"""Read side: KQL results cached in memory as pre-encoded JSON.

Dashboards poll, so the hot path is a dict lookup that returns bytes. Entries are
refreshed in the background (stale-while-revalidate) with one in-flight query per key,
so request volume never turns into Log Analytics query volume.
"""
import asyncio
import hashlib
import logging
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Awaitable, Callable

import orjson

from . import queries
from .config import Settings

log = logging.getLogger("usage.reader")

QueryFn = Callable[[str], Awaitable[list[dict]]]
EVENTS_WINDOW_DAYS = 7
RETRY_AFTER_FAILURE = 5.0


class QueryUnavailable(Exception):
    pass


@dataclass(slots=True)
class Entry:
    body: bytes
    etag: str
    fetched: float


class AzureQuery:
    def __init__(self, workspace_id: str, timeout: float, credential=None) -> None:
        from azure.identity.aio import DefaultAzureCredential
        from azure.monitor.query.aio import LogsQueryClient

        self._credential = credential or DefaultAzureCredential()
        self._client = LogsQueryClient(self._credential)
        self._workspace = workspace_id
        self._timeout = int(timeout)

    async def __call__(self, kql: str) -> list[dict]:
        from azure.monitor.query import LogsQueryStatus

        result = await self._client.query_workspace(
            self._workspace, kql, timespan=None, server_timeout=self._timeout
        )
        if result.status != LogsQueryStatus.SUCCESS:
            raise QueryUnavailable(f"partial result: {getattr(result, 'partial_error', None)}")
        table = result.tables[0]
        return [dict(zip(table.columns, row)) for row in table.rows]

    async def close(self) -> None:
        await self._client.close()
        await self._credential.close()


def _iso(value):
    return value.astimezone(timezone.utc).isoformat() if isinstance(value, datetime) else value


class UsageReader:
    def __init__(self, query: QueryFn, settings: Settings, price_per_million: float) -> None:
        self._query = query
        self._s = settings
        self._rate = price_per_million
        self._entries: dict[tuple, Entry] = {}
        self._inflight: dict[tuple, asyncio.Task] = {}

    # ---- public -----------------------------------------------------------
    async def usage(self, days: int, events_limit: int) -> Entry:
        days = max(1, min(days, self._s.max_days))
        events_limit = max(0, min(events_limit, self._s.max_events_limit))
        return await self._cached(("usage", days, events_limit), self._load_usage)

    async def events(self, limit: int) -> Entry:
        limit = max(1, min(limit, self._s.max_events_limit))
        return await self._cached(("events", limit), self._load_events)

    def stats(self) -> dict:
        now = time.monotonic()
        return {
            "cached_keys": len(self._entries),
            "inflight_queries": len(self._inflight),
            "oldest_entry_age_seconds": round(
                max((now - e.fetched for e in self._entries.values()), default=0.0), 1
            ),
        }

    # ---- cache ------------------------------------------------------------
    async def _cached(self, key: tuple, loader) -> Entry:
        entry = self._entries.get(key)
        if entry and time.monotonic() - entry.fetched < self._s.cache_ttl:
            return entry
        task = self._inflight.get(key)
        if task is None:
            task = asyncio.create_task(self._refresh(key, loader))
            task.add_done_callback(lambda t: t.cancelled() or t.exception())
            self._inflight[key] = task
        if entry:  # stale: answer now, refresh behind the scenes
            return entry
        try:
            return await asyncio.shield(task)
        except Exception as error:
            raise QueryUnavailable(str(error)) from error

    async def _refresh(self, key: tuple, loader) -> Entry:
        try:
            body = orjson.dumps(await loader(*key[1:]))
            entry = Entry(body, hashlib.blake2b(body, digest_size=8).hexdigest(), time.monotonic())
            self._entries[key] = entry
            return entry
        except Exception:
            log.exception("query refresh failed key=%s", key)
            stale = self._entries.get(key)
            if stale:  # keep serving it, retry shortly instead of on every request
                stale.fetched = time.monotonic() - self._s.cache_ttl + RETRY_AFTER_FAILURE
            raise
        finally:
            self._inflight.pop(key, None)

    # ---- loaders ----------------------------------------------------------
    async def _load_usage(self, days: int, events_limit: int) -> dict:
        rows_task = self._query(queries.daily_usage(days, self._s.daily_tz))
        if events_limit:
            raw_rows, raw_events = await asyncio.gather(
                rows_task,
                self._query(queries.recent_events(
                    min(days, EVENTS_WINDOW_DAYS), events_limit, self._s.daily_tz)),
            )
        else:
            raw_rows, raw_events = await rows_task, []
        rows, unattributed = self._shape_rows(raw_rows)
        return {
            "currency": "USD",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "window_days": days,
            "rows": rows,
            "events": self._shape_events(raw_events),
            "unattributed": unattributed,
        }

    async def _load_events(self, limit: int) -> dict:
        raw = await self._query(queries.recent_events(
            EVENTS_WINDOW_DAYS, limit, self._s.daily_tz))
        return {
            "currency": "USD",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "events": self._shape_events(raw),
        }

    def _cost(self, tokens: int) -> float:
        return round(tokens * self._rate / 1_000_000, 8)

    def _shape_rows(self, raw: list[dict]) -> tuple[list[dict], dict]:
        rows, missing = [], {"requests": 0, "total_tokens": 0}
        for r in raw:
            inp, out = int(r["input_tokens"] or 0), int(r["output_tokens"] or 0)
            if not r["user"]:
                # No identity was ever observed for these calls; never shown as a user.
                missing["requests"] += int(r["requests"] or 0)
                missing["total_tokens"] += inp + out
                continue
            lat_n = int(r["latency_requests"] or 0)
            lat_total = float(r["latency_ms_total"] or 0)
            rows.append({
                "date": r["date"],
                "user": r["user"],
                "agent": r["agent"],
                "model": r["model"],
                "requests": int(r["requests"] or 0),
                "input_tokens": inp,
                "output_tokens": out,
                "total_tokens": inp + out,
                "cost": self._cost(inp + out),
                "unpriced_requests": 0,
                "latency_ms_total": round(lat_total, 3),
                "latency_requests": lat_n,
                "latency_ms_avg": round(lat_total / lat_n, 3) if lat_n else None,
                "first_seen": _iso(r["first_seen"]),
                "last_seen": _iso(r["last_seen"]),
            })
        return rows, missing

    def _shape_events(self, raw: list[dict]) -> list[dict]:
        events = []
        for r in raw:
            if not r["user"]:
                continue
            inp, out = int(r["input_tokens"] or 0), int(r["output_tokens"] or 0)
            events.append({
                "key": r["key"],
                "timestamp": _iso(r["timestamp"]),
                "date": r["date"],
                "user": r["user"],
                "agent": r["agent"],
                "model": r["model"],
                "input_tokens": inp,
                "output_tokens": out,
                "total_tokens": inp + out,
                "latency_ms": r["latency_ms"],
                "cost": self._cost(inp + out),
            })
        return events
