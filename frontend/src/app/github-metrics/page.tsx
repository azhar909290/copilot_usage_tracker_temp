"use client";

import {
  Activity,
  ArrowDownToLine,
  ArrowUpRight,
  BookOpen,
  ChevronDown,
  Cpu,
  GitBranch,
  Info,
  LayoutGrid,
  Moon,
  RefreshCw,
  Search,
  Sun,
  TriangleAlert,
  Users,
} from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Rail } from "@/components/Rail";
import { RidgeMark } from "@/components/RidgeMark";
import { SignalLines } from "@/components/SignalLines";
import { seriesColor } from "@/components/DataViews";
import { personHues } from "@/lib/usage";
import { useDashboardTheme } from "../theme";

type Counts = {
  user_initiated_interaction_count: number;
  code_generation_activity_count: number;
  code_acceptance_activity_count: number;
  loc_added_sum: number;
  loc_deleted_sum: number;
};
type Breakdown = Counts & { name: string };
type ModelMetric = keyof Counts;
type User = Counts & {
  login: string; id: number; ai_credits_used: number | null; features: string[];
  daily_usage: { day: string; ai_credits_used: number | null; user_initiated_interaction_count: number }[];
};
type Window = { start: string; end: string };
type Metrics = {
  organization: string;
  fetched_at: string;
  cache_seconds: number;
  organization_metrics: {
    window: Window;
    daily: (Counts & { day: string; daily_active_users: number })[];
    totals: Counts;
    models: Breakdown[];
    features: Breakdown[];
  } | null;
  user_metrics: { window: Window; users: User[] } | null;
  errors: Record<string, string>;
};
type Tab = "overview" | "users" | "models";
type SortKey = keyof Counts | "name" | "ai_credits_used";
type Sort = { key: SortKey; direction: "asc" | "desc" };
const sortOptions: { key: SortKey; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "user_initiated_interaction_count", label: "Prompts" },
  { key: "code_generation_activity_count", label: "Generations" },
  { key: "code_acceptance_activity_count", label: "Acceptances" },
  { key: "loc_added_sum", label: "Lines added" },
  { key: "loc_deleted_sum", label: "Lines deleted" },
  { key: "ai_credits_used", label: "Reported credits" },
];

function sortRows<T extends Counts & { ai_credits_used?: number | null }>(
  rows: T[], name: (row: T) => string, sort: Sort,
) {
  return [...rows].sort((a, b) => {
    let comparison;
    if (sort.key === "name") {
      comparison = name(a).localeCompare(name(b));
    } else {
      const left = a[sort.key], right = b[sort.key];
      // Missing measurements stay last in either direction, never become zero.
      if (left == null || right == null) {
        return left == null && right == null ? name(a).localeCompare(name(b)) : left == null ? 1 : -1;
      }
      comparison = left - right;
    }
    return (sort.direction === "asc" ? comparison : -comparison) || name(a).localeCompare(name(b));
  });
}

function SortControls({ label, sort, onChange, credits = false }: {
  label: string; sort: Sort; onChange: (sort: Sort) => void; credits?: boolean;
}) {
  return <>
    <label className="select"><select aria-label={`Sort ${label}`} value={sort.key} onChange={(event) => {
      const option = sortOptions.find((item) => item.key === event.target.value);
      if (option) onChange({ ...sort, key: option.key });
    }}>{sortOptions.filter((option) => credits || option.key !== "ai_credits_used").map((option) =>
      <option key={option.key} value={option.key}>Sort: {option.label}</option>,
    )}</select><ChevronDown size={14} aria-hidden="true" /></label>
    <label className="select"><select aria-label={`Sort direction for ${label}`} value={sort.direction} onChange={(event) => {
      if (event.target.value === "asc" || event.target.value === "desc") onChange({ ...sort, direction: event.target.value });
    }}><option value="desc">Descending</option><option value="asc">Ascending</option></select><ChevronDown size={14} aria-hidden="true" /></label>
  </>;
}
const API_BASE = (process.env.NEXT_PUBLIC_USAGE_API_URL || "http://127.0.0.1:4318").replace(/\/$/, "");
const count = (value: number | null | undefined) => value == null ? "Unavailable" : new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
const short = (value: number) => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
const labels: Record<string, string> = {
  code_completion: "Code completion", chat_panel: "Chat panel", inline_chat: "Inline chat",
  agent_edit: "Agent / edit", copilot_cli: "Copilot CLI", copilot_app: "Copilot app",
};
const featureLabel = (value: string) => labels[value] || value.replaceAll("_", " ");
const dateLabel = (value: string | null) => value ? new Date(value.length === 10 ? `${value}T00:00:00Z` : value).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }) : "Not reported";
const windowLabel = (window: Window) => `${dateLabel(window.start)} – ${dateLabel(window.end)}`;
const tabs: { id: Tab; label: string; icon: typeof Activity }[] = [
  { id: "overview", label: "Overview", icon: Activity },
  { id: "users", label: "User usage", icon: Users },
  { id: "models", label: "Models", icon: Cpu },
];
const tooltipStyle = {
  contentStyle: { background: "var(--raised)", border: "1px solid var(--control)", borderRadius: 6, color: "var(--text)", fontSize: 12, padding: "6px 10px", boxShadow: "var(--float-shadow)" },
  itemStyle: { color: "var(--text)", padding: 0 },
  labelStyle: { color: "var(--muted)", marginBottom: 2 },
};
// Neutral ramp for the model ring: one ink, stepped by opacity in the order shown.

function BreakdownTable({ rows, dimension }: { rows: Breakdown[]; dimension: "Model" | "Feature" }) {
  return <div className="table-frame"><table className="table">
    <thead><tr><th>{dimension}</th><th className="num">Prompts</th><th className="num">Generations</th><th className="num">Acceptances</th><th className="num">Lines added</th><th className="num">Lines deleted</th></tr></thead>
    <tbody>{rows.map((row) => <tr key={row.name}>
      <td className="strong">{dimension === "Feature" ? featureLabel(row.name) : row.name}</td>
      <td className="num">{count(row.user_initiated_interaction_count)}</td><td className="num">{count(row.code_generation_activity_count)}</td>
      <td className="num">{count(row.code_acceptance_activity_count)}</td><td className="num muted">{count(row.loc_added_sum)}</td><td className="num muted">{count(row.loc_deleted_sum)}</td>
    </tr>)}</tbody>
  </table>{!rows.length && <p className="empty">No {dimension.toLowerCase()} breakdown was reported for this window.</p>}</div>;
}

function ModelUsageChart({ rows, metric }: { rows: Breakdown[]; metric: ModelMetric }) {
  const metricLabel = sortOptions.find((option) => option.key === metric)?.label;
  if (!rows.length) return <p className="empty">No models match the current filters.</p>;
  const total = rows.reduce((sum, row) => sum + row[metric], 0);
  const chartRows = rows.map((row, index) => ({ ...row, color: seriesColor(index) }));
  const share = (value: number) => `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(total ? value / total * 100 : 0)}%`;
  return <section className="ring-layout" aria-label={`Model usage ring chart: ${metricLabel}`}>
    <div className="ring">
      {total > 0 ? <>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={chartRows.filter((row) => row[metric] > 0)} dataKey={metric} nameKey="name" innerRadius={92} outerRadius={108} paddingAngle={1.2} cornerRadius={3} stroke="var(--surface)" strokeWidth={1} animationDuration={1100} animationEasing="ease-out">
              {chartRows.filter((row) => row[metric] > 0).map((row) => <Cell key={row.name} fill={row.color} />)}
            </Pie>
            <Tooltip {...tooltipStyle} formatter={(value) => {
              const amount = Number(value);
              return `${count(amount)} ${metricLabel?.toLowerCase()} (${share(amount)})`;
            }} />
          </PieChart>
        </ResponsiveContainer>
        <div className="ring-total"><strong>{short(total)}</strong><span>{metricLabel?.toLowerCase()}</span></div>
      </> : <p className="empty">No {metricLabel?.toLowerCase()} reported for the matching models.</p>}
    </div>
    <ul className="legend-table" aria-label="Model usage values and percentages">
      {chartRows.map((row) => <li key={row.name}>
        <span className="legend-swatch" style={{ background: row.color, boxShadow: `0 0 8px ${row.color}` }} aria-hidden="true" />
        <span className="legend-name" title={row.name}>{row.name}</span>
        <span className="num">{count(row[metric])}</span><span className="num muted">{share(row[metric])}</span>
      </li>)}
    </ul>
  </section>;
}

export default function GitHubMetricsPage() {
  const { theme, toggleTheme } = useDashboardTheme();
  const [data, setData] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [tab, setTab] = useState<Tab>("overview");
  const [search, setSearch] = useState("");
  const [userSort, setUserSort] = useState<Sort>({ key: "user_initiated_interaction_count", direction: "desc" });
  const [modelSort, setModelSort] = useState<Sort>({ key: "user_initiated_interaction_count", direction: "desc" });
  const [modelMetric, setModelMetric] = useState<ModelMetric>("user_initiated_interaction_count");
  const [featureSort, setFeatureSort] = useState<Sort>({ key: "code_generation_activity_count", direction: "desc" });

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`${API_BASE}/api/v1/github/metrics`, {
          cache: "no-store", signal: controller.signal,
        });
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(typeof body?.detail === "string" ? body.detail : `Metrics API returned HTTP ${response.status}.`);
        }
        const payload: Metrics = await response.json();
        if (!controller.signal.aborted) setData(payload);
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Unable to load GitHub metrics.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [refreshKey]);

  const org = data?.organization_metrics;
  const users = useMemo(() => data?.user_metrics?.users ?? [], [data]);
  const hues = useMemo(() => personHues(users.map((user) => user.login)), [users]);
  const query = search.trim().toLowerCase();
  const filteredUsers = sortRows(users.filter((user) =>
    `${user.login} ${user.id} ${user.features.join(" ")}`.toLowerCase().includes(query),
  ), (user) => user.login, userSort);
  const filteredModels = sortRows((org?.models ?? []).filter((row) => row.name.toLowerCase().includes(query)), (row) => row.name, modelSort);
  const sortedFeatures = sortRows(org?.features ?? [], (row) => featureLabel(row.name), featureSort);
  const completion = org?.features.find((feature) => feature.name === "code_completion");
  const completionRate = completion && completion.code_generation_activity_count > 0 ?
    100 * completion.code_acceptance_activity_count / completion.code_generation_activity_count : null;
  const modelPromptTotal = (org?.models ?? []).reduce((total, model) => total + model.user_initiated_interaction_count, 0);
  const topModelPrompts = Math.max(0, ...(org?.models ?? []).slice(0, 5).map((model) => model.user_initiated_interaction_count));
  const reportWindowsDiffer = org && data?.user_metrics &&
    (org.window.start !== data.user_metrics.window.start || org.window.end !== data.user_metrics.window.end);

  function exportCsv() {
    const rows: Record<string, string | number | null>[] = tab === "users" ? filteredUsers.map((user) => ({
      login: user.login, id: user.id, prompts: user.user_initiated_interaction_count,
      generations: user.code_generation_activity_count, acceptances: user.code_acceptance_activity_count,
      lines_added: user.loc_added_sum, lines_deleted: user.loc_deleted_sum,
      reported_ai_credits: user.ai_credits_used, features: user.features.join("; "),
      report_start: data?.user_metrics?.window.start ?? null,
      report_end: data?.user_metrics?.window.end ?? null,
    })) :
      filteredModels.map((model) => ({ ...model }));
    if (!rows.length) return;
    const columns = Object.keys(rows[0]);
    const cell = (value: string | number | null) => {
      let text = value == null ? "" : String(value);
      if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
      return `"${text.replaceAll('"', '""')}"`;
    };
    const content = [columns.map(cell).join(","), ...rows.map((row) => columns.map((column) => cell(row[column])).join(","))].join("\r\n");
    const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url; link.download = `github-copilot-${data?.organization}-${tab}.csv`; link.click();
    URL.revokeObjectURL(url);
  }

  const exportAvailable = tab === "users" ? filteredUsers.length : tab === "models" ? filteredModels.length : 0;
  const kpis = data ? [
    { label: "Reported users", value: data.user_metrics ? users.length : null, note: "Users included in the user report" },
    { label: "Code generations", value: org?.totals.code_generation_activity_count, note: "Copilot output events in the window" },
    { label: "User prompts", value: org?.totals.user_initiated_interaction_count, note: "Explicit interactions in the window" },
    { label: "Lines added", value: org?.totals.loc_added_sum, note: "Accepted code and agent/editor additions" },
  ] : [];

  return <><div className="sky" aria-hidden="true"><i /></div><div className="app">
    <Rail
      active="github"
      items={[
        { id: "overview", label: "Telemetry overview", short: "Overview", icon: LayoutGrid, href: "/dashboard" },
        { id: "github", label: "GitHub metrics", short: "GitHub", icon: GitBranch, href: "/github-metrics" },
      ]}
      utilities={[
        { id: "theme", label: theme === "dark" ? "Light mode" : "Dark mode", icon: theme === "dark" ? Sun : Moon, onSelect: toggleTheme },
        { id: "docs", label: "Metrics documentation", icon: BookOpen, href: "https://docs.github.com/en/rest/copilot/copilot-usage-metrics" },
      ]}
    />
    <main className="canvas">
      <div className="mobile-bar">
        <RidgeMark size={22} />
        <strong>AI Control Plane</strong>
        <button className="icon-button" type="button" onClick={toggleTheme} aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}>{theme === "dark" ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}</button>
      </div>
      <header className="title-row">
        <div className="title-block">
          <h1>GitHub metrics</h1>
          <p className="title-meta">
            {data ? <>
              <span>{data.organization}</span><span aria-hidden="true">·</span>
              <span>{org ? windowLabel(org.window) : "Organization report unavailable"}</span><span aria-hidden="true">·</span>
              <span className="freshness" data-state={error ? "error" : "ok"}><i aria-hidden="true" />Fetched {new Date(data.fetched_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
            </> : <span>Adoption, people and model usage from GitHub&apos;s organization reports.</span>}
          </p>
        </div>
        <div className="title-actions">
          <button className="icon-button" type="button" title="Refresh" aria-label="Refresh GitHub metrics" onClick={() => setRefreshKey((key) => key + 1)} disabled={loading}><RefreshCw size={15} className={loading ? "spin" : undefined} aria-hidden="true" /></button>
          <button className="button" type="button" onClick={exportCsv} disabled={!exportAvailable}><ArrowDownToLine size={14} aria-hidden="true" /> Export CSV</button>
        </div>
      </header>

      {error && <div className="notice is-negative" role="alert"><TriangleAlert size={15} aria-hidden="true" /><span>GitHub metrics could not be loaded. <span className="muted">{error}{data ? " Showing the last successful snapshot; it is not refreshed." : ""}</span></span><button className="text-button" type="button" onClick={() => setRefreshKey((key) => key + 1)} disabled={loading}>Retry</button></div>}
      {loading && !data && <section className="block inline-loader" role="status"><SignalLines compact /><p>Fetching GitHub usage reports…</p></section>}

      {data && <div className="view">
        <div className="notes">
          <div className="notice is-neutral"><Info size={15} aria-hidden="true" /><div><strong>Daily reports, not real-time telemetry</strong>Latest available 28-day window. Prompts are explicit user interactions, not LLM calls or tokens. Reports can lag behind activity. AI credits are consumption metrics, not an invoice.</div></div>
          <div className="notice is-neutral"><Info size={15} aria-hidden="true" /><div><strong>Reported credits are not your VS Code billing-cycle balance</strong>{data.user_metrics ? `Credit report window: ${windowLabel(data.user_metrics.window)} (UTC). ` : "Credit report unavailable. "}This rolling organization report is not a billing-cycle total and does not include activity after its end date. GitHub says recent telemetry typically finalizes within three full UTC days. &quot;0 reported&quot; means GitHub supplied zero; it does not mean the user had no activity or no billed usage. Missing credit values are shown as unavailable, not zero. <a href="https://docs.github.com/en/copilot/reference/copilot-usage-metrics/reconciling-usage-metrics" target="_blank" rel="noreferrer">How GitHub usage reports differ</a></div></div>
        </div>
        {(Object.keys(data.errors).length > 0 || reportWindowsDiffer) && <div className="notice-stack">
          {Object.entries(data.errors).map(([section, message]) => <div className="notice is-warning" role="alert" key={section}><TriangleAlert size={15} aria-hidden="true" /><span><strong>{section.replaceAll("_", " ")} unavailable:</strong> {message}</span></div>)}
          {reportWindowsDiffer && <div className="notice is-warning"><TriangleAlert size={15} aria-hidden="true" /><span>User and organization reports have different reporting windows. Their totals should not be directly compared.</span></div>}
        </div>}

        <section className="kpis is-four" aria-label="GitHub usage totals">
          {kpis.map(({ label, value, note }) => <div className="kpi" key={label}>
            <span className="kpi-label">{label}</span>
            <span className="kpi-value num">{value == null ? <span className="dash">Unavailable</span> : count(value)}</span>
            <span className="kpi-note">{note}</span>
          </div>)}
        </section>

        <div>
          <nav className="tabs" role="tablist" aria-label="GitHub metric views">{tabs.map(({ id, label, icon: Icon }) => <button type="button" role="tab" key={id} aria-selected={tab === id} onClick={() => { setTab(id); setSearch(""); }}>
            <Icon size={15} strokeWidth={1.6} aria-hidden="true" />{label}
            {tab === id && <motion.span className="select-line" layoutId="gh-tab" transition={{ type: "spring", stiffness: 560, damping: 44 }} />}
          </button>)}</nav>
        </div>

        {tab === "overview" && <>
          <div className="chart-row" style={{ marginTop: 0 }}>
            <section className="block">
              <header className="block-head"><div className="block-title"><h2>Daily Copilot activity</h2><p>Prompts and code generations per UTC day</p></div></header>
              {org?.daily.length ? <>
                <div className="area-chart"><ResponsiveContainer width="100%" height={214}><AreaChart data={org.daily} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="day" tickFormatter={(day: string) => dateLabel(day).replace(/, \d{4}$/, "")} axisLine={false} tickLine={false} minTickGap={28} />
                  <YAxis tickFormatter={short} axisLine={false} tickLine={false} width={44} />
                  <defs>
                    <linearGradient id="gh-prompts" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--c-calls)" stopOpacity={0.45} /><stop offset="100%" stopColor="var(--c-calls)" stopOpacity={0} /></linearGradient>
                    <linearGradient id="gh-generations" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--c-tokens)" stopOpacity={0.35} /><stop offset="100%" stopColor="var(--c-tokens)" stopOpacity={0} /></linearGradient>
                  </defs>
                  <Tooltip {...tooltipStyle} cursor={{ stroke: "var(--c-cost)", strokeWidth: 1 }} formatter={(value) => count(typeof value === "number" ? value : Number(value))} />
                  <Area type="monotone" dataKey="user_initiated_interaction_count" name="User prompts" stroke="var(--c-calls)" strokeWidth={2} fill="url(#gh-prompts)" animationDuration={1200} animationEasing="ease-out" />
                  <Area type="monotone" dataKey="code_generation_activity_count" name="Code generations" stroke="var(--c-tokens)" strokeWidth={2} fill="url(#gh-generations)" animationDuration={1200} animationEasing="ease-out" />
                </AreaChart></ResponsiveContainer></div>
                <div className="chart-legend"><span style={{ color: "var(--c-calls)" }}><i />User prompts</span><span style={{ color: "var(--c-tokens)" }}><i />Code generations</span></div>
              </> : <p className="empty">Daily activity is unavailable or no activity was reported.</p>}
            </section>
            <section className="block">
              <header className="block-head"><div className="block-title"><h2>Most used models</h2><p>Chat model mix by prompts</p></div><button className="text-button" type="button" onClick={() => setTab("models")}>View all <ArrowUpRight size={13} aria-hidden="true" /></button></header>
              <ol className="rank-list">{org?.models.slice(0, 5).map((model) => <li key={model.name} style={{ "--fill": topModelPrompts ? model.user_initiated_interaction_count / topModelPrompts : 0 } as CSSProperties}>
                <span title={model.name}>{model.name}</span>
                <span className="num">{count(model.user_initiated_interaction_count)} <span className="muted">· {modelPromptTotal ? `${(model.user_initiated_interaction_count / modelPromptTotal * 100).toFixed(1)}%` : "0.0%"}</span></span>
              </li>)}</ol>
              {!org?.models.length && <p className="empty">No model breakdown reported.</p>}
              <p className="block-foot">Share of reported model prompts only. Not token usage or cost.</p>
            </section>
          </div>
          <section className="block">
            <header className="block-head"><div className="block-title"><h2>How Copilot is being used</h2><p>Feature adoption across the report window</p></div><span className="muted">Completion acceptance: <span className="num">{completionRate === null ? "Unavailable" : `${completionRate.toFixed(1)}%`}</span></span></header>
            <div className="gh-controls"><span className="caption">Sort feature activity</span><SortControls label="features" sort={featureSort} onChange={setFeatureSort} /></div>
            {org ? <BreakdownTable rows={sortedFeatures} dimension="Feature" /> : <p className="empty">Feature metrics are unavailable.</p>}
          </section>
          <section className="block">
            <header className="block-head"><div className="block-title"><h2>IDE active users by day</h2><p>Daily counts are not additive; CLI activity is counted separately by GitHub</p></div></header>
            <div className="daily-grid">{org?.daily.map((day) => <div key={day.day} title={`${day.day}: ${count(day.daily_active_users)} active users`}><span className="num">{day.day.slice(5)}</span><strong className="num">{count(day.daily_active_users)}</strong></div>)}</div>
            {!org?.daily.length && <p className="empty">Daily user counts are unavailable.</p>}
          </section>
        </>}

        {tab !== "overview" && <section className="block">
          <header className="block-head"><div className="block-title"><h2>{tabs.find((item) => item.id === tab)?.label}</h2><p>28-day report</p></div><span className="muted">{tab === "users" ? data.user_metrics ? windowLabel(data.user_metrics.window) : "User reporting window unavailable" : org ? windowLabel(org.window) : "Organization reporting window unavailable"}</span></header>
          <div className="gh-controls">
            <label className="search"><Search size={15} aria-hidden="true" /><input value={search} onChange={(event) => setSearch(event.target.value)} aria-label={`Search ${tab}`} placeholder={tab === "models" ? "Search models" : "Search GitHub alias or ID"} /></label>
            {tab === "users" ? <SortControls label="users" sort={userSort} onChange={setUserSort} credits /> : <>
              <label className="select"><select aria-label="Model chart metric" value={modelMetric} onChange={(event) => {
                const option = sortOptions.find((item) => item.key === event.target.value);
                if (option && option.key !== "name" && option.key !== "ai_credits_used") setModelMetric(option.key);
              }}>{sortOptions.filter((option) => option.key !== "name" && option.key !== "ai_credits_used").map((option) =>
                <option key={option.key} value={option.key}>Ring: {option.label}</option>,
              )}</select><ChevronDown size={14} aria-hidden="true" /></label>
              <SortControls label="models" sort={modelSort} onChange={setModelSort} />
            </>}
          </div>
          {tab === "models" && <><p className="caption" style={{ marginBottom: 16 }}>Chat activity grouped by model across features. Choose the ring metric independently of the sort field and direction; breakdowns may not cover every feature. Each model keeps its share of the matching models only, not credits, token usage or billing cost. Zero values stay in the legend without a segment.</p>{org ? <><ModelUsageChart rows={filteredModels} metric={modelMetric} /><BreakdownTable rows={filteredModels} dimension="Model" /></> : <p className="empty">Model metrics are unavailable.</p>}</>}
          {tab === "users" && <>
            <p className="caption" style={{ marginBottom: 16 }}>Per-user report metrics are independent of local captureIdentity. Expand credit details to inspect GitHub&apos;s daily values; a reported zero is not an inactivity verdict.</p>
            <div className="table-frame"><table className="table"><thead><tr><th>GitHub user</th><th className="num">Prompts</th><th className="num">Generations</th><th className="num">Acceptances</th><th className="num">Lines added</th><th className="num">Lines deleted</th><th className="num">Reported AI credits</th><th>Features used</th></tr></thead><tbody>{filteredUsers.map((user) => <tr key={user.id}>
              <td><span className="person"><span className="avatar" style={{ "--hue": hues.get(user.login) ?? 0 } as CSSProperties} aria-hidden="true">{user.login.slice(0, 1).toUpperCase()}</span><span className="gh-user"><a href={`https://github.com/${encodeURIComponent(user.login)}`} target="_blank" rel="noreferrer">{user.login}<ArrowUpRight size={11} aria-hidden="true" /></a><small className="muted num">ID {user.id}</small></span></span></td>
              <td className="num">{count(user.user_initiated_interaction_count)}</td><td className="num">{count(user.code_generation_activity_count)}</td><td className="num">{count(user.code_acceptance_activity_count)}</td><td className="num muted">{count(user.loc_added_sum)}</td><td className="num muted">{count(user.loc_deleted_sum)}</td><td className="num">
                <span>{user.ai_credits_used === 0 ? "0 reported" : count(user.ai_credits_used)}</span>
                <details className="credit-details"><summary aria-label={`Credit details for ${user.login}`}>Daily report details</summary>
                  {user.daily_usage?.length ? <table><caption>UTC date / reported credits / prompts</caption><thead><tr><th>Date</th><th>Credits</th><th>Prompts</th></tr></thead><tbody>{user.daily_usage.map((day) => <tr key={day.day}><td className="num">{day.day}</td><td className="num">{day.ai_credits_used === 0 ? "0 reported" : count(day.ai_credits_used)}</td><td className="num">{count(day.user_initiated_interaction_count)}</td></tr>)}</tbody></table> : <p>Daily breakdown unavailable in this report.</p>}
                  <p>Only returned report rows are shown. Missing dates do not establish zero usage. Credits are not reconstructed from prompts or tokens.</p>
                </details>
              </td>
              <td><div className="tag-list">{user.features.map((feature) => <span className="pill is-neutral" key={feature}>{feature}</span>)}{!user.features.length && <span className="muted">No feature flags reported</span>}</div></td>
            </tr>)}</tbody></table>{!filteredUsers.length && <p className="empty">{data.user_metrics ? "No users match these filters." : "User metrics are unavailable."}</p>}</div>
          </>}
        </section>}
      </div>}
      {data && <footer className="status-footer"><span>GitHub snapshot <span className="num">{new Date(data.fetched_at).toLocaleString()}</span> · server cache <span className="num">{data.cache_seconds / 60}</span> minutes</span><span>GitHub REST API · no OTLP data mixed in</span></footer>}
    </main>
  </div></>;
}
