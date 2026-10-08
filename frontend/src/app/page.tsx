"use client";

import {
  Activity,
  ArrowDownToLine,
  ArrowUpRight,
  Bot,
  Boxes,
  ChevronDown,
  CircleHelp,
  Clock3,
  Command,
  Cpu,
  LayoutDashboard,
  LoaderCircle,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  Users,
  Zap,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useEffect, useRef, useState } from "react";

type UsageRow = {
  date: string;
  user: string;
  agent: string;
  model: string;
  requests: number;
  input_tokens: number;
  output_tokens: number;
  cost: number;
  unpriced_requests: number;
};

type CatalogAgent = {
  id: string;
  name: string;
  description: string;
  plugin_id: string;
  plugin_name: string;
  version: string;
  path: string;
};

type CatalogResponse = {
  loaded_at: string | null;
  stale: boolean;
  error: string | null;
  agents: CatalogAgent[];
};

type View = "overview" | "agents" | "models" | "activity";
type Period = 7 | 30 | 90;
type DailyPoint = {
  date: string;
  label: string;
  input: number;
  output: number;
  requests: number;
  cost: number;
};

const API_BASE = (
  process.env.NEXT_PUBLIC_USAGE_API_URL || "http://127.0.0.1:4318"
).replace(/\/$/, "");

const numberFormat = new Intl.NumberFormat("en-US");

function formatCount(value: number) {
  return numberFormat.format(Math.round(value || 0));
}

function formatCompact(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value || 0);
}

function formatMoney(value: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 2,
    }).format(value || 0);
  } catch {
    return `${currency} ${(value || 0).toFixed(2)}`;
  }
}

function displayDate(date: string, options?: Intl.DateTimeFormatOptions) {
  return new Date(`${date}T00:00:00`).toLocaleDateString("en-US", options);
}

function getCsvValue(value: string | number) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

const navigation: { id: View; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "agents", label: "Agents", icon: Bot },
  { id: "models", label: "Models", icon: Cpu },
  { id: "activity", label: "Activity", icon: Activity },
];

export default function Home() {
  const [view, setView] = useState<View>("overview");
  const [period, setPeriod] = useState<Period>(30);
  const [selectedAgent, setSelectedAgent] = useState("all");
  const [selectedModel, setSelectedModel] = useState("all");
  const [search, setSearch] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [usageRows, setUsageRows] = useState<UsageRow[]>([]);
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [currency, setCurrency] = useState("USD");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function focusSearch(event: KeyboardEvent) {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      ) return;
      event.preventDefault();
      searchRef.current?.focus();
    }
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  useEffect(() => {
    let active = true;

    async function loadDashboard() {
      if (active) {
        setRefreshing(true);
      }
      try {
        const [usageResponse, agentResponse] = await Promise.all([
          fetch(`${API_BASE}/api/v1/usage`, { cache: "no-store" }),
          fetch(`${API_BASE}/api/v1/agents`, { cache: "no-store" }),
        ]);
        if (!usageResponse.ok || !agentResponse.ok) {
          throw new Error(
            `API request failed: usage ${usageResponse.status}, agents ${agentResponse.status}`,
          );
        }
        const [usagePayload, agentPayload] = await Promise.all([
          usageResponse.json(),
          agentResponse.json(),
        ]);
        if (!active) return;
        setUsageRows(Array.isArray(usagePayload.rows) ? usagePayload.rows : []);
        setCurrency(usagePayload.currency || "USD");
        setCatalog(agentPayload);
        setUpdatedAt(new Date());
        setError(null);
      } catch (loadError) {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Could not connect to the usage API.",
          );
        }
      } finally {
        if (active) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    }

    void loadDashboard();
    const interval = autoRefresh
      ? window.setInterval(() => void loadDashboard(), 30_000)
      : undefined;
    return () => {
      active = false;
      if (interval) window.clearInterval(interval);
    };
  }, [autoRefresh, refreshKey]);

  const cutoffDate = updatedAt
    ? new Date(
        Date.parse(`${updatedAt.toISOString().slice(0, 10)}T00:00:00Z`) -
          (period - 1) * 86_400_000,
      ).toISOString().slice(0, 10)
    : null;

  const filteredRows = usageRows.filter((row) => {
    const matchesPeriod = !cutoffDate || row.date >= cutoffDate;
    const matchesAgent = selectedAgent === "all" || row.agent === selectedAgent;
    const matchesModel = selectedModel === "all" || row.model === selectedModel;
    const query = search.trim().toLowerCase();
    const matchesSearch =
      !query ||
      [row.user, row.agent, row.model].some((value) =>
        value.toLowerCase().includes(query),
      );
    return matchesPeriod && matchesAgent && matchesModel && matchesSearch;
  });

  const totals = filteredRows.reduce(
    (summary, row) => ({
      requests: summary.requests + row.requests,
      input: summary.input + row.input_tokens,
      output: summary.output + row.output_tokens,
      cost: summary.cost + row.cost,
      unpriced: summary.unpriced + row.unpriced_requests,
    }),
    { requests: 0, input: 0, output: 0, cost: 0, unpriced: 0 },
  );

  const dailyMap = new Map<string, DailyPoint>();
  for (const row of filteredRows) {
    const point = dailyMap.get(row.date) || {
      date: row.date,
      label: displayDate(row.date, { month: "short", day: "numeric" }),
      input: 0,
      output: 0,
      requests: 0,
      cost: 0,
    };
    point.input += row.input_tokens;
    point.output += row.output_tokens;
    point.requests += row.requests;
    point.cost += row.cost;
    dailyMap.set(row.date, point);
  }
  const dailySeries = [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date));

  const modelMap = new Map<string, { model: string; calls: number; tokens: number; cost: number }>();
  for (const row of filteredRows) {
    const model = modelMap.get(row.model) || { model: row.model, calls: 0, tokens: 0, cost: 0 };
    model.calls += row.requests;
    model.tokens += row.input_tokens + row.output_tokens;
    model.cost += row.cost;
    modelMap.set(row.model, model);
  }
  const modelRows = [...modelMap.values()].sort((a, b) => b.tokens - a.tokens);
  const agentMap = new Map<string, number>();
  for (const row of filteredRows) {
    agentMap.set(row.agent, (agentMap.get(row.agent) || 0) + row.requests);
  }
  const agentNames = [...new Set(usageRows.map((row) => row.agent))].sort();
  const modelNames = [...new Set(usageRows.map((row) => row.model))].sort();
  const activeLabel = navigation.find((item) => item.id === view)?.label || "Overview";

  function exportCsv() {
    const columns: (keyof UsageRow)[] = [
      "date",
      "user",
      "agent",
      "model",
      "requests",
      "input_tokens",
      "output_tokens",
      "cost",
      "unpriced_requests",
    ];
    const csv = [
      columns.map(getCsvValue).join(","),
      ...filteredRows.map((row) => columns.map((column) => getCsvValue(row[column])).join(",")),
    ].join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    link.download = "copilot-usage.csv";
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#overview" onClick={() => setView("overview")}>
          <span className="brand-mark"><Command size={19} strokeWidth={2.4} /></span>
          <span className="brand-copy"><strong>signal</strong><small>USAGE INTELLIGENCE</small></span>
        </a>

        <div className="workspace-label">WORKSPACE</div>
        <div className="workspace-switcher">
          <span className="workspace-avatar">A</span>
          <span className="workspace-name"><strong>All activity</strong><small>Local workspace</small></span>
          <ChevronDown size={15} />
        </div>

        <div className="nav-label">ANALYTICS</div>
        <nav className="primary-nav" aria-label="Dashboard sections">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button
              className={`nav-item ${view === id ? "active" : ""}`}
              aria-label={label}
              title={label}
              key={id}
              onClick={() => setView(id)}
              type="button"
            >
              <Icon size={18} strokeWidth={1.8} />
              <span>{label}</span>
              {id === "agents" && <span className="nav-count">{catalog?.agents.length ?? 0}</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="source-card">
            <div className="source-card-top"><span className="source-pulse" /> RECEIVER</div>
            <strong>{error ? "Connection issue" : "API connected"}</strong>
            <small>{API_BASE.replace(/^https?:\/\//, "")}</small>
          </div>
          <a className="help-link" href={`${API_BASE}/docs`} target="_blank" rel="noreferrer">
            <CircleHelp size={16} /> API reference <ArrowUpRight size={13} />
          </a>
          <div className="sidebar-foot"><span>LOCAL INSTANCE</span><span>v1.0</span></div>
        </div>
      </aside>

      <section className="main-panel">
        <header className="topbar">
          <div className="breadcrumb"><span>ANALYTICS</span><span className="breadcrumb-slash">/</span><strong>{activeLabel}</strong></div>
          <div className="topbar-actions">
            <span className={`connection-status ${error ? "offline" : ""}`}>
              <span className="status-dot" /> {error ? "API issue" : "Live data"}
            </span>
            <button
              className="icon-button refresh-button"
              onClick={() => setRefreshKey((key) => key + 1)}
              title="Refresh data"
              aria-label="Refresh data"
              type="button"
              disabled={refreshing}
            >
              <RefreshCw size={16} className={refreshing ? "spin" : ""} />
            </button>
            <div className="profile-button" aria-label="Current user">
              <span>AZ</span><ChevronDown size={13} />
            </div>
          </div>
        </header>

        <div className="content-wrap">
          <div className="page-heading">
            <div>
              <div className="eyebrow"><Sparkles size={13} /> COPILOT TELEMETRY</div>
              <h1>{view === "overview" ? "Usage overview" : `${activeLabel} overview`}</h1>
              <p>Understand where your team’s AI work is going.</p>
            </div>
            <div className="heading-meta">
              <div className="period-control" role="group" aria-label="Date range">
                {([7, 30, 90] as Period[]).map((days) => (
                  <button
                    className={period === days ? "selected" : ""}
                    key={days}
                    onClick={() => setPeriod(days)}
                    type="button"
                  >
                    {days}D
                  </button>
                ))}
              </div>
              <button className="export-button" onClick={exportCsv} type="button" disabled={!filteredRows.length}>
                <ArrowDownToLine size={15} /> <span>Export</span>
              </button>
            </div>
          </div>

          {error && (
            <div className="error-banner" role="alert">
              <ShieldAlert size={17} />
              <div><strong>Can’t reach the usage API</strong><span>{error}</span></div>
              <button onClick={() => setRefreshKey((key) => key + 1)} type="button">Retry</button>
            </div>
          )}

          {catalog?.stale && (
            <div className="stale-banner"><Clock3 size={15} /> Showing the last saved agent catalog; its refresh failed.</div>
          )}

          <section className="filter-row" aria-label="Usage filters">
            <label className="search-field">
              <Search size={16} />
              <input
                aria-label="Search usage"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search user, agent, model"
                ref={searchRef}
                value={search}
              />
              <kbd>/</kbd>
            </label>
            <label className="select-filter">
              <Users size={15} />
              <select aria-label="Filter by agent" onChange={(event) => setSelectedAgent(event.target.value)} value={selectedAgent}>
                <option value="all">All agents</option>
                {agentNames.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
              <ChevronDown size={14} />
            </label>
            <label className="select-filter model-filter">
              <Cpu size={15} />
              <select aria-label="Filter by model" onChange={(event) => setSelectedModel(event.target.value)} value={selectedModel}>
                <option value="all">All models</option>
                {modelNames.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
              <ChevronDown size={14} />
            </label>
            <label className="auto-refresh-control">
              <input checked={autoRefresh} onChange={(event) => setAutoRefresh(event.target.checked)} type="checkbox" />
              <span className="toggle-track"><span /></span>
              <span>Auto-refresh</span>
            </label>
          </section>

          <section className="metric-grid" aria-label="Usage totals">
            <article className="metric-card metric-highlight">
              <div className="metric-label">LLM CALLS <Zap size={14} /></div>
              <div className="metric-value">{loading ? "—" : formatCount(totals.requests)}</div>
              <div className="metric-foot"><span className="metric-mark lime-mark" /> requests in the last {period} days</div>
            </article>
            <article className="metric-card">
              <div className="metric-label">TOTAL TOKENS <Boxes size={14} /></div>
              <div className="metric-value">{loading ? "—" : formatCompact(totals.input + totals.output)}</div>
              <div className="metric-foot"><span className="metric-mark blue-mark" /> {formatCompact(totals.input)} in <span className="metric-separator">/</span> {formatCompact(totals.output)} out</div>
            </article>
            <article className="metric-card">
              <div className="metric-label">ESTIMATED COST <Activity size={14} /></div>
              <div className="metric-value">{loading ? "—" : formatMoney(totals.cost, currency)}</div>
              <div className="metric-foot">Model-rate estimate · {currency}</div>
            </article>
            <article className="metric-card">
              <div className="metric-label">UNPRICED CALLS <ShieldAlert size={14} /></div>
              <div className="metric-value">{loading ? "—" : formatCount(totals.unpriced)}</div>
              <div className="metric-foot">{totals.unpriced ? "Rates needed for full cost" : "All calls have a configured rate"}</div>
            </article>
          </section>

          {view === "overview" && (
            <>
              <section className="overview-grid">
                <article className="panel trend-panel">
                  <div className="panel-heading">
                    <div><div className="section-kicker">ACTIVITY</div><h2>Token consumption</h2></div>
                    <div className="chart-legend"><span><i className="legend-input" /> Input</span><span><i className="legend-output" /> Output</span></div>
                  </div>
                  {dailySeries.length ? (
                    <div className="chart-frame">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={dailySeries} margin={{ top: 12, right: 8, left: -12, bottom: 0 }}>
                          <defs>
                            <linearGradient id="inputFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#5488e8" stopOpacity={0.22} /><stop offset="100%" stopColor="#5488e8" stopOpacity={0} /></linearGradient>
                            <linearGradient id="outputFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#df7057" stopOpacity={0.19} /><stop offset="100%" stopColor="#df7057" stopOpacity={0} /></linearGradient>
                          </defs>
                          <CartesianGrid stroke="#e9e9e2" vertical={false} />
                          <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "#858a84", fontSize: 11 }} minTickGap={24} />
                          <YAxis axisLine={false} tickLine={false} tick={{ fill: "#858a84", fontSize: 11 }} tickFormatter={formatCompact} />
                          <Tooltip contentStyle={{ border: "1px solid #e7e8df", borderRadius: 6, boxShadow: "0 8px 25px #18211d12" }} formatter={(value, name) => [formatCount(Number(value)), name === "input" ? "Input tokens" : "Output tokens"]} labelStyle={{ color: "#343934", fontWeight: 700 }} />
                          <Area type="monotone" dataKey="input" name="input" stroke="#5488e8" strokeWidth={2.2} fill="url(#inputFill)" activeDot={{ r: 4, strokeWidth: 0 }} />
                          <Area type="monotone" dataKey="output" name="output" stroke="#df7057" strokeWidth={2.2} fill="url(#outputFill)" activeDot={{ r: 4, strokeWidth: 0 }} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  ) : <EmptyState loading={loading} label="No token activity in this date range." />}
                  <div className="chart-bottomline"><span><i className="dot-blue" /> {formatCount(totals.input)} input tokens</span><span><i className="dot-coral" /> {formatCount(totals.output)} output tokens</span><span className="chart-period">{period}-DAY WINDOW</span></div>
                </article>

                <article className="panel model-panel">
                  <div className="panel-heading"><div><div className="section-kicker">DISTRIBUTION</div><h2>Model mix</h2></div><button className="text-link" onClick={() => setView("models")} type="button">View all <ArrowUpRight size={13} /></button></div>
                  {modelRows.length ? (
                    <div className="model-list">
                      {modelRows.slice(0, 5).map((model, index) => (
                        <div className="model-row" key={model.model}>
                          <div className={`model-index model-index-${index % 4}`}>{String(index + 1).padStart(2, "0")}</div>
                          <div className="model-details"><div className="model-name-line"><strong title={model.model}>{model.model}</strong><span>{formatCompact(model.tokens)}</span></div><div className="model-bar"><span style={{ width: `${Math.max(4, (model.tokens / (modelRows[0]?.tokens || 1)) * 100)}%` }} /></div></div>
                        </div>
                      ))}
                    </div>
                  ) : <EmptyState loading={loading} label="Model usage appears here." />}
                  <div className="model-panel-footer"><span>{modelRows.length} MODELS IN RANGE</span><span>{formatMoney(totals.cost, currency)} TOTAL</span></div>
                </article>
              </section>

              <section className="panel bottom-panel">
                <div className="panel-heading bottom-panel-heading">
                  <div><div className="section-kicker">WORKLOAD</div><h2>Agent activity</h2></div>
                  <button className="text-link" onClick={() => setView("agents")} type="button">All agents <ArrowUpRight size={13} /></button>
                </div>
                <AgentTable agents={catalog?.agents || []} usage={filteredRows} currency={currency} compact />
              </section>
              <RecentActivity rows={filteredRows} onViewAll={() => setView("activity")} />
            </>
          )}

          {view === "agents" && (
            <section className="panel full-panel">
              <div className="panel-heading"><div><div className="section-kicker">MARKETPLACE INVENTORY</div><h2>Agents and tracked usage</h2></div><span className="inventory-count">{catalog?.agents.length ?? 0} LISTED</span></div>
              <AgentTable agents={catalog?.agents || []} usage={filteredRows} currency={currency} />
              {!!catalog?.error && <p className="table-note">Catalog refresh issue: {catalog.error}</p>}
            </section>
          )}

          {view === "models" && (
            <section className="panel full-panel">
              <div className="panel-heading"><div><div className="section-kicker">MODEL PERFORMANCE</div><h2>Usage by model</h2></div><span className="inventory-count">{modelRows.length} MODELS</span></div>
              <div className="table-scroll"><table className="data-table"><thead><tr><th>MODEL</th><th>CALLS</th><th>TOKENS</th><th>EST. COST</th><th>SHARE</th></tr></thead><tbody>
                {modelRows.map((model) => <tr key={model.model}><td><span className="model-cell-dot" />{model.model}</td><td>{formatCount(model.calls)}</td><td>{formatCount(model.tokens)}</td><td>{formatMoney(model.cost, currency)}</td><td><div className="share-bar"><span style={{ width: `${totals.input + totals.output ? (model.tokens / (totals.input + totals.output)) * 100 : 0}%` }} /></div></td></tr>)}
              </tbody></table>{!modelRows.length && <EmptyState loading={loading} label="No model usage in this date range." />}</div>
            </section>
          )}

          {view === "activity" && <ActivityTable rows={filteredRows} loading={loading} currency={currency} />}

          <footer className="page-footer"><span><span className="footer-status" /> RECEIVER {error ? "UNAVAILABLE" : "OPERATIONAL"}</span><span>{updatedAt ? `LAST SYNC ${updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "WAITING FOR DATA"}</span></footer>
        </div>
      </section>
    </main>
  );
}

function EmptyState({ loading, label }: { loading: boolean; label: string }) {
  return <div className="empty-state">{loading ? <LoaderCircle className="spin" size={18} /> : <span className="empty-dash">—</span>}<span>{loading ? "Loading usage" : label}</span></div>;
}

function AgentTable({ agents, usage, currency, compact = false }: { agents: CatalogAgent[]; usage: UsageRow[]; currency: string; compact?: boolean }) {
  const metrics = new Map<string, { requests: number; tokens: number; cost: number; unpriced: number }>();
  const observedNames = new Map<string, string>();
  for (const row of usage) {
    const agentKey = row.agent.trim().toLocaleLowerCase();
    const current = metrics.get(agentKey) || { requests: 0, tokens: 0, cost: 0, unpriced: 0 };
    current.requests += row.requests;
    current.tokens += row.input_tokens + row.output_tokens;
    current.cost += row.cost;
    current.unpriced += row.unpriced_requests;
    metrics.set(agentKey, current);
    observedNames.set(agentKey, row.agent);
  }
  const visibleAgents = compact ? agents.slice(0, 6) : agents;
  const catalogNames = new Set(
    agents.flatMap((agent) => [agent.name, agent.id].map((name) => name.trim().toLocaleLowerCase())),
  );
  const unlistedAgents = [...metrics.entries()]
    .filter(([key]) => !catalogNames.has(key))
    .sort((a, b) => b[1].requests - a[1].requests);
  const visibleUnlisted = compact ? unlistedAgents.slice(0, 4) : unlistedAgents;
  return (
    <div className="table-scroll"><table className="data-table agent-table"><thead><tr><th>AGENT</th><th>PLUGIN</th><th>CALLS</th><th>TOKENS</th><th>EST. COST</th><th>STATUS</th></tr></thead><tbody>
      {visibleAgents.map((agent, index) => {
        const key = [agent.name, agent.id]
          .map((candidate) => candidate.trim().toLocaleLowerCase())
          .find((candidate) => metrics.has(candidate));
        const measure = key ? metrics.get(key) : undefined;
        return <tr key={`${agent.plugin_id}-${agent.id}-${index}`}>
          <td><span className={`agent-avatar agent-avatar-${index % 4}`}><Bot size={16} /></span><span className="agent-name-cell"><strong>{agent.name}</strong><small>{agent.description}</small></span></td>
          <td><span className="plugin-name">{agent.plugin_name || agent.plugin_id || "—"}</span><small className="plugin-version">{agent.version ? `v${agent.version}` : ""}</small></td>
          <td>{formatCount(measure?.requests || 0)}</td><td>{formatCompact(measure?.tokens || 0)}</td><td>{formatMoney(measure?.cost || 0, currency)}</td>
          <td><span className={`usage-badge ${measure ? "used" : "unused"}`}><span />{measure ? "Tracked" : "No usage"}</span></td>
        </tr>;
      })}
      {visibleUnlisted.map(([key, measure]) => <tr key={`tracked-${key}`}>
        <td><span className="agent-avatar agent-avatar-3"><Activity size={16} /></span><span className="agent-name-cell"><strong>{observedNames.get(key) || key}</strong><small>Observed in usage telemetry</small></span></td>
        <td><span className="plugin-name">Not in marketplace</span></td>
        <td>{formatCount(measure.requests)}</td><td>{formatCompact(measure.tokens)}</td><td>{formatMoney(measure.cost, currency)}</td>
        <td><span className="usage-badge used"><span />Tracked</span></td>
      </tr>)}
    </tbody></table>{!visibleAgents.length && <EmptyState loading={false} label="No marketplace agents found." />}</div>
  );
}

function RecentActivity({ rows, onViewAll }: { rows: UsageRow[]; onViewAll: () => void }) {
  const recent = [...rows].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  return (
    <section className="recent-section">
      <div className="panel-heading"><div><div className="section-kicker">LATEST RECORDED</div><h2>Recent activity</h2></div><button className="text-link" onClick={onViewAll} type="button">Full activity <ArrowUpRight size={13} /></button></div>
      {recent.length ? <div className="recent-list">{recent.map((row, index) => <div className="recent-row" key={`${row.date}-${row.agent}-${row.model}-${index}`}><span className={`recent-icon recent-icon-${index % 3}`}><Zap size={15} /></span><div className="recent-copy"><strong>{row.agent}</strong><small>{row.model} · {row.user}</small></div><span className="recent-tokens">{formatCompact(row.input_tokens + row.output_tokens)} <small>tokens</small></span><span className="recent-cost">${row.cost.toFixed(4)}</span><time>{displayDate(row.date, { month: "short", day: "numeric" })}</time></div>)}</div> : <EmptyState loading={false} label="No activity found for these filters." />}
    </section>
  );
}

function ActivityTable({ rows, loading, currency }: { rows: UsageRow[]; loading: boolean; currency: string }) {
  const sortedRows = [...rows].sort((a, b) => b.date.localeCompare(a.date));
  return <section className="panel full-panel"><div className="panel-heading"><div><div className="section-kicker">EVENT LEDGER</div><h2>Recorded requests</h2></div><span className="inventory-count">{formatCount(rows.length)} ROWS</span></div>
    <div className="table-scroll"><table className="data-table"><thead><tr><th>DATE</th><th>USER</th><th>AGENT</th><th>MODEL</th><th>CALLS</th><th>INPUT</th><th>OUTPUT</th><th>COST</th></tr></thead><tbody>{sortedRows.map((row, index) => <tr key={`${row.date}-${row.user}-${row.agent}-${row.model}-${index}`}><td>{displayDate(row.date, { month: "short", day: "numeric", year: "numeric" })}</td><td>{row.user}</td><td>{row.agent}</td><td>{row.model}</td><td>{formatCount(row.requests)}</td><td>{formatCount(row.input_tokens)}</td><td>{formatCount(row.output_tokens)}</td><td>{formatMoney(row.cost, currency)}</td></tr>)}</tbody></table>{!rows.length && <EmptyState loading={loading} label="No activity in this date range." />}</div>
  </section>;
}
