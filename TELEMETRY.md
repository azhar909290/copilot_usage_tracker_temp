# Per-Agent LLM Usage

Each LLM call processes input tokens and usually generates output tokens. Use
the provider's reported usage, not a count of characters or a guessed token count.
An agent invocation can make multiple LLM calls, including calls from subagents.

## VS Code Copilot Agents

Start the receiver from this directory in WSL:

```sh
venv/bin/python run.py
```

In VS Code user settings, enable the built-in exporter:

```json
{
  "github.copilot.chat.otel.enabled": true,
  "github.copilot.chat.otel.exporterType": "otlp-http",
  "github.copilot.chat.otel.otlpEndpoint": "http://localhost:4318",
  "github.copilot.chat.otel.captureContent": false
}
```

Reload the VS Code window after changing these settings. Environment variables
can override settings. These settings require a Copilot Chat version supporting
OpenTelemetry. See the [official monitoring documentation](https://code.visualstudio.com/docs/copilot/guides/monitoring-agents).

The tracker uses `gen_ai.agent.name` on the LLM span, or the nearest named ancestor
available when the span is ingested. Parent `invoke_agent` token rollups are
excluded to avoid counting the same tokens twice. Nested agents with distinct
names are grouped separately, not charged to both parent and child.

Coverage depends on what the client exports. A custom agent cannot be identified
by its markdown filename unless the runtime exports that identity. Spans without
an agent name or an available named ancestor fall back to `service.name`. A parent
that arrives in a later batch does not retroactively relabel existing events.
For reliable custom-agent attribution, set the name on each LLM-call span.

Optional identity capture (`github.copilot.chat.otel.captureIdentity`) records
developer identity; enable it only with appropriate consent and retention policy.
No prompt or response content is needed for usage tracking.

## Custom Python Agents

Install the project dependencies into the agent's Python environment. Create one
`AgentTelemetry` per process and wrap every LLM request, including subagent calls:

```python
from telemetry import AgentTelemetry

with AgentTelemetry(endpoint="http://localhost:4318/v1/traces") as telemetry:
    with telemetry.llm_call("Reviewer", "gpt-4o") as span:
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=messages,
        )
        span.set_attribute("gen_ai.response.model", response.model)
        span.set_attribute("gen_ai.usage.input_tokens", response.usage.prompt_tokens)
        span.set_attribute("gen_ai.usage.output_tokens", response.usage.completion_tokens)
```

The example assumes an existing OpenAI-compatible `client` and `messages`.
Adapt the usage fields for your provider. For streaming, wrap the whole stream
and record the final reported usage before leaving the context. The helper
records elapsed LLM-call time automatically and exports through the official
OpenTelemetry SDK. It does not make LLM requests or capture message content.
Shutdown flushes pending spans. Call `telemetry.flush()` for an immediate export.
Omit `endpoint` to use the SDK's standard OTLP environment configuration.

## Reports and Limits

Read `http://localhost:4318/api/v1/usage`. Rows are grouped by date, user, agent,
and model and include `requests`, `input_tokens`, `output_tokens`, `total_tokens`,
`cost`, `latency_ms_total`, `latency_requests`, and `latency_ms_avg`.
The latency average includes only spans with valid start and end timestamps;
it is LLM-call latency, not total agent execution time. Old ledger entries still
work and do not contribute unknown latency as zero.

Cost is the project's existing flat USD estimate: $0.99 per million combined
input and output tokens. It is not a provider invoice or Copilot premium-request
charge and does not distinguish cached-token pricing. The current pricing code
does not read `prices.yaml`.

This application derives usage from `/v1/traces`. `/v1/metrics` and `/v1/logs`
are accepted but not stored; it is not a full OTel collector or trace backend.
Spans without nonzero token usage are not included in usage reports. Missing
provider usage cannot be reconstructed by this tracker.
Bind only to localhost unless you add authenticated transport and access control.