"""Turn OTLP trace payloads (as dicts) into usage events."""
import os
from collections import OrderedDict
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

DAILY_TZ = ZoneInfo(os.getenv("DAILY_TZ", "UTC"))
# Spans that only roll up their children's tokens would double count.
SKIP_OPERATIONS = set(
    filter(None, os.getenv("SKIP_OPERATIONS", "invoke_agent").split(","))
)

# span -> agent name cache across batches (children can arrive before/after parents)
_AGENT_CACHE: "OrderedDict[str, tuple[str | None, str | None, bool]]" = OrderedDict()
_USER_CACHE: "OrderedDict[str, tuple[str | None, str | None]]" = OrderedDict()
_CACHE_MAX = 50_000


def _val(v: dict):
    for k in ("stringValue", "boolValue", "doubleValue"):
        if k in v:
            return v[k]
    if "intValue" in v:
        return int(v["intValue"])
    return None


def attrs(items) -> dict:
    return {a["key"]: _val(a.get("value", {})) for a in (items or [])}


def _to_int(x) -> int:
    try:
        return int(x)
    except (TypeError, ValueError):
        return 0


def _remember(trace_id: str, span_id: str, agent: str | None,
              mode: str | None, is_invocation: bool) -> None:
    _AGENT_CACHE[f"{trace_id}:{span_id}"] = (agent, mode, is_invocation)
    if len(_AGENT_CACHE) > _CACHE_MAX:
        _AGENT_CACHE.popitem(last=False)


def parse_spans(payload: dict, price_book) -> list[dict]:
    events: list[dict] = []
    # Identity-bearing parents can be in another resource group or earlier batch.
    for rs in payload.get("resourceSpans", []):
        for ss in rs.get("scopeSpans", []):
            for s in ss.get("spans", []):
                a = attrs(s.get("attributes"))
                user = a.get("user.name") or a.get("enduser.id") or a.get("user.id")
                key = f"{s.get('traceId', '')}:{s.get('spanId', '')}"
                _USER_CACHE[key] = (str(user) if user else None, s.get("parentSpanId"))
                _USER_CACHE.move_to_end(key)
                if len(_USER_CACHE) > _CACHE_MAX:
                    _USER_CACHE.popitem(last=False)

    for rs in payload.get("resourceSpans", []):
        res = attrs(rs.get("resource", {}).get("attributes"))
        resource_user = (
            res.get("user.name")
            or res.get("enduser.id")
            or res.get("user.id")
            or "unknown"
        )
        default_agent = res.get("service.name") or "copilot-chat"

        spans = [s for ss in rs.get("scopeSpans", []) for s in ss.get("spans", [])]
        by_id = {(s.get("traceId", ""), s.get("spanId")): s for s in spans}

        # 1) remember every span that names an agent
        for s in spans:
            a = attrs(s.get("attributes"))
            name = a.get("gen_ai.agent.name")
            mode = a.get("copilot_chat.mode_name")
            is_invocation = a.get("gen_ai.operation.name") == "invoke_agent"
            if name or mode or is_invocation:
                _remember(s.get("traceId", ""), s.get("spanId", ""),
                          name, mode, is_invocation)

        def resolve_agent(span: dict) -> str:
            cur, hops = span, 0
            nearest_name = None
            while cur is not None and hops < 12:
                cid = f"{cur.get('traceId','')}:{cur.get('spanId','')}"
                if cid in _AGENT_CACHE:
                    name, mode, is_invocation = _AGENT_CACHE[cid]
                    if mode:
                        return mode
                    nearest_name = nearest_name or name
                    if is_invocation:
                        return nearest_name or default_agent
                pid = cur.get("parentSpanId")
                if not pid:
                    break
                pkey = f"{cur.get('traceId', '')}:{pid}"
                if pkey in _AGENT_CACHE:
                    name, mode, is_invocation = _AGENT_CACHE[pkey]
                    if mode:
                        return mode
                    nearest_name = nearest_name or name
                    if is_invocation:
                        return nearest_name or default_agent
                cur = by_id.get((cur.get("traceId", ""), pid))
                hops += 1
            return nearest_name or default_agent

        def resolve_user(span: dict) -> str:
            trace_id, span_id = span.get("traceId", ""), span.get("spanId", "")
            for _ in range(12):
                user, parent_id = _USER_CACHE.get(
                    f"{trace_id}:{span_id}", (None, None)
                )
                if user:
                    return user
                if not parent_id:
                    break
                span_id = parent_id
            return str(resource_user)

        # 2) build events from spans that carry token usage
        for s in spans:
            a = attrs(s.get("attributes"))
            in_tok = _to_int(a.get("gen_ai.usage.input_tokens"))
            out_tok = _to_int(a.get("gen_ai.usage.output_tokens"))
            if not (in_tok or out_tok):
                continue
            if a.get("gen_ai.operation.name") in SKIP_OPERATIONS:
                continue

            req_model = a.get("gen_ai.request.model")
            resp_model = a.get("gen_ai.response.model")
            key, cost = price_book.cost([resp_model, req_model], in_tok, out_tok)

            start_ns = _to_int(s.get("startTimeUnixNano"))
            end_ns = _to_int(s.get("endTimeUnixNano"))
            latency_ms = (
                (end_ns - start_ns) / 1e6
                if start_ns > 0 and end_ns >= start_ns else None
            )
            ts = datetime.fromtimestamp(
                start_ns / 1e9, tz=timezone.utc
            )
            events.append(
                {
                    "key": f"{s.get('traceId','')}:{s.get('spanId','')}",
                    "timestamp": ts.isoformat(),
                    "date": ts.astimezone(DAILY_TZ).date().isoformat(),
                    "user": resolve_user(s),
                    "agent": resolve_agent(s),
                    "request_model": req_model,
                    "response_model": resp_model,
                    "model": resp_model or req_model or "unknown",
                    "priced_as": key,
                    "input_tokens": in_tok,
                    "output_tokens": out_tok,
                    "total_tokens": in_tok + out_tok,
                    "latency_ms": latency_ms,
                    "cost": round(cost, 8) if cost is not None else 0.0,
                    "priced": cost is not None,
                }
            )
    return events
