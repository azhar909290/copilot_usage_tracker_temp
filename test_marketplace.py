import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import marketplace


class MarketplaceTests(unittest.TestCase):
    def test_converts_github_blob_url_to_raw_content_url(self):
        url = "https://github.com/org/repo/blob/main/.github/plugin/marketplace.json"

        normalized = marketplace._normalize_marketplace_url(url)

        self.assertEqual(
            normalized,
            "https://raw.githubusercontent.com/org/repo/main/.github/plugin/marketplace.json",
        )

    def test_loads_agent_metadata_from_plugin_manifest(self):
        json_payloads = {
            "https://example.test/marketplace.json": {
                "plugins": [
                    {
                        "id": "doc-tools",
                        "name": "Document Tools",
                        "version": "2.1.0",
                        "path": "Plugins/doc-tools/plugin.json",
                    }
                ]
            },
            "https://example.test/Plugins/doc-tools/plugin.json": {
                "components": {"agents": ["agents/Project-Documenter.agent.md"]}
            },
        }
        markdown = "---\nname: Project-Documenter\ndescription: Writes project docs\n---\n"

        with patch.object(marketplace, "_fetch_json", side_effect=json_payloads.__getitem__), \
                patch.object(marketplace, "_fetch_text", return_value=markdown):
            agents = marketplace._load_agents(
                "https://example.test/marketplace.json",
                "https://example.test/",
            )

        self.assertEqual(len(agents), 1)
        self.assertEqual(agents[0]["name"], "Project-Documenter")
        self.assertEqual(agents[0]["plugin_name"], "Document Tools")
        self.assertEqual(agents[0]["version"], "2.1.0")

    def test_invalid_agent_error_identifies_source_file(self):
        json_payloads = [
            {"plugins": [{"path": "plugin.json"}]},
            {"components": {"agents": ["agents/broken.agent.md"]}},
        ]
        with patch.object(marketplace, "_fetch_json", side_effect=json_payloads), \
                patch.object(marketplace, "_fetch_text", return_value="# Agent without metadata"):
            with self.assertRaisesRegex(
                ValueError,
                r"https://example\.test/agents/broken\.agent\.md: Agent definition is missing YAML frontmatter",
            ):
                marketplace._load_agents(
                    "https://example.test/marketplace.json", "https://example.test/"
                )

    def test_keeps_cached_catalog_when_refresh_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            cache_path = Path(directory) / "catalog.json"
            cache_path.write_text(
                json.dumps({"loaded_at": "2026-10-01T00:00:00+00:00", "agents": [{"name": "Cached"}]}),
                encoding="utf-8",
            )
            with patch.dict("os.environ", {"AGENT_MARKETPLACE_TTL": "0"}), \
                    patch.object(marketplace, "_load_agents", side_effect=OSError("offline")):
                catalog = marketplace.MarketplaceCatalog(str(cache_path)).get()

        self.assertEqual(catalog["agents"], [{"name": "Cached"}])
        self.assertTrue(catalog["stale"])
        self.assertEqual(catalog["error"], "offline")


if __name__ == "__main__":
    unittest.main()