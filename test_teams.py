import json
import tempfile
import unittest
from collections import Counter
from pathlib import Path
from unittest.mock import patch

from store import UsageStore
from teams import DemoTeams, TEAM_NAMES
from test_store import event


class DemoTeamTests(unittest.TestCase):
    def test_assignments_are_balanced_persisted_and_stable(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "team_assignments.json"
            teams = DemoTeams(path)
            users = [f"user-{i}" for i in range(23)]
            result = teams.for_users(users)
            self.assertTrue(result["demo"])
            self.assertEqual(result["organization"], "tth-cto-innovation")
            self.assertEqual(result["names"], list(TEAM_NAMES))
            self.assertEqual(set(result["assignments"]), set(users))
            counts = Counter(result["assignments"].values())
            self.assertEqual(len(counts), 5)
            self.assertLessEqual(max(counts.values()) - min(counts.values()), 1)
            self.assertEqual(json.loads(path.read_text()), result["assignments"])
            self.assertEqual(DemoTeams(path).for_users(list(reversed(users))), result)
            added = teams.for_users(users + ["new-user"])["assignments"]
            self.assertEqual({user: added[user] for user in users}, result["assignments"])

    def test_aliases_share_membership_and_unknown_is_unassigned(self):
        with tempfile.TemporaryDirectory() as directory:
            teams = DemoTeams(Path(directory) / "team_assignments.json")
            result = teams.for_users(["2860041", "EswaraGollangi", "eswarasai-25", "unknown", ""])
            self.assertEqual(list(result["assignments"]), ["eswarasai-25"])

    def test_invalid_saved_assignments_and_write_errors_are_explicit(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "team_assignments.json"
            path.write_text('{"alice": "not-a-team"}')
            with self.assertRaises(ValueError):
                DemoTeams(path)
            path.unlink()
            teams = DemoTeams(path)
            with patch("teams.os.replace", side_effect=OSError("cannot save")):
                with self.assertRaises(OSError):
                    teams.for_users(["alice"])
            self.assertEqual(teams._assignments, {})

    def test_store_assigns_all_observed_users_and_removes_deleted_membership(self):
        with tempfile.TemporaryDirectory() as directory:
            store = UsageStore(directory)
            store.add_events([event("a", "alice", 100), event("b", "bob", 50), event("u", "unknown", 20)])
            teams = store.get_teams()
            self.assertEqual(set(teams["assignments"]), {"alice", "bob"})
            self.assertEqual(UsageStore(directory).get_teams(), teams)
            store.delete_user("alice")
            self.assertEqual(set(store.get_teams()["assignments"]), {"bob"})
            self.assertNotIn("alice", json.loads((Path(directory) / "team_assignments.json").read_text()))


if __name__ == "__main__":
    unittest.main()
