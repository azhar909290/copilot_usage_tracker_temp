"""Non-blocking batched uploads to the Logs Ingestion API.

Requests are acknowledged as soon as their rows are queued; a background task groups
rows into large batches (fewer, bigger uploads) and retries with backoff. A bounded
queue provides backpressure: when it is full, ``submit`` raises ``Overloaded`` and the
HTTP layer answers 503 + Retry-After, which OTLP exporters retry.
"""
import asyncio
import logging
import random
from collections import defaultdict, deque
from typing import Awaitable, Callable

log = logging.getLogger("usage.sink")

Uploader = Callable[[str, list[dict]], Awaitable[None]]
MAX_CONCURRENT_UPLOADS = 4


class Overloaded(Exception):
    pass


class LogsSink:
    def __init__(
        self,
        uploader: Uploader,
        *,
        batch_rows: int = 1000,
        flush_interval: float = 2.0,
        max_pending_rows: int = 200_000,
        attempts: int = 5,
        backoff_base: float = 0.5,
    ) -> None:
        self._upload_fn = uploader
        self.batch_rows = batch_rows
        self.flush_interval = flush_interval
        self.max_pending_rows = max_pending_rows
        self.attempts = attempts
        self.backoff_base = backoff_base
        self._queues: dict[str, deque] = defaultdict(deque)
        self._queued = 0
        self._inflight = 0
        self._wake = asyncio.Event()
        self._slots = asyncio.Semaphore(MAX_CONCURRENT_UPLOADS)
        self._tasks: set[asyncio.Task] = set()
        self._worker: asyncio.Task | None = None
        self._stopping = False
        self.counters = {
            "accepted_rows": 0, "uploaded_rows": 0, "dropped_rows": 0,
            "upload_errors": 0, "overload_rejections": 0,
        }

    @property
    def pending_rows(self) -> int:
        return self._queued + self._inflight

    def submit(self, stream: str, rows: list[dict]) -> None:
        if not rows:
            return
        if self.pending_rows + len(rows) > self.max_pending_rows:
            self.counters["overload_rejections"] += 1
            raise Overloaded(f"{self.pending_rows} rows pending")
        self._queues[stream].extend(rows)
        self._queued += len(rows)
        self.counters["accepted_rows"] += len(rows)
        if self._queued >= self.batch_rows:
            self._wake.set()

    def start(self) -> None:
        self._worker = asyncio.create_task(self._run(), name="logs-sink")

    async def stop(self, timeout: float = 20.0) -> None:
        """Flush what is queued, then stop."""
        self._stopping = True
        self._wake.set()
        if self._worker:
            try:
                await asyncio.wait_for(self._worker, timeout)
            except asyncio.TimeoutError:
                self._worker.cancel()
        if self._tasks:
            await asyncio.wait(self._tasks, timeout=timeout)
        if self.pending_rows:
            log.error("sink stopped with %d rows not uploaded", self.pending_rows)

    async def _run(self) -> None:
        while True:
            try:
                await asyncio.wait_for(self._wake.wait(), self.flush_interval)
            except asyncio.TimeoutError:
                pass
            self._wake.clear()
            self._dispatch()
            if self._stopping:
                if self._queued == 0:
                    return
                self._wake.set()

    def _dispatch(self) -> None:
        for stream, queue in self._queues.items():
            while queue:
                n = min(len(queue), self.batch_rows)
                rows = [queue.popleft() for _ in range(n)]
                self._queued -= n
                self._inflight += n
                task = asyncio.create_task(self._upload(stream, rows))
                self._tasks.add(task)
                task.add_done_callback(self._tasks.discard)

    async def _upload(self, stream: str, rows: list[dict]) -> None:
        try:
            async with self._slots:
                for attempt in range(1, self.attempts + 1):
                    try:
                        await self._upload_fn(stream, rows)
                        self.counters["uploaded_rows"] += len(rows)
                        return
                    except Exception as error:
                        self.counters["upload_errors"] += 1
                        if attempt == self.attempts:
                            self.counters["dropped_rows"] += len(rows)
                            log.error(
                                "dropping %d %s rows after %d attempts: %s",
                                len(rows), stream, attempt, error,
                            )
                            return
                        delay = min(30.0, self.backoff_base * 2 ** (attempt - 1))
                        log.warning("upload to %s failed (attempt %d): %s", stream, attempt, error)
                        await asyncio.sleep(delay * (0.5 + random.random()))
        finally:
            self._inflight -= len(rows)


class AzureUploader:
    """Uploads to a Data Collection Rule using managed identity / developer credentials."""

    def __init__(self, endpoint: str, dcr_immutable_id: str, credential=None) -> None:
        from azure.identity.aio import DefaultAzureCredential
        from azure.monitor.ingestion.aio import LogsIngestionClient

        self._credential = credential or DefaultAzureCredential()
        self._client = LogsIngestionClient(endpoint, self._credential, logging_enable=False)
        self._rule = dcr_immutable_id

    async def __call__(self, stream: str, rows: list[dict]) -> None:
        await self._client.upload(rule_id=self._rule, stream_name=stream, logs=rows)

    async def close(self) -> None:
        await self._client.close()
        await self._credential.close()
