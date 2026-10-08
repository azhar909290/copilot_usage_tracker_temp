"""Sends a fake OTLP/JSON batch: one Copilot chat span, one plugin-agent child span."""
import json, os, time, urllib.request

ENDPOINT = os.getenv("OTLP_ENDPOINT", "https://otel-data-h3f2g0fqgrc4e6bn.westindia-01.azurewebsites.net").rstrip("/")

now = str(int(time.time() * 1e9))
def a(k, v):
    return {"key": k, "value": ({"intValue": str(v)} if isinstance(v, int) else {"stringValue": v})}

payload = {"resourceSpans": [{
  "resource": {"attributes": [a("service.name", "copilot-chat"), a("user.name", "alice")]},
  "scopeSpans": [{"spans": [
    {"traceId": "t1", "spanId": "s1", "startTimeUnixNano": now,
     "attributes": [a("gen_ai.operation.name", "chat"), a("gen_ai.request.model", "gpt-4o"),
                    a("gen_ai.response.model", "gpt-4o-2024-08-06"),
                    a("gen_ai.usage.input_tokens", 12000), a("gen_ai.usage.output_tokens", 800)]},
    {"traceId": "t2", "spanId": "root", "startTimeUnixNano": now,
     "attributes": [a("gen_ai.operation.name", "invoke_agent"), a("gen_ai.agent.name", "code-review-agent")]},
    {"traceId": "t2", "spanId": "c1", "parentSpanId": "root", "startTimeUnixNano": now,
     "attributes": [a("gen_ai.operation.name", "chat"), a("gen_ai.request.model", "claude-sonnet-4"),
                    a("gen_ai.usage.input_tokens", 5000), a("gen_ai.usage.output_tokens", 1500)]},
  ]}]}]}
req = urllib.request.Request(f"{ENDPOINT}/v1/traces", json.dumps(payload).encode(),
                             {"Content-Type": "application/json"})
print(urllib.request.urlopen(req).read())
