"""File-based storage: events.jsonl (ledger) + daily_usage.csv / daily_totals.csv."""
import csv
import json
import os
import threading
from pathlib import Path

DAILY_FIELDS = [
    "date", "user", "agent", "model",
    "requests", "input_tokens", "output_tokens", "cost", "unpriced_requests",
]
TOTAL_FIELDS = ["date", "requests", "input_tokens", "output_tokens", "cost"]


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
        self._replay()

    def _accumulate(self, e: dict) -> None:
        k = (e["date"], e["user"], e["agent"], e["model"])
        r = self._daily.setdefault(
            k,
            dict(requests=0, input_tokens=0, output_tokens=0, cost=0.0, unpriced_requests=0),
        )
        r["requests"] += 1
        r["input_tokens"] += e["input_tokens"]
        r["output_tokens"] += e["output_tokens"]
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
                    f.write(json.dumps(e) + "\n")
                    self._seen.add(e["key"])
                    self._accumulate(e)
            self._flush_csv()
            return len(new)

    def _flush_csv(self) -> None:
        rows, totals = [], {}
        for (date, user, agent, model), r in sorted(self._daily.items()):
            rows.append(
                dict(date=date, user=user, agent=agent, model=model,
                     **{**r, "cost": round(r["cost"], 6)})
            )
            t = totals.setdefault(date, dict(requests=0, input_tokens=0, output_tokens=0, cost=0.0))
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
                dict(date=d, user=u, agent=a, model=m, **{**r, "cost": round(r["cost"], 6)})
                for (d, u, a, m), r in sorted(self._daily.items())
            ]
