"""FastAPI app: OTLP ingest -> Log Analytics, cached KQL reads for the dashboard."""
import asyncio
import dataclasses
import hmac
import itertools
import logging
import os
import uuid
import zlib
from contextlib import asynccontextmanager

import orjson
from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from google.protobuf.message import DecodeError
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import (
    ExportTraceServiceResponse,
)

from github_metrics import GitHubMetrics, GitHubMetricsError
from marketplace import MarketplaceCatalog

from . import identity, otlp
from .config import Settings
from .provision import Provisioner
from .reader import AzureQuery, Entry, QueryUnavailable, UsageReader
from .schema import CALLS_STREAM, IDENTITY_STREAM
from .sink import AzureUploader, LogsSink, Overloaded

log = logging.getLogger("usage_api")

PROTOBUF = "application/x-protobuf"
JSON = "application/json"


class BodyTooLarge(Exception):
    pass


class RequestIdMiddleware:
    """Adds X-Request-ID without the per-request overhead of BaseHTTPMiddleware."""

    def __init__(self, app) -> None:
        self.app = app
        self._prefix = uuid.uuid4().hex[:16]
        self._counter = itertools.count()

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        request_id = f"{self._prefix}{next(self._counter):016x}".encode()

        async def send_with_id(message):
            if message["type"] == "http.response.start":
                message["headers"] = [*message.get("headers", []), (b"x-request-id", request_id)]
            await send(message)

        await self.app(scope, receive, send_with_id)


def _inflate(body: bytes, limit: int) -> bytes:
    inflater = zlib.decompressobj(16 + zlib.MAX_WBITS)
    data = inflater.decompress(body, limit + 1)
    if len(data) > limit or inflater.unconsumed_tail:
        raise BodyTooLarge
    return data


def create_app(
    settings: Settings | None = None, *, uploader=None, query=None,
    github_metrics=None, marketplace=None,
) -> FastAPI:
    """Collaborators are injectable for tests; production builds the Azure clients."""
    cfg = settings or Settings.from_env()
    state: dict = {"cfg": cfg, "ready": False, "reason": "starting"}

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        current = state["cfg"]
        owned = []
        try:
            if current.auto_provision and not (uploader and query):
                try:
                    resolved = await asyncio.to_thread(Provisioner(current).run)
                except Exception as error:
                    # Stay up so /health and /diagnostics can explain what is wrong.
                    log.exception("provisioning failed")
                    state["reason"] = f"provisioning failed: {error}"
                    yield
                    return
                current = dataclasses.replace(
                    current,
                    workspace_id=resolved.workspace_id,
                    ingestion_endpoint=resolved.ingestion_endpoint,
                    dcr_immutable_id=resolved.dcr_immutable_id,
                )
                state["cfg"] = current
            up, qry = uploader, query
            if up is None and current.ingestion_endpoint and current.dcr_immutable_id:
                up = AzureUploader(current.ingestion_endpoint, current.dcr_immutable_id)
                owned.append(up)
            if qry is None and current.workspace_id:
                qry = AzureQuery(current.workspace_id, current.query_timeout)
                owned.append(qry)
            if up and qry:
                state["sink"] = LogsSink(
                    up,
                    batch_rows=current.batch_rows,
                    flush_interval=current.flush_interval,
                    max_pending_rows=current.max_pending_rows,
                    attempts=current.upload_attempts,
                )
                state["sink"].start()
                state["reader"] = UsageReader(qry, current, current.price_per_million)
                state["ready"], state["reason"] = True, "ok"
                # Warm the default dashboard query so the first user doesn't wait on KQL.
                reader = state["reader"]
                warm = asyncio.create_task(
                    reader.usage(current.default_days, current.events_limit)
                )
                warm.add_done_callback(lambda t: t.cancelled() or t.exception())
            else:
                state["reason"] = (
                    "Log Analytics is not configured: set LOGS_INGESTION_ENDPOINT, "
                    "DCR_IMMUTABLE_ID and LOG_ANALYTICS_WORKSPACE_ID, or "
                    "AUTO_PROVISION=true with LOG_ANALYTICS_RESOURCE_ID"
                )
                log.error(state["reason"])
            yield
        finally:
            if state.get("sink"):
                await state["sink"].stop()
            for client in owned:
                await client.close()

    app = FastAPI(
        title="Copilot Usage API",
        version="2.0.0",
        lifespan=lifespan,
        openapi_tags=[
            {"name": "Usage", "description": "Usage read from Log Analytics (cached)."},
            {"name": "Agents", "description": "AgentVerse repository catalogue."},
            {"name": "GitHub", "description": "Organization Copilot metrics."},
            {"name": "System", "description": "Health and diagnostics."},
            {"name": "OpenTelemetry", "description": "OTLP/HTTP ingestion."},
        ],
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(cfg.frontend_origins),
        allow_methods=["GET", "OPTIONS"],
        allow_headers=["*"],
        expose_headers=["ETag", "X-Request-ID"],
    )
    app.add_middleware(RequestIdMiddleware)
    decoder = otlp.TraceDecoder(cfg)
    marketplace = marketplace or MarketplaceCatalog(
        os.path.join(cfg.data_dir, "marketplace_cache.json"))
    github_metrics = github_metrics or GitHubMetrics()

    # ---- ingest -----------------------------------------------------------
    def _authorize(request: Request) -> None:
        token = state["cfg"].ingest_token
        if not token:
            return
        scheme, _, supplied = request.headers.get("authorization", "").partition(" ")
        if scheme.lower() != "bearer" or not hmac.compare_digest(supplied.encode(), token.encode()):
            raise HTTPException(401, "A valid bearer token is required",
                                headers={"WWW-Authenticate": "Bearer"})

    async def _read_body(request: Request) -> bytes:
        limit = state["cfg"].max_body_bytes
        declared = request.headers.get("content-length")
        if declared and declared.isdigit() and int(declared) > limit:
            raise HTTPException(413, "Request body too large")
        chunks, size = [], 0
        async for chunk in request.stream():
            size += len(chunk)
            if size > limit:
                raise HTTPException(413, "Request body too large")
            chunks.append(chunk)
        body = b"".join(chunks)
        if request.headers.get("content-encoding", "").lower() == "gzip":
            try:
                return _inflate(body, limit)
            except BodyTooLarge:
                raise HTTPException(413, "Decompressed body too large")
            except zlib.error:
                raise HTTPException(400, "Invalid gzip body")
        return body

    @app.post("/v1/traces", name="ingest_trace_batch", operation_id="ingest_trace_batch",
              tags=["OpenTelemetry"])
    async def traces(request: Request):
        _authorize(request)
        sink: LogsSink | None = state.get("sink")
        if sink is None:
            raise HTTPException(503, state["reason"], headers={"Retry-After": "30"})
        body = await _read_body(request)
        is_json = "json" in request.headers.get("content-type", "")
        try:
            resources = otlp.parse_json(body) if is_json else otlp.parse_protobuf(body)
        except (DecodeError, ValueError, AttributeError, TypeError) as error:
            raise HTTPException(400, f"Malformed OTLP payload: {error}")
        decoded = decoder.decode(resources)
        try:
            sink.submit(IDENTITY_STREAM, decoded.identities)
            sink.submit(CALLS_STREAM, decoded.calls)
        except Overloaded:
            raise HTTPException(503, "Ingest queue is full", headers={"Retry-After": "5"})
        if is_json:
            return Response(b"{}", media_type=JSON)
        return Response(ExportTraceServiceResponse().SerializeToString(), media_type=PROTOBUF)

    # VS Code may also push metrics/logs to the same endpoint; accept and ignore them.
    @app.post("/v1/metrics", include_in_schema=False)
    @app.post("/v1/logs", include_in_schema=False)
    async def ignore():
        return Response(b"{}", media_type=JSON)

    # ---- reads ------------------------------------------------------------
    def _reader() -> UsageReader:
        reader = state.get("reader")
        if reader is None:
            raise HTTPException(503, state["reason"], headers={"Retry-After": "30"})
        return reader

    def _respond(request: Request, entry: Entry) -> Response:
        headers = {"ETag": f'"{entry.etag}"', "Cache-Control": "private, max-age=5"}
        if request.headers.get("if-none-match") == headers["ETag"]:
            return Response(status_code=304, headers=headers)
        return Response(entry.body, media_type=JSON, headers=headers)

    async def _guarded(awaitable):
        try:
            return await awaitable
        except QueryUnavailable as error:
            raise HTTPException(503, f"Log Analytics query failed: {error}",
                                headers={"Retry-After": "10"})

    @app.get("/usage", include_in_schema=False)
    @app.get("/api/v1/usage", name="get_usage_summary", operation_id="get_usage_summary",
             tags=["Usage"])
    async def usage(
        request: Request,
        days: int = Query(default=None, ge=1, le=3650),
        events_limit: int = Query(default=None, ge=0),
    ):
        c = state["cfg"]
        entry = await _guarded(_reader().usage(
            days or c.default_days, c.events_limit if events_limit is None else events_limit))
        return _respond(request, entry)

    @app.get("/activity", include_in_schema=False)
    @app.get("/events", include_in_schema=False)
    @app.get("/api/v1/activity", include_in_schema=False)
    @app.get("/api/v1/events", name="get_events", operation_id="get_events", tags=["Usage"])
    async def events(request: Request, limit: int = Query(default=None, ge=1)):
        entry = await _guarded(_reader().events(limit or state["cfg"].events_limit))
        return _respond(request, entry)

    @app.get("/agents", include_in_schema=False)
    @app.get("/api/v1/agents", name="get_marketplace_agents",
             operation_id="get_marketplace_agents", tags=["Agents"])
    def agents():
        return marketplace.get()

    @app.get("/api/v1/github/metrics", name="get_github_metrics",
             operation_id="get_github_metrics", tags=["GitHub"])
    def get_github_metrics(response: Response):
        response.headers["Cache-Control"] = "private, no-store"
        try:
            return github_metrics.get()
        except GitHubMetricsError as error:
            log.warning("github_metrics_unavailable error=%s", error)
            raise HTTPException(503, str(error)) from error

    # ---- system -----------------------------------------------------------
    @app.get("/health", include_in_schema=False)
    @app.get("/api/v1/health", name="get_service_health", operation_id="get_service_health",
             tags=["System"])
    def health():
        return {"ok": True}

    @app.get("/api/v1/health/ready", tags=["System"])
    def ready():
        if not state["ready"]:
            raise HTTPException(503, state["reason"])
        return {"ok": True}

    @app.get("/api/v1/diagnostics", tags=["System"])
    def diagnostics(request: Request):
        _authorize(request)
        sink = state.get("sink")
        reader = state.get("reader")
        return {
            "ready": state["ready"],
            "reason": state["reason"],
            "ingest": {**sink.counters, "pending_rows": sink.pending_rows} if sink else None,
            "identity": identity.STATS.snapshot(),
            "reader": reader.stats() if reader else None,
        }

    return app
