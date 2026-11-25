"""Sends a fake OTLP/JSON batch: one Copilot chat span, one plugin-agent child span."""
import json, os, secrets, time, urllib.request

ENDPOINT = os.getenv("OTLP_ENDPOINT", "https://otel-data-h3f2g0fqgrc4e6bn.westindia-01.azurewebsites.net").rstrip("/")
USER_NAME = os.getenv("TELEMETRY_USER", "unknown_test")

now = str(time.time_ns())
chat_trace_id = secrets.token_hex(16)
agent_trace_id = secrets.token_hex(16)
root_span_id = secrets.token_hex(8)
def a(k, v):
    return {"key": k, "value": ({"intValue": str(v)} if isinstance(v, int) else {"stringValue": v})}

payload = {"resourceSpans": [{
  "resource": {"attributes": [a("service.name", "copilot-chat"), a("user.name", USER_NAME)]},
  "scopeSpans": [{"spans": [
    {"traceId": chat_trace_id, "spanId": secrets.token_hex(8), "startTimeUnixNano": now,
     "attributes": [a("gen_ai.operation.name", "chat"), a("gen_ai.request.model", "gpt-4o"),
                    a("gen_ai.response.model", "gpt-4o-2024-08-06"),
                    a("gen_ai.usage.input_tokens", 12000), a("gen_ai.usage.output_tokens", 800)]},
    {"traceId": agent_trace_id, "spanId": root_span_id, "startTimeUnixNano": now,
     "attributes": [a("gen_ai.operation.name", "invoke_agent"), a("gen_ai.agent.name", "code-review-agent")]},
    {"traceId": agent_trace_id, "spanId": secrets.token_hex(8), "parentSpanId": root_span_id, "startTimeUnixNano": now,
     "attributes": [a("gen_ai.operation.name", "chat"), a("gen_ai.request.model", "claude-sonnet-4"),
                    a("gen_ai.usage.input_tokens", 5000), a("gen_ai.usage.output_tokens", 1500)]},
  ]}]}]}
req = urllib.request.Request(f"{ENDPOINT}/v1/traces", json.dumps(payload).encode(),
                             {"Content-Type": "application/json"})
with urllib.request.urlopen(req, timeout=60) as response:
  print(f"Sent sample telemetry for {USER_NAME}: HTTP {response.status}")
  print(response.read().decode())
