import asyncio

import pytest

from tracker.sink import LogsSink, Overloaded


def run(coro):
    return asyncio.run(coro)


def test_rows_are_batched_and_flushed_on_stop():
    async def go():
        uploaded = []

        async def upload(stream, rows):
            uploaded.append((stream, len(rows)))

        sink = LogsSink(upload, batch_rows=100, flush_interval=60)
        sink.start()
        for _ in range(250):
            sink.submit("s", [{"a": 1}])
        await asyncio.sleep(0.05)
        await sink.stop()
        return uploaded, sink

    uploaded, sink = run(go())
    assert sum(n for _, n in uploaded) == 250
    assert max(n for _, n in uploaded) <= 100
    assert sink.counters["uploaded_rows"] == 250 and sink.pending_rows == 0


def test_backpressure_raises_overloaded():
    async def go():
        sink = LogsSink(lambda *_: None, max_pending_rows=10)
        sink.submit("s", [{}] * 8)
        with pytest.raises(Overloaded):
            sink.submit("s", [{}] * 3)
        assert sink.counters["overload_rejections"] == 1

    run(go())


def test_failed_upload_is_retried_then_succeeds():
    async def go():
        calls = {"n": 0}

        async def flaky(stream, rows):
            calls["n"] += 1
            if calls["n"] < 3:
                raise RuntimeError("boom")

        sink = LogsSink(flaky, flush_interval=0.01, backoff_base=0.001, attempts=5)
        sink.start()
        sink.submit("s", [{}])
        await asyncio.sleep(0.2)
        await sink.stop()
        return calls["n"], sink.counters

    n, counters = run(go())
    assert n == 3 and counters["uploaded_rows"] == 1 and counters["dropped_rows"] == 0


def test_rows_dropped_after_max_attempts_release_capacity():
    async def go():
        async def broken(stream, rows):
            raise RuntimeError("down")

        sink = LogsSink(broken, flush_interval=0.01, backoff_base=0.001, attempts=2)
        sink.start()
        sink.submit("s", [{}] * 5)
        await asyncio.sleep(0.2)
        await sink.stop()
        return sink

    sink = run(go())
    assert sink.counters["dropped_rows"] == 5 and sink.pending_rows == 0
