# Copilot Usage Tracker: HLD and LLD

## 1. Purpose and scope

This document describes the current implementation of the Copilot Usage Tracker: how OpenTelemetry data reaches the Python API, how it is stored and served, and how the dashboard retrieves and displays it.

This is an **as-built** description. It does not assume that Azure storage mounts, database services, or access controls exist unless they are configured outside this repository.

## 2. High-Level Design (HLD)

### 2.1 System context

```text
VS Code Copilot / custom-agent telemetry
                 |
                 | OTLP/HTTP: JSON or protobuf
                 v
       Azure App Service: Python API
       - receives and parses spans
       - normalizes and aggregates usage
       - stores event ledger and CSV projections
                 |
                 | GET /api/v1/usage
                 | GET /api/v1/agents
                 v
       Azure Static Web App: Next.js dashboard
       - fetches API data in the browser
       - filters, groups, and renders dashboard views
```

The Python API is deployed to the Azure Web App named `otel-data` by the backend workflow (`.github/workflows/main_otel-data.yml`). The frontend workflow builds and deploys the static dashboard and sets `NEXT_PUBLIC_USAGE_API_URL` to the API's Azure URL (`.github/workflows/azure-static-web-apps-polite-cliff-03667eb10.yml`).

### 2.2 Main data flow

1. A telemetry client exports trace batches to `POST /v1/traces`.
2. The API accepts OTLP JSON or protobuf (and decompresses gzip request bodies), then parses spans into usage events.
3. The store deduplicates events in-process, appends new events to its JSONL ledger, updates in-memory aggregates, and regenerates CSV files.
4. The dashboard fetches usage data and agent catalogue data from the API.
5. The frontend stores the responses in page state and applies its filters and grouping calculations to render the views.

### 2.3 Storage and operational boundary

Usage data is file-backed in the Python service. `DATA_DIR` controls the directory and defaults to `data/`. The store uses:

| File | Purpose |
|---|---|
| `events.jsonl` | Event ledger; source used to rebuild in-memory state |
| `daily_usage.csv` | Daily usage grouped by user, agent, and model |
| `daily_totals.csv` | Daily totals across users, agents, and models |
| `marketplace_cache.json` | Cached agent catalogue |

The application code does **not** write usage events to Azure Blob Storage or a database. The actual persistence and sharing characteristics therefore depend on the App Service filesystem configuration and instance topology, which are not specified in this repository. Confirm that configuration before relying on data surviving restarts or being consistent across multiple instances.

Azure Monitor/Application Insights is optionally configured for service telemetry using `APPLICATIONINSIGHTS_CONNECTION_STRING`; it is separate from the usage event store.

## 3. Low-Level Design (LLD)

### 3.1 Components

#### FastAPI service — `tracker/server.py`

- Creates the usage store using `DATA_DIR` (default `data`).
- Receives trace exports at `POST /v1/traces`.
- Exposes usage, activity, agent-catalogue, GitHub metrics, health, and user-deletion endpoints.
- Logs HTTP request metadata and can send application telemetry to Azure Monitor.

#### Span parser — `tracker/parser.py`

- Reads token usage, model, timestamps, user, and agent attributes from spans.
- Skips spans without input or output token usage and configured operations to skip.
- Resolves identity and agent information from span/resource attributes and related context.
- Produces an event with a trace/span key, timestamp, user, agent, model, token counts, latency, cost, and priced status.

#### Usage store — `tracker/store.py`

- Replays `events.jsonl` during startup to reconstruct its in-memory state.
- Deduplicates using each event's key.
- Aggregates rows by `(date, user, agent, model)`.
- Calculates daily request/token/cost totals and average latency.
- Rewrites CSV projections through temporary files and file replacement.
- Supports deleting a user's events by rewriting the ledger and replaying it.

Dates in usage rows are derived in the configured `DAILY_TZ` time zone (default `Asia/Kolkata`).

#### Dashboard — `frontend/src/app/dashboard/page.tsx`

- Resolves its API base from `NEXT_PUBLIC_USAGE_API_URL`; the local default is `http://127.0.0.1:4318`.
- Fetches `/api/v1/usage` and `/api/v1/agents` in parallel with browser caching disabled.
- Checks response status, parses JSON, then populates usage rows, events, team data, currency, and catalogue state.
- Uses frontend utilities in `frontend/src/lib/usage.ts` for filtering and aggregation before rendering.

#### Agent catalogue — `tracker/marketplace.py`

- Loads catalogue data from its configured source.
- Keeps a memory cache and persists a JSON cache at `DATA_DIR/marketplace_cache.json`.
- Returns freshness and error information along with the catalogue, and can serve cached data when refresh fails.

### 3.2 API design

#### Ingestion: `POST /v1/traces`

**Input:** OTLP trace batch in JSON or protobuf format. Gzip-encoded request bodies are decompressed.

**Processing:** Decode request, parse spans, add unique usage events to the store.

**Response:** Empty OTLP success response (`{}` for JSON or an empty protobuf response).

#### Dashboard usage: `GET /api/v1/usage`

Example response shape:

```json
{
  "currency": "USD",
  "rows": [],
  "events": [],
  "teams": {}
}
```

- `rows`: daily aggregates grouped by date, user, agent, and model.
- `events`: event-level usage data.
- `teams`: team names and user assignments.
- `currency`: currency label used by the API.

The endpoint constructs this response from the in-process usage store.

#### Agent catalogue: `GET /api/v1/agents`

Returns the agent catalogue and metadata, including source, load time, stale status, and any refresh error.

#### Other endpoints

| Endpoint | Purpose |
|---|---|
| `GET /api/v1/activity` | Returns activity events; defaults to a limit of 10,000 |
| `GET /api/v1/events` | Alias for the event feed |
| `DELETE /api/v1/usage/users/{username}` | Deletes a user's events; requires a configured bearer token |
| `GET /api/v1/github/metrics` | Retrieves GitHub organization metrics through a separate integration |
| `GET /api/v1/health` | Returns the service health status |

### 3.3 Dashboard request sequence

```text
Browser loads dashboard
    |
    +-- GET {API_BASE}/api/v1/usage
    |
    +-- GET {API_BASE}/api/v1/agents
             |
             v
     Check HTTP responses and parse JSON
             |
             v
     Set page state: rows, events, teams, currency, catalogue
             |
             v
     Apply client-side filters/grouping and render
```

### 3.4 Event and aggregate shapes

An event records one usage-bearing span. Its fields include:

```text
key, timestamp, date, user, agent,
request_model, response_model, model,
input_tokens, output_tokens, total_tokens,
latency_ms, cost, priced
```

The aggregate key is `(date, user, agent, model)`. Aggregate values include request count, input/output/total tokens, cost, unpriced request count, first/last seen times, and average latency.

## 4. Current constraints and considerations

- **Durability:** The repository shows local file writes, not a cloud database or blob integration. App Service persistence must be verified separately.
- **Scale-out consistency:** Store state and deduplication are process-local. Multiple instances with separate files will not automatically share records or deduplication state.
- **Response size:** `GET /api/v1/usage` returns all in-memory events as well as aggregate rows, so payload size can grow with event volume.
- **API access:** The usage GET endpoint has no application-level authentication in this code. CORS is not an authentication mechanism; access should be controlled by an authenticated proxy or equivalent Azure controls if the data is private.
- **Privacy:** User identity is included in events and dashboard responses. Telemetry capture settings and retention/access controls should be reviewed for the deployment.

## 5. Source files

- Backend API and routes: [`tracker/server.py`](../tracker/server.py)
- Span parsing: [`tracker/parser.py`](../tracker/parser.py)
- File-backed store: [`tracker/store.py`](../tracker/store.py)
- Dashboard data fetching: [`frontend/src/app/dashboard/page.tsx`](../frontend/src/app/dashboard/page.tsx)
- Dashboard data utilities: [`frontend/src/lib/usage.ts`](../frontend/src/lib/usage.ts)
- Agent catalogue cache: [`tracker/marketplace.py`](../tracker/marketplace.py)
- Backend deployment workflow: [`.github/workflows/main_otel-data.yml`](../.github/workflows/main_otel-data.yml)
- Frontend deployment workflow: [`.github/workflows/azure-static-web-apps-polite-cliff-03667eb10.yml`](../.github/workflows/azure-static-web-apps-polite-cliff-03667eb10.yml)
