"""KQL for the dashboard. Every interpolated value is an int or a validated timezone."""
from .schema import CALLS_TABLE, IDENTITY_TABLE

# Identity is resolved here, at read time, so arrival order of spans never matters.
# Precedence: span-level identity on the trace, then on the session (2), then
# resource-level identity on the trace, then on the session (1). Within a level the
# earliest-seen login wins, so one trace/session can never flip between users.
_RESOLVE = f"""
let Ident = {IDENTITY_TABLE}
  | where TimeGenerated >= ago({{ident_days}}d)
  | extend Score = Tier * 100000.0 - (EventTime - datetime(2020-01-01)) / 1d;
let ByTrace = Ident | where TraceId != ''
  | summarize arg_max(Score, UserKey, Tier) by TraceId
  | project TraceId, TKey = UserKey, TTier = Tier;
let BySession = Ident | where SessionId != ''
  | summarize arg_max(Score, UserKey, Tier) by SessionId
  | project SessionId, SKey = UserKey, STier = Tier;
let Names = Ident | summarize arg_max(EventTime, UserLogin) by UserKey
  | project UserKey, Login = UserLogin;
let Calls = {CALLS_TABLE}
  | where TimeGenerated >= ago({{days}}d)
  | summarize arg_min(TimeGenerated, *) by CallKey
  {{pre_join}}
  | join hint.strategy=shuffle kind=leftouter ByTrace on TraceId
  | join hint.strategy=shuffle kind=leftouter BySession on SessionId
  | extend UserKey = case(
      TTier == 2, TKey,
      STier == 2, SKey,
      isnotempty(TKey), TKey,
      isnotempty(SKey), SKey,
      '')
  | join kind=leftouter Names on UserKey
  | extend Login = coalesce(Login, '');
"""


def _prefix(days: int, pre_join: str = "") -> str:
    # Identity facts can arrive after the calls they describe, and sessions outlive days.
    return _RESOLVE.format(days=days, ident_days=days + 7, pre_join=pre_join)


def _local_day(tz: str) -> str:
    if tz == "UTC":
        return "format_datetime(EventTime, 'yyyy-MM-dd')"
    return f"format_datetime(datetime_utc_to_local(EventTime, '{tz}'), 'yyyy-MM-dd')"


def daily_usage(days: int, tz: str) -> str:
    return _prefix(days) + f"""
Calls
| where EventTime >= startofday(now()) - {days}d
| summarize
    requests = count(),
    input_tokens = sum(InputTokens),
    output_tokens = sum(OutputTokens),
    latency_ms_total = sumif(LatencyMs, isnotnull(LatencyMs)),
    latency_requests = countif(isnotnull(LatencyMs)),
    first_seen = min(EventTime),
    last_seen = max(EventTime),
    user = take_any(Login)
  by date = {_local_day(tz)}, UserKey, agent = Agent, model = Model
| project date, user, agent, model, requests, input_tokens, output_tokens,
          latency_ms_total, latency_requests, first_seen, last_seen
| order by date asc, user asc, agent asc, model asc
"""


def recent_events(days: int, limit: int, tz: str) -> str:
    newest = f"| top {int(limit)} by EventTime desc"
    return _prefix(days, pre_join=newest) + f"""
Calls
| project key = CallKey, timestamp = EventTime, date = {_local_day(tz)},
          user = Login, agent = Agent, model = Model,
          input_tokens = InputTokens, output_tokens = OutputTokens,
          latency_ms = LatencyMs
| order by timestamp desc
"""
