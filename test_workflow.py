import unittest
from pathlib import Path

import yaml


class StaticWebAppWorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        path = Path(__file__).parent / ".github/workflows/azure-static-web-apps-polite-cliff-03667eb10.yml"
        cls.workflow = yaml.safe_load(path.read_text(encoding="utf-8"))
        cls.build_job = cls.workflow["jobs"]["build_and_deploy_job"]

    def test_upload_is_restricted_to_main_pushes(self):
        uploads = [
            step for step in self.build_job["steps"]
            if step.get("with", {}).get("action") == "upload"
        ]
        self.assertEqual(len(uploads), 1)
        self.assertEqual(
            uploads[0]["if"],
            "github.event_name == 'push' && github.ref == 'refs/heads/main'",
        )
        self.assertEqual(uploads[0]["with"]["app_location"], "./frontend")
        self.assertEqual(uploads[0]["with"]["output_location"], "out")

    def test_pull_requests_still_build_with_the_production_api_url(self):
        steps = self.build_job["steps"]
        setup = next(step for step in steps if step.get("uses", "").startswith("actions/setup-node@"))
        build = next(step for step in steps if "npm run build" in step.get("run", ""))
        upload = next(step for step in steps if step.get("id") == "builddeploy")
        self.assertEqual(setup["if"], "github.event_name == 'pull_request'")
        self.assertEqual(setup["with"]["node-version"], "22")
        self.assertEqual(build["if"], "github.event_name == 'pull_request'")
        self.assertEqual(build["working-directory"], "./frontend")
        self.assertEqual(build["run"].splitlines(), ["npm ci", "npm run build"])
        self.assertEqual(build["env"], upload["env"])
        self.assertLess(steps.index(setup), steps.index(build))
        self.assertNotIn("continue-on-error", build)
        self.assertIn("github.event.action != 'closed'", self.build_job["if"])

    def test_closed_pull_requests_still_clean_up_existing_previews(self):
        close_job = self.workflow["jobs"]["close_pull_request_job"]
        self.assertEqual(
            close_job["if"],
            "github.event_name == 'pull_request' && github.event.action == 'closed'",
        )
        self.assertEqual(close_job["steps"][0]["with"]["action"], "close")


if __name__ == "__main__":
    unittest.main()
