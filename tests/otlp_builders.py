"""Builders for OTLP payloads used across tests."""
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest
from opentelemetry.proto.common.v1.common_pb2 import AnyValue, KeyValue

T0 = 1_760_000_000_000_000_000  # ns


def kv(key, value):
    v = AnyValue()
    if isinstance(value, bool):
        v.bool_value = value
    elif isinstance(value, int):
        v.int_value = value
    else:
        v.string_value = str(value)
    return KeyValue(key=key, value=v)


def tid(n: int) -> bytes:
    return n.to_bytes(16, "big")


def sid(n: int) -> bytes:
    return n.to_bytes(8, "big")


def llm_span(trace, span, parent=0, tokens=(100, 50), user=None, **extra):
    attrs = {
        "gen_ai.operation.name": "chat",
        "gen_ai.request.model": "gpt-4o",
        "gen_ai.usage.input_tokens": tokens[0],
        "gen_ai.usage.output_tokens": tokens[1],
        **extra,
    }
    if user:
        attrs["user.name"] = user
    return dict(trace=trace, span=span, parent=parent, attrs=attrs, start=T0, end=T0 + 500_000_000)


def agent_span(trace, span, parent=0, user=None, name=None, **extra):
    attrs = {"gen_ai.operation.name": "invoke_agent", **extra}
    if name:
        attrs["gen_ai.agent.name"] = name
    if user:
        attrs["user.name"] = user
    return dict(trace=trace, span=span, parent=parent, attrs=attrs, start=T0, end=T0 + 900_000_000)


def export(*resources) -> bytes:
    """resources: (resource_attrs, [span dicts])"""
    req = ExportTraceServiceRequest()
    for res_attrs, spans in resources:
        rs = req.resource_spans.add()
        rs.resource.attributes.extend(kv(k, v) for k, v in res_attrs.items())
        scope = rs.scope_spans.add()
        for s in spans:
            span = scope.spans.add()
            span.trace_id = tid(s["trace"])
            span.span_id = sid(s["span"])
            if s["parent"]:
                span.parent_span_id = sid(s["parent"])
            span.start_time_unix_nano = s["start"]
            span.end_time_unix_nano = s["end"]
            span.attributes.extend(kv(k, v) for k, v in s["attrs"].items())
    return req.SerializeToString()
