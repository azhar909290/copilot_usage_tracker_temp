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

Open `http://127.0.0.1:4318/docs` for the interactive API reference. API calls include an `X-Request-ID` response header, also logged by the receiver.

## Dashboard

The overview includes call, token, estimated-cost, and unpriced-call totals; token trends; model mix; and agent activity. The Agents, Models, and Activity views share date, agent, model, and text filters. The dashboard also supports auto-refresh and CSV export. Agents without an exact marketplace match are shown separately as telemetry-only agents.

For an optimized build, run from `frontend/`:

```bash
npm run lint
npm run build
npm start
```
