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
_AGENT_CACHE: "OrderedDict[str, str]" = OrderedDict()
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


def _remember(trace_id: str, span_id: str, agent: str) -> None:
    _AGENT_CACHE[f"{trace_id}:{span_id}"] = agent
    if len(_AGENT_CACHE) > _CACHE_MAX:
        _AGENT_CACHE.popitem(last=False)


def parse_spans(payload: dict, price_book) -> list[dict]:
    events: list[dict] = []
    for rs in payload.get("resourceSpans", []):
        res = attrs(rs.get("resource", {}).get("attributes"))
        resource_user = (
            res.get("enduser.id")
            or res.get("user.name")
            or res.get("user.id")
            or os.getenv("DEFAULT_USER", "unknown")
        )
        default_agent = res.get("service.name") or "copilot-chat"

        spans = [s for ss in rs.get("scopeSpans", []) for s in ss.get("spans", [])]
        by_id = {(s.get("traceId", ""), s.get("spanId")): s for s in spans}

        # 1) remember every span that names an agent
        for s in spans:
            a = attrs(s.get("attributes"))
            name = a.get("gen_ai.agent.name")
            if name:
                _remember(s.get("traceId", ""), s.get("spanId", ""), name)

        def resolve_agent(span: dict) -> str:
            cur, hops = span, 0
            while cur is not None and hops < 12:
                cid = f"{cur.get('traceId','')}:{cur.get('spanId','')}"
                if cid in _AGENT_CACHE:
                    return _AGENT_CACHE[cid]
                pid = cur.get("parentSpanId")
                if not pid:
                    break
                pkey = f"{cur.get('traceId', '')}:{pid}"
                if pkey in _AGENT_CACHE:
                    return _AGENT_CACHE[pkey]
                cur = by_id.get((cur.get("traceId", ""), pid))
                hops += 1
            return default_agent

        def resolve_user(span: dict) -> str:
            cur, hops = span, 0
            while cur is not None and hops < 12:
                a = attrs(cur.get("attributes"))
                user = a.get("enduser.id") or a.get("user.name") or a.get("user.id")
                if user:
                    return str(user)
                pid = cur.get("parentSpanId")
                if not pid:
                    break
                cur = by_id.get((cur.get("traceId", ""), pid))
                hops += 1
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

            ts = datetime.fromtimestamp(
                _to_int(s.get("startTimeUnixNano")) / 1e9, tz=timezone.utc
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
                    "cost": round(cost, 8) if cost is not None else 0.0,
                    "priced": cost is not None,
                }
            )
    return events
