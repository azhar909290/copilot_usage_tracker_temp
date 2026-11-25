# Copilot Usage Tracker

OTLP/HTTP receiver that prices GenAI spans from VS Code / Copilot / custom agents, plus a Next.js dashboard.

## Layout

```text
run.py              Local entry point for the FastAPI receiver
requirements.txt    Python dependencies (kept at the root for Azure Oryx builds)
tracker/            Backend package (FastAPI app, span parser, store, pricing, teams, ...)
tests/              Python unit tests
scripts/            One-off utilities (seed data, cost report, send a sample trace)
data/               Local file-backed ledger (git-ignored)
docs/               Design docs, telemetry notes, architecture diagram, presentation
frontend/           Next.js dashboard (original variant)
lookandfeel/        Next.js dashboard (variant deployed to Azure Static Web Apps)
.github/            CI/CD workflows and Copilot skills
```

## Commands

Run these from the repository root:

```bash
venv/bin/python run.py                                   # API on 127.0.0.1:4318
venv/bin/python -m unittest discover -s tests -t .       # Python tests
venv/bin/python -m scripts.seed_telemetry --direct       # seed local data/
venv/bin/python scripts/report.py                        # daily cost report
venv/bin/python scripts/send_sample_trace.py             # POSTs a sample trace to the deployed endpoint
```

In production, Azure App Service starts the API with
`python -m uvicorn tracker.server:app --host 0.0.0.0 --port 8000`. This command is set in
[`.github/workflows/main_otel-data.yml`](.github/workflows/main_otel-data.yml).

See [docs/TELEMETRY.md](docs/TELEMETRY.md) and [docs/HLD-LLD.md](docs/HLD-LLD.md) for details.
