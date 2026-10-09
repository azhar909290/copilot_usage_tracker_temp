import os
import unittest
from unittest.mock import Mock, patch

from parser import parse_spans
from pricing import PriceBook


def attribute(key, value):
    value_key = "intValue" if isinstance(value, int) else "stringValue"
    return {"key": key, "value": {value_key: str(value) if isinstance(value, int) else value}}


class ParserTests(unittest.TestCase):
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