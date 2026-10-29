import asyncio
from datetime import datetime, timezone

import orjson
import pytest

from tracker.config import Settings
from tracker.reader import QueryUnavailable, UsageReader

NOW = datetime(2026, 10, 29, 7, tzinfo=timezone.utc)


def daily(user="octocat", inp=1_000_000, out=0):
    return {"date": "2026-10-29", "user": user, "agent": "a", "model": "m", "requests": 2,
            "input_tokens": inp, "output_tokens": out, "latency_ms_total": 300.0,
            "latency_requests": 2, "first_seen": NOW, "last_seen": NOW}


def event(user="octocat"):
    return {"key": "t:s", "timestamp": NOW, "date": "2026-10-29", "user": user, "agent": "a",
            "model": "m", "input_tokens": 10, "output_tokens": 5, "latency_ms": 12.5}


class FakeQuery:
    def __init__(self, rows=None, events=None, delay=0.0):
        self.rows, self.events, self.delay = rows or [], events or [], delay
        self.calls = []
        self.fail = False

    async def __call__(self, kql):
        self.calls.append(kql)
        await asyncio.sleep(self.delay)
        if self.fail:
            raise RuntimeError("LA down")
        return self.events if "top " in kql else self.rows


def reader(q, ttl=30.0):
    return UsageReader(q, Settings(cache_ttl=ttl), 0.99)


def test_shapes_rows_cost_and_unattributed_are_kept_out_of_users():
    async def go():
        q = FakeQuery(rows=[daily(), daily(user="", inp=500)], events=[event(), event(user="")])
        return orjson.loads((await reader(q).usage(30, 100)).body)

    p = asyncio.run(go())
    assert [r["user"] for r in p["rows"]] == ["octocat"]
    assert p["rows"][0]["cost"] == 0.99 and p["rows"][0]["latency_ms_avg"] == 150.0
    assert p["unattributed"] == {"requests": 2, "total_tokens": 500}
    assert [e["user"] for e in p["events"]] == ["octocat"]
    assert p["events"][0]["total_tokens"] == 15
    assert p["rows"][0]["last_seen"].startswith("2026-10-29T07:00:00")


def test_concurrent_requests_share_one_query_and_hit_cache():
    async def go():
        q = FakeQuery(rows=[daily()], delay=0.05)
        r = reader(q)
        await asyncio.gather(*(r.usage(30, 0) for _ in range(50)))
        await r.usage(30, 0)
        return len(q.calls)

    assert asyncio.run(go()) == 1


def test_stale_entry_is_served_while_refreshing_and_survives_failures():
    async def go():
        q = FakeQuery(rows=[daily()])
        r = reader(q, ttl=0.01)
        first = await r.usage(30, 0)
        await asyncio.sleep(0.03)
        q.fail = True
        stale = await r.usage(30, 0)  # refresh fails in the background
        await asyncio.sleep(0.05)
        return first, stale, len(q.calls)

    first, stale, calls = asyncio.run(go())
    assert stale.body == first.body and calls == 2


def test_cold_failure_raises_unavailable():
    async def go():
        q = FakeQuery()
        q.fail = True
        await reader(q).usage(30, 0)

    with pytest.raises(QueryUnavailable):
        asyncio.run(go())


def test_days_and_limits_are_clamped():
    async def go():
        q = FakeQuery(rows=[daily()])
        await reader(q).usage(10_000, 0)
        return q.calls[0]

    assert "ago(365d)" in asyncio.run(go())
