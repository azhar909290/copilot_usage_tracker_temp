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
# Values are (user, tier); a None user marks conflicting identities.
_TRACE_USER_CACHE: "OrderedDict[str, tuple[str | None, int]]" = OrderedDict()
_SESSION_USER_CACHE: "OrderedDict[str, tuple[str | None, int]]" = OrderedDict()
_CACHE_MAX = 50_000

# Span identities describe the request; resource identities describe the sender.
SPAN_TIER = 2
RESOURCE_TIER = 1

SESSION_ATTR_KEYS = (
    "gen_ai.conversation.id",
    "copilot_chat.session_id",
    "copilot_chat.chat_session_id",
    "conversation.id",
    "conversation_id",
    "session.id",
)

USER_ATTR_KEYS = (
    "user.name",
    "enduser.id",
    "user.id",
    "github.actor",
    "github.user.login",
    "github.user",
    "actor.login",
    "user.login",
    "enduser.pseudo.id",
    "copilot.user",
    "copilot.user.login",
    "copilot.actor",
)


def _extract_user(a: dict) -> str | None:
    if not a:
        return None
    for k in USER_ATTR_KEYS:
        val = a.get(k)
        if val is not None and str(val).strip():
            return str(val).strip()
    return None


def _extract_session(a: dict) -> str | None:
    if not a:
        return None
    for k in SESSION_ATTR_KEYS:
        val = a.get(k)
        if val is not None and str(val).strip():
            return str(val).strip()
    return None


def _val(v):
    if not isinstance(v, dict):
        return v
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


def _remember_user(cache: OrderedDict, key: str, user: str, tier: int) -> None:
    current = cache.get(key)
    if current is None or tier > current[1]:
        cache[key] = (user, tier)
    elif tier == current[1] and current[0] != user:
        cache[key] = (None, tier)
    else:
        return
    cache.move_to_end(key)
    if len(cache) > _CACHE_MAX:
        cache.popitem(last=False)


def _cached_user(cache: OrderedDict, key: str | None, tier: int) -> str | None:
    entry = cache.get(key) if key else None
    return entry[0] if entry and entry[1] == tier else None


def _remember(trace_id: str, span_id: str, agent: str | None,
              mode: str | None, is_invocation: bool) -> None:
    _AGENT_CACHE[f"{trace_id}:{span_id}"] = (agent, mode, is_invocation)
    if len(_AGENT_CACHE) > _CACHE_MAX:
        _AGENT_CACHE.popitem(last=False)


def parse_spans(payload: dict, price_book) -> list[dict]:
    events: list[dict] = []
    # Pass 1: Cache identities (user, trace, session, and span hierarchy) across batches
    for rs in payload.get("resourceSpans", []):
        res = attrs(rs.get("resource", {}).get("attributes"))
        res_user = _extract_user(res)
        res_session = _extract_session(res)
        for ss in rs.get("scopeSpans", []):
            for s in ss.get("spans", []):
                a = attrs(s.get("attributes"))
                span_user = _extract_user(a)
                trace_id = s.get("traceId", "")
                span_id = s.get("spanId", "")
                session_id = _extract_session(a) or res_session

                # Only span-level identity is inherited through the parent chain.
                key = f"{trace_id}:{span_id}"
                _USER_CACHE[key] = (span_user, s.get("parentSpanId"))
                _USER_CACHE.move_to_end(key)
                if len(_USER_CACHE) > _CACHE_MAX:
                    _USER_CACHE.popitem(last=False)

                user, tier = (
                    (span_user, SPAN_TIER) if span_user else (res_user, RESOURCE_TIER)
                )
                if user and trace_id:
                    _remember_user(_TRACE_USER_CACHE, trace_id, user, tier)
                if user and session_id:
                    _remember_user(_SESSION_USER_CACHE, session_id, user, tier)

    for rs in payload.get("resourceSpans", []):
        res = attrs(rs.get("resource", {}).get("attributes"))
        resource_user = _extract_user(res) or "unknown"
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

        def resolve_user(span: dict, span_attrs: dict) -> str:
            trace_id, span_id = span.get("traceId", ""), span.get("spanId", "")
            session_id = _extract_session(span_attrs) or _extract_session(res)
            for _ in range(12):
                u, parent_id = _USER_CACHE.get(
                    f"{trace_id}:{span_id}", (None, None)
                )
                if u:
                    return u
                if not parent_id:
                    break
                span_id = parent_id
            inherited = (
                _cached_user(_TRACE_USER_CACHE, trace_id, SPAN_TIER)
                or _cached_user(_SESSION_USER_CACHE, session_id, SPAN_TIER)
            )
            if inherited:
                return inherited
            if resource_user != "unknown":
                return str(resource_user)
            return (
                _cached_user(_TRACE_USER_CACHE, trace_id, RESOURCE_TIER)
                or _cached_user(_SESSION_USER_CACHE, session_id, RESOURCE_TIER)
                or "unknown"
            )

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
                    "user": resolve_user(s, a),
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
