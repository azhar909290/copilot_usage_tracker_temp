# Per-Agent LLM Usage

Each LLM call processes input tokens and usually generates output tokens. Usage is
the provider's reported token count, never a guess. An agent invocation can make
multiple LLM calls, including calls from subagents.

## Architecture

```text
VS Code / Copilot / custom agents
        │ OTLP/HTTP (protobuf or JSON) → POST /v1/traces
        ▼
  receiver (FastAPI)  ── decode ── queue ──► Logs Ingestion API ──► Log Analytics
        ▲                                                              │
        │ cached JSON (ETag)                                           │ KQL
  dashboard  ◄────────────────  /api/v1/usage  ◄── in-memory cache ◄──┘
```

* **Ingest** acknowledges as soon as rows are queued. A background task uploads
  large batches (default 1000 rows or 2 s) with retries. If the queue is full
  (`INGEST_MAX_PENDING_ROWS`) the receiver answers `503` + `Retry-After`, which
  OTLP exporters retry. Rows are acknowledged before they are durable, so a crash
  can lose at most the few seconds still queued.
* **Storage** is two custom Log Analytics tables, created by the app:

  | Table | One row per | Key columns |
  | :--- | :--- | :--- |
  | `CopilotLlmCalls_CL` | LLM call span | `EventTime`, `CallKey` (`traceId:spanId`), `TraceId`, `SessionId`, `Agent`, `Model`, `InputTokens`, `OutputTokens`, `LatencyMs` |
  | `CopilotIdentity_CL` | identity fact seen on a span/resource | `TraceId`, `SessionId`, `UserLogin`, `UserKey` (lower-cased), `Tier` (2 span, 1 resource), `Source` |

  `TimeGenerated` is the ingestion time (Azure Monitor overwrites values older than
  48 hours); the span's own start time is `EventTime`, so back-filling works.
* **Reads** run KQL against those tables and are cached in memory
  (`CACHE_TTL_SECONDS`, default 30). Requests are served from the cache and
  refreshed in the background, with one query per key regardless of traffic, so
  dashboard load never turns into Log Analytics load.
* **Freshness:** Log Analytics typically makes new rows queryable after 20 s to a
  few minutes, plus the cache TTL. The dashboard is near-real-time, not real-time.

## Setup

1. Create (or pick) a Log Analytics workspace. Give the app a managed identity.
2. Set `LOG_ANALYTICS_RESOURCE_ID` and run `python -m tracker.provision`
   (needs Contributor on the resource group). It creates both tables with
   `TABLE_RETENTION_DAYS` retention and a Direct Data Collection Rule, then
   prints `LOG_ANALYTICS_WORKSPACE_ID`, `LOGS_INGESTION_ENDPOINT` and
   `DCR_IMMUTABLE_ID` plus the two role assignments to grant the app identity:
   *Monitoring Metrics Publisher* on the DCR and *Log Analytics Reader* on the
   workspace. Alternatively set `AUTO_PROVISION=true` to run the same idempotent
   step at startup.
3. Start the receiver: `venv/bin/python run.py` (or `uvicorn server:app --workers N`;
   any number of workers is safe because identity is bound in KQL, not in memory).
   Locally, authenticate with `az login`; in Azure, the managed identity is used.

`GET /api/v1/health/ready` reports whether Log Analytics is configured;
`GET /api/v1/diagnostics` shows queue depth, upload errors, dropped rows,
and how many identity values were rejected and why.

## VS Code Copilot Agents

In VS Code **User** settings (the extension defines these as application-scoped):

```json
{
  "github.copilot.chat.otel.enabled": true,
  "github.copilot.chat.otel.captureIdentity": true,
  "github.copilot.chat.otel.exporterType": "otlp-http",
  "github.copilot.chat.otel.otlpEndpoint": "http://localhost:4318",
  "github.copilot.chat.otel.captureContent": false
}
```

Reload the window after changing settings. See the
[official monitoring documentation](https://code.visualstudio.com/docs/agents/guides/monitoring-agents).
If `INGEST_TOKEN` is set on the receiver, configure the exporter to send
`Authorization: Bearer <token>` (for example via `OTEL_EXPORTER_OTLP_HEADERS`).

### Organization-wide identity (managed-settings.json)

```json
{
  "telemetry": {
    "enabled": true,
    "endpoint": "https://<your-receiver>.azurewebsites.net",
    "protocol": "http/protobuf",
    "capture": { "identity": true },
    "captureContent": false,
    "lockCaptureContent": true,
    "serviceName": "copilot"
  }
}
```

With identity capture on, Copilot Chat emits the signed-in GitHub login as
`user.name` on agent-invocation spans (including subagent and inline-chat spans),
and `process.user.name` / `host.name` as resource attributes. Do **not** add
`user.name` as a static value in `resourceAttributes`; it would label every user
with the same name. Identity capture applies to Local harness sessions only;
Agent Host telemetry does not carry it.

If identity capture is not allowed, an administrator can supply an explicit GitHub
login per client with `OTEL_RESOURCE_ATTRIBUTES=user.name=octocat`.

## How the username is determined

The username is the GitHub login from OTel data, and nothing else.

* **Attributes read:** `IDENTITY_ATTRIBUTES` (default `user.name`, `enduser.id`,
  `user.id`), first valid one wins, on the span and on its resource.
* **Never used:** `process.user.name`, `host.name`, e-mails, file paths or prompt
  text, and there is no alias/employee-ID mapping table. OS logins
  (`azharudeens`) and employee IDs (`2869784`) were the source of the old
  duplicate names, so they are not identities.
* **Validation:** a value must look like a GitHub login (1-39 letters, digits,
  `-`, or `_` for enterprise accounts; no dots, no `@`, not all digits, not a
  placeholder such as `unknown`). Anything else is not an identity and is counted
  in `/api/v1/diagnostics`.
* **No case duplicates:** logins are grouped by their lower-cased form and shown
  with the most recently seen spelling.
* **Order-independent binding:** the span that carries `user.name` is usually
  exported *after* the LLM calls it covers, often in another request. So calls and
  identity facts are stored separately and joined when queried. A call is owned by,
  in order: the span-level identity of its trace, of its session, then the
  resource-level identity of its trace, of its session. Within a level the
  earliest-seen login wins, so a trace never flips between users.
* **Unattributed usage:** calls with no identity anywhere are never shown as a
  user. Their totals are returned separately as `unattributed` in
  `/api/v1/usage` so nothing is silently lost.

## Agent names

The tracker prefers `copilot_chat.mode_name` on the nearest agent invocation, then
`gen_ai.agent.name` on the span or an ancestor, then `service.name`. Parent
`invoke_agent` token roll-ups are skipped to avoid double counting. Agent names
are resolved when the call is received (using a bounded cache of recent spans), so
a parent arriving in a later request does not rename calls already stored.

## Custom Python Agents

```python
from telemetry import AgentTelemetry

with AgentTelemetry(endpoint="http://localhost:4318/v1/traces") as telemetry:
    with telemetry.llm_call("Reviewer", "gpt-4o", username="octocat") as span:
        response = client.chat.completions.create(model="gpt-4o", messages=messages)
        span.set_attribute("gen_ai.response.model", response.model)
        span.set_attribute("gen_ai.usage.input_tokens", response.usage.prompt_tokens)
        span.set_attribute("gen_ai.usage.output_tokens", response.usage.completion_tokens)
```

`username` must be the person's GitHub login. Wrap every LLM request, including
subagent calls; for streaming, record the final usage before leaving the context.

## Reading the data

* `GET /api/v1/usage?days=90&events_limit=1000` — daily rows grouped by date,
  user, agent and model (`requests`, `input_tokens`, `output_tokens`,
  `total_tokens`, `cost`, latency fields, `first_seen`, `last_seen`), recent
  `events`, and `unattributed` totals. Supports `ETag` / `If-None-Match`.
* `GET /api/v1/events?limit=1000` — most recent calls (last 7 days).
* Daily grouping uses `DAILY_TZ` (UTC by default).
* Exact duplicates (exporter retries, multiple workers) are removed in KQL by `CallKey`.

You can also query the tables directly in Log Analytics, for example:

```kusto
CopilotIdentity_CL
| summarize Calls = dcount(TraceId) by UserKey
| order by Calls desc
```

Cost is a flat estimate of `PRICE_PER_MILLION` (default $0.99) USD per million
combined input and output tokens, applied at read time so changing it re-prices
history. It is not a provider invoice or premium-request charge.

Only `/v1/traces` is stored. `/v1/metrics` and `/v1/logs` are accepted and ignored.
Spans without nonzero token usage are not counted. Deleting one user's data is a
Log Analytics purge operation and is not exposed by this API.
