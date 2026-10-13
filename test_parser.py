import os
import unittest
from unittest.mock import Mock, patch

from parser import parse_spans
from pricing import PriceBook


def attribute(key, value):
    value_key = "intValue" if isinstance(value, int) else "stringValue"
    return {"key": key, "value": {value_key: str(value) if isinstance(value, int) else value}}


class ParserTests(unittest.TestCase):
    def test_plugin_mode_name_overrides_internal_llm_agent_name(self):
        payload = {"resourceSpans": [{"scopeSpans": [{"spans": [
            {
                "traceId": "plugin-mode", "spanId": "parent",
                "attributes": [attribute("gen_ai.operation.name", "invoke_agent"),
                               attribute("gen_ai.agent.name", "GitHub Copilot Chat"),
                               attribute("copilot_chat.mode_name", "Format-Agent"),
                               attribute("gen_ai.usage.input_tokens", 100)],
            },
            {
                "traceId": "plugin-mode", "spanId": "chat", "parentSpanId": "parent",
                "attributes": [attribute("gen_ai.agent.name", "panel/editAgent"),
                               attribute("gen_ai.usage.input_tokens", 100)],
            },
            {
                "traceId": "plugin-mode", "spanId": "nested", "parentSpanId": "parent",
                "attributes": [attribute("gen_ai.operation.name", "invoke_agent"),
                               attribute("gen_ai.agent.name", "Reviewer")],
            },
            {
                "traceId": "plugin-mode", "spanId": "nested-chat", "parentSpanId": "nested",
                "attributes": [attribute("gen_ai.usage.input_tokens", 50)],
            },
        ]}]}]}
        events = parse_spans(payload, PriceBook())
        self.assertEqual([event["agent"] for event in events], ["Format-Agent", "Reviewer"])
        self.assertEqual([event["input_tokens"] for event in events], [100, 50])
        spans = payload["resourceSpans"][0]["scopeSpans"][0]["spans"]
        for span in spans:
            span["traceId"] = "plugin-mode-separate-batches"
        payload["resourceSpans"][0]["scopeSpans"][0]["spans"] = spans[:1]
        self.assertEqual(parse_spans(payload, PriceBook()), [])
        payload["resourceSpans"][0]["scopeSpans"][0]["spans"] = spans[1:]
        events = parse_spans(payload, PriceBook())
        self.assertEqual([event["agent"] for event in events], ["Format-Agent", "Reviewer"])

    def test_named_agents_have_separate_llm_usage_and_latency(self):
        spans = [{
            "traceId": "agent-metrics", "spanId": "parent",
            "attributes": [attribute("gen_ai.agent.name", "Planner"),
                           attribute("gen_ai.operation.name", "invoke_agent"),
                           attribute("gen_ai.usage.input_tokens", 999)],
        }]
        for span_id, agent_name, parent_id in (
            ("planner-call", None, "parent"),
            ("reviewer-call", "Reviewer", "parent"),
        ):
            attributes = [attribute("gen_ai.usage.input_tokens", 100),
                          attribute("gen_ai.usage.output_tokens", 20),
                          attribute("gen_ai.request.model", "test-model")]
            if agent_name:
                attributes.append(attribute("gen_ai.agent.name", agent_name))
            spans.append({
                "traceId": "agent-metrics", "spanId": span_id, "parentSpanId": parent_id,
                "startTimeUnixNano": "1000000000", "endTimeUnixNano": "1250000000",
                "attributes": attributes,
            })
        payload = {"resourceSpans": [{"scopeSpans": [{"spans": spans}]}]}
        events = parse_spans(payload, PriceBook())
        self.assertEqual([item["agent"] for item in events], ["Planner", "Reviewer"])
        self.assertEqual([item["total_tokens"] for item in events], [120, 120])
        self.assertEqual([item["latency_ms"] for item in events], [250.0, 250.0])

    def test_missing_or_invalid_end_timestamp_has_unknown_latency(self):
        for end_ns in (None, "500000000"):
            span = {"traceId": "latency", "spanId": "call",
                    "startTimeUnixNano": "1000000000",
                    "attributes": [attribute("gen_ai.usage.input_tokens", 1)]}
            if end_ns is not None:
                span["endTimeUnixNano"] = end_ns
            payload = {"resourceSpans": [{"scopeSpans": [{"spans": [span]}]}]}
            self.assertIsNone(parse_spans(payload, PriceBook())[0]["latency_ms"])

    def test_client_identities_are_not_replaced_by_server_default(self):
        payload = {"resourceSpans": []}
        for index, username in enumerate(("octocat", "another-user", None)):
            resource_attributes = [] if username is None else [
                attribute("user.name", username), attribute("enduser.id", "numeric-id")
            ]
            payload["resourceSpans"].append({
                "resource": {"attributes": resource_attributes},
                "scopeSpans": [{"spans": [{
                    "traceId": "client-identity-trace",
                    "spanId": str(index),
                    "attributes": [attribute("gen_ai.usage.input_tokens", 100)],
                }]}],
            })
        with patch.dict(os.environ, {"DEFAULT_USER": "unknown"}):
            events = parse_spans(payload, PriceBook())
        self.assertEqual([event["user"] for event in events],
                         ["octocat", "another-user", "unknown"])

    def test_flat_rate_prices_all_models_and_combined_tokens(self):
        prices = PriceBook()
        for model in ("gpt-4o", "new-model", None):
            with self.subTest(model=model):
                key, cost = prices.cost([model], 600_000, 400_000)
                self.assertEqual(key, "flat-rate")
                self.assertAlmostEqual(cost, 0.99)
        self.assertEqual(prices.cost([], 0, 0), ("flat-rate", 0.0))
        self.assertAlmostEqual(prices.cost([], 1000, 0)[1], 0.00099)

    def test_inherits_authenticated_account_from_invoke_agent_parent(self):
        trace_id = "trace"
        payload = {
            "resourceSpans": [{
                "resource": {"attributes": [attribute("service.name", "copilot-chat")]},
                "scopeSpans": [{"spans": [
                    {
                        "traceId": trace_id,
                        "spanId": "root",
                        "attributes": [
                            attribute("gen_ai.operation.name", "invoke_agent"),
                            attribute("user.name", "octocat"),
                        ],
                    },
                    {
                        "traceId": trace_id,
                        "spanId": "chat",
                        "parentSpanId": "root",
                        "attributes": [
                            attribute("gen_ai.usage.input_tokens", 120),
                            attribute("gen_ai.request.model", "gpt-4o"),
                        ],
                    },
                ]}],
            }],
        }
        price_book = Mock()
        price_book.cost.return_value = ("gpt-4o", 0.01)

        events = parse_spans(payload, price_book)

        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["user"], "octocat")


if __name__ == "__main__":
    unittest.main()