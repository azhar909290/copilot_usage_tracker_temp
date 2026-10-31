# AI Control Plane

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

- `GET /api/v1/usage` returns daily usage aggregates, currency, call events and
  `teams` (the organization name, its team names and each member's saved team).
- `GET /api/v1/agents` returns the AgentVerse DevJourney agent catalogue and refresh status.
- `GET /api/v1/health` returns receiver health.
- `GET /api/v1/github/metrics` returns GitHub organization and per-user usage
  reports without a dashboard login.

Open `http://127.0.0.1:4318/docs` for the interactive API reference. API calls include an `X-Request-ID` response header, also logged by the receiver.

## Landing page

`/` introduces the AI Control Plane: a three.js hero (three stacked control
planes for cost, tokens and calls, an AI core, and the catalogue's agents
orbiting it with data streaming in), live figures from the receiver for the last
30 days (active agents out of the catalogue, calls, teams and people, models),
the four lenses of the product and how telemetry flows into it. The scene follows
the pointer, pauses off screen, and falls back to a flat drawing without WebGL.

## Dashboard

The dashboard lives at `/dashboard`; `/dashboard?view=users` (or `agents`,
`models`, `activity`) opens a view directly. The overview answers "where is the team's Copilot usage going, and what does it cost?" for the selected range (7, 30 or 90 days):

- **Title row**: the organization (`tth-cto-innovation`), the scope (all teams, one team or one user), the range, a freshness stamp, and the strongest finding in one sentence (for example, which model drove most of the estimated cost).
- **KPI cards**: active agents (catalogue agents with calls, out of the catalogue total, plus any active agents outside it), calls (with people and live users), tokens (in/out), models used, and median/p95 latency, each with a drawn-in daily sparkline in its own hue. Calls and Tokens double as the metric switch for the two charts below. The headline sentence above the filters is the strongest usage finding, not a cost one.
- **Daily rhythm**: a three.js ridgeline, with one line per receiver day and the newest day (bright ink) in front. Ridges shade by depth from a back hue to the selected metric's hue. Each line is the smoothed density of the selected metric by UTC time of day (18-minute Gaussian kernel), so the area under a line equals that day's total. Hovering reads the exact 30-minute bin under the pointer; clicking opens that day in Activity. Browsers without WebGL get a flat SVG version of the same data.
- **Per-day bars**: the same metric per day on a labelled scale, linked to the ridge (hovering either highlights the same day in both). Bars grow in with a stagger in the metric's gradient and today's bar glows; arrow keys and Enter work when the chart has focus.
- **Findings carousel**: plain-language facts computed from the filtered data (biggest cost driver, unpriced calls, peak half-hour, busiest agent, heaviest user, busiest day, slowest model, input/output ratio), each with an action that applies a filter or opens a view. Slide width and travel are computed in CSS viewport units; it autoplays every 7 seconds, pauses on hover, keyboard focus or the Pause button, supports drag/swipe and arrow keys, and never autoplays under reduced motion.
- **Models and Agents** share lists (top five, row fill as the bar) and **Recent calls**.

The Organization, Catalog, Models and Activity views share the date, team, user, agent, model and text filters. Selecting a team scopes every view to that team's members; on Organization it focuses the team instead, so the whole hierarchy stays visible. The dashboard also supports auto-refresh and CSV export; usage and activity exports include each person's team.

### Organization

The Organization view shows `tth-cto-innovation` as one organization with five
teams: Data, AI, Cognitive core, Rapid labs and Innovation.

- **Constellation**: a three.js scene with the organization at the core, one
  planet per team on a shared orbit (sized by the team's token share) and one
  badge per member circling their team: their initial ringed in the team colour,
  sized by the member's tokens and dimmed when idle in the range. Drag to orbit; select a team (in the scene, the team
  list, a card or the donut) to fly the camera to it and focus the whole page.
  Hovering the core, a team or a member shows its calls, tokens and cost. The
  scene pauses when off screen; browsers without WebGL get a flat orbit diagram.
- **Team cards**: tokens, share of the organization, a contribution bar per
  member, calls, cost, active members and a daily sparkline.
- **Team pulse**: daily calls stacked by team; hover a band to isolate it.
- **Token share donut** and a **leaderboard** of the members with the most tokens.
- **Members table**: every member with their team, live badge and usage.

Team memberships come from the receiver (`DATA_DIR/team_assignments.json`). They
are saved demo assignments, not HR records: new users are assigned to the
smallest team at random and keep that team afterwards. Usage from people
without a membership (for example `unknown`) appears as Unassigned. Set
`TEAM_ORGANIZATION` on the receiver to change the organization name.

### Catalog

The Catalog view lists the AgentVerse DevJourney agents grouped into families,
each with its own two-to-three hue signature: Development journey (A-DEV),
Assurance & testing (A-ASR), Modernisation (B-MOD), Data & analytics (D-DATA),
standalone agents, and telemetry-only agents seen in usage but not in the
catalogue. Family cards filter the grid; tiles show calls, tokens, cost and a
usage meter, and open a detail panel with the description, arguments,
definition link, daily calls and the people who use the agent.

### Models and Activity

Models shows the token mix as an animated donut, average tokens per call and a
sortable table. Activity shows a weekday × hour heat field in local time (hot
hours shift from aurora to ember), the busiest agents, a **signal network** and
the recorded calls. The signal network is a four-layer graph of the top teams,
people, agents and models: link width follows call counts, signals travel each
link at a pace set by its traffic, and hovering or focusing a node traces its
path through every layer.

Press <kbd>⌘K</kbd> / <kbd>Ctrl K</kbd> for the command menu (views, agents, users, models and actions with fuzzy search), or <kbd>/</kbd> to focus the filter search.

On first load, a full-screen loader assembles three control planes (cost, tokens, calls) with a neural mesh lighting up on the top one, reveals the name, and reports the real loading stage (interface, receiver, ledger, composing) with a percentage meter, then lifts away as soon as the data is on screen. It is part of the static HTML and CSS-animated, so it paints and moves before JavaScript runs.

The overview's live strip lists users whose most recent recorded model call
started within the last 5 minutes, and the Users table highlights them with a
Live badge. This is based on exported call start times, so it reflects recent
Copilot model calls rather than an open VS Code window, and it depends on the
client exporting promptly. `unknown` is excluded, and the view is not affected
by the dashboard filters. Live status is recalculated every 15 seconds; new calls
appear after the next data refresh.

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

## Design and UI stack

The visual system, "Aurora Observatory", was set with the
[Impeccable](https://github.com/pbakaus/impeccable) colour and type guidance and
[Emil Kowalski's](https://github.com/emilkowalski/skills) motion principles:

- **Palette**: a deep ink ground with a triad that keeps one meaning everywhere:
  aurora teal for calls, iris violet for tokens and ember coral for cost. Teams
  take the triad plus rose, sun and lime; catalogue families pair two or three
  of these hues. Light mode remaps the same roles. All tokens live at the top of
  `src/app/globals.css`.
- **Type**: Bricolage Grotesque for display headings and figures, Instrument
  Sans for interface text with tabular numerals, and JetBrains Mono only for
  agent identifiers and file paths.
- **Motion**: strong ease-out curves for arrivals, short staggered entrances as
  sections scroll into view, drawn-in sparklines and arcs, growing bars, springs
  for selection, and press feedback on controls.

| Library | Used for |
| --- | --- |
| `next/font` | Self-hosted Bricolage Grotesque, Instrument Sans and JetBrains Mono |
| `three` + `@react-three/fiber` | The landing hero, the Daily rhythm ridgeline and the Organization constellation (loaded on demand) |
| `motion` | Entrances, drawn charts, the catalogue grid, the detail panel and view changes |
| `cmdk` | The ⌘K command menu |
| `@number-flow/react` | KPI figures that roll to new values on refresh |

The interface respects `prefers-reduced-motion`: travel, loops, orbits and the
loader animation stop, while fades and colour changes that carry meaning remain.
The rail folds into a bottom bar below 720px.

If `npm run dev` shows outdated styles after pulling changes, stop the dev server, delete `.next/dev` and start it again.

## GitHub Metrics

Open **GitHub metrics** in the navigation rail or visit `/github-metrics`. This separate
page reads GitHub's REST reports, not the OTLP ledger. It includes:

- Latest 28-day organization totals and daily prompt/generation trends.
- GitHub aliases and stable user IDs, per-user activity, AI credits when
  reported, and feature-use flags.
- Model and feature activity, including generation/acceptance counts and lines
  added/deleted.
- Model-usage ring chart with a selectable activity metric and a legend showing
  values and percentages of the filtered model total. Segments use one ink in
  stepped tones (in the same order as the legend) rather than a colour per model.
  Zero values remain in the legend without a segment; an all-zero selection shows an explicit message.
  Chart metric
  and sort field/direction are independent; search and sorting apply to the
  segments, legend, table, and CSV consistently. All matching models are included,
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
