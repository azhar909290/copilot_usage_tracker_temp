"""OTLP/HTTP receiver that prices GenAI spans from VS Code / Copilot / custom agents."""
import gzip
import json
import logging
import os

from fastapi import FastAPI, Request, Response
from google.protobuf.json_format import MessageToDict
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import (
    ExportTraceServiceRequest,
)

from .parser import parse_spans
from .pricing import PriceBook
from .store import UsageStore

log = logging.getLogger("otel_cost")
logging.basicConfig(level=logging.INFO)

app = FastAPI(title="GenAI cost monitor")
prices = PriceBook(os.getenv("PRICES_FILE", "prices.yaml"))
store = UsageStore(os.getenv("DATA_DIR", "data"))


async def _body(request: Request) -> bytes:
    body = await request.body()
    if request.headers.get("content-encoding", "").lower() == "gzip":
        body = gzip.decompress(body)
    return body


@app.post("/v1/traces")
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
        for e in events:
            if not e["priced"]:
                log.warning("no price for model %r (add it to prices.yaml)", e["model"])
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


@app.get("/usage")
def usage():
    return {"currency": prices.currency, "rows": store.summary()}


@app.get("/health")
def health():
    return {"ok": True}
