import gzip
import threading
import time

import orjson
import pytest
import requests
import uvicorn
from fastapi.testclient import TestClient

from telemetry import AgentTelemetry
from tracker.api import create_app
from tracker.config import Settings

from .otlp_builders import agent_span, export, llm_span
from .test_reader import FakeQuery, daily, event


class Capture:
    def __init__(self):
        self.rows = {}

    async def __call__(self, stream, rows):
        self.rows.setdefault(stream, []).extend(rows)


def cfg(**kw):
    return Settings(flush_interval=0.05, **kw)


def wait_for(predicate, timeout=3.0):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if predicate():
            return True
        time.sleep(0.02)
    return False


def batch():
    return export(({"service.name": "copilot-chat"}, [
        llm_span(1, 11, parent=10), agent_span(1, 10, user="Octocat")]))


def test_ingest_acknowledges_then_writes_calls_and_identity_to_logs():
    capture = Capture()
    app = create_app(cfg(), uploader=capture, query=FakeQuery())
    with TestClient(app) as client:
        r = client.post("/v1/traces", content=batch(),
                        headers={"content-type": "application/x-protobuf"})
        assert r.status_code == 200 and r.headers["x-request-id"]
        assert wait_for(lambda: len(capture.rows) == 2)
    calls = capture.rows["Custom-CopilotLlmCalls_CL"]
    ids = capture.rows["Custom-CopilotIdentity_CL"]
    assert len(calls) == 1 and ids[0]["UserLogin"] == "Octocat" and ids[0]["UserKey"] == "octocat"


def test_gzip_and_json_content_types():
    capture = Capture()
    app = create_app(cfg(), uploader=capture, query=FakeQuery())
    payload = orjson.dumps({"resourceSpans": [{"resource": {"attributes": []}, "scopeSpans": [{"spans": [{
        "traceId": "11" * 16, "spanId": "22" * 8, "startTimeUnixNano": "1760000000000000000",
        "endTimeUnixNano": "1760000000100000000",
        "attributes": [{"key": "gen_ai.usage.input_tokens", "value": {"intValue": "5"}}]}]}]}]})
    with TestClient(app) as client:
        r = client.post("/v1/traces", content=gzip.compress(payload),
                        headers={"content-type": "application/json", "content-encoding": "gzip"})
        assert r.status_code == 200 and r.json() == {}
        assert wait_for(lambda: "Custom-CopilotLlmCalls_CL" in capture.rows)


def test_bad_requests_are_rejected_without_500s():
    app = create_app(cfg(max_body_bytes=2000), uploader=Capture(), query=FakeQuery())
    with TestClient(app) as client:
        assert client.post("/v1/traces", content=b"\xff\xfe garbage",
                           headers={"content-type": "application/x-protobuf"}).status_code == 400
        assert client.post("/v1/traces", content=b"{nope",
                           headers={"content-type": "application/json"}).status_code == 400
        assert client.post("/v1/traces", content=b"x" * 5000).status_code == 413
        bomb = gzip.compress(b"0" * 100_000)
        assert client.post("/v1/traces", content=bomb,
                           headers={"content-encoding": "gzip"}).status_code == 413
        assert client.post("/v1/traces", content=b"not gzip",
                           headers={"content-encoding": "gzip"}).status_code == 400


def test_ingest_token_is_enforced_when_configured():
    app = create_app(cfg(ingest_token="s3cret"), uploader=Capture(), query=FakeQuery())
    with TestClient(app) as client:
        assert client.post("/v1/traces", content=batch()).status_code == 401
        ok = client.post("/v1/traces", content=batch(), headers={
            "authorization": "Bearer s3cret", "content-type": "application/x-protobuf"})
        assert ok.status_code == 200


def test_full_queue_returns_503_with_retry_after():
    app = create_app(cfg(max_pending_rows=1), uploader=Capture(), query=FakeQuery())
    with TestClient(app) as client:
        r = client.post("/v1/traces", content=batch(),
                        headers={"content-type": "application/x-protobuf"})
    assert r.status_code == 503 and r.headers["retry-after"] == "5"


def test_unconfigured_service_reports_why_instead_of_dropping_data():
    with TestClient(create_app(cfg())) as client:
        r = client.post("/v1/traces", content=batch())
        assert r.status_code == 503 and "not configured" in r.json()["detail"]
        assert client.get("/api/v1/health").status_code == 200
        assert client.get("/api/v1/health/ready").status_code == 503
        assert client.get("/api/v1/usage").status_code == 503


def test_usage_endpoint_serves_cached_bytes_with_etag():
    q = FakeQuery(rows=[daily()], events=[event()])
    with TestClient(create_app(cfg(), uploader=Capture(), query=q)) as client:
        r = client.get("/api/v1/usage?days=30")
        body = r.json()
        assert body["rows"][0]["user"] == "octocat" and body["events"][0]["user"] == "octocat"
        again = client.get("/api/v1/usage?days=30", headers={"if-none-match": r.headers["etag"]})
        assert again.status_code == 304
        assert client.get("/api/v1/events?limit=5").json()["events"][0]["key"] == "t:s"
        assert client.get("/api/v1/diagnostics").json()["ready"] is True


def test_real_otel_sdk_exports_agent_user_to_log_analytics():
    capture = Capture()
    app = create_app(cfg(), uploader=capture, query=FakeQuery())
    server = uvicorn.Server(uvicorn.Config(app, port=0, log_level="error"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    assert wait_for(lambda: server.started)
    port = server.servers[0].sockets[0].getsockname()[1]
    try:
        with AgentTelemetry(endpoint=f"http://127.0.0.1:{port}/v1/traces") as telemetry:
            with telemetry.llm_call("Planner", "gpt-4o", username="octocat") as span:
                span.set_attribute("gen_ai.usage.input_tokens", 10)
                span.set_attribute("gen_ai.usage.output_tokens", 4)
        assert wait_for(lambda: len(capture.rows) == 2)
    finally:
        server.should_exit = True
        thread.join(5)
    call = capture.rows["Custom-CopilotLlmCalls_CL"][0]
    assert (call["Agent"], call["InputTokens"]) == ("Planner", 10)
    assert capture.rows["Custom-CopilotIdentity_CL"][0]["UserKey"] == "octocat"
