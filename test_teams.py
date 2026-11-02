import unittest
from collections import Counter
import tempfile

from store import UsageStore
from teams import DemoTeams, TEAM_NAMES
from team_assignments import TEAM_ASSIGNMENTS
from test_store import event


class DemoTeamTests(unittest.TestCase):
    def test_team_assignments_loaded_from_python_module(self):
        teams = DemoTeams()
        self.assertGreater(len(TEAM_ASSIGNMENTS), 25)
        # Verify all assigned teams are valid team names
        self.assertTrue(all(team in TEAM_NAMES for team in TEAM_ASSIGNMENTS.values()))
        # Check canonical users mapped correctly
        result = teams.for_users(["azhar909290", "AnirudhTrivedi"])
        self.assertEqual(result["assignments"]["azhar909290"], "Innovation")
        self.assertEqual(result["assignments"]["AnirudhTrivedi"], "AI")
        self.assertTrue(result["demo"])
        self.assertEqual(result["organization"], "tth-cto-innovation")
        self.assertEqual(result["names"], list(TEAM_NAMES))

    def test_aliases_share_membership_and_unknown_is_unassigned(self):
        teams = DemoTeams()
        result = teams.for_users(["2860041", "EswaraGollangi", "eswarasai-25", "unknown", "azureuser", ""])
        self.assertEqual(list(result["assignments"]), ["eswarasai-25"])
        self.assertEqual(result["assignments"]["eswarasai-25"], "Data")

    def test_dynamic_users_are_balanced_and_stable(self):
        teams = DemoTeams()
        users = [f"custom-user-{i}" for i in range(20)]
        result = teams.for_users(users)
        self.assertEqual(set(result["assignments"]), set(users))
        # All teams have assignments
        self.assertEqual(len(Counter(result["assignments"].values())), 5)
        # Total team memberships remain balanced across the organization
        total_counts = Counter(teams._assignments.values())
        self.assertLessEqual(max(total_counts.values()) - min(total_counts.values()), 1)
        # Calling again gives the exact same assignments
        self.assertEqual(teams.for_users(list(reversed(users))), result)

    def test_store_assigns_all_observed_users_and_removes_deleted_membership(self):
        with tempfile.TemporaryDirectory() as directory:
            store = UsageStore(directory)
            store.add_events([
                event("a", "alice", 100),
                event("b", "bob", 50),
                event("u", "unknown", 20),
                event("c", "azhar909290", 10),
            ])
            teams = store.get_teams()
            self.assertEqual(set(teams["assignments"]), {"alice", "bob", "azhar909290"})
            self.assertEqual(teams["assignments"]["azhar909290"], "Innovation")
            self.assertEqual(UsageStore(directory).get_teams(), teams)

            # Deleting a user removes them from team assignments
            store.delete_user("alice")
            self.assertEqual(set(store.get_teams()["assignments"]), {"bob", "azhar909290"})


if __name__ == "__main__":
    unittest.main()
