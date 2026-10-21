import csv
import json
import tempfile
import unittest
from pathlib import Path

from store import UsageStore


def event(key, username, input_tokens):
    return {
        "key": key,
        "date": "2026-10-09",
        "user": username,
        "agent": "copilot-chat",
        "model": "test-model",
        "input_tokens": input_tokens,
        "output_tokens": 10,
        "cost": 0.01,
        "priced": True,
    }


class UsageStoreTests(unittest.TestCase):
    def test_daily_call_times_use_event_timestamps_and_survive_replay(self):
        with tempfile.TemporaryDirectory() as directory:
            store = UsageStore(directory)
            first = event("first", "alice", 100)
            first["timestamp"] = "2026-10-09T12:00:00+05:30"
            last = event("last", "alice", 200)
            last["timestamp"] = "2026-10-09T08:00:00+00:00"
            legacy = event("legacy", "alice", 50)
            store.add_events([last, legacy, first])
            row = store.summary()[0]
            self.assertEqual(row["first_seen"], "2026-10-09T06:30:00+00:00")
            self.assertEqual(row["last_seen"], "2026-10-09T08:00:00+00:00")
            self.assertEqual(row["requests"], 3)
            self.assertEqual(row["total_tokens"], 380)
            self.assertEqual(UsageStore(directory).summary(), [row])
            with open(store.daily_path, newline="", encoding="utf-8") as source:
                csv_row = next(csv.DictReader(source))
            self.assertEqual(csv_row["first_seen"], row["first_seen"])
            self.assertEqual(csv_row["last_seen"], row["last_seen"])

    def test_legacy_events_do_not_invent_call_times(self):
        with tempfile.TemporaryDirectory() as directory:
            store = UsageStore(directory)
            store.add_events([event("legacy", "alice", 100)])
            row = store.summary()[0]
            self.assertIsNone(row["first_seen"])
            self.assertIsNone(row["last_seen"])

    def test_agent_totals_latency_and_legacy_replay(self):
        with tempfile.TemporaryDirectory() as directory:
            store = UsageStore(directory)
            planner = event("planner", "alice", 100)
            planner.update(agent="Planner", latency_ms=250.0)
            reviewer = event("reviewer", "alice", 200)
            reviewer.update(agent="Reviewer", latency_ms=500.0)
            legacy = event("legacy", "alice", 50)
            legacy.update(agent="Planner")
            self.assertEqual(store.add_events([planner, reviewer, legacy]), 3)
            self.assertEqual(store.add_events([planner]), 0)
            rows = {row["agent"]: row for row in store.summary()}
            self.assertEqual(rows["Planner"]["total_tokens"], 170)
            self.assertEqual(rows["Planner"]["latency_ms_avg"], 250.0)
            self.assertEqual(rows["Reviewer"]["total_tokens"], 210)
            self.assertEqual(rows["Reviewer"]["latency_ms_avg"], 500.0)
            self.assertEqual(UsageStore(directory).summary(), store.summary())

    def test_delete_user_rebuilds_ledger_and_summaries(self):
        with tempfile.TemporaryDirectory() as directory:
            store = UsageStore(directory)
            events = [
                event("alice-1", "alice", 100),
                event("alice-2", "alice", 200),
                event("alice-other", "alice2", 300),
                event("bob-1", "bob", 400),
            ]
            self.assertEqual(store.add_events(events), 4)

            self.assertEqual(store.delete_user("alice"), 2)
            self.assertEqual({row["user"] for row in store.summary()}, {"alice2", "bob"})
            self.assertEqual(
                [json.loads(line)["user"] for line in store.events_path.read_text().splitlines()],
                ["alice2", "bob"],
            )

            with open(store.daily_path, newline="", encoding="utf-8") as summary_file:
                daily_rows = list(csv.DictReader(summary_file))
            self.assertEqual({row["user"] for row in daily_rows}, {"alice2", "bob"})
            with open(store.totals_path, newline="", encoding="utf-8") as totals_file:
                totals = list(csv.DictReader(totals_file))
            self.assertEqual(totals[0]["input_tokens"], "700")

            reloaded = UsageStore(directory)
            self.assertEqual({row["user"] for row in reloaded.summary()}, {"alice2", "bob"})

    def test_delete_user_returns_zero_when_user_has_no_events(self):
        with tempfile.TemporaryDirectory() as directory:
            store = UsageStore(directory)
            store.add_events([event("bob-1", "bob", 100)])

            self.assertEqual(store.delete_user("alice"), 0)
            self.assertEqual({row["user"] for row in store.summary()}, {"bob"})


if __name__ == "__main__":
    unittest.main()