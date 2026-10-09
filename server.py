"""OTLP/HTTP receiver that prices GenAI spans from VS Code / Copilot / custom agents."""
import gzip
import json
import logging
import os
import time
import uuid

from dotenv import load_dotenv
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from google.protobuf.json_format import MessageToDict
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import (
    ExportTraceServiceRequest,
)

from parser import parse_spans
from marketplace import MarketplaceCatalog
from pricing import PriceBook
from store import UsageStore

load_dotenv()

log = logging.getLogger("usage_api")
logging.basicConfig(level=logging.INFO)

app = FastAPI(
    title="Copilot Usage API",
    version="1.0.0",
    openapi_tags=[
        {"name": "Usage", "description": "Aggregated usage and cost reports."},
        {"name": "Agents", "description": "Marketplace catalog and agent usage."},
        {"name": "System", "description": "Service health checks."},
        {"name": "OpenTelemetry", "description": "OpenTelemetry ingestion endpoints."},
    ],
)
frontend_origins = [
    origin.strip()
    for origin in os.getenv(
        "FRONTEND_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000",
    ).split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=frontend_origins,
    allow_methods=["GET"],
    allow_headers=["*"],
    expose_headers=["X-Request-ID"],
)
prices = PriceBook()
store = UsageStore(os.getenv("DATA_DIR", "data"))
marketplace = MarketplaceCatalog(os.path.join(store.dir, "marketplace_cache.json"))


@app.middleware("http")
async def log_http_request(request: Request, call_next):
    request_id = uuid.uuid4().hex
    started = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        duration_ms = (time.perf_counter() - started) * 1000
        log.exception(
            "http_request request_id=%s method=%s path=%s status=500 duration_ms=%.2f",
            request_id,
            request.method,
            request.url.path,
            duration_ms,
        )
        raise

    duration_ms = (time.perf_counter() - started) * 1000
    response.headers["X-Request-ID"] = request_id
    log.info(
        "http_request request_id=%s method=%s path=%s status=%d duration_ms=%.2f",
        request_id,
        request.method,
        request.url.path,
        response.status_code,
        duration_ms,
    )
    return response


async def _body(request: Request) -> bytes:
    body = await request.body()
    if request.headers.get("content-encoding", "").lower() == "gzip":
        body = gzip.decompress(body)
    return body


@app.post(
    "/v1/traces",
    name="ingest_trace_batch",
    operation_id="ingest_trace_batch",
    tags=["OpenTelemetry"],
)
async def traces(request: Request):
    body = await _body(request)
    ctype = request.headers.get("content-type", "")
    if "json" in ctype:
        payload = json.loads(body)
    else:  # application/x-protobuf
        msg = ExportTraceServiceRequest()
        msg.ParseFromString(body)
        payload = MessageToDict(msg)

    events = parse_spans(payload, prices)
    added = store.add_events(events)
    if added:
        cost = sum(e["cost"] for e in events)
        log.info("recorded %d LLM calls, batch cost %.6f %s", added, cost, prices.currency)
    # OTLP success response (empty ExportTraceServiceResponse)
    if "json" in ctype:
        return Response(content="{}", media_type="application/json")
    return Response(content=b"", media_type="application/x-protobuf")


# VS Code may also push metrics/logs to the same endpoint; accept and ignore them.
@app.post("/v1/metrics")
@app.post("/v1/logs")
async def ignore(request: Request):
    await request.body()
    return Response(content="{}", media_type="application/json")


@app.get("/usage", include_in_schema=False)
@app.get(
    "/api/v1/usage",
    name="get_usage_summary",
    operation_id="get_usage_summary",
    tags=["Usage"],
)
def usage():
    return {"currency": prices.currency, "rows": store.summary()}


@app.get("/agents", include_in_schema=False)
@app.get(
    "/api/v1/agents",
    name="get_marketplace_agents",
    operation_id="get_marketplace_agents",
    tags=["Agents"],
)
def agents():
    return marketplace.get()


@app.get("/health", include_in_schema=False)
@app.get(
    "/api/v1/health",
    name="get_service_health",
    operation_id="get_service_health",
    tags=["System"],
)
def health():
    return {"ok": True}
