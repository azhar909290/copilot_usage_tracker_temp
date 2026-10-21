"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity, ArrowDownToLine, ArrowUpRight, Command, Cpu, GitBranch,
  LayoutDashboard, LoaderCircle, Moon, RefreshCw,
  Search, ShieldAlert, Sun, Users, Zap,
} from "lucide-react";
import {
  Area, AreaChart, CartesianGrid, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
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
    <label className="select-filter"><select aria-label={`Sort ${label}`} value={sort.key} onChange={(event) => {
      const option = sortOptions.find((item) => item.key === event.target.value);
      if (option) onChange({ ...sort, key: option.key });
    }}>{sortOptions.filter((option) => credits || option.key !== "ai_credits_used").map((option) =>
      <option key={option.key} value={option.key}>{option.label}</option>,
    )}</select></label>
    <label className="select-filter"><select aria-label={`Sort direction for ${label}`} value={sort.direction} onChange={(event) => {
      if (event.target.value === "asc" || event.target.value === "desc") onChange({ ...sort, direction: event.target.value });
    }}><option value="desc">Descending</option><option value="asc">Ascending</option></select></label>
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
const windowLabel = (window: Window) => `${dateLabel(window.start)} - ${dateLabel(window.end)}`;
const tabs: { id: Tab; label: string; icon: typeof Activity }[] = [
  { id: "overview", label: "Overview", icon: Activity },
  { id: "users", label: "User usage", icon: Users },
  { id: "models", label: "Models", icon: Cpu },
];

function BreakdownTable({ rows, dimension }: { rows: Breakdown[]; dimension: "Model" | "Feature" }) {
  return <div className="table-scroll"><table className="data-table github-table">
    <thead><tr><th>{dimension}</th><th>Prompts</th><th>Generations</th><th>Acceptances</th><th>Lines added</th><th>Lines deleted</th></tr></thead>
    <tbody>{rows.map((row) => <tr key={row.name}>
      <td><strong>{dimension === "Feature" ? featureLabel(row.name) : row.name}</strong></td>
      <td>{count(row.user_initiated_interaction_count)}</td><td>{count(row.code_generation_activity_count)}</td>
      <td>{count(row.code_acceptance_activity_count)}</td><td>{count(row.loc_added_sum)}</td><td>{count(row.loc_deleted_sum)}</td>
    </tr>)}</tbody>
  </table>{!rows.length && <div className="empty-state">No {dimension.toLowerCase()} breakdown was reported for this window.</div>}</div>;
}

function ModelUsageChart({ rows, metric }: { rows: Breakdown[]; metric: ModelMetric }) {
  const metricLabel = sortOptions.find((option) => option.key === metric)?.label;
  if (!rows.length) return <div className="empty-state">No models match the current filters.</div>;
  const total = rows.reduce((sum, row) => sum + row[metric], 0);
  const chartRows = rows.map((row) => {
    const hue = Array.from(row.name).reduce((hash, character) => (hash * 31 + character.charCodeAt(0)) % 360, 0);
    return { ...row, fill: `hsl(${hue}, 65%, 60%)` };
  });
  const share = (value: number) => `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(total ? value / total * 100 : 0)}%`;
  return <section className="github-model-chart" aria-label={`Model usage pie chart: ${metricLabel}`}>
    <div className="panel-heading"><h2>Model usage</h2><span className="github-caption">{metricLabel} / {rows.length} models / current sort order</span></div>
    <div className="github-model-pie-layout">
      <div className="github-model-pie-canvas">
        {total > 0 ?
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={chartRows.filter((row) => row[metric] > 0)} dataKey={metric} nameKey="name" outerRadius="85%" stroke="var(--surface)" strokeWidth={2} isAnimationActive={false} />
            <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", color: "var(--ink)", borderRadius: 8 }} itemStyle={{ color: "var(--ink)" }} formatter={(value) => {
              const amount = Number(value);
              return `${count(amount)} ${metricLabel?.toLowerCase()} (${share(amount)})`;
            }} />
          </PieChart>
        </ResponsiveContainer>
        : <div className="empty-state">No {metricLabel?.toLowerCase()} reported for the matching models.</div>}
      </div>
      <ul className="github-model-pie-legend" aria-label="Model usage values and percentages">
        {chartRows.map((row) => <li key={row.name}>
          <span className="github-model-pie-swatch" style={{ background: row.fill }} aria-hidden="true" />
          <span className="github-model-pie-name">{row.name}</span>
          <strong>{count(row[metric])}</strong><span className="github-caption">{share(row[metric])}</span>
        </li>)}
      </ul>
    </div>
    <p className="github-caption">Slices show each model&apos;s share of {metricLabel?.toLowerCase()} among the matching models, not credits, token usage, or billing cost. Zero values remain in the legend without a slice. The legend, table, and CSV use the same filtered sort order.</p>
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
  const users = data?.user_metrics?.users ?? [];
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

  return <main className="app-shell github-shell">
    <aside className="sidebar">
      <Link className="brand" href="/"><span className="brand-mark"><Command size={19} /></span><span className="brand-copy"><strong>Agent Command</strong><small>CENTER</small></span></Link>
      <div className="workspace-label">ORGANIZATION</div>
      <div className="workspace-switcher"><span className="workspace-avatar"><GitBranch size={18} /></span><span className="workspace-name"><strong>{data?.organization ?? "GitHub organization"}</strong><small>Copilot REST metrics</small></span></div>
      <div className="nav-label">ANALYTICS</div>
      <nav className="primary-nav" aria-label="Dashboard sections">
        <Link className="nav-item github-nav-link" href="/" aria-label="Telemetry dashboard" title="Telemetry dashboard"><LayoutDashboard size={18} /><span>Telemetry dashboard</span></Link>
        <Link className="nav-item active github-nav-link" href="/github-metrics" aria-current="page" aria-label="GitHub Metrics" title="GitHub Metrics"><GitBranch size={18} /><span>GitHub Metrics</span></Link>
      </nav>
      <div className="sidebar-bottom">
        <div className="source-card"><div className="source-card-top"><GitBranch size={13} /> DATA SOURCE</div><strong>GitHub REST API</strong><small>Daily reports / latest 28 days</small></div>
        <a className="help-link" href="https://docs.github.com/en/rest/copilot/copilot-usage-metrics" target="_blank" rel="noreferrer">Metrics documentation <ArrowUpRight size={13} /></a>
        <div className="sidebar-foot"><span>SEPARATE FROM OTEL DATA</span></div>
      </div>
    </aside>
    <section className="main-panel">
      <header className="topbar">
        <span className="github-topbar-label"><GitBranch size={17} /> Organization intelligence</span>
        <div className="topbar-actions">
          <button className="icon-button" onClick={toggleTheme} type="button" aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}>{theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}</button>
        </div>
      </header>
      <div className="content-wrap">
        <div className="page-heading">
          <div><div className="eyebrow"><GitBranch size={13} /> GITHUB COPILOT METRICS</div><h1>GitHub Metrics</h1><p>{data ? `${data.organization} / ${org ? windowLabel(org.window) : "Organization report unavailable"}` : "Adoption, people, and model usage from GitHub's organization reports."}</p></div>
          <div className="heading-meta">
            <button className="export-button" onClick={() => setRefreshKey((key) => key + 1)} type="button" disabled={loading}><RefreshCw size={15} className={loading ? "spin" : ""} /> Refresh</button>
            <button className="export-button" onClick={exportCsv} type="button" disabled={!exportAvailable}><ArrowDownToLine size={15} /> CSV</button>
          </div>
        </div>
        {error && <div className="error-banner" role="alert"><ShieldAlert size={17} /><div><strong>GitHub metrics could not be loaded</strong><span>{error}{data ? " Showing the last successful snapshot; it is not refreshed." : ""}</span></div><button onClick={() => setRefreshKey((key) => key + 1)} type="button" disabled={loading}>Retry</button></div>}
        {loading && !data && <div className="empty-state" role="status"><LoaderCircle size={24} className="spin" /><p>Fetching GitHub usage reports...</p></div>}
        {data && <>
          <div className="github-report-note"><Activity size={19} aria-hidden="true" /><div><strong>Daily reports, not real-time telemetry</strong><p>Latest available 28-day window. Prompts are explicit user interactions, not LLM calls or tokens. Reports can lag behind activity. AI credits are consumption metrics, not an invoice.</p></div></div>
          <div className="github-report-note"><ShieldAlert size={19} aria-hidden="true" /><div><strong>Reported credits are not your VS Code billing-cycle balance</strong><p>{data.user_metrics ? `Credit report window: ${windowLabel(data.user_metrics.window)} (UTC). ` : "Credit report unavailable. "}This rolling organization report is not a billing-cycle total and does not include activity after its end date. GitHub says recent telemetry typically finalizes within three full UTC days. &quot;0 reported&quot; means GitHub supplied zero; it does not mean the user had no activity or no billed usage. Missing credit values are shown as unavailable, not zero.</p><a className="text-link" href="https://docs.github.com/en/copilot/reference/copilot-usage-metrics/reconciling-usage-metrics" target="_blank" rel="noreferrer">How GitHub usage reports differ <ArrowUpRight size={12} /></a></div></div>
          {Object.entries(data.errors).map(([section, message]) => <div className="stale-banner" role="alert" key={section}><ShieldAlert size={16} /><span><strong>{section.replaceAll("_", " ")} unavailable:</strong> {message}</span></div>)}
          {reportWindowsDiffer && <div className="stale-banner">User and organization reports have different reporting windows. Their totals should not be directly compared.</div>}
          <section className="metric-grid" aria-label="GitHub usage totals">
            {[
              { label: "REPORTED USERS", value: data.user_metrics ? users.length : null, detail: "Users included in the user report", icon: Users },
              { label: "CODE GENERATIONS", value: org?.totals.code_generation_activity_count, detail: "Copilot output events in the report window", icon: Activity },
              { label: "USER PROMPTS", value: org?.totals.user_initiated_interaction_count, detail: "Explicit interactions in the report window", icon: Zap },
              { label: "LINES ADDED", value: org?.totals.loc_added_sum, detail: "Accepted code and agent/editor additions", icon: Cpu },
            ].map(({ label, value, detail, icon: Icon }) => <article className="metric-card" key={label}><div className="metric-label">{label}<Icon size={17} /></div><div className="metric-value">{count(value)}</div><div className="metric-foot">{detail}</div></article>)}
          </section>
          <nav className="github-tabs" aria-label="GitHub metric views">{tabs.map(({ id, label, icon: Icon }) => <button type="button" key={id} className={tab === id ? "selected" : ""} aria-pressed={tab === id} onClick={() => { setTab(id); setSearch(""); }}><Icon size={16} />{label}</button>)}</nav>
          {tab === "overview" && <>
            <div className="overview-grid">
              <section className="panel trend-panel"><div className="panel-heading"><div><div className="section-kicker">ENGAGEMENT OVER TIME</div><h2>Daily Copilot activity</h2></div></div>
                {org?.daily.length ? <><div className="chart-frame"><ResponsiveContainer width="100%" height="100%"><AreaChart data={org.daily}>
                  <CartesianGrid stroke="var(--line)" vertical={false} /><XAxis dataKey="day" tickFormatter={(day: string) => day.slice(5)} stroke="var(--muted)" fontSize={10} /><YAxis tickFormatter={short} stroke="var(--muted)" fontSize={10} />
                  <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", color: "var(--ink)", borderRadius: 8 }} formatter={(value) => count(typeof value === "number" ? value : Number(value))} />
                  <Area type="monotone" dataKey="user_initiated_interaction_count" name="User prompts" stroke="var(--accent)" fill="var(--accent)" fillOpacity={0.13} />
                  <Area type="monotone" dataKey="code_generation_activity_count" name="Code generations" stroke="var(--green)" fill="var(--green)" fillOpacity={0.08} />
                </AreaChart></ResponsiveContainer></div><div className="chart-legend"><span>User prompts</span><span>Code generations</span></div></> : <div className="empty-state">Daily activity is unavailable or no activity was reported.</div>}
              </section>
              <section className="panel model-panel"><div className="panel-heading"><div><div className="section-kicker">CHAT MODEL MIX</div><h2>Most used models</h2></div><button className="text-link" type="button" onClick={() => setTab("models")}>View all</button></div>
                <div className="model-list">{org?.models.slice(0, 5).map((model, index) => <div className="model-row" key={model.name}><span className={`model-index model-index-${index % 4}`}>{String(index + 1).padStart(2, "0")}</span><div className="model-details"><div className="model-name-line"><strong>{model.name}</strong><span>{count(model.user_initiated_interaction_count)} prompts</span></div><div className="model-bar"><span style={{ width: `${modelPromptTotal ? model.user_initiated_interaction_count / modelPromptTotal * 100 : 0}%` }} /></div></div></div>)}</div>
                {!org?.models.length && <div className="empty-state">No model breakdown reported.</div>}<div className="model-panel-footer">Share of reported model prompts only. Not token usage or cost.</div>
              </section>
            </div>
            <section className="panel full-panel"><div className="panel-heading"><div><div className="section-kicker">FEATURE ADOPTION</div><h2>How Copilot is being used</h2></div><span className="github-caption">Completion acceptance: {completionRate === null ? "Unavailable" : `${completionRate.toFixed(1)}%`}</span></div>
              <div className="filter-row"><span className="github-caption">Sort feature activity</span><SortControls label="features" sort={featureSort} onChange={setFeatureSort} /></div>
              {org ? <BreakdownTable rows={sortedFeatures} dimension="Feature" /> : <div className="empty-state">Feature metrics are unavailable.</div>}
            </section>
            <section className="panel full-panel"><div className="panel-heading"><div><div className="section-kicker">DAILY IDE REACH</div><h2>IDE active users by day</h2></div><span className="github-caption">Daily counts are not additive; CLI activity is counted separately by GitHub</span></div>
              <div className="github-daily-grid">{org?.daily.map((day) => <div className="github-day" key={day.day} title={`${day.day}: ${count(day.daily_active_users)} active users`}><span>{day.day.slice(5)}</span><strong>{count(day.daily_active_users)}</strong></div>)}</div>
              {!org?.daily.length && <div className="empty-state">Daily user counts are unavailable.</div>}
            </section>
          </>}
          {tab !== "overview" && <section className="panel full-panel">
            <div className="panel-heading"><div><div className="section-kicker">28-DAY REPORT</div><h2>{tabs.find((item) => item.id === tab)?.label}</h2></div><span className="github-caption">{tab === "users" ? data.user_metrics ? windowLabel(data.user_metrics.window) : "User reporting window unavailable" : org ? windowLabel(org.window) : "Organization reporting window unavailable"}</span></div>
            <div className="filter-row">
              <label className="search-field"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} aria-label={`Search ${tab}`} placeholder={tab === "models" ? "Search models" : "Search GitHub alias or ID"} /></label>
              {tab === "users" ? <SortControls label="users" sort={userSort} onChange={setUserSort} credits /> : <>
                <label className="select-filter"><select aria-label="Model chart metric" value={modelMetric} onChange={(event) => {
                  const option = sortOptions.find((item) => item.key === event.target.value);
                  if (option && option.key !== "name" && option.key !== "ai_credits_used") setModelMetric(option.key);
                }}>{sortOptions.filter((option) => option.key !== "name" && option.key !== "ai_credits_used").map((option) =>
                  <option key={option.key} value={option.key}>Pie: {option.label}</option>,
                )}</select></label>
                <SortControls label="models" sort={modelSort} onChange={setModelSort} />
              </>}
            </div>
            {tab === "models" && <><p className="github-caption">Chat activity grouped by model across features. Choose the pie metric independently of the sort field and direction; breakdowns may not cover every feature.</p>{org ? <><ModelUsageChart rows={filteredModels} metric={modelMetric} /><BreakdownTable rows={filteredModels} dimension="Model" /></> : <div className="empty-state">Model metrics are unavailable.</div>}</>}
            {tab === "users" && <>
              <p className="github-caption">Per-user report metrics are independent of local captureIdentity. Expand credit details to inspect GitHub&apos;s daily values; a reported zero is not an inactivity verdict.</p>
              <div className="table-scroll"><table className="data-table github-table"><thead><tr><th>GitHub user</th><th>Prompts</th><th>Generations</th><th>Acceptances</th><th>Lines added</th><th>Lines deleted</th><th>Reported AI credits</th><th>Features used</th></tr></thead><tbody>{filteredUsers.map((user) => <tr key={user.id}>
                <td><div className="github-user"><span className="agent-avatar">{user.login.slice(0, 2).toUpperCase()}</span><div><a href={`https://github.com/${encodeURIComponent(user.login)}`} target="_blank" rel="noreferrer">{user.login}<ArrowUpRight size={11} /></a><small>ID {user.id}</small></div></div></td>
                <td>{count(user.user_initiated_interaction_count)}</td><td>{count(user.code_generation_activity_count)}</td><td>{count(user.code_acceptance_activity_count)}</td><td>{count(user.loc_added_sum)}</td><td>{count(user.loc_deleted_sum)}</td><td>
                  <strong>{user.ai_credits_used === 0 ? "0 reported" : count(user.ai_credits_used)}</strong>
                  <details className="github-credit-details"><summary aria-label={`Credit details for ${user.login}`}>Daily report details</summary>
                    {user.daily_usage?.length ? <table><caption>UTC date / reported credits / prompts</caption><thead><tr><th>Date</th><th>Credits</th><th>Prompts</th></tr></thead><tbody>{user.daily_usage.map((day) => <tr key={day.day}><td>{day.day}</td><td>{day.ai_credits_used === 0 ? "0 reported" : count(day.ai_credits_used)}</td><td>{count(day.user_initiated_interaction_count)}</td></tr>)}</tbody></table> : <p>Daily breakdown unavailable in this report.</p>}
                    <p>Only returned report rows are shown. Missing dates do not establish zero usage. Credits are not reconstructed from prompts or tokens.</p>
                  </details>
                </td>
                <td><div className="github-tags">{user.features.map((feature) => <span key={feature}>{feature}</span>)}{!user.features.length && <span>No feature flags reported</span>}</div></td>
              </tr>)}</tbody></table>{!filteredUsers.length && <div className="empty-state">{data.user_metrics ? "No users match these filters." : "User metrics are unavailable."}</div>}</div>
            </>}
          </section>}
          <footer className="page-footer"><span>GitHub snapshot: {new Date(data.fetched_at).toLocaleString()} / server cache: {data.cache_seconds / 60} minutes</span><span>GitHub REST API / no OTLP data mixed in</span></footer>
        </>}
      </div>
    </section>
  </main>;
}
