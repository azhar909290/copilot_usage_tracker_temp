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

### Organization-Wide Identity Capture (managed-settings.json)

This is the recommended configuration for capturing every team member's identity
automatically without each user having to configure anything manually.

In your `.github-private/managed-settings.json` (applied via your GitHub organization
policy), use this configuration:

```json
{
  "telemetry": {
    "enabled": true,
    "endpoint": "https://<your-azure-receiver>.azurewebsites.net",
    "protocol": "http/protobuf",
    "capture": {
      "identity": true
    },
    "captureContent": false,
    "lockCaptureContent": true,
    "serviceName": "copilot",
    "resourceAttributes": {
      "deployment.environment": "production"
    }
  }
}
```

**What `"capture": { "identity": true }` does for every user in your org:**

| What is captured | Attribute key in OTel span |
| :--- | :--- |
| GitHub account login (e.g. `alice`, `bob`) | `user.name` |
| Local OS username | `process.user.name` *(not used for identity by this receiver)* |
| Machine hostname | `host.name` |

With `captureIdentity` enabled at the **managed (org) level**, every Copilot Chat
user in your organization automatically emits their GitHub login on each trace.
The receiver picks this up from `user.name` on the root span and attributes **all**
LLM sub-calls in that trace to that user — including background spans like
`thinkingTitle` and `XtabProvider` that would otherwise fall into `unknown`.

> **Important:** Do **not** add `user.name` as a static value in `resourceAttributes`.
> The managed setting `"capture": { "identity": true }` makes Copilot Chat inject
> each user's **actual** GitHub login dynamically per-session. A static
> `resourceAttributes` entry would overwrite every user's identity with the same
> fixed value.

**Summary of fields in your current managed-settings.json:**

| Field | Keep as-is? | Reason |
| :--- | :---: | :--- |
| `"enabled": true` | ✅ Yes | Required to turn on OTel export |
| `"endpoint"` | ✅ Yes | Your Azure receiver URL |
| `"protocol": "http/protobuf"` | ✅ Yes | Standard OTLP protocol |
| `"capture": { "identity": true }` | ✅ Yes | **This is the key setting** — auto-captures each user's GitHub login |
| `"captureContent": false` | ✅ Yes | Keeps prompt/response content private |
| `"lockCaptureContent": true` | ✅ Yes | Prevents individual users from enabling content capture |
| `"serviceName": "copilot"` | ✅ Yes | Labels all spans with the service name |
| `"resourceAttributes": { "deployment.environment": "production" }` | ✅ Yes | Adds an org-level tag to every span |

Your `managed-settings.json` is already correct for org-wide use. No changes needed.
The only reason tokens land in `unknown` is that background sub-spans (streaming
completions, title generators) arrive at the receiver before the root session span
that carries the identity. The trace-level identity cache added to `parser.py`
resolves this — within a single request batch.

For Copilot custom agents, the tracker prefers `copilot_chat.mode_name` on the
nearest available agent invocation over internal labels such as `panel/editAgent`.
Otherwise it uses `gen_ai.agent.name` on the LLM span or an available ancestor.
Parent `invoke_agent` token rollups are
excluded to avoid counting the same tokens twice. Nested agents with distinct
names are grouped separately, not charged to both parent and child.

Coverage depends on what the client exports. A custom agent cannot be identified
by its markdown filename unless the runtime exports that identity. Spans without
an agent name or an available named ancestor fall back to `service.name`. A parent
that arrives in a later batch does not retroactively relabel existing events.
For reliable custom-agent attribution, set the name on each LLM-call span.

If a plugin agent is missing, check the GitHub Copilot Chat output for `[OTel]`
initialization and export errors. Configure OTel in VS Code **User** settings;
the installed extension defines these as application-scoped settings, so workspace
settings are not sufficient. Keep the Azure collector URL for cloud reporting.
Deploy receiver changes to Azure before expecting new attribution in the cloud;
existing usage rows are not retroactively renamed by this parser change.

Optional identity capture (`github.copilot.chat.otel.captureIdentity`) records
the authenticated account name, OS username, and machine hostname for Local
harness sessions; enable it only with appropriate consent and retention policy.
No prompt or response content is needed for usage tracking.

If identity capture is disabled or managed settings prohibit enabling it, you
can attribute usage with an explicitly supplied GitHub alias instead. Set the
`OTEL_RESOURCE_ATTRIBUTES` environment variable for the VS Code process:

```text
OTEL_RESOURCE_ATTRIBUTES=user.name=octocat
```

This adds only the supplied `user.name` resource attribute; the tracker uses it
to group usage by user. The tracker also accepts `enduser.id` and `user.id`.
If your organization manages OTel resource attributes, its managed value
overrides `OTEL_RESOURCE_ATTRIBUTES`, so ask your administrator to configure
the approved alias there. This alternative does not enable machine identity
capture.

### Why several user names can appear

The receiver groups usage by the identity it finds on each span or its ancestors.
Identity comes from span attributes (`user.name`, `enduser.id`, `github.actor`, etc.)
or resource attributes pushed by the OTel SDK on every client machine.
If two different attribute keys are used by different parts of the client, they may
resolve to the same person but appear as different labels in the ledger.
An OS-style name in the User column means that name was supplied through
`user.name`, `enduser.id`, or `user.id`; the ledger alone cannot prove which client
configuration supplied it. The receiver does **not** use `process.user.name` as a
GitHub identity.

The receiver resolves identity in this order:

1. The call span, then its ancestor spans (span attributes only).
2. Another span in the same trace, then the same conversation/session, that
   carries a span-level identity.
3. The call's own resource identity (for example, `OTEL_RESOURCE_ATTRIBUTES`).
4. A resource identity seen on the same trace, then session, in another resource
   group or earlier batch.

Span identity describes the request, while resource identity describes the
sending process, so a GitHub login on a parent span wins over an OS-style
resource `user.name`. If one trace or session carries two different identities
at the same level, it is not used for inheritance, so calls fall back to the
next step or `unknown` rather than being charged to the wrong user. Recognized
user attributes are `user.name`, `enduser.id`, `user.id`, `github.actor`,
`github.user.login`, `github.user`, `actor.login`, `user.login`,
`enduser.pseudo.id`, `copilot.user`, `copilot.user.login`, and `copilot.actor`.

Inheritance uses bounded in-memory caches and works across resource groups and
earlier batches. A parent arriving in a later request does not retroactively
update stored events; restarting the receiver clears these caches. `unknown`
means no supported identity was available. Existing labels remain separate and
are not automatically merged or assigned to a GitHub account.

Seeing three labels does not by itself prove duplicate accounting. Event keys
are trace ID plus span ID, and parent `invoke_agent` rollups are excluded by
default. Verify actual event keys before treating separate rows as duplicates.
For new calls, enable approved identity capture or configure the explicit GitHub
alias above on each emitting client. Neither option relabels historical rows.

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
Rows also include `first_seen` and `last_seen`: the earliest and latest call
start timestamps in each daily group, normalized to UTC. These fields are also
included in `daily_usage.csv` and dashboard CSV exports. The Activity table
displays both in the browser's local timezone, and Recent activity shows the
last call time and sorts by it. Daily grouping still uses `DAILY_TZ` (UTC by
default), so the local call date may differ from the group's date. Historical
events without timestamps show "Time unavailable"; no midnight time is invented.
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