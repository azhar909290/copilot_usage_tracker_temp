"""Read GitHub organization Copilot reports without exposing GitHub credentials."""
import gzip
import io
import json
import logging
import math
import os
import re
import threading
from datetime import date, datetime, timezone
from time import monotonic
from urllib.parse import urlparse

import requests

log = logging.getLogger("github_metrics")
API_ROOT = "https://api.github.com"
API_VERSION = "2026-03-10"
MAX_REPORT_BYTES = 32 * 1024 * 1024
COUNTERS = (
    "user_initiated_interaction_count",
    "code_generation_activity_count",
    "code_acceptance_activity_count",
    "loc_added_sum",
    "loc_deleted_sum",
)


class GitHubMetricsError(Exception):
    pass


def _number(record: dict, key: str, optional: bool = False) -> int | float | None:
    value = record.get(key)
    if optional and value is None:
        return None
    if (isinstance(value, bool) or not isinstance(value, (int, float))
            or not math.isfinite(value) or value < 0):
        raise GitHubMetricsError(f"GitHub report has an invalid or missing {key}.")
    return value


def _counts(record: dict) -> dict:
    return {key: _number(record, key) for key in COUNTERS}


def _objects(value, field: str) -> list[dict]:
    if not isinstance(value, list) or any(not isinstance(item, dict) for item in value):
        raise GitHubMetricsError(f"GitHub returned an invalid {field} list.")
    return value


def _report_date(value) -> str:
    if not isinstance(value, str):
        raise GitHubMetricsError("GitHub returned a missing report date.")
    try:
        return date.fromisoformat(value).isoformat()
    except ValueError as error:
        raise GitHubMetricsError("GitHub returned an invalid report date.") from error


def _decode_report(content: bytes) -> list[dict]:
    try:
        if content.startswith(b"\x1f\x8b"):
            with gzip.GzipFile(fileobj=io.BytesIO(content)) as archive:
                content = archive.read(MAX_REPORT_BYTES + 1)
        if len(content) > MAX_REPORT_BYTES:
            raise GitHubMetricsError("GitHub report exceeds the 32 MiB size limit.")
        text = content.decode("utf-8-sig").strip()
        if not text:
            return []
        try:
            payload = json.loads(text)
        except json.JSONDecodeError:
            payload = [json.loads(line) for line in text.splitlines() if line.strip()]
        return _objects(payload if isinstance(payload, list) else [payload], "report")
    except (UnicodeError, ValueError, OSError, EOFError) as error:
        raise GitHubMetricsError("GitHub returned an unreadable JSON/NDJSON report.") from error


def _summarize_organization(records: list[dict]) -> dict:
    daily = []
    models: dict[str, dict] = {}
    features: dict[str, dict] = {}
    seen_days = set()
    for record in records:
        for day in _objects(record.get("day_totals"), "day_totals"):
            day_key = _report_date(day.get("day"))
            if day_key in seen_days:
                raise GitHubMetricsError("GitHub report contains duplicate daily totals.")
            seen_days.add(day_key)
            daily.append({
                "day": day_key,
                "daily_active_users": _number(day, "daily_active_users"),
                **_counts(day),
            })
            for field, dimension, target in (
                ("totals_by_model_feature", "model", models),
                ("totals_by_feature", "feature", features),
            ):
                for item in _objects(day.get(field), field):
                    name = item.get(dimension)
                    if not isinstance(name, str) or not name:
                        raise GitHubMetricsError(f"GitHub report has a missing {dimension}.")
                    group = target.setdefault(name, {
                        "name": name, **dict.fromkeys(COUNTERS, 0),
                    })
                    for key, value in _counts(item).items():
                        group[key] += value
    totals = {key: sum(item[key] for item in daily) for key in COUNTERS}
    return {
        "daily": sorted(daily, key=lambda item: item["day"]),
        "totals": totals,
        "models": sorted(models.values(),
                         key=lambda item: item["user_initiated_interaction_count"],
                         reverse=True),
        "features": sorted(features.values(),
                           key=lambda item: item["code_generation_activity_count"],
                           reverse=True),
    }


def _summarize_users(records: list[dict]) -> list[dict]:
    users: dict[int, dict] = {}
    seen = set()
    for record in records:
        login = record.get("user_login")
        user_id = record.get("user_id")
        if (not isinstance(login, str) or not login or isinstance(user_id, bool)
                or not isinstance(user_id, int)):
            raise GitHubMetricsError("GitHub user report has a missing login or ID.")
        day = _report_date(record["day"]) if "day" in record else None
        record_key = (user_id, day)
        if record_key in seen:
            raise GitHubMetricsError("GitHub report contains duplicate user/day totals.")
        if user_id in users and (day is None or (user_id, None) in seen):
            raise GitHubMetricsError("GitHub report mixes daily and aggregate user totals.")
        seen.add(record_key)
        item = {
            "login": login,
            "id": user_id,
            **_counts(record),
            "ai_credits_used": _number(record, "ai_credits_used", optional=True),
            "daily_usage": [{
                "day": day,
                "ai_credits_used": _number(record, "ai_credits_used", optional=True),
                "user_initiated_interaction_count": _number(
                    record, "user_initiated_interaction_count",
                ),
            }] if day else [],
            "features": [
                label for key, label in (
                    ("used_agent", "IDE agent"),
                    ("used_chat", "IDE chat"),
                    ("used_cli", "CLI"),
                    ("used_copilot_app", "Copilot app"),
                    ("used_vscode_agent", "VS Code Agents"),
                    ("used_copilot_cloud_agent", "Cloud agent"),
                    ("used_copilot_code_review_active", "Code review"),
                ) if record.get(key) is True
            ],
        }
        if user_id not in users:
            users[user_id] = item
        else:
            user = users[user_id]
            # Use the latest reported alias while joining by stable GitHub ID.
            if day > user["_latest_day"]:
                user["login"] = login
            for key in COUNTERS:
                user[key] += item[key]
            credits = item["ai_credits_used"]
            user["ai_credits_used"] = (
                user["ai_credits_used"] + credits
                if user["ai_credits_used"] is not None and credits is not None else None
            )
            user["features"] = list(dict.fromkeys(user["features"] + item["features"]))
            user["daily_usage"].extend(item["daily_usage"])
        users[user_id]["_latest_day"] = max(users[user_id].get("_latest_day") or "", day or "")
    for user in users.values():
        del user["_latest_day"]
        user["daily_usage"].sort(key=lambda item: item["day"], reverse=True)
    return sorted(users.values(), key=lambda item: item["user_initiated_interaction_count"],
                  reverse=True)


class GitHubMetrics:
    def __init__(self):
        self._lock = threading.Lock()
        self._cached: dict | None = None
        self._cached_at = 0.0
        self._configuration: tuple[str, str] | None = None

    def _get_json(self, path: str, token: str, params: dict | None = None):
        try:
            response = requests.get(
                f"{API_ROOT}{path}",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Accept": "application/vnd.github+json",
                    "X-GitHub-Api-Version": API_VERSION,
                },
                params=params, timeout=(10, 60), allow_redirects=False,
            )
            if response.status_code != 200:
                messages = {
                    401: "GitHub rejected the configured API token.",
                    403: "GitHub denied access. Check metrics policy, token permissions, "
                         "SSO authorization, and rate limits.",
                    404: "GitHub report is unavailable. Check the organization, "
                         "Copilot subscription, and permissions.",
                    204: "GitHub has not published this report yet.",
                    429: "GitHub rate limit reached. Try again later.",
                }
                raise GitHubMetricsError(messages.get(
                    response.status_code, f"GitHub API returned HTTP {response.status_code}.",
                ))
            return response.json()
        except requests.exceptions.JSONDecodeError as error:
            raise GitHubMetricsError("GitHub API returned invalid JSON.") from error
        except requests.RequestException as error:
            raise GitHubMetricsError("Unable to reach the GitHub API.") from error

    def _download(self, url: str) -> list[dict]:
        try:
            parsed = urlparse(url)
            port = parsed.port
        except ValueError as error:
            raise GitHubMetricsError("GitHub returned an invalid report download URL.") from error
        host = parsed.hostname or ""
        if (parsed.scheme != "https" or parsed.username or parsed.password
                or port not in (None, 443)
                or not (host == "copilot-reports.github.com" or host.endswith(
                    (".blob.core.windows.net", ".githubusercontent.com")))):
            raise GitHubMetricsError("GitHub returned an unsupported report download host.")
        try:
            # Signed download URLs are credentials: never log them or forward the API token.
            with requests.get(url, timeout=(10, 60), stream=True,
                              allow_redirects=False) as response:
                if response.status_code != 200:
                    raise GitHubMetricsError(
                        f"Report download returned HTTP {response.status_code}. Retry "
                        "to obtain a new signed download link."
                    )
                content = bytearray()
                for chunk in response.iter_content(chunk_size=65536):
                    content.extend(chunk)
                    if len(content) > MAX_REPORT_BYTES:
                        raise GitHubMetricsError("GitHub report exceeds the 32 MiB size limit.")
            return _decode_report(bytes(content))
        except requests.RequestException as error:
            raise GitHubMetricsError("Unable to download the GitHub report.") from error

    def _report(self, org: str, token: str, name: str) -> tuple[dict, list[dict]]:
        metadata = self._get_json(
            f"/orgs/{org}/copilot/metrics/reports/{name}-28-day/latest", token,
        )
        if not isinstance(metadata, dict):
            raise GitHubMetricsError("GitHub returned invalid report metadata.")
        start = _report_date(metadata.get("report_start_day"))
        end = _report_date(metadata.get("report_end_day"))
        if start > end:
            raise GitHubMetricsError("GitHub returned an invalid reporting window.")
        links = metadata.get("download_links")
        if not isinstance(links, list) or not links or any(
                not isinstance(link, str) for link in links):
            raise GitHubMetricsError("GitHub returned no valid report download links.")
        records = [record for link in links for record in self._download(link)]
        return {"start": start, "end": end}, records

    def get(self) -> dict:
        org = os.getenv("GITHUB_METRICS_ORG", "").strip()
        token = os.getenv("GITHUB_METRICS_TOKEN", "").strip()
        if not org or not token:
            raise GitHubMetricsError(
                "Configure GITHUB_METRICS_ORG and GITHUB_METRICS_TOKEN on the API server."
            )
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9-]{0,38}", org):
            raise GitHubMetricsError("GITHUB_METRICS_ORG must be a GitHub organization slug.")
        with self._lock:
            configuration = (org, token)
            if (self._cached is not None and self._configuration == configuration
                    and monotonic() - self._cached_at < 300):
                return self._cached
            result = {
                "organization": org,
                "fetched_at": datetime.now(timezone.utc).isoformat(),
                "cache_seconds": 300,
                "organization_metrics": None,
                "user_metrics": None,
                "errors": {},
            }
            for section in ("organization_metrics", "user_metrics"):
                try:
                    window, records = self._report(
                        org, token, "organization" if section == "organization_metrics"
                        else "users",
                    )
                    result[section] = {
                        "window": window,
                        **(_summarize_organization(records)
                           if section == "organization_metrics"
                           else {"users": _summarize_users(records)}),
                    }
                except GitHubMetricsError as error:
                    result["errors"][section] = str(error)
                    log.warning("github_metrics_failed section=%s organization=%s error=%s",
                                section, org, error)
            if len(result["errors"]) == 2:
                raise GitHubMetricsError(
                    "No GitHub metrics could be loaded. " + " ".join(
                        f"{section}: {message}" for section, message in result["errors"].items()
                    )
                )
            # Do not cache partial failures; the next request must be able to retry.
            if not result["errors"]:
                self._cached = result
                self._cached_at = monotonic()
                self._configuration = configuration
            return result
