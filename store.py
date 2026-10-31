"""File-based storage: events.jsonl (ledger) + daily_usage.csv / daily_totals.csv."""
import csv
import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path

from user_mapping import normalize_user, FILE_EXTENSION_PATTERN
from teams import DemoTeams

DAILY_FIELDS = [
    "date", "user", "agent", "model",
    "requests", "input_tokens", "output_tokens", "total_tokens", "cost", "unpriced_requests",
    "latency_ms_total", "latency_requests",
    "first_seen", "last_seen",
]
TOTAL_FIELDS = ["date", "requests", "input_tokens", "output_tokens", "total_tokens", "cost"]


class UsageStore:
    def __init__(self, data_dir: str):
        self.dir = Path(data_dir)
        self.dir.mkdir(parents=True, exist_ok=True)
        self.events_path = self.dir / "events.jsonl"
        self.daily_path = self.dir / "daily_usage.csv"
        self.totals_path = self.dir / "daily_totals.csv"
        self._lock = threading.Lock()
        self._seen: set[str] = set()
        self._daily: dict[tuple, dict] = {}
        self._events: list[dict] = []
        self._teams = DemoTeams(self.dir / "team_assignments.json")
        self._replay()

    def _accumulate(self, e: dict) -> None:
        raw_user = e.get("user")
        normalized = normalize_user(raw_user)
        if normalized:
            user = normalized
        elif raw_user and not FILE_EXTENSION_PATTERN.search(str(raw_user)):
            user = str(raw_user).strip()
        else:
            user = "unknown"
        e["user"] = user

        k = (e["date"], user, e["agent"], e["model"])
        r = self._daily.setdefault(
            k,
            dict(requests=0, input_tokens=0, output_tokens=0, total_tokens=0,
                 cost=0.0, unpriced_requests=0, latency_ms_total=0.0, latency_requests=0,
                 first_seen=None, last_seen=None),
        )
        if e.get("timestamp"):
            timestamp = datetime.fromisoformat(e["timestamp"])
            if timestamp.tzinfo is None:
                raise ValueError("Usage event timestamp must include a timezone")
            timestamp = timestamp.astimezone(timezone.utc).isoformat()
            r["first_seen"] = min(r["first_seen"] or timestamp, timestamp)
            r["last_seen"] = max(r["last_seen"] or timestamp, timestamp)
        r["requests"] += 1
        r["input_tokens"] += e["input_tokens"]
        r["output_tokens"] += e["output_tokens"]
        r["total_tokens"] += e["input_tokens"] + e["output_tokens"]
        latency_ms = e.get("latency_ms")
        if latency_ms is not None:
            r["latency_ms_total"] += latency_ms
            r["latency_requests"] += 1
        r["cost"] += e["cost"]
        if not e["priced"]:
            r["unpriced_requests"] += 1

    def _replay(self) -> None:
        if not self.events_path.exists():
            return
        with open(self.events_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                e = json.loads(line)
                self._seen.add(e["key"])
                self._accumulate(e)
                self._events.append(e)
        self._flush_csv()

    def _write_csv(self, path: Path, fields: list[str], rows: list[dict]) -> None:
        tmp = path.with_suffix(".tmp")
        with open(tmp, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=fields)
            w.writeheader()
            w.writerows(rows)
        os.replace(tmp, path)

    def add_events(self, events: list[dict]) -> int:
        with self._lock:
            new = [e for e in events if e["key"] not in self._seen]
            if not new:
                return 0
            with open(self.events_path, "a", encoding="utf-8") as f:
                for e in new:
                    norm = normalize_user(e.get("user"))
                    if norm:
                        e["user"] = norm
                    f.write(json.dumps(e) + "\n")
                    self._seen.add(e["key"])
                    self._accumulate(e)
                    self._events.append(e)
            self._flush_csv()
            return len(new)

    def delete_user(self, username: str) -> int:
        with self._lock:
            if not self.events_path.exists():
                self._teams.remove_user(username)
                return 0

            retained_lines = []
            deleted = 0
            with open(self.events_path, "r", encoding="utf-8") as source:
                for line in source:
                    event = json.loads(line)
                    if event.get("user") == username:
                        deleted += 1
                    else:
                        retained_lines.append(line)

            if not deleted:
                self._teams.remove_user(username)
                return 0

            temp_path = self.events_path.with_suffix(".tmp")
            with open(temp_path, "w", encoding="utf-8") as target:
                target.writelines(retained_lines)
            os.replace(temp_path, self.events_path)

            self._seen.clear()
            self._daily.clear()
            self._events.clear()
            self._replay()
            self._flush_csv()
            self._teams.remove_user(username)
            return deleted

    def _flush_csv(self) -> None:
        rows, totals = [], {}
        for (date, user, agent, model), r in sorted(self._daily.items()):
            rows.append(
                dict(date=date, user=user, agent=agent, model=model,
                     **{**r, "cost": round(r["cost"], 6)})
            )
            t = totals.setdefault(date, dict(requests=0, input_tokens=0, output_tokens=0,
                                             total_tokens=0, cost=0.0))
            for k in t:
                t[k] += r[k]
        self._write_csv(self.daily_path, DAILY_FIELDS, rows)
        self._write_csv(
            self.totals_path, TOTAL_FIELDS,
            [dict(date=d, **{**t, "cost": round(t["cost"], 6)}) for d, t in sorted(totals.items())],
        )

    def summary(self) -> list[dict]:
        with self._lock:
            return [
                 dict(date=d, user=u, agent=a, model=m,
                     **{**r, "cost": round(r["cost"], 6)},
                     latency_ms_avg=(r["latency_ms_total"] / r["latency_requests"]
                                  if r["latency_requests"] else None))
                for (d, u, a, m), r in sorted(self._daily.items())
            ]

    def get_events(self, limit: int | None = None) -> list[dict]:
        with self._lock:
            if limit and limit > 0:
                return self._events[-limit:]
            return list(self._events)

    def get_teams(self) -> dict:
        with self._lock:
            users = sorted({user for _, user, _, _ in self._daily})
            return self._teams.for_users(users)
