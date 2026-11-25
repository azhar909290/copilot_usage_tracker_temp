"""Load the AgentVerse development journey's agent catalogue from GitHub."""
import json
import logging
import os
import re
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from time import monotonic

import requests
import yaml

REPOSITORY = "tthctoinnovation/agentverse-devjourney"
REPOSITORY_URL = f"https://github.com/{REPOSITORY}"
DEFAULT_MARKETPLACE_URL = f"https://api.github.com/repos/{REPOSITORY}/git/trees/HEAD?recursive=1"
CACHE_VERSION = 2
log = logging.getLogger("agent_marketplace")


def _headers() -> dict[str, str]:
    token = os.getenv("AGENT_MARKETPLACE_TOKEN", "").strip()
    return {"Authorization": f"Bearer {token}"} if token else {}


def _fetch_json(url: str) -> dict:
    response = requests.get(url, headers=_headers(), timeout=(5, 15))
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict):
        raise ValueError(f"Expected a JSON object from {url}")
    return payload


def _fetch_text(url: str) -> str:
    response = requests.get(url, headers=_headers(), timeout=(5, 15))
    response.raise_for_status()
    return response.text


def _agent_metadata(markdown: str) -> dict:
    lines = markdown.splitlines()
    if not lines or lines[0].strip() != "---":
        raise ValueError("Agent definition is missing YAML frontmatter")
    try:
        end = next(i for i, line in enumerate(lines[1:], 1) if line.strip() == "---")
    except StopIteration as error:
        raise ValueError("Agent definition has unterminated YAML frontmatter") from error
    metadata = yaml.safe_load("\n".join(lines[1:end])) or {}
    if not isinstance(metadata, dict):
        raise ValueError("Agent frontmatter must be a YAML object")
    return metadata


def _catalogue_agents(markdown: str, path: str, revision: str) -> list[dict]:
    agents = []
    sections = re.finditer(
        r"^#{4,6}\s+([A-Z]\d+\.\d+)\s+([^\n]+)\n(.*?)(?=^#{1,6}\s|\Z)",
        markdown, re.MULTILINE | re.DOTALL,
    )
    for section in sections:
        reference, title, body = section.groups()
        if not re.search(r"\bBuilt\b", title):
            continue
        name = re.search(
            r"Registered name:[*_` ]*([a-z][a-z0-9.]*-[a-z0-9-]+)",
            body, re.IGNORECASE,
        )
        purpose = re.search(
            r"\*\*Purpose:\*\*\s*(.+?)(?=\n\s*\n|\n\*\*|\Z)", body, re.DOTALL,
        )
        if not name or not purpose:
            raise ValueError(f"Built agent {reference} in {path} is missing its name or purpose")
        display_name = re.split(r"\s+Agent\s+", title, maxsplit=1)[0].strip()
        agents.append({
            "id": name[1],
            "name": name[1],
            "display_name": display_name,
            "description": " ".join(purpose[1].split()),
            "argument_hint": "",
            "plugin_id": REPOSITORY,
            "plugin_name": "AgentVerse DevJourney",
            "version": "",
            "status": "Built (catalogue)",
            "path": path,
            "url": f"{REPOSITORY_URL}/blob/{revision}/{path}",
            "kind": "agent",
            "skills": [],
            "has_definition": False,
            "catalogue": Path(path).stem,
        })
    return agents


def _load_agents(source_url: str) -> list[dict]:
    listing = _fetch_json(source_url)
    tree = listing.get("tree")
    revision = listing.get("sha")
    if (listing.get("truncated") or not isinstance(tree, list)
            or not isinstance(revision, str) or not revision):
        raise ValueError("GitHub returned an incomplete repository tree")
    paths = {
        item["path"] for item in tree
        if isinstance(item, dict) and item.get("type") == "blob"
        and isinstance(item.get("path"), str)
    }
    agent_paths = sorted(
        path for path in paths
        if path.startswith(".github/agents/") and path.endswith(".agent.md")
    )
    catalogue_paths = sorted(
        path for path in paths
        if path.startswith("docs/agent-catalogue/") and path.endswith(".md")
    )
    if not agent_paths and not catalogue_paths:
        raise ValueError("No agent definitions found in the repository's .github/agents directory")

    def load_agent(path: str) -> dict:
        identifier = Path(path).name.removesuffix(".agent.md")
        raw_root = f"https://raw.githubusercontent.com/{REPOSITORY}/{revision}"
        try:
            metadata = _agent_metadata(_fetch_text(f"{raw_root}/{path}"))
            manifest_path = f".github/manifests/{identifier}.manifest.yaml"
            manifest = {}
            if manifest_path in paths:
                manifest = yaml.safe_load(_fetch_text(f"{raw_root}/{manifest_path}"))
                if not isinstance(manifest, dict):
                    raise ValueError("Agent manifest must be a YAML object")
            details = manifest.get("agent", {})
            skills = manifest.get("skills", [])
            if not isinstance(details, dict) or not isinstance(skills, list):
                raise ValueError("Agent manifest has invalid agent details or skills")
            return {
                "id": identifier,
                "name": str(metadata.get("name") or identifier),
                "display_name": str(details.get("name") or metadata.get("name") or identifier),
                "description": str(metadata.get("description") or ""),
                "argument_hint": str(metadata.get("argument-hint") or ""),
                "plugin_id": REPOSITORY,
                "plugin_name": "AgentVerse DevJourney",
                "version": str(details.get("version") or ""),
                "status": str(details.get("status") or ""),
                "path": path,
                "url": f"{REPOSITORY_URL}/blob/{revision}/{path}",
                "kind": "agent",
                "has_definition": True,
                "skills": [
                    skill["name"] for skill in skills
                    if isinstance(skill, dict) and isinstance(skill.get("name"), str)
                ],
            }
        except (ValueError, yaml.YAMLError) as error:
            raise ValueError(f"Invalid agent definition at {path}: {error}") from error

    # Pin every definition and manifest to the same revision.
    with ThreadPoolExecutor(max_workers=6) as executor:
        definitions = list(executor.map(load_agent, agent_paths))
        catalogues = list(executor.map(
            _fetch_text,
            [f"https://raw.githubusercontent.com/{REPOSITORY}/{revision}/{path}"
             for path in catalogue_paths],
        ))
    agents = {}
    for path, markdown in zip(catalogue_paths, catalogues):
        for agent in _catalogue_agents(markdown, path, revision):
            agents.setdefault(agent["id"], agent)
    for definition in definitions:
        documented = agents.get(definition["id"])
        if documented:
            definition["catalogue"] = documented["catalogue"]
        agents[definition["id"]] = definition
    if not agents:
        raise ValueError("No Built agents or executable definitions found in the repository")
    return [agents[key] for key in sorted(agents)]


class MarketplaceCatalog:
    def __init__(self, cache_path: str):
        self.source_url = DEFAULT_MARKETPLACE_URL
        self.cache_path = Path(cache_path)
        self.ttl = max(0, int(os.getenv("AGENT_MARKETPLACE_TTL", "300")))
        self._lock = threading.Lock()
        self._agents: list[dict] = []
        self._loaded_at: str | None = None
        self._loaded_monotonic = 0.0
        self._last_attempt = 0.0
        self._error: str | None = None
        self._read_cache()

    def _read_cache(self) -> None:
        if not self.cache_path.exists():
            return
        try:
            cached = json.loads(self.cache_path.read_text(encoding="utf-8"))
            if not isinstance(cached, dict):
                raise ValueError("Cached catalogue must be an object")
            if (cached.get("source") != self.source_url
                    or cached.get("version") != CACHE_VERSION):
                log.info("catalog_cache_ignored reason=source_changed")
                return
            if (not isinstance(cached.get("agents"), list)
                    or any(not isinstance(agent, dict) or agent.get("kind") != "agent"
                           for agent in cached["agents"])):
                raise ValueError("Invalid cached agent catalogue")
            self._agents = cached["agents"]
            self._loaded_at = cached["loaded_at"]
            self._loaded_monotonic = monotonic() - self.ttl
        except (OSError, ValueError, KeyError, TypeError) as error:
            log.warning("catalog_cache_unreadable error=%s", error)

    def get(self) -> dict:
        with self._lock:
            now = monotonic()
            if self._loaded_at and now - self._loaded_monotonic < self.ttl:
                return self._response()
            if self._last_attempt and now - self._last_attempt < 30:
                return self._response()

            self._last_attempt = now
            try:
                agents = _load_agents(self.source_url)
                loaded_at = datetime.now(timezone.utc).isoformat()
                self.cache_path.parent.mkdir(parents=True, exist_ok=True)
                temporary = self.cache_path.with_suffix(".tmp")
                temporary.write_text(
                    json.dumps({"source": self.source_url, "version": CACHE_VERSION,
                                "loaded_at": loaded_at,
                                "agents": agents}, indent=2),
                    encoding="utf-8",
                )
                os.replace(temporary, self.cache_path)
                self._agents = agents
                self._loaded_at = loaded_at
                self._loaded_monotonic = monotonic()
                self._error = None
                log.info("catalog_refresh_succeeded agent_count=%d", len(agents))
            except (OSError, ValueError, requests.RequestException, yaml.YAMLError) as error:
                self._error = str(error)
                status = getattr(getattr(error, "response", None), "status_code", None)
                log.warning(
                    "catalog_refresh_failed status=%s error_type=%s cached_agents=%d",
                    status or "n/a", type(error).__name__, len(self._agents),
                )
            return self._response()

    def _response(self) -> dict:
        return {
            "source": REPOSITORY_URL,
            "loaded_at": self._loaded_at,
            "stale": bool(self._error and self._agents),
            "error": self._error,
            "agents": self._agents,
        }
