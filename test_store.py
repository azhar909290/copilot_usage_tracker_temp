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