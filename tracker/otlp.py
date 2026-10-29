"""Decode OTLP trace exports (protobuf or JSON) into Log Analytics rows."""
from collections import OrderedDict
from dataclasses import dataclass
from datetime import datetime, timezone

import orjson
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import (
    ExportTraceServiceRequest,
)

from .config import Settings
from .identity import extract_login
from .schema import TIER_RESOURCE, TIER_SPAN

SESSION_KEYS = (
    "gen_ai.conversation.id",
    "copilot_chat.session_id",
    "copilot_chat.chat_session_id",
    "conversation.id",
    "session.id",
)
MAX_HOPS = 12
CACHE_MAX = 50_000


@dataclass(slots=True)
class Span:
    trace: str
    span: str
    parent: str
    start_ns: int
    end_ns: int
    attrs: dict


@dataclass(slots=True)
class Decoded:
    calls: list[dict]
    identities: list[dict]


def _pb_value(v):
    kind = v.WhichOneof("value")
    return getattr(v, kind) if kind in ("string_value", "bool_value", "int_value", "double_value") else None


def _pb_attrs(items) -> dict:
    return {kv.key: _pb_value(kv.value) for kv in items}


def _json_value(v):
    if not isinstance(v, dict):
        return None
    for key in ("stringValue", "boolValue", "doubleValue"):
        if key in v:
            return v[key]
    if "intValue" in v:
        return _to_int(v["intValue"])
    return None


def _json_attrs(items) -> dict:
    return {a.get("key"): _json_value(a.get("value")) for a in items or () if a.get("key")}


def _to_int(x) -> int:
    try:
        return int(x)
    except (TypeError, ValueError):
        return 0


def parse_protobuf(body: bytes) -> list[tuple[dict, list[Span]]]:
    msg = ExportTraceServiceRequest()
    msg.ParseFromString(body)
    out = []
    for rs in msg.resource_spans:
        spans = [
            Span(
                s.trace_id.hex(), s.span_id.hex(), s.parent_span_id.hex(),
                s.start_time_unix_nano, s.end_time_unix_nano, _pb_attrs(s.attributes),
            )
            for ss in rs.scope_spans
            for s in ss.spans
        ]
        out.append((_pb_attrs(rs.resource.attributes), spans))
    return out


def parse_json(body: bytes) -> list[tuple[dict, list[Span]]]:
    payload = orjson.loads(body)
    out = []
    for rs in payload.get("resourceSpans") or ():
        spans = [
            Span(
                s.get("traceId", ""), s.get("spanId", ""), s.get("parentSpanId", ""),
                _to_int(s.get("startTimeUnixNano")), _to_int(s.get("endTimeUnixNano")),
                _json_attrs(s.get("attributes")),
            )
            for ss in rs.get("scopeSpans") or ()
            for s in ss.get("spans") or ()
        ]
        out.append((_json_attrs((rs.get("resource") or {}).get("attributes")), spans))
    return out


def _iso(ns: int) -> str:
    return datetime.fromtimestamp(ns / 1e9, tz=timezone.utc).isoformat()


class _Lru:
    def __init__(self, size: int) -> None:
        self.size = size
        self.items: OrderedDict = OrderedDict()

    def add(self, key, value=True) -> bool:
        """Insert; return False when the key was already present."""
        fresh = key not in self.items
        self.items[key] = value
        self.items.move_to_end(key)
        if len(self.items) > self.size:
            self.items.popitem(last=False)
        return fresh

    def get(self, key):
        return self.items.get(key)


class TraceDecoder:
    """Stateful only for best-effort dedupe and cross-batch agent lookup.

    Correctness never depends on this state: identity is bound in KQL and exact
    duplicates are removed by CallKey at query time, so any worker can ingest any batch.
    """

    def __init__(self, settings: Settings) -> None:
        self.identity_keys = settings.identity_attributes
        self.skip_operations = frozenset(settings.skip_operations)
        self._spans = _Lru(CACHE_MAX)  # (trace, span) -> (parent, agent, mode, is_invocation)
        self._seen_calls = _Lru(CACHE_MAX)
        self._seen_identity = _Lru(CACHE_MAX)

    def decode(self, resources: list[tuple[dict, list[Span]]]) -> Decoded:
        calls: list[dict] = []
        identities: list[dict] = []
        now_iso = datetime.now(timezone.utc).isoformat()
        for res, spans in resources:
            self._decode_resource(res, spans, calls, identities, now_iso)
        return Decoded(calls, identities)

    def _remember_spans(self, spans: list[Span]) -> None:
        for s in spans:
            a = s.attrs
            self._spans.add(
                (s.trace, s.span),
                (
                    s.parent,
                    a.get("gen_ai.agent.name"),
                    a.get("copilot_chat.mode_name"),
                    a.get("gen_ai.operation.name") == "invoke_agent",
                ),
            )

    def _resolve_agent(self, s: Span, default: str) -> str:
        nearest = None
        key = (s.trace, s.span)
        for _ in range(MAX_HOPS):
            node = self._spans.get(key)
            if node is None:
                break
            parent, name, mode, is_invocation = node
            if mode:
                return mode
            nearest = nearest or name
            if is_invocation:
                return nearest or default
            if not parent:
                break
            key = (s.trace, parent)
        return nearest or default

    def _identity_row(self, event_time, trace, session, login, user_key, tier, source):
        if not (trace or session):
            return None
        if not self._seen_identity.add((trace, session, user_key, tier)):
            return None
        return {
            "EventTime": event_time, "TraceId": trace, "SessionId": session,
            "UserLogin": login, "UserKey": user_key, "Tier": tier, "Source": source,
        }

    def _decode_resource(self, res, spans, calls, identities, now_iso) -> None:
        self._remember_spans(spans)
        default_agent = res.get("service.name") or "copilot-chat"
        service = str(res.get("service.name") or "")
        res_session = next((str(res[k]) for k in SESSION_KEYS if res.get(k)), "")
        res_identity = extract_login(res, self.identity_keys)
        resource_traces: dict[str, str] = {}  # trace -> session, for resource-level facts

        for s in spans:
            a = s.attrs
            session = next((str(a[k]) for k in SESSION_KEYS if a.get(k)), "") or res_session
            event_ns = s.start_ns or s.end_ns
            event_time = _iso(event_ns) if event_ns else now_iso

            found = extract_login(a, self.identity_keys)
            if found:
                row = self._identity_row(
                    event_time, s.trace, session, found[0], found[1], TIER_SPAN, found[2]
                )
                if row:
                    identities.append(row)

            in_tok = _to_int(a.get("gen_ai.usage.input_tokens"))
            out_tok = _to_int(a.get("gen_ai.usage.output_tokens"))
            if not (in_tok or out_tok):
                continue
            operation = a.get("gen_ai.operation.name") or ""
            if operation in self.skip_operations:
                continue
            key = f"{s.trace}:{s.span}"
            if not self._seen_calls.add(key):
                continue
            resource_traces.setdefault(s.trace, session)
            req_model = a.get("gen_ai.request.model") or ""
            resp_model = a.get("gen_ai.response.model") or ""
            latency = (
                (s.end_ns - s.start_ns) / 1e6
                if s.start_ns > 0 and s.end_ns >= s.start_ns else None
            )
            calls.append({
                "EventTime": event_time,
                "CallKey": key,
                "TraceId": s.trace,
                "SpanId": s.span,
                "SessionId": session,
                "Agent": self._resolve_agent(s, default_agent),
                "Model": resp_model or req_model or "unknown",
                "RequestModel": req_model,
                "ResponseModel": resp_model,
                "Operation": operation,
                "Service": service,
                "InputTokens": in_tok,
                "OutputTokens": out_tok,
                "LatencyMs": round(latency, 3) if latency is not None else None,
            })

        if res_identity:
            login, user_key, source = res_identity
            for trace, session in resource_traces.items():
                row = self._identity_row(
                    now_iso, trace, session, login, user_key, TIER_RESOURCE, source
                )
                if row:
                    identities.append(row)
