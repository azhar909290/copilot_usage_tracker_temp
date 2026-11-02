"""Persistent, randomly assigned demo teams for observed telemetry users."""
import json
import os
import random
import threading
from pathlib import Path

from user_mapping import normalize_user

TEAM_NAMES = ("Data", "AI", "Cognitive core", "Rapid labs", "Innovation")
TEAM_ORGANIZATION = os.getenv("TEAM_ORGANIZATION", "").strip() or "tth-cto-innovation"


class DemoTeams:
    def __init__(self, path: Path):
        self.path = path
        self._lock = threading.Lock()
        self._random = random.SystemRandom()
        self._assignments: dict[str, str] = {}
        if path.exists():
            assignments = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(assignments, dict) or any(
                not isinstance(user, str) or not normalize_user(user)
                or not isinstance(team, str) or team not in TEAM_NAMES
                for user, team in assignments.items()
            ):
                raise ValueError(f"Invalid demo team assignments in {path}")
            self._assignments = assignments

    def _save(self, assignments: dict[str, str]) -> None:
        temp = self.path.with_suffix(".tmp")
        temp.write_text(json.dumps(assignments, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        os.replace(temp, self.path)
        self._assignments = assignments

    def for_users(self, users: list[str]) -> dict:
        canonical_users = sorted({name for user in users if (name := normalize_user(user))})
        with self._lock:
            assignments = dict(self._assignments)
            counts = {team: sum(value == team for value in assignments.values()) for team in TEAM_NAMES}
            for user in canonical_users:
                if user not in assignments:
                    smallest = min(counts.values())
                    team = self._random.choice([name for name in TEAM_NAMES if counts[name] == smallest])
                    assignments[user] = team
                    counts[team] += 1
            if assignments != self._assignments:
                self._save(assignments)
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
                self._save(assignments)
