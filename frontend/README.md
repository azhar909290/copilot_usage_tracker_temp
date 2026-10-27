# Signal Usage Dashboard

Next.js dashboard for the Copilot usage tracker. It reads the FastAPI service from the browser, so API calls are visible in DevTools Network.

Start the API from the repository root with `.venv/bin/python run.py`, then start this UI from `frontend/` with `npm run dev`. Set `NEXT_PUBLIC_USAGE_API_URL` in `.env.local` if the API is not at `http://127.0.0.1:4318`.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

## Requirements

- Node.js 20.9 or newer
- The Python environment and dependencies for the API in the repository root

## Run Locally

Start the FastAPI receiver from the repository root:

```bash
.venv/bin/python run.py
```

The receiver listens on port `4318` by default. To use another port, set `PORT` when starting it, for example `PORT=4321 .venv/bin/python run.py`.

In a second terminal, start the dashboard:

```bash
cd frontend
cp .env.local.example .env.local
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Set `NEXT_PUBLIC_USAGE_API_URL` in `.env.local` to the receiver's origin if it is not `http://127.0.0.1:4318`. The API allows `localhost:3000` and `127.0.0.1:3000` by default. Set `FRONTEND_ORIGINS` on the API to allow other browser origins.

## API

The dashboard requests these endpoints directly from the browser:

- `GET /api/v1/usage` returns daily usage aggregates and currency.
- `GET /api/v1/agents` returns marketplace agents and refresh status.
- `GET /api/v1/health` returns receiver health.
- `GET /api/v1/github/metrics` returns GitHub organization and per-user usage
  reports without a dashboard login.

Open `http://127.0.0.1:4318/docs` for the interactive API reference. API calls include an `X-Request-ID` response header, also logged by the receiver.

## Dashboard

The overview includes call, token, estimated-cost, and unpriced-call totals; token trends; model mix; and agent activity. The Agents, Models, and Activity views share date, agent, model, and text filters. The dashboard also supports auto-refresh and CSV export. Agents without an exact marketplace match are shown separately as telemetry-only agents.

Activity rows remain daily aggregates, with first and last call timestamps shown
in the browser's local timezone. Click an Activity table heading to sort by that
column; click it again to reverse the sort. Recent activity shows and sorts by
the last call time. CSV exports include UTC `first_seen` and `last_seen` timestamps. The daily
grouping date still uses the receiver's `DAILY_TZ` (UTC by default). Older events
without timestamps display "Time unavailable". User labels come from client
telemetry, not a dashboard login; GitHub aliases, OS-style labels, and `unknown`
are not automatically merged. See [identity attribution](../TELEMETRY.md#why-several-user-names-can-appear).

For an optimized build, run from `frontend/`:

```bash
npm run lint
npm run build
npm start
```

## GitHub Metrics

Open **GitHub Metrics** in the sidebar or visit `/github-metrics`. This separate
page reads GitHub's REST reports, not the OTLP ledger. It includes:

- Latest 28-day organization totals and daily prompt/generation trends.
- GitHub aliases and stable user IDs, per-user activity, AI credits when
  reported, and feature-use flags.
- Model and feature activity, including generation/acceptance counts and lines
  added/deleted.
- Model-usage pie chart with a selectable activity metric and a legend showing
  values and percentages of the filtered model total. Zero values remain in
  the legend without a slice; an all-zero selection shows an explicit message.
  Chart metric
  and sort field/direction are independent; search and sorting apply to the
  slices, legend, table, and CSV consistently. All matching models are included,
  with a scrollable legend and a stacked layout on smaller screens.
- Per-user reported credits with expandable daily values and prompts.
- User/model search; ascending/descending sorting for users, models, and
  features by name, prompts, generations, acceptances, lines added/deleted,
  plus reported credits for users; CSV export, refresh, and
  shared light/dark mode.

Seat assignments are not fetched or displayed.

### Server configuration

Add these values to the repository root `.env` (or deployment environment).
Use `.env.example` as a reference; do not replace your existing configuration:

```dotenv
GITHUB_METRICS_ORG=your-organization
GITHUB_METRICS_TOKEN=your-server-side-github-token
```

Restart the Python API. The page loads metrics automatically without a login.
The browser never receives the GitHub API token or signed report download links.
Do not place the PAT in a `NEXT_PUBLIC_*` variable or commit real credentials.
Anyone who can reach the metrics API can read the organization's metrics.
Keep the API bound to localhost or behind an authenticated proxy/network access
controls; CORS is not authentication. Use HTTPS for remote access.

The server uses GitHub API version `2026-03-10` and these endpoints:

```text
GET /orgs/{org}/copilot/metrics/reports/organization-28-day/latest
GET /orgs/{org}/copilot/metrics/reports/users-28-day/latest
```

It downloads all report parts, supports JSON/NDJSON and gzip,
and aggregates daily per-user rows by stable GitHub ID over the report window.
Repeated user/day rows and mixed daily/aggregate totals are rejected rather
than double-counted. Feature flags are combined across the window; missing
daily AI-credit values keep the user credit total unavailable.
The server caches complete successful snapshots in memory for five minutes. Refresh
within that interval returns the cached snapshot. Partial failures are shown
per section and are not cached; if everything fails, the API returns HTTP 503.
Reports larger than 32 MiB per part are rejected explicitly. Signed downloads
are restricted to HTTPS `copilot-reports.github.com`, Azure Blob Storage, and
GitHub content hosts, without
forwarding the API token or following redirects.

The organization needs a qualifying Copilot subscription. GitHub's **Copilot
usage metrics** policy must be **Enabled everywhere** for the enterprise.
Organization report access requires an organization owner or an authorized
user with **View Organization Copilot Metrics** permission. Classic PATs use
`read:org`.
Authorize the token for organization SSO when required. Consult GitHub's
[usage metrics API reference](https://docs.github.com/en/rest/copilot/copilot-usage-metrics)
for fine-grained token permissions and eligibility.

Reports are daily snapshots and can lag behind current activity. The page
shows the actual reporting windows, including a warning if the user and
organization windows differ. Prompts, code generations, and acceptance actions
are different measures, not token counts or billing totals. Model shares use
only the model/feature breakdown, not language/model breakdowns as well, to
avoid double counting. Acceptance rate is displayed only for code completions.
Daily active-user counts must not be summed into a unique-user total.

### Reported credits versus VS Code usage

The credits column is the sum of GitHub's `ai_credits_used` values for the
organization's returned per-user daily records, not the VS Code billing-cycle
balance. The report's actual rolling 28-day window is displayed explicitly.
Usage after the report end date is not included. GitHub documents that recent
telemetry typically finalizes within three full UTC days.

`0 reported` means the source supplied a real zero; it does not imply no
activity or no billed usage. Missing values stay `Unavailable`, and a missing
daily credit value prevents displaying a misleading partial user total.
Expand daily report details to inspect the source dates, credits, and prompts.
Absent days are not converted into zero rows. Sorting keeps unavailable
credits last in both directions. CSV uses `reported_ai_credits` and includes
the user report start/end dates.

For discrepancies, compare the same account, scope, dates, and measurement.
Do not infer credits from prompts, code generation, or tokens, or replace
reported values with estimates. See GitHub's
[reconciliation guidance](https://docs.github.com/en/copilot/reference/copilot-usage-metrics/reconciling-usage-metrics).

Per-user GitHub reports do not depend on the local OTel `captureIdentity`
setting. GitHub identities and usage are returned under the organization's
report-access permissions.
