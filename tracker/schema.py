"""Log Analytics custom tables and the Data Collection Rule streams that feed them.

Two tables:
  CopilotLlmCalls_CL  one row per LLM call (tokens, model, agent, latency). No user.
  CopilotIdentity_CL  one row per observed identity fact (who owns a trace/session).

Usernames are bound to calls at query time, not ingest time, because the span that
carries ``user.name`` (the agent invocation) usually arrives after its child LLM calls.
TimeGenerated is the ingestion time (set by the DCR transform) because Azure Monitor
overwrites TimeGenerated values older than 48 hours; the span's own time is EventTime.
"""
from dataclasses import dataclass

CALLS_TABLE = "CopilotLlmCalls_CL"
IDENTITY_TABLE = "CopilotIdentity_CL"
CALLS_STREAM = f"Custom-{CALLS_TABLE}"
IDENTITY_STREAM = f"Custom-{IDENTITY_TABLE}"
DCR_NAME = "copilot-usage-dcr"


@dataclass(frozen=True)
class Table:
    name: str
    stream: str
    columns: tuple[tuple[str, str], ...]  # (name, Log Analytics type)

    @property
    def input_columns(self) -> list[dict]:
        """Columns the client sends (TimeGenerated is added by the transform)."""
        return [{"name": n, "type": t} for n, t in self.columns if n != "TimeGenerated"]

    @property
    def table_columns(self) -> list[dict]:
        return [{"name": n, "type": t} for n, t in self.columns]


CALLS = Table(
    CALLS_TABLE,
    CALLS_STREAM,
    (
        ("TimeGenerated", "datetime"),
        ("EventTime", "datetime"),
        ("CallKey", "string"),
        ("TraceId", "string"),
        ("SpanId", "string"),
        ("SessionId", "string"),
        ("Agent", "string"),
        ("Model", "string"),
        ("RequestModel", "string"),
        ("ResponseModel", "string"),
        ("Operation", "string"),
        ("Service", "string"),
        ("InputTokens", "long"),
        ("OutputTokens", "long"),
        ("LatencyMs", "real"),
    ),
)

IDENTITY = Table(
    IDENTITY_TABLE,
    IDENTITY_STREAM,
    (
        ("TimeGenerated", "datetime"),
        ("EventTime", "datetime"),
        ("TraceId", "string"),
        ("SessionId", "string"),
        ("UserLogin", "string"),
        ("UserKey", "string"),
        ("Tier", "int"),
        ("Source", "string"),
    ),
)

TABLES = (CALLS, IDENTITY)

# Identity tiers: a span describes the request, a resource describes the sending process.
TIER_SPAN = 2
TIER_RESOURCE = 1
