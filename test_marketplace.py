import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import requests

import marketplace


AGENT_PATH = ".github/agents/a1.1-product-discovery.agent.md"
MANIFEST_PATH = ".github/manifests/a1.1-product-discovery.manifest.yaml"
RAW_ROOT = f"https://raw.githubusercontent.com/{marketplace.REPOSITORY}/revision"
MARKDOWN = """---
name: a1.1-product-discovery
description: Synthesizes evidence into opportunities.
argument-hint: project=<project>
---
# Instructions are not catalogue metadata.
"""
MANIFEST = """agent:
  name: Product Discovery
  version: "1.0.0"
  status: accepted
skills:
  - name: synthesize-evidence-themes
"""


def tree(*paths):
    return {"sha": "revision", "tree": [{"path": path, "type": "blob"} for path in paths]}


class MarketplaceTests(unittest.TestCase):
    def test_loads_only_agent_definitions_with_matching_manifest_details(self):
        listing = tree(
            AGENT_PATH, MANIFEST_PATH,
            ".github/skills/reviewer/SKILL.md",
            ".github/manifests/x01-builder.manifest.yaml",
            ".github/prompts/discovery.prompt.md",
            "docs/example.agent.md",
        )
        files = {f"{RAW_ROOT}/{AGENT_PATH}": MARKDOWN,
                 f"{RAW_ROOT}/{MANIFEST_PATH}": MANIFEST}
        with patch.object(marketplace, "_fetch_json", return_value=listing), \
                patch.object(marketplace, "_fetch_text", side_effect=files.__getitem__) as fetch:
            agents = marketplace._load_agents(marketplace.DEFAULT_MARKETPLACE_URL)
        self.assertEqual(fetch.call_count, 2)
        self.assertEqual(len(agents), 1)
        agent = agents[0]
        self.assertEqual(agent["id"], "a1.1-product-discovery")
        self.assertEqual(agent["name"], "a1.1-product-discovery")
        self.assertEqual(agent["display_name"], "Product Discovery")
        self.assertEqual(agent["description"], "Synthesizes evidence into opportunities.")
        self.assertEqual(agent["argument_hint"], "project=<project>")
        self.assertEqual(agent["version"], "1.0.0")
        self.assertEqual(agent["status"], "accepted")
        self.assertEqual(agent["skills"], ["synthesize-evidence-themes"])
        self.assertEqual(agent["kind"], "agent")
        self.assertEqual(agent["url"],
                         f"{marketplace.REPOSITORY_URL}/blob/revision/{AGENT_PATH}")

    def test_agent_without_manifest_is_included_and_nested_definitions_are_discovered(self):
        path = ".github/agents/utilities/helper.agent.md"
        with patch.object(marketplace, "_fetch_json", return_value=tree(path)), \
                patch.object(marketplace, "_fetch_text", return_value="---\ndescription: Help\n---"):
            agents = marketplace._load_agents(marketplace.DEFAULT_MARKETPLACE_URL)
        self.assertEqual(agents[0]["id"], "helper")
        self.assertEqual(agents[0]["name"], "helper")
        self.assertEqual(agents[0]["skills"], [])
        self.assertEqual(agents[0]["version"], "")

    def test_agent_order_is_deterministic(self):
        paths = [".github/agents/z.agent.md", ".github/agents/a.agent.md"]
        with patch.object(marketplace, "_fetch_json", return_value=tree(*paths)), \
                patch.object(marketplace, "_fetch_text", return_value="---\ndescription: Help\n---"):
            agents = marketplace._load_agents(marketplace.DEFAULT_MARKETPLACE_URL)
        self.assertEqual([agent["id"] for agent in agents], ["a", "z"])

    def test_rejects_empty_truncated_or_malformed_repository_tree(self):
        for listing in (tree(), {**tree(AGENT_PATH), "truncated": True},
                        {"tree": []}, {"sha": "revision", "tree": None}):
            with self.subTest(listing=listing), \
                    patch.object(marketplace, "_fetch_json", return_value=listing):
                with self.assertRaises(ValueError):
                    marketplace._load_agents(marketplace.DEFAULT_MARKETPLACE_URL)

    def test_invalid_definition_or_manifest_fails_explicitly_with_agent_path(self):
        for markdown, manifest in (
            ("# No frontmatter", MANIFEST),
            ("---\nname: [\n---", MANIFEST),
            (MARKDOWN, "[]"),
            (MARKDOWN, "agent: []"),
            (MARKDOWN, "skills: {}"),
        ):
            files = {f"{RAW_ROOT}/{AGENT_PATH}": markdown,
                     f"{RAW_ROOT}/{MANIFEST_PATH}": manifest}
            with self.subTest(manifest=manifest), \
                    patch.object(marketplace, "_fetch_json",
                                 return_value=tree(AGENT_PATH, MANIFEST_PATH)), \
                    patch.object(marketplace, "_fetch_text", side_effect=files.__getitem__):
                with self.assertRaisesRegex(ValueError, AGENT_PATH):
                    marketplace._load_agents(marketplace.DEFAULT_MARKETPLACE_URL)

    def test_server_side_token_authenticates_requests(self):
        response = Mock(text=MARKDOWN)
        response.json.return_value = tree(AGENT_PATH)
        with patch.dict("os.environ", {"AGENT_MARKETPLACE_TOKEN": "test-token"}), \
                patch.object(marketplace.requests, "get", return_value=response) as get:
            marketplace._fetch_json(marketplace.DEFAULT_MARKETPLACE_URL)
            marketplace._fetch_text(f"{RAW_ROOT}/{AGENT_PATH}")
        for call in get.call_args_list:
            self.assertEqual(call.kwargs["headers"]["Authorization"], "Bearer test-token")
        self.assertEqual(response.raise_for_status.call_count, 2)

    def test_old_marketplace_overrides_cannot_change_repository(self):
        with tempfile.TemporaryDirectory() as directory, \
                patch.dict("os.environ", {"AGENT_MARKETPLACE_URL": "https://old.test/catalog",
                                         "AGENT_MARKETPLACE_ROOT_URL": "https://old.test/"}):
            catalog = marketplace.MarketplaceCatalog(str(Path(directory) / "catalog.json"))
        self.assertEqual(catalog.source_url, marketplace.DEFAULT_MARKETPLACE_URL)

    def test_keeps_only_same_source_cached_catalog_when_refresh_fails(self):
        agent = {"id": "cached", "name": "Cached", "kind": "agent"}
        with tempfile.TemporaryDirectory() as directory:
            cache_path = Path(directory) / "catalog.json"
            cache_path.write_text(json.dumps({
                "source": marketplace.DEFAULT_MARKETPLACE_URL,
                "version": marketplace.CACHE_VERSION,
                "loaded_at": "2026-10-01T00:00:00+00:00", "agents": [agent],
            }), encoding="utf-8")
            with patch.dict("os.environ", {"AGENT_MARKETPLACE_TTL": "0"}), \
                    patch.object(marketplace, "_load_agents", side_effect=OSError("offline")):
                catalog = marketplace.MarketplaceCatalog(str(cache_path)).get()
        self.assertEqual(catalog["agents"], [agent])
        self.assertTrue(catalog["stale"])
        self.assertEqual(catalog["error"], "offline")
        self.assertEqual(catalog["source"], marketplace.REPOSITORY_URL)

    def test_old_cache_never_leaks_other_agents_after_refresh_failure(self):
        for source in (None, "https://old.test/catalog", marketplace.DEFAULT_MARKETPLACE_URL):
            with self.subTest(source=source), tempfile.TemporaryDirectory() as directory:
                cache_path = Path(directory) / "catalog.json"
                cache_path.write_text(json.dumps({
                    "source": source, "loaded_at": "2026-10-01", "agents": [{"name": "Old"}],
                }), encoding="utf-8")
                with patch.object(marketplace, "_load_agents", side_effect=OSError("offline")):
                    catalog = marketplace.MarketplaceCatalog(str(cache_path)).get()
                self.assertEqual(catalog["agents"], [])
                self.assertFalse(catalog["stale"])
                self.assertEqual(catalog["error"], "offline")

    def test_successful_refresh_persists_and_reuses_repository_catalogue(self):
        agent = {"id": "discovery", "name": "Discovery", "kind": "agent"}
        with tempfile.TemporaryDirectory() as directory:
            cache_path = Path(directory) / "catalog.json"
            with patch.object(marketplace, "_load_agents", return_value=[agent]) as load:
                catalog = marketplace.MarketplaceCatalog(str(cache_path))
                result = catalog.get()
                self.assertEqual(catalog.get(), result)
                load.assert_called_once_with(marketplace.DEFAULT_MARKETPLACE_URL)
            saved = json.loads(cache_path.read_text(encoding="utf-8"))
            self.assertEqual(saved["source"], marketplace.DEFAULT_MARKETPLACE_URL)
            self.assertEqual(saved["version"], marketplace.CACHE_VERSION)
            self.assertEqual(saved["agents"], [agent])
            self.assertEqual(marketplace.MarketplaceCatalog(str(cache_path))._agents, [agent])

    def test_failed_refresh_is_retried_after_cooldown_without_claiming_success(self):
        with tempfile.TemporaryDirectory() as directory, \
                patch.object(marketplace, "monotonic", return_value=100) as clock, \
                patch.object(marketplace, "_load_agents",
                             side_effect=requests.ConnectionError("offline")) as load:
            catalog = marketplace.MarketplaceCatalog(str(Path(directory) / "catalog.json"))
            self.assertEqual(catalog.get()["error"], "offline")
            catalog.get()
            self.assertEqual(load.call_count, 1)
            clock.return_value = 131
            catalog.get()
            self.assertEqual(load.call_count, 2)


if __name__ == "__main__":
    unittest.main()
