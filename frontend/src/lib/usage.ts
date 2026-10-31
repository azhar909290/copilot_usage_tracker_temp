import { displayDate, formatClock, formatCompact, formatCount } from "./format";

export type UsageRow = {
  date: string;
  first_seen?: string | null;
  last_seen?: string | null;
  user: string;
  agent: string;
  model: string;
  requests: number;
  input_tokens: number;
  output_tokens: number;
  cost: number;
  unpriced_requests: number;
  latency_ms_avg?: number | null;
};

export type CallEvent = {
  key: string;
  timestamp: string;
  date: string;
  user: string;
  agent: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens?: number;
  latency_ms?: number | null;
  cost: number;
};

export type CatalogAgent = {
  id: string;
  name: string;
  display_name?: string;
  description: string;
  argument_hint?: string;
  plugin_id: string;
  plugin_name: string;
  version: string;
  status?: string;
  path: string;
  url?: string;
  kind?: "agent" | "skill_package";
  skills?: string[];
  has_definition?: boolean;
  catalogue?: string | null;
};

export type CatalogResponse = {
  loaded_at: string | null;
  stale: boolean;
  error: string | null;
  agents: CatalogAgent[];
};

export type Period = 7 | 30 | 90;
export type Metric = "calls" | "tokens" | "cost";
export type Totals = { requests: number; input: number; output: number; cost: number; unpriced: number };
export type Share = { name: string; calls: number; tokens: number; cost: number };
export type Filters = {
  cutoff: string | null;
  user: string;
  agent: string;
  model: string;
  search: string;
};

export const DAY_MS = 86_400_000;
export const LIVE_WINDOW_MS = 5 * 60_000;

export function isUnknownUser(name: string) {
  return name.trim().toLowerCase() === "unknown";
}

export function cutoffDate(updatedAt: Date | null, period: Period) {
  if (!updatedAt) return null;
  const today = Date.parse(`${updatedAt.toISOString().slice(0, 10)}T00:00:00Z`);
  return new Date(today - (period - 1) * DAY_MS).toISOString().slice(0, 10);
}

function matches(
  values: { date: string; user: string; agent: string; model: string },
  haystack: (string | null | undefined)[],
  filters: Filters,
) {
  if (filters.cutoff && values.date < filters.cutoff) return false;
  if (filters.user !== "all" && values.user !== filters.user) return false;
  if (filters.agent !== "all" && values.agent !== filters.agent) return false;
  if (filters.model !== "all" && values.model !== filters.model) return false;
  const query = filters.search.trim().toLowerCase();
  return !query || haystack.some((value) => (value ?? "").toLowerCase().includes(query));
}

export function filterRows(rows: UsageRow[], filters: Filters) {
  return rows.filter((row) => matches(row, [row.date, row.user, row.agent, row.model], filters));
}

export function filterEvents(events: CallEvent[], filters: Filters) {
  return events.filter((event) =>
    matches(event, [event.date, event.user, event.agent, event.model, event.timestamp], filters),
  );
}

export function sumTotals(rows: UsageRow[]): Totals {
  return rows.reduce(
    (summary, row) => ({
      requests: summary.requests + row.requests,
      input: summary.input + row.input_tokens,
      output: summary.output + row.output_tokens,
      cost: summary.cost + row.cost,
      unpriced: summary.unpriced + row.unpriced_requests,
    }),
    { requests: 0, input: 0, output: 0, cost: 0, unpriced: 0 },
  );
}

export function groupShares(rows: UsageRow[], key: "model" | "agent" | "user"): Share[] {
  const groups = new Map<string, Share>();
  for (const row of rows) {
    const name = row[key];
    const share = groups.get(name) || { name, calls: 0, tokens: 0, cost: 0 };
    share.calls += row.requests;
    share.tokens += row.input_tokens + row.output_tokens;
    share.cost += row.cost;
    groups.set(name, share);
  }
  return [...groups.values()];
}

/** Every date from `start` to `end` inclusive (ISO yyyy-mm-dd, UTC calendar). */
export function dayRange(start: string, end: string) {
  const days: string[] = [];
  const last = Date.parse(`${end}T00:00:00Z`);
  for (let time = Date.parse(`${start}T00:00:00Z`); time <= last; time += DAY_MS) {
    days.push(new Date(time).toISOString().slice(0, 10));
  }
  return days;
}

export function metricOfRow(row: UsageRow, metric: Metric) {
  if (metric === "calls") return row.requests;
  if (metric === "tokens") return row.input_tokens + row.output_tokens;
  return row.cost;
}

export function metricOfEvent(event: CallEvent, metric: Metric) {
  if (metric === "calls") return 1;
  if (metric === "tokens") return (event.input_tokens || 0) + (event.output_tokens || 0);
  return event.cost || 0;
}

export function dailyTotals(rows: UsageRow[], days: string[], metric: Metric) {
  const index = new Map(days.map((day, position) => [day, position]));
  const values = days.map(() => 0);
  for (const row of rows) {
    const position = index.get(row.date);
    if (position !== undefined) values[position] += metricOfRow(row, metric);
  }
  return values;
}

export const RIDGE_SAMPLE_MINUTES = 5;
export const RIDGE_BIN_MINUTES = 30;
const RIDGE_SAMPLES = 1440 / RIDGE_SAMPLE_MINUTES + 1;
const RIDGE_SIGMA_MINUTES = 18;

export type RidgeData = {
  days: string[];
  /** Smoothed density per row, in metric units per hour, sampled every 5 minutes (UTC). */
  rows: number[][];
  /** Exact totals per 30-minute UTC bin, per row. */
  bins: number[][];
  max: number;
};

/**
 * One ridge per receiver day. Each call adds a Gaussian kernel at its UTC time of day,
 * weighted by the metric, so the area under a ridge equals that day's total.
 */
export function ridgeData(events: CallEvent[], days: string[], metric: Metric): RidgeData {
  const index = new Map(days.map((day, position) => [day, position]));
  const rows = days.map(() => new Array<number>(RIDGE_SAMPLES).fill(0));
  const bins = days.map(() => new Array<number>(1440 / RIDGE_BIN_MINUTES).fill(0));
  const norm = 60 / (RIDGE_SIGMA_MINUTES * Math.sqrt(2 * Math.PI));
  const reach = Math.ceil((RIDGE_SIGMA_MINUTES * 4) / RIDGE_SAMPLE_MINUTES);
  for (const event of events) {
    const row = index.get(event.date);
    if (row === undefined) continue;
    const time = Date.parse(event.timestamp);
    if (Number.isNaN(time)) continue;
    const weight = metricOfEvent(event, metric);
    if (!weight) continue;
    const minute = (((time % DAY_MS) + DAY_MS) % DAY_MS) / 60_000;
    bins[row][Math.min(bins[row].length - 1, Math.floor(minute / RIDGE_BIN_MINUTES))] += weight;
    const center = Math.round(minute / RIDGE_SAMPLE_MINUTES);
    const first = Math.max(0, center - reach);
    const last = Math.min(RIDGE_SAMPLES - 1, center + reach);
    for (let sample = first; sample <= last; sample += 1) {
      const delta = (sample * RIDGE_SAMPLE_MINUTES - minute) / RIDGE_SIGMA_MINUTES;
      rows[row][sample] += weight * norm * Math.exp(-0.5 * delta * delta);
    }
  }
  let max = 0;
  for (const row of rows) for (const value of row) if (value > max) max = value;
  return { days, rows, bins, max };
}

export type LiveUser = { user: string; lastSeen: number };

export function getLiveUsers(events: CallEvent[], now: number): LiveUser[] {
  const latest = new Map<string, number>();
  for (const event of events) {
    if (isUnknownUser(event.user)) continue;
    const seen = Date.parse(event.timestamp);
    if (Number.isNaN(seen) || now - seen > LIVE_WINDOW_MS) continue;
    latest.set(event.user, Math.max(latest.get(event.user) ?? 0, seen));
  }
  return [...latest.entries()]
    .map(([user, lastSeen]) => ({ user, lastSeen }))
    .sort((a, b) => b.lastSeen - a.lastSeen);
}

export function latencyStats(events: CallEvent[]) {
  const values = events
    .map((event) => event.latency_ms)
    .filter((value): value is number => typeof value === "number" && value > 0)
    .sort((a, b) => a - b);
  const count = values.length;
  if (!count) return { median: null, p95: null, count };
  const middle = Math.floor(count / 2);
  const median = count % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
  const p95 = values[Math.max(0, Math.ceil(0.95 * count) - 1)];
  return { median, p95, count };
}

/** Stable identity hues: alphabetical neighbours sit about 137° apart on the wheel. */
export function personHues(names: string[]) {
  const people = [...new Set(names)].filter((name) => !isUnknownUser(name));
  people.sort((a, b) => a.localeCompare(b));
  return new Map(people.map((name, position) => [name, Math.round((position * 137.508 + 28) % 360)]));
}

export type FindingAction =
  | { kind: "model" | "agent" | "user" | "date"; value: string; label: string }
  | { kind: "models" | "users" | "activity"; label: string };

export type Finding = {
  id: string;
  label: string;
  figure: string;
  unit?: string;
  text: string;
  action?: FindingAction;
};

const percent = (part: number, whole: number) => (whole ? (part / whole) * 100 : 0).toFixed(1);

function topBy<T>(items: T[], value: (item: T) => number) {
  return items.reduce<T | undefined>(
    (best, item) => (best === undefined || value(item) > value(best) ? item : best),
    undefined,
  );
}

/** Plain-language facts about the filtered range, strongest first. Every share names its whole. */
export function computeFindings({
  rows,
  events,
  totals,
  rangeLabel,
}: {
  rows: UsageRow[];
  events: CallEvent[];
  totals: Totals;
  rangeLabel: string;
}): Finding[] {
  const findings: Finding[] = [];
  if (!rows.length || !totals.requests) return findings;
  const models = groupShares(rows, "model");
  const agents = groupShares(rows, "agent");
  const people = groupShares(rows, "user").filter((person) => !isUnknownUser(person.name));
  const tokens = totals.input + totals.output;

  const costDriver = topBy(models, (model) => model.cost);
  if (costDriver && models.length > 1 && totals.cost > 0) {
    findings.push({
      id: "cost-driver",
      label: "Biggest cost",
      figure: percent(costDriver.cost, totals.cost),
      unit: "%",
      text: `of estimated cost came from ${costDriver.name}, which handled ${percent(costDriver.calls, totals.requests)}% of calls.`,
      action: { kind: "model", value: costDriver.name, label: "Filter to this model" },
    });
  }

  if (totals.unpriced > 0) {
    findings.push({
      id: "unpriced",
      label: "Unpriced calls",
      figure: formatCount(totals.unpriced),
      unit: totals.unpriced === 1 ? "call" : "calls",
      text: "have no price in the price book, so the estimated cost leaves them out.",
      action: { kind: "models", label: "Open models" },
    });
  }

  const halfHours = new Array<number>(48).fill(0);
  for (const event of events) {
    const time = Date.parse(event.timestamp);
    if (Number.isNaN(time)) continue;
    halfHours[Math.floor((((time % DAY_MS) + DAY_MS) % DAY_MS) / 1_800_000)] += 1;
  }
  const timedCalls = halfHours.reduce((sum, value) => sum + value, 0);
  const peak = halfHours.indexOf(Math.max(...halfHours));
  if (timedCalls >= 10 && halfHours[peak] > 1) {
    findings.push({
      id: "peak-time",
      label: "Peak half-hour",
      figure: formatClock(peak * 30),
      unit: "UTC",
      text: `is the busiest half-hour: ${formatCount(halfHours[peak])} of ${formatCount(timedCalls)} calls (${percent(halfHours[peak], timedCalls)}%) started between ${formatClock(peak * 30)} and ${formatClock(peak * 30 + 30)} UTC.`,
      action: { kind: "activity", label: "Open activity" },
    });
  }

  const busiestAgent = topBy(agents, (agent) => agent.calls);
  if (busiestAgent && agents.length > 1) {
    findings.push({
      id: "busiest-agent",
      label: "Busiest agent",
      figure: formatCount(busiestAgent.calls),
      unit: busiestAgent.calls === 1 ? "call" : "calls",
      text: `from ${busiestAgent.name}: ${percent(busiestAgent.calls, totals.requests)}% of all calls in ${rangeLabel}.`,
      action: { kind: "agent", value: busiestAgent.name, label: "Filter to this agent" },
    });
  }

  const heaviest = topBy(people, (person) => person.tokens);
  if (heaviest && people.length > 1 && tokens > 0) {
    findings.push({
      id: "heaviest-user",
      label: "Most tokens",
      figure: percent(heaviest.tokens, tokens),
      unit: "%",
      text: `of tokens were used by ${heaviest.name}: ${formatCompact(heaviest.tokens)} tokens over ${formatCount(heaviest.calls)} calls.`,
      action: { kind: "user", value: heaviest.name, label: "Filter to this user" },
    });
  }

  const days = new Map<string, number>();
  for (const row of rows) days.set(row.date, (days.get(row.date) || 0) + row.requests);
  const busiestDay = topBy([...days.entries()], ([, calls]) => calls);
  if (busiestDay && days.size > 1) {
    findings.push({
      id: "busiest-day",
      label: "Busiest day",
      figure: formatCount(busiestDay[1]),
      unit: busiestDay[1] === 1 ? "call" : "calls",
      text: `on ${displayDate(busiestDay[0], { weekday: "long", month: "short", day: "numeric" })}: ${percent(busiestDay[1], totals.requests)}% of calls in ${rangeLabel}.`,
      action: { kind: "date", value: busiestDay[0], label: "Open that day" },
    });
  }

  const overall = latencyStats(events);
  const latencyByModel = [...new Set(events.map((event) => event.model))]
    .map((model) => ({ model, ...latencyStats(events.filter((event) => event.model === model)) }))
    .filter((entry) => entry.count >= 5 && entry.median !== null);
  const slowest = topBy(latencyByModel, (entry) => entry.median ?? 0);
  if (slowest && latencyByModel.length > 1 && overall.median) {
    findings.push({
      id: "slowest-model",
      label: "Slowest model",
      figure: ((slowest.median ?? 0) / 1000).toFixed(2),
      unit: "s",
      text: `median latency on ${slowest.model}, against ${(overall.median / 1000).toFixed(2)} s across all models.`,
      action: { kind: "model", value: slowest.model, label: "Filter to this model" },
    });
  }

  if (totals.output > 0 && totals.input > 0) {
    findings.push({
      id: "context-weight",
      label: "Context weight",
      figure: (totals.input / totals.output).toFixed(1),
      unit: ": 1",
      text: `input to output tokens: ${formatCompact(totals.input)} sent as context for ${formatCompact(totals.output)} generated.`,
      action: { kind: "users", label: "Compare by user" },
    });
  }

  return findings;
}
