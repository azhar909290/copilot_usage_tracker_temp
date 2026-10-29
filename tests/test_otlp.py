import orjson

from tracker import otlp
from tracker.config import Settings
from tracker.schema import TIER_RESOURCE, TIER_SPAN

from .otlp_builders import agent_span, export, llm_span


def decode(*batches, decoder=None):
    decoder = decoder or otlp.TraceDecoder(Settings())
    out = otlp.Decoded([], [])
    for b in batches:
        d = decoder.decode(otlp.parse_protobuf(b))
        out.calls += d.calls
        out.identities += d.identities
    return out


def test_call_row_fields_and_invocation_rollup_is_skipped():
    d = decode(export(({"service.name": "copilot-chat"}, [
        agent_span(1, 10, name="planner", user="octocat"),
        llm_span(1, 11, parent=10, tokens=(120, 30), **{"gen_ai.response.model": "gpt-4o-2024-08-06"}),
    ])))
    assert len(d.calls) == 1  # the invoke_agent span is not double counted
    c = d.calls[0]
    assert (c["InputTokens"], c["OutputTokens"]) == (120, 30)
    assert c["Model"] == "gpt-4o-2024-08-06" and c["RequestModel"] == "gpt-4o"
    assert c["Agent"] == "planner"
    assert c["LatencyMs"] == 500.0
    assert c["CallKey"] == f"{1:032x}:{11:016x}"
    assert "UserLogin" not in c  # identity is bound at query time


def test_identity_arriving_after_children_is_still_captured():
    child_batch = export(({}, [llm_span(7, 71, parent=70)]))
    parent_batch = export(({}, [agent_span(7, 70, user="Octocat")]))
    d = decode(child_batch, parent_batch)
    assert len(d.calls) == 1
    assert [(i["TraceId"], i["UserKey"], i["Tier"]) for i in d.identities] == [
        (f"{7:032x}", "octocat", TIER_SPAN)]


def test_process_user_name_and_host_are_never_used():
    d = decode(export(({"process.user.name": "azharudeens", "host.name": "pc"},
                       [llm_span(2, 21)])))
    assert len(d.calls) == 1 and d.identities == []


def test_invalid_user_name_values_produce_no_identity():
    d = decode(export(({}, [llm_span(3, 31, user="2869784"), llm_span(3, 32, user="alex.novak")])))
    assert len(d.calls) == 2 and d.identities == []


def test_resource_identity_is_tier_one_per_trace_with_calls():
    d = decode(export(({"user.name": "octocat", "session.id": "win-1"}, [
        llm_span(4, 41), llm_span(5, 51)])))
    assert sorted((i["TraceId"][-1:], i["Tier"], i["SessionId"]) for i in d.identities) == [
        ("4", TIER_RESOURCE, "win-1"), ("5", TIER_RESOURCE, "win-1")]


def test_resend_is_deduplicated_and_identity_not_repeated():
    batch = export(({}, [agent_span(6, 60, user="octocat"), llm_span(6, 61, parent=60)]))
    decoder = otlp.TraceDecoder(Settings())
    d = decode(batch, batch, decoder=decoder)
    assert len(d.calls) == 1 and len(d.identities) == 1


def test_agent_resolves_across_batches_and_mode_name_wins():
    decoder = otlp.TraceDecoder(Settings())
    first = export(({}, [agent_span(8, 80, name="reviewer", **{"copilot_chat.mode_name": "My Agent"})]))
    second = export(({"service.name": "svc"}, [llm_span(8, 81, parent=80)]))
    d = decode(first, second, decoder=decoder)
    assert d.calls[0]["Agent"] == "My Agent"
    assert decode(export(({"service.name": "svc"}, [llm_span(9, 91)])), decoder=decoder).calls[0]["Agent"] == "svc"


def test_zero_token_spans_ignored():
    assert decode(export(({}, [llm_span(1, 1, tokens=(0, 0))]))).calls == []


def test_json_payload_matches_protobuf_semantics():
    payload = {"resourceSpans": [{
        "resource": {"attributes": [{"key": "service.name", "value": {"stringValue": "copilot"}}]},
        "scopeSpans": [{"spans": [
            {"traceId": "aa" * 16, "spanId": "bb" * 8, "parentSpanId": "cc" * 8,
             "startTimeUnixNano": "1760000000000000000", "endTimeUnixNano": "1760000000250000000",
             "attributes": [
                 {"key": "user.name", "value": {"stringValue": "octocat"}},
                 {"key": "gen_ai.usage.input_tokens", "value": {"intValue": "10"}},
                 {"key": "gen_ai.usage.output_tokens", "value": {"intValue": "5"}},
             ]}]}]}]}
    d = otlp.TraceDecoder(Settings()).decode(otlp.parse_json(orjson.dumps(payload)))
    assert d.calls[0]["InputTokens"] == 10 and d.calls[0]["LatencyMs"] == 250.0
    assert d.identities[0]["UserLogin"] == "octocat"
