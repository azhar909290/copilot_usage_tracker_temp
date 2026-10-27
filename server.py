"""OTLP/HTTP receiver that prices GenAI spans from VS Code / Copilot / custom agents."""
import gzip
import hmac
import json
import logging
import os
import time
import uuid

from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from google.protobuf.json_format import MessageToDict
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import (
    ExportTraceServiceRequest,
)

from parser import parse_spans
from github_metrics import GitHubMetrics, GitHubMetricsError
from marketplace import MarketplaceCatalog
from pricing import PriceBook
from store import UsageStore
from azure.monitor.opentelemetry import configure_azure_monitor


load_dotenv()

log = logging.getLogger("usage_api")
logging.basicConfig(level=logging.INFO)

applicationinsights_connection_string = os.getenv(
    "APPLICATIONINSIGHTS_CONNECTION_STRING", ""
).strip()
if applicationinsights_connection_string:
    configure_azure_monitor(
        connection_string=applicationinsights_connection_string,
        logger_name="usage_api",
    )
    log.info("Azure Monitor enabled for Application Insights")

app = FastAPI(
    title="Copilot Usage API",
    version="1.0.0",
    openapi_tags=[
        {"name": "Usage", "description": "Aggregated usage and cost reports."},
        {"name": "Agents", "description": "Marketplace catalog and agent usage."},
        {"name": "GitHub", "description": "Organization Copilot metrics."},
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
    allow_methods=["GET", "DELETE"],
    allow_headers=["*"],
    expose_headers=["X-Request-ID"],
)
prices = PriceBook()
store = UsageStore(os.getenv("DATA_DIR", "data"))
marketplace = MarketplaceCatalog(os.path.join(store.dir, "marketplace_cache.json"))
github_metrics = GitHubMetrics()

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
    if request.url.path == "/api/v1/github/metrics":
        response.headers["Cache-Control"] = "private, no-store"
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
        for ev in events:
            dim = {
                "user": ev["user"],
                "agent": ev["agent"],
                "model": ev["model"],
                "input_tokens": ev["input_tokens"],
                "output_tokens": ev["output_tokens"],
                "total_tokens": ev["total_tokens"],
                "cost": ev["cost"],
                "latency_ms": ev["latency_ms"] or 0,
            }
            log.info(
                "gen_ai_agent_call",
                extra={
                    **dim,
                    "custom_dimensions": dim,
                },
            )
            if ev["user"] == "unknown":
                log.warning(
                    "unresolved_user_span key=%s model=%s tokens=%d agent=%s (lacks identity on span/trace)",
                    ev["key"],
                    ev["model"],
                    ev["total_tokens"],
                    ev["agent"],
                )
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
    return {
        "currency": prices.currency,
        "rows": store.summary(),
        "events": store.get_events(),
    }


@app.get("/activity", include_in_schema=False)
@app.get("/events", include_in_schema=False)
@app.get(
    "/api/v1/activity",
    name="get_activity_events",
    operation_id="get_activity_events",
    tags=["Usage"],
)
@app.get(
    "/api/v1/events",
    name="get_events",
    operation_id="get_events",
    tags=["Usage"],
)
def activity_events(limit: int = 10000):
    return {
        "currency": prices.currency,
        "events": store.get_events(limit=limit),
    }


@app.delete(
    "/api/v1/usage/users/{username}",
    name="delete_user_usage",
    operation_id="delete_user_usage",
    tags=["Usage"],
)
def delete_user_usage(username: str, authorization: str | None = Header(default=None)):
    expected_token = os.getenv("USER_DATA_DELETE_TOKEN")
    if not expected_token:
        raise HTTPException(status_code=503, detail="User data deletion is not configured")

    scheme, separator, supplied_token = (authorization or "").partition(" ")
    if (not separator or scheme.lower() != "bearer"
            or not hmac.compare_digest(supplied_token.encode(), expected_token.encode())):
        raise HTTPException(
            status_code=401,
            detail="A valid bearer token is required",
            headers={"WWW-Authenticate": "Bearer"},
        )

    deleted = store.delete_user(username)
    return {"user": username, "deleted_events": deleted}


@app.get("/agents", include_in_schema=False)
@app.get(
    "/api/v1/agents",
    name="get_marketplace_agents",
    operation_id="get_marketplace_agents",
    tags=["Agents"],
)
def agents():
    return marketplace.get()


@app.get(
    "/api/v1/github/metrics",
    name="get_github_metrics",
    operation_id="get_github_metrics",
    tags=["GitHub"],
)
def get_github_metrics():
    try:
        return github_metrics.get()
    except GitHubMetricsError as error:
        log.warning("github_metrics_unavailable error=%s", error)
        raise HTTPException(status_code=503, detail=str(error)) from error


@app.get("/health", include_in_schema=False)
@app.get(
    "/api/v1/health",
    name="get_service_health",
    operation_id="get_service_health",
    tags=["System"],
)
def health():
    return {"ok": True}
