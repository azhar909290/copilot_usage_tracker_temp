import unittest
from unittest.mock import Mock

from parser import parse_spans


def attribute(key, value):
    value_key = "intValue" if isinstance(value, int) else "stringValue"
    return {"key": key, "value": {value_key: str(value) if isinstance(value, int) else value}}


class ParserTests(unittest.TestCase):
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