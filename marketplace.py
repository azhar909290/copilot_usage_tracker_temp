"""Load agent definitions referenced by a VS Code plugin marketplace."""
import json
import logging
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from time import monotonic
from urllib.parse import urljoin, urlparse, urlunparse

import requests
import yaml

DEFAULT_MARKETPLACE_URL = (
    "https://github.com/tthctoinnovation/Plugins-Test/blob/main/.github/plugin/marketplace.json"
)
log = logging.getLogger("agent_marketplace")


def _fetch_json(url: str) -> dict:
    response = requests.get(url, headers=_headers(), timeout=5)
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict):
        raise ValueError(f"Expected a JSON object from {url}")
    return payload


def _fetch_text(url: str) -> str:
    response = requests.get(url, headers=_headers(), timeout=5)
    response.raise_for_status()
    return response.text


def _headers() -> dict[str, str]:
    token = os.getenv("AGENT_MARKETPLACE_TOKEN")
    return {"Authorization": f"Bearer {token}"} if token else {}


def _normalize_marketplace_url(url: str) -> str:
    parsed = urlparse(url)
    parts = parsed.path.strip("/").split("/")
    if parsed.hostname == "github.com" and len(parts) >= 5 and parts[2] == "blob":
        raw_path = "/".join((parts[0], parts[1], *parts[3:]))
        return urlunparse(parsed._replace(netloc="raw.githubusercontent.com", path=f"/{raw_path}"))
    return url


def _safe_source(url: str) -> str:
    parsed = urlparse(url)
    return f"{parsed.scheme}://{parsed.hostname or ''}{parsed.path}"


def _relative_url(base_url: str, path: str) -> str:
    parsed = urlparse(path)
    if parsed.scheme or parsed.netloc or path.startswith("/"):
        raise ValueError(f"Expected a relative marketplace path: {path}")
    return urljoin(base_url, path.removeprefix("./"))


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


def _load_agents(source_url: str, repository_root: str | None = None) -> list[dict]:
    root = repository_root or urljoin(source_url, "../../")
    marketplace = _fetch_json(source_url)
    plugins = marketplace.get("plugins", [])
    if not isinstance(plugins, list):
        raise ValueError("Marketplace 'plugins' must be a list")

    agents = []
    for plugin in plugins:
        if not isinstance(plugin, dict):
            continue
        manifest_path = plugin.get("path")
        if not manifest_path:
            source_path = plugin.get("source")
            if not source_path:
                continue
            manifest_path = f"{source_path.rstrip('/')}/plugin.json"
        manifest_url = _relative_url(root, str(manifest_path))
        manifest = _fetch_json(manifest_url)
        components = manifest.get("components", {})
        agent_paths = components.get("agents", []) if isinstance(components, dict) else []
        if not isinstance(agent_paths, list):
            raise ValueError(f"Plugin {plugin.get('name', '')!r} agents must be a list")

        for agent_path in agent_paths:
            if not isinstance(agent_path, str):
                continue
            agent_url = _relative_url(manifest_url, agent_path)
            metadata = _agent_metadata(_fetch_text(agent_url))
            name = str(metadata.get("name") or Path(agent_path).stem)
            agents.append(
                {
                    "id": str(metadata.get("id") or name),
                    "name": name,
                    "description": str(metadata.get("description") or ""),
                    "plugin_id": str(plugin.get("id") or plugin.get("name") or ""),
                    "plugin_name": str(
                        plugin.get("displayName") or plugin.get("name") or ""
                    ),
                    "version": str(plugin.get("version") or manifest.get("version") or ""),
                    "path": agent_path,
                }
            )
    return agents


class MarketplaceCatalog:
    def __init__(self, cache_path: str):
        source_url = os.getenv("AGENT_MARKETPLACE_URL", DEFAULT_MARKETPLACE_URL)
        self.source_url = _normalize_marketplace_url(source_url)
        self.repository_root = os.getenv("AGENT_MARKETPLACE_ROOT_URL") or None
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
        try:
            cached = json.loads(self.cache_path.read_text(encoding="utf-8"))
            self._agents = cached["agents"]
            self._loaded_at = cached["loaded_at"]
            self._loaded_monotonic = monotonic() - self.ttl
        except (OSError, ValueError, KeyError, TypeError):
            return

    def get(self) -> dict:
        with self._lock:
            now = monotonic()
            if self._loaded_at and now - self._loaded_monotonic < self.ttl:
                return self._response()
            if self._last_attempt and now - self._last_attempt < 30:
                return self._response()

            self._last_attempt = now
            try:
                agents = _load_agents(self.source_url, self.repository_root)
                loaded_at = datetime.now(timezone.utc).isoformat()
                self.cache_path.parent.mkdir(parents=True, exist_ok=True)
                temporary = self.cache_path.with_suffix(".tmp")
                temporary.write_text(
                    json.dumps({"loaded_at": loaded_at, "agents": agents}, indent=2),
                    encoding="utf-8",
                )
                os.replace(temporary, self.cache_path)
                self._agents = agents
                self._loaded_at = loaded_at
                self._loaded_monotonic = now
                self._error = None
                log.info(
                    "marketplace_refresh_succeeded source=%s agent_count=%d",
                    _safe_source(self.source_url),
                    len(agents),
                )
            except (OSError, ValueError, requests.RequestException, yaml.YAMLError) as error:
                self._error = str(error)
                status = getattr(getattr(error, "response", None), "status_code", None)
                log.warning(
                    "marketplace_refresh_failed source=%s status=%s error_type=%s cached_agents=%d",
                    _safe_source(self.source_url),
                    status or "n/a",
                    type(error).__name__,
                    len(self._agents),
                )
            return self._response()

    def _response(self) -> dict:
        return {
            "source": self.source_url,
            "loaded_at": self._loaded_at,
            "stale": bool(self._error and self._agents),
            "error": self._error,
            "agents": self._agents,
        }