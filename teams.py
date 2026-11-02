"""Team management and assignments for observed telemetry users."""
import hashlib
import os
import threading
from pathlib import Path

from user_mapping import normalize_user
from team_assignments import TEAM_NAMES, TEAM_ASSIGNMENTS

TEAM_ORGANIZATION = os.getenv("TEAM_ORGANIZATION", "").strip() or "tth-cto-innovation"


class DemoTeams:
    def __init__(self, path: Path | None = None):
        self.path = path
        self._lock = threading.Lock()
        # Seed from team_assignments.py
        self._assignments: dict[str, str] = dict(TEAM_ASSIGNMENTS)

        if path and path.exists():
            import json
            try:
                assignments = json.loads(path.read_text(encoding="utf-8"))
                if isinstance(assignments, dict):
                    for user, team in assignments.items():
                        if isinstance(user, str) and isinstance(team, str) and team in TEAM_NAMES:
                            canonical = normalize_user(user)
                            if canonical:
                                self._assignments[canonical] = team
            except Exception:
                pass

    def for_users(self, users: list[str]) -> dict:
        canonical_users = sorted({name for user in users if (name := normalize_user(user))})
        with self._lock:
            assignments = dict(self._assignments)
            counts = {team: sum(value == team for value in assignments.values()) for team in TEAM_NAMES}
            for user in canonical_users:
                if user not in assignments:
                    smallest = min(counts[team] for team in TEAM_NAMES)
                    candidates = [team for team in TEAM_NAMES if counts[team] == smallest]
                    team = min(candidates, key=lambda t: hashlib.md5(f"{user}:{t}".encode()).hexdigest())
                    assignments[user] = team
                    counts[team] += 1
            self._assignments = assignments
            return {
                "demo": True,
                "organization": TEAM_ORGANIZATION,
                "names": list(TEAM_NAMES),
                "assignments": {user: assignments[user] for user in canonical_users},
            }

    def remove_user(self, user: str) -> None:
        with self._lock:
            if user in self._assignments:
                assignments = dict(self._assignments)
                del assignments[user]
                self._assignments = assignments
