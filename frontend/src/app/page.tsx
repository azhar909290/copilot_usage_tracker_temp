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
  GitBranch,
  LayoutDashboard,
  LoaderCircle,
  Moon,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  Sun,
  Users,
  X,
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
import Link from "next/link";
import { useDashboardTheme } from "./theme";

type UsageRow = {
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
};

type CallEvent = {
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

type CatalogAgent = {
  id: string;
  name: string;
  description: string;
  plugin_id: string;
  plugin_name: string;
  version: string;
  path: string;
  kind?: "agent" | "skill_package";
  skills?: string[];
};

type CatalogResponse = {
  loaded_at: string | null;
  stale: boolean;
  error: string | null;
  agents: CatalogAgent[];
};

type View = "overview" | "users" | "agents" | "models" | "activity";
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

function displayCallTime(timestamp: string | null | undefined) {
  if (!timestamp) return "Time unavailable";
  return new Date(timestamp).toLocaleString("en-US", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short",
  });
}

function compareLatest(a: UsageRow, b: UsageRow) {
  return Date.parse(b.last_seen || `${b.date}T00:00:00Z`) -
    Date.parse(a.last_seen || `${a.date}T00:00:00Z`);
}

function getCsvValue(value: string | number | null | undefined) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

const navigation: { id: View; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "overview", label: "Command Center", icon: LayoutDashboard },
  { id: "users", label: "Users", icon: Users },
  { id: "agents", label: "Catalog", icon: Boxes },
  { id: "models", label: "Models", icon: Cpu },
  { id: "activity", label: "Activity", icon: Activity },
];

export default function Home() {
  const [view, setView] = useState<View>("overview");
  const [period, setPeriod] = useState<Period>(30);
  const [selectedUser, setSelectedUser] = useState("all");
  const [selectedAgent, setSelectedAgent] = useState("all");
  const [selectedModel, setSelectedModel] = useState("all");
  const [search, setSearch] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [usageRows, setUsageRows] = useState<UsageRow[]>([]);
  const [callEvents, setCallEvents] = useState<CallEvent[]>([]);
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [currency, setCurrency] = useState("USD");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const paletteRef = useRef<HTMLDialogElement>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const { theme, toggleTheme } = useDashboardTheme();

  useEffect(() => {
    if (paletteOpen) paletteRef.current?.showModal();
    else paletteRef.current?.close();
  }, [paletteOpen]);

  useEffect(() => {
    function focusSearch(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandQuery("");
        setPaletteOpen((open) => !open);
        return;
      }
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
        const rows = Array.isArray(usagePayload.rows) ? usagePayload.rows : [];
        setUsageRows(rows);
        setCurrency(usagePayload.currency || "USD");
        setCatalog(agentPayload);
        if (Array.isArray(usagePayload.events) && usagePayload.events.length > 0) {
          setCallEvents(usagePayload.events);
        } else {
          setCallEvents(
            rows.map((r: UsageRow, i: number) => ({
              key: `${r.date}-${r.user}-${r.agent}-${r.model}-${i}`,
              timestamp: r.last_seen || r.first_seen || `${r.date}T00:00:00Z`,
              date: r.date,
              user: r.user,
              agent: r.agent,
              model: r.model,
              input_tokens: r.input_tokens,
              output_tokens: r.output_tokens,
              total_tokens: (r.input_tokens || 0) + (r.output_tokens || 0),
              latency_ms: (r as any).latency_ms_avg ?? null,
              cost: r.cost,
            }))
          );
        }
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
    const matchesUser = selectedUser === "all" || row.user === selectedUser;
    const matchesAgent = selectedAgent === "all" || row.agent === selectedAgent;
    const matchesModel = selectedModel === "all" || row.model === selectedModel;
    const query = search.trim().toLowerCase();
    const matchesSearch =
      !query ||
      [row.date, row.user, row.agent, row.model].some((value) =>
        value.toLowerCase().includes(query),
      );
    return matchesPeriod && matchesUser && matchesAgent && matchesModel && matchesSearch;
  });

  const filteredEvents = callEvents.filter((event) => {
    const matchesPeriod = !cutoffDate || event.date >= cutoffDate;
    const matchesUser = selectedUser === "all" || event.user === selectedUser;
    const matchesAgent = selectedAgent === "all" || event.agent === selectedAgent;
    const matchesModel = selectedModel === "all" || event.model === selectedModel;
    const query = search.trim().toLowerCase();
    const matchesSearch =
      !query ||
      [event.date, event.user, event.agent, event.model, event.timestamp].some((value) =>
        value.toLowerCase().includes(query),
      );
    return matchesPeriod && matchesUser && matchesAgent && matchesModel && matchesSearch;
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
  const activeUsers = new Set(
    filteredRows
      .map((row) => row.user)
      .filter((user) => user.trim().toLowerCase() !== "unknown"),
  ).size;
  const modelsUsed = new Set(filteredRows.map((row) => row.model)).size;

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
  const agentNames = [...new Set([...usageRows.map((row) => row.agent), ...callEvents.map((e) => e.agent)])].sort();
  const modelNames = [...new Set([...usageRows.map((row) => row.model), ...callEvents.map((e) => e.model)])].sort();
  const userNames = [...new Set([...usageRows.map((row) => row.user), ...callEvents.map((e) => e.user)])].sort();
  const activeLabel = navigation.find((item) => item.id === view)?.label || "Overview";
  const commands = [
    ...navigation.map((item) => ({
      label: item.label, kind: "View", icon: item.icon,
      run: () => setView(item.id),
    })),
    ...agentNames.map((name) => ({
      label: name, kind: "Agent", icon: Bot,
      run: () => { setView("agents"); setSelectedAgent(name); setSelectedUser("all"); setSelectedModel("all"); setSearch(""); },
    })),
    ...userNames.map((name) => ({
      label: name, kind: "User", icon: Users,
      run: () => { setView("users"); setSelectedUser(name); setSelectedAgent("all"); setSelectedModel("all"); setSearch(""); },
    })),
    { label: "Refresh data", kind: "Action", icon: RefreshCw, run: () => setRefreshKey((key) => key + 1) },
    { label: theme === "dark" ? "Switch to light mode" : "Switch to dark mode", kind: "Action", icon: Sun, run: toggleTheme },
    { label: "Clear filters", kind: "Action", icon: X, run: () => { setSelectedUser("all"); setSelectedAgent("all"); setSelectedModel("all"); setSearch(""); } },
  ].filter((item) => item.label.toLowerCase().includes(commandQuery.trim().toLowerCase())).slice(0, 12);

  function runCommand(command: (typeof commands)[number]) {
    command.run();
    setPaletteOpen(false);
  }

  function exportCsv() {
    if (view === "activity") {
      const columns: (keyof CallEvent)[] = [
        "timestamp",
        "date",
        "user",
        "agent",
        "model",
        "input_tokens",
        "output_tokens",
        "total_tokens",
        "latency_ms",
        "cost",
      ];
      const csv = [
        columns.map(getCsvValue).join(","),
        ...filteredEvents.map((event) =>
          columns
            .map((column) =>
              column === "total_tokens"
                ? getCsvValue((event.input_tokens || 0) + (event.output_tokens || 0))
                : getCsvValue(event[column])
            )
            .join(",")
        ),
      ].join("\n");
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      link.download = "copilot-call-activity.csv";
      link.click();
      URL.revokeObjectURL(link.href);
      return;
    }
    const columns: (keyof UsageRow)[] = [
      "date",
      "first_seen",
      "last_seen",
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
          <span className="brand-copy"><strong>Agent Command</strong><small>CENTER</small></span>
        </a>

        <div className="workspace-label">WORKSPACE</div>
        <div className="workspace-switcher">
          <span className="workspace-avatar">A</span>
          <span className="workspace-name"><strong>Team workspace</strong><small>Copilot usage</small></span>
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
              {id === "users" && <span className="nav-count">{userNames.length}</span>}
            </button>
          ))}
          <Link className="nav-item github-nav-link" href="/github-metrics" aria-label="GitHub Metrics" title="GitHub Metrics">
            <GitBranch size={18} strokeWidth={1.8} /><span>GitHub Metrics</span>
          </Link>
        </nav>

        <div className="sidebar-bottom">
          <div className="source-card">
            <div className="source-card-top"><span className="source-pulse" /> RECEIVER</div>
            <strong>{error ? "Connection issue" : updatedAt ? "Live backend" : "Connecting"}</strong>
            <small>{API_BASE.replace(/^https?:\/\//, "")}</small>
          </div>
          <a className="help-link" href={`${API_BASE}/docs`} target="_blank" rel="noreferrer">
            <CircleHelp size={16} /> API reference <ArrowUpRight size={13} />
          </a>
          <div className="sidebar-foot"><span>COPILOT OBSERVABILITY</span></div>
        </div>
      </aside>

      <section className="main-panel">
        <header className="topbar">
          <button className="command-search" onClick={() => { setCommandQuery(""); setPaletteOpen(true); }} type="button" aria-label="Open command search">
            <Search size={17} /><span>Search agents, users, pages...</span><Command size={13} />
          </button>
          <div className="topbar-actions">
            <span className="updated-label">{updatedAt ? `Updated ${updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Connecting"}</span>
            <span className={`connection-status ${error ? "offline" : ""}`}>
              <span className="status-dot" /> {error ? "API issue" : updatedAt ? "Live data" : "Connecting"}
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
            <button className="icon-button" onClick={toggleTheme} type="button" title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}>
              {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
            </button>
          </div>
        </header>

        <div className="content-wrap">
          <div className="page-heading">
            <div>
              <div className="eyebrow"><Sparkles size={13} /> COPILOT TELEMETRY</div>
              <h1>{activeLabel}</h1>
              <p>{selectedUser === "all" ? "Team workspace" : selectedUser} / Last {period} days</p>
            </div>
            <div className="heading-meta">
              <div className="period-control" role="group" aria-label="Date range">
                {([7, 30, 90] as Period[]).map((days) => (
                  <button
                    className={period === days ? "selected" : ""}
                    aria-pressed={period === days}
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
                placeholder="Search date, user, agent, model"
                ref={searchRef}
                value={search}
              />
            </label>
            <label className="select-filter">
              <Users size={15} />
              <select aria-label="Filter by user" onChange={(event) => setSelectedUser(event.target.value)} value={selectedUser}>
                <option value="all">All users</option>
                {userNames.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
              <ChevronDown size={14} />
            </label>
            <label className="select-filter">
              <Bot size={15} />
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

          {view === "overview" && (
            <>
              <section className="metric-grid" aria-label="Usage totals">
                <article className="metric-card metric-highlight">
                  <div className="metric-label">AGENT CALLS <Zap size={14} /></div>
                  <div className="metric-value">{loading ? "—" : formatCount(totals.requests)}</div>
                  <div className="metric-foot"><span className="metric-mark lime-mark" /> requests in the current results</div>
                </article>
                <article className="metric-card">
                  <div className="metric-label">TOTAL TOKENS <Boxes size={14} /></div>
                  <div className="metric-value">{loading ? "—" : formatCompact(totals.input + totals.output)}</div>
                  <div className="metric-foot"><span className="metric-mark blue-mark" /> {formatCompact(totals.input)} in <span className="metric-separator">/</span> {formatCompact(totals.output)} out</div>
                </article>
                <article className="metric-card">
                  <div className="metric-label">ACTIVE USERS <Users size={14} /></div>
                  <div className="metric-value">{loading ? "—" : formatCount(activeUsers)}</div>
                  <div className="metric-foot">Known users in the current results</div>
                </article>
                <article className="metric-card">
                  <div className="metric-label">MODELS USED <Cpu size={14} /></div>
                  <div className="metric-value">{loading ? "—" : formatCount(modelsUsed)}</div>
                  <div className="metric-foot">Distinct models in the current results</div>
                </article>
              </section>

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
                          <CartesianGrid stroke="var(--line)" vertical={false} />
                          <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "#858a84", fontSize: 11 }} minTickGap={24} />
                          <YAxis axisLine={false} tickLine={false} tick={{ fill: "#858a84", fontSize: 11 }} tickFormatter={formatCompact} />
                          <Tooltip contentStyle={{ background: "var(--surface)", color: "var(--ink)", border: "1px solid var(--line)", borderRadius: 6 }} formatter={(value, name) => [formatCount(Number(value)), name === "input" ? "Input tokens" : "Output tokens"]} labelStyle={{ color: "var(--ink)", fontWeight: 700 }} />
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

              <UsageHeatmap rows={filteredRows} period={period} endDate={updatedAt?.toISOString().slice(0, 10) ?? null} onSelect={(date) => { setSearch(date); setView("activity"); }} />
              <section className="panel bottom-panel">
                <div className="panel-heading bottom-panel-heading">
                  <div><div className="section-kicker">WORKLOAD</div><h2>Agent activity</h2></div>
                  <button className="text-link" onClick={() => setView("agents")} type="button">All agents <ArrowUpRight size={13} /></button>
                </div>
                <AgentTable agents={catalog?.agents || []} usage={filteredRows} currency={currency} compact />
              </section>
              <RecentActivity events={filteredEvents} rows={filteredRows} onViewAll={() => setView("activity")} />
            </>
          )}

          {view === "agents" && (
            <section className="panel full-panel">
              <div className="panel-heading"><div><div className="section-kicker">MARKETPLACE INVENTORY</div><h2>Agents, skill packages, and tracked usage</h2></div><span className="inventory-count">{catalog?.agents.length ?? 0} ITEMS LISTED</span></div>
              <AgentTable agents={catalog?.agents || []} usage={filteredRows} currency={currency} />
              {!!catalog?.error && <p className="table-note">Catalog refresh issue: {catalog.error}</p>}
            </section>
          )}

          {view === "users" && (
            <section className="panel full-panel">
              <div className="panel-heading"><div><div className="section-kicker">TEAM USAGE</div><h2>Usage by user</h2></div><span className="inventory-count">{userNames.length} USERS</span></div>
              <UserTable rows={filteredRows} currency={currency} />
            </section>
          )}

          {view === "models" && (
            <section className="panel full-panel">
              <div className="panel-heading"><div><div className="section-kicker">MODEL PERFORMANCE</div><h2>Usage by model</h2></div><span className="inventory-count">{modelRows.length} MODELS</span></div>
              <ModelTable rows={modelRows} totals={totals} currency={currency} loading={loading} />
            </section>
          )}

          {view === "activity" && <ActivityTable events={filteredEvents} loading={loading} currency={currency} />}

          <footer className="page-footer"><span><span className="footer-status" /> RECEIVER {error ? "UNAVAILABLE" : "OPERATIONAL"}</span><span>{updatedAt ? `LAST SYNC ${updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "WAITING FOR DATA"}</span></footer>
        </div>
      </section>
      <dialog ref={paletteRef} className="command-dialog" onCancel={() => setPaletteOpen(false)} onClick={(event) => { if (event.target === event.currentTarget) setPaletteOpen(false); }} aria-label="Command search">
        <div className="command-dialog-inner">
          <div className="command-input-row"><Search size={19} /><input autoFocus aria-label="Search commands" placeholder="Search agents, users, pages..." value={commandQuery} onChange={(event) => setCommandQuery(event.target.value)} onKeyDown={(event) => {
            if (event.key === "Enter" && commands[0]) { event.preventDefault(); runCommand(commands[0]); }
            if (event.key === "ArrowDown") { event.preventDefault(); paletteRef.current?.querySelector<HTMLButtonElement>(".command-result")?.focus(); }
          }} /><button type="button" className="icon-button" title="Close search" aria-label="Close search" onClick={() => setPaletteOpen(false)}><X size={17} /></button></div>
          <div className="command-results" onKeyDown={(event) => {
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
            event.preventDefault();
            const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>(".command-result"));
            const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
            buttons[(currentIndex + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
          }}>
            {commands.map((command) => <button type="button" className="command-result" key={`${command.kind}-${command.label}`} onClick={() => runCommand(command)}><command.icon size={18} /><span>{command.label}</span><small>{command.kind}</small><ArrowUpRight size={14} /></button>)}
            {!commands.length && <div className="empty-state">No matches</div>}
          </div>
        </div>
      </dialog>
    </main>
  );
}

function UsageHeatmap({ rows, period, endDate, onSelect }: { rows: UsageRow[]; period: Period; endDate: string | null; onSelect: (date: string) => void }) {
  if (!endDate) return null;
  const end = Date.parse(`${endDate}T00:00:00Z`);
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.date, (counts.get(row.date) || 0) + row.requests);
  const maximum = Math.max(1, ...counts.values());
  const start = end - (period - 1) * 86_400_000;
  const offset = new Date(start).getUTCDay();
  const cells = Array.from({ length: offset + period }, (_, index) => {
    if (index < offset) return <span className="heatmap-spacer" key={`spacer-${index}`} />;
    const date = new Date(start + (index - offset) * 86_400_000).toISOString().slice(0, 10);
    const count = counts.get(date) || 0;
    const level = count ? Math.max(1, Math.ceil(count / maximum * 4)) : 0;
    return <button className={`heatmap-cell level-${level}`} key={date} type="button" title={`${date}: ${formatCount(count)} calls`} aria-label={`${date}: ${formatCount(count)} calls`} onClick={() => onSelect(date)} />;
  });
  return <section className="heatmap-section"><div className="panel-heading"><div><div className="section-kicker">DAILY PULSE</div><h2>Activity calendar</h2></div><span className="inventory-count">{counts.size} ACTIVE DAYS</span></div><div className="heatmap-layout"><div className="heatmap-day-labels"><span>Sun</span><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span></div><div className="heatmap-grid">{cells}</div><div className="heatmap-summary"><strong>{formatCount(rows.reduce((total, row) => total + row.requests, 0))}</strong><span>calls / {period} days</span><div className="heatmap-legend"><span>Less</span>{[0, 1, 2, 3, 4].map((level) => <i key={level} className={`heatmap-cell level-${level}`} />)}<span>More</span></div></div></div></section>;
}

function EmptyState({ loading, label }: { loading: boolean; label: string }) {
  return <div className="empty-state">{loading ? <LoaderCircle className="spin" size={18} /> : <span className="empty-dash">—</span>}<span>{loading ? "Loading usage" : label}</span></div>;
}

function ModelTable({
  rows,
  totals,
  currency,
  loading,
}: {
  rows: { model: string; calls: number; tokens: number; cost: number }[];
  totals: { input: number; output: number };
  currency: string;
  loading: boolean;
}) {
  type ModelSortKey = "model" | "calls" | "tokens" | "cost" | "share";
  const [sort, setSort] = useState<{ key: ModelSortKey; direction: "asc" | "desc" }>({
    key: "tokens",
    direction: "desc",
  });

  const totalTokens = totals.input + totals.output;
  const modelItems = rows.map((m) => ({
    ...m,
    share: totalTokens ? (m.tokens / totalTokens) * 100 : 0,
  }));

  const sortedModels = [...modelItems].sort((a, b) => {
    const left = a[sort.key];
    const right = b[sort.key];
    const result =
      typeof left === "number" && typeof right === "number"
        ? left - right
        : String(left).localeCompare(String(right));
    return sort.direction === "asc" ? result : -result;
  });

  const sortHeader = (key: ModelSortKey, label: string) => (
    <th aria-sort={sort.key === key ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}>
      <button
        className="activity-sort-button"
        onClick={() =>
          setSort((current) => ({
            key,
            direction:
              current.key === key
                ? current.direction === "asc"
                  ? "desc"
                  : "asc"
                : key === "model"
                ? "asc"
                : "desc",
          }))
        }
        type="button"
      >
        {label}
        {sort.key === key ? (sort.direction === "asc" ? " ↑" : " ↓") : ""}
      </button>
    </th>
  );

  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            {sortHeader("model", "MODEL")}
            {sortHeader("calls", "CALLS")}
            {sortHeader("tokens", "TOKENS")}
            {sortHeader("cost", "EST. COST")}
            {sortHeader("share", "SHARE")}
          </tr>
        </thead>
        <tbody>
          {sortedModels.map((model) => (
            <tr key={model.model}>
              <td>
                <span className="model-cell-dot" />
                {model.model}
              </td>
              <td>{formatCount(model.calls)}</td>
              <td>{formatCount(model.tokens)}</td>
              <td>{formatMoney(model.cost, currency)}</td>
              <td>
                <div className="share-cell">
                  <div className="share-bar">
                    <span style={{ width: `${Math.min(100, model.share)}%` }} />
                  </div>
                  <span>{model.share.toFixed(1)}%</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <EmptyState loading={loading} label="No model usage in this date range." />}
    </div>
  );
}

function AgentTable({
  agents,
  usage,
  currency,
  compact = false,
}: {
  agents: CatalogAgent[];
  usage: UsageRow[];
  currency: string;
  compact?: boolean;
}) {
  type AgentSortKey = "name" | "plugin" | "requests" | "tokens" | "cost" | "status";
  const [sort, setSort] = useState<{ key: AgentSortKey; direction: "asc" | "desc" }>({
    key: "requests",
    direction: "desc",
  });

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

  const catalogNames = new Set(
    agents.flatMap((agent) => [agent.name, agent.id].map((name) => name.trim().toLocaleLowerCase()))
  );
  const unlistedAgents = [...metrics.entries()]
    .filter(([key]) => !catalogNames.has(key))
    .sort((a, b) => b[1].requests - a[1].requests);

  if (compact) {
    const visibleAgents = agents.slice(0, 6);
    const visibleUnlisted = unlistedAgents.slice(0, 4);
    return (
      <div className="table-scroll">
        <table className="data-table agent-table">
          <thead>
            <tr>
              <th>AGENT / PACKAGE</th>
              <th>PLUGIN</th>
              <th>CALLS</th>
              <th>TOKENS</th>
              <th>EST. COST</th>
              <th>STATUS</th>
            </tr>
          </thead>
          <tbody>
            {visibleAgents.map((agent, index) => {
              const isSkillPackage = agent.kind === "skill_package";
              const key = isSkillPackage
                ? undefined
                : [agent.name, agent.id]
                    .map((candidate) => candidate.trim().toLocaleLowerCase())
                    .find((candidate) => metrics.has(candidate));
              const measure = key ? metrics.get(key) : undefined;
              return (
                <tr key={`${agent.plugin_id}-${agent.id}-${index}`}>
                  <td>
                    <span className={`agent-avatar agent-avatar-${index % 4}`}>
                      {isSkillPackage ? <Boxes size={16} /> : <Bot size={16} />}
                    </span>
                    <span className="agent-name-cell">
                      <strong>{agent.name}</strong>
                      <small>
                        {isSkillPackage
                          ? `Skill package · ${agent.skills?.length ?? 0} skills`
                          : agent.description}
                      </small>
                      {isSkillPackage && !!agent.skills?.length && (
                        <small title={agent.skills.join(", ")}>{agent.skills.join(", ")}</small>
                      )}
                    </span>
                  </td>
                  <td>
                    <span className="plugin-name">{agent.plugin_name || agent.plugin_id || "—"}</span>
                    <small className="plugin-version">{agent.version ? `v${agent.version}` : ""}</small>
                  </td>
                  <td>{isSkillPackage ? "—" : formatCount(measure?.requests || 0)}</td>
                  <td>{isSkillPackage ? "—" : formatCompact(measure?.tokens || 0)}</td>
                  <td>{isSkillPackage ? "—" : formatMoney(measure?.cost || 0, currency)}</td>
                  <td>
                    <span
                      className={`usage-badge ${
                        isSkillPackage ? "unused" : measure ? "used" : "unused"
                      }`}
                    >
                      <span />
                      {isSkillPackage ? "Skills only" : measure ? "Tracked" : "No usage"}
                    </span>
                  </td>
                </tr>
              );
            })}
            {visibleUnlisted.map(([key, measure]) => (
              <tr key={`tracked-${key}`}>
                <td>
                  <span className="agent-avatar agent-avatar-3">
                    <Activity size={16} />
                  </span>
                  <span className="agent-name-cell">
                    <strong>{observedNames.get(key) || key}</strong>
                    <small>Observed in usage telemetry</small>
                  </span>
                </td>
                <td>
                  <span className="plugin-name">Not in marketplace</span>
                </td>
                <td>{formatCount(measure.requests)}</td>
                <td>{formatCompact(measure.tokens)}</td>
                <td>{formatMoney(measure.cost, currency)}</td>
                <td>
                  <span className="usage-badge used">
                    <span />Tracked
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!visibleAgents.length && <EmptyState loading={false} label="No marketplace agents found." />}
      </div>
    );
  }

  type TableRow = {
    key: string;
    name: string;
    description: string;
    plugin: string;
    version: string;
    isSkillPackage: boolean;
    skills?: string[];
    requests: number;
    tokens: number;
    cost: number;
    status: string;
    statusScore: number;
    avatarIndex: number;
    isUnlisted: boolean;
  };

  const catalogRows: TableRow[] = agents.map((agent, index) => {
    const isSkillPackage = agent.kind === "skill_package";
    const metricKey = isSkillPackage
      ? undefined
      : [agent.name, agent.id]
          .map((candidate) => candidate.trim().toLocaleLowerCase())
          .find((candidate) => metrics.has(candidate));
    const measure = metricKey ? metrics.get(metricKey) : undefined;
    const status = isSkillPackage ? "Skills only" : measure ? "Tracked" : "No usage";
    const statusScore = isSkillPackage ? 1 : measure ? 2 : 0;
    return {
      key: `${agent.plugin_id}-${agent.id}-${index}`,
      name: agent.name,
      description: isSkillPackage
        ? `Skill package · ${agent.skills?.length ?? 0} skills`
        : agent.description,
      plugin: agent.plugin_name || agent.plugin_id || "—",
      version: agent.version ? `v${agent.version}` : "",
      isSkillPackage,
      skills: agent.skills,
      requests: isSkillPackage ? 0 : measure?.requests || 0,
      tokens: isSkillPackage ? 0 : measure?.tokens || 0,
      cost: isSkillPackage ? 0 : measure?.cost || 0,
      status,
      statusScore,
      avatarIndex: index % 4,
      isUnlisted: false,
    };
  });

  const unlistedRows: TableRow[] = unlistedAgents.map(([key, measure]) => ({
    key: `tracked-${key}`,
    name: observedNames.get(key) || key,
    description: "Observed in usage telemetry",
    plugin: "Not in marketplace",
    version: "",
    isSkillPackage: false,
    skills: undefined,
    requests: measure.requests,
    tokens: measure.tokens,
    cost: measure.cost,
    status: "Tracked",
    statusScore: 2,
    avatarIndex: 3,
    isUnlisted: true,
  }));

  const allRows = [...catalogRows, ...unlistedRows];

  const sortedRows = [...allRows].sort((a, b) => {
    if (sort.key === "status") {
      const result = a.statusScore - b.statusScore;
      return sort.direction === "asc" ? result : -result;
    }
    const left = a[sort.key];
    const right = b[sort.key];
    const result =
      typeof left === "number" && typeof right === "number"
        ? left - right
        : String(left).localeCompare(String(right));
    return sort.direction === "asc" ? result : -result;
  });

  const sortHeader = (key: AgentSortKey, label: string) => (
    <th aria-sort={sort.key === key ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}>
      <button
        className="activity-sort-button"
        onClick={() =>
          setSort((current) => ({
            key,
            direction:
              current.key === key
                ? current.direction === "asc"
                  ? "desc"
                  : "asc"
                : ["name", "plugin"].includes(key)
                ? "asc"
                : "desc",
          }))
        }
        type="button"
      >
        {label}
        {sort.key === key ? (sort.direction === "asc" ? " ↑" : " ↓") : ""}
      </button>
    </th>
  );

  return (
    <div className="table-scroll">
      <table className="data-table agent-table">
        <thead>
          <tr>
            {sortHeader("name", "AGENT / PACKAGE")}
            {sortHeader("plugin", "PLUGIN")}
            {sortHeader("requests", "CALLS")}
            {sortHeader("tokens", "TOKENS")}
            {sortHeader("cost", "EST. COST")}
            {sortHeader("status", "STATUS")}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row) => (
            <tr key={row.key}>
              <td>
                <span className={`agent-avatar agent-avatar-${row.avatarIndex}`}>
                  {row.isUnlisted ? (
                    <Activity size={16} />
                  ) : row.isSkillPackage ? (
                    <Boxes size={16} />
                  ) : (
                    <Bot size={16} />
                  )}
                </span>
                <span className="agent-name-cell">
                  <strong>{row.name}</strong>
                  <small>{row.description}</small>
                  {row.isSkillPackage && !!row.skills?.length && (
                    <small title={row.skills.join(", ")}>{row.skills.join(", ")}</small>
                  )}
                </span>
              </td>
              <td>
                <span className="plugin-name">{row.plugin}</span>
                {row.version && <small className="plugin-version">{row.version}</small>}
              </td>
              <td>{row.isSkillPackage ? "—" : formatCount(row.requests)}</td>
              <td>{row.isSkillPackage ? "—" : formatCompact(row.tokens)}</td>
              <td>{row.isSkillPackage ? "—" : formatMoney(row.cost, currency)}</td>
              <td>
                <span
                  className={`usage-badge ${
                    row.isSkillPackage
                      ? "unused"
                      : row.statusScore === 2
                      ? "used"
                      : "unused"
                  }`}
                >
                  <span />
                  {row.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!allRows.length && <EmptyState loading={false} label="No marketplace agents found." />}
    </div>
  );
}

function RecentActivity({
  events,
  rows,
  onViewAll,
}: {
  events: CallEvent[];
  rows: UsageRow[];
  onViewAll: () => void;
}) {
  const recent =
    events.length > 0
      ? [...events]
          .sort((a, b) => Date.parse(b.timestamp || b.date) - Date.parse(a.timestamp || a.date))
          .slice(0, 5)
      : [...rows].sort(compareLatest).slice(0, 5).map((r, index) => ({
          key: `${r.date}-${r.agent}-${r.model}-${index}`,
          timestamp: r.last_seen || `${r.date}T00:00:00Z`,
          user: r.user,
          agent: r.agent,
          model: r.model,
          input_tokens: r.input_tokens,
          output_tokens: r.output_tokens,
          cost: r.cost,
        }));

  return (
    <section className="recent-section">
      <div className="panel-heading">
        <div><div className="section-kicker">LATEST RECORDED</div><h2>Recent calls</h2></div>
        <button className="text-link" onClick={onViewAll} type="button">Full activity <ArrowUpRight size={13} /></button>
      </div>
      {recent.length ? (
        <div className="recent-list">
          {recent.map((call, index) => {
            const tokens = (call.input_tokens || 0) + (call.output_tokens || 0);
            return (
              <div className="recent-row" key={`${call.key}-${index}`}>
                <span className={`recent-icon recent-icon-${index % 3}`}><Zap size={15} /></span>
                <div className="recent-copy">
                  <strong>{call.agent}</strong>
                  <small>{call.model} · {call.user}</small>
                </div>
                <span className="recent-tokens">{formatCompact(tokens)} <small>tokens</small></span>
                <span className="recent-cost">${(call.cost || 0).toFixed(4)}</span>
                <time dateTime={call.timestamp} title="Call time (local time)">
                  {call.timestamp ? displayCallTime(call.timestamp) : "Time unavailable"}
                </time>
              </div>
            );
          })}
        </div>
      ) : <EmptyState loading={false} label="No activity found for these filters." />}
    </section>
  );
}

function UserTable({ rows, currency }: { rows: UsageRow[]; currency: string }) {
  type UserSortKey = "user" | "requests" | "input" | "output" | "tokens" | "cost" | "share";
  const [sort, setSort] = useState<{ key: UserSortKey; direction: "asc" | "desc" }>({
    key: "cost",
    direction: "desc",
  });

  const metrics = new Map<
    string,
    { requests: number; input: number; output: number; cost: number; unpriced: number }
  >();
  for (const row of rows) {
    const current = metrics.get(row.user) || {
      requests: 0,
      input: 0,
      output: 0,
      cost: 0,
      unpriced: 0,
    };
    current.requests += row.requests;
    current.input += row.input_tokens;
    current.output += row.output_tokens;
    current.cost += row.cost;
    current.unpriced += row.unpriced_requests;
    metrics.set(row.user, current);
  }

  const rawUserRows = [...metrics.entries()];
  const totalTokens = rawUserRows.reduce(
    (total, [, measure]) => total + measure.input + measure.output,
    0
  );

  const userItems = rawUserRows.map(([user, measure]) => {
    const tokens = measure.input + measure.output;
    const share = totalTokens ? (tokens / totalTokens) * 100 : 0;
    return {
      user,
      requests: measure.requests,
      input: measure.input,
      output: measure.output,
      tokens,
      cost: measure.cost,
      unpriced: measure.unpriced,
      share,
    };
  });

  const sortedUsers = [...userItems].sort((a, b) => {
    const left = a[sort.key];
    const right = b[sort.key];
    const result =
      typeof left === "number" && typeof right === "number"
        ? left - right
        : String(left).localeCompare(String(right));
    return sort.direction === "asc" ? result : -result;
  });

  const sortHeader = (key: UserSortKey, label: string) => (
    <th aria-sort={sort.key === key ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}>
      <button
        className="activity-sort-button"
        onClick={() =>
          setSort((current) => ({
            key,
            direction:
              current.key === key
                ? current.direction === "asc"
                  ? "desc"
                  : "asc"
                : key === "user"
                ? "asc"
                : "desc",
          }))
        }
        type="button"
      >
        {label}
        {sort.key === key ? (sort.direction === "asc" ? " ↑" : " ↓") : ""}
      </button>
    </th>
  );

  return (
    <div className="table-scroll">
      <table className="data-table user-table">
        <thead>
          <tr>
            {sortHeader("user", "USER")}
            {sortHeader("requests", "CALLS")}
            {sortHeader("input", "INPUT TOKENS")}
            {sortHeader("output", "OUTPUT TOKENS")}
            {sortHeader("tokens", "TOTAL TOKENS")}
            {sortHeader("cost", "EST. COST")}
            {sortHeader("share", "SHARE")}
          </tr>
        </thead>
        <tbody>
          {sortedUsers.map((item) => (
            <tr key={item.user}>
              <td>{item.user}</td>
              <td>{formatCount(item.requests)}</td>
              <td>{formatCount(item.input)}</td>
              <td>{formatCount(item.output)}</td>
              <td>{formatCount(item.tokens)}</td>
              <td>
                {formatMoney(item.cost, currency)}
                {item.unpriced > 0 && (
                  <small className="user-unpriced">
                    {formatCount(item.unpriced)} unpriced
                  </small>
                )}
              </td>
              <td>
                <div className="share-cell">
                  <div className="share-bar">
                    <span style={{ width: `${Math.min(100, item.share)}%` }} />
                  </div>
                  <span>{item.share.toFixed(1)}%</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!userItems.length && <EmptyState loading={false} label="No user usage in this date range." />}
    </div>
  );
}

function ActivityTable({
  events,
  loading,
  currency,
}: {
  events: CallEvent[];
  loading: boolean;
  currency: string;
}) {
  type SortKey =
    | "timestamp"
    | "user"
    | "agent"
    | "model"
    | "input_tokens"
    | "output_tokens"
    | "total_tokens"
    | "latency_ms"
    | "cost";

  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>({
    key: "timestamp",
    direction: "desc",
  });

  const sortedEvents = [...events].sort((a, b) => {
    let left: any = a[sort.key];
    let right: any = b[sort.key];

    if (sort.key === "total_tokens") {
      left = (a.input_tokens || 0) + (a.output_tokens || 0);
      right = (b.input_tokens || 0) + (b.output_tokens || 0);
    } else if (sort.key === "timestamp") {
      left = Date.parse(a.timestamp || a.date || "1970-01-01");
      right = Date.parse(b.timestamp || b.date || "1970-01-01");
    }

    if (left == null || right == null) {
      return left == null ? (right == null ? 0 : 1) : -1;
    }
    const result =
      typeof left === "number" && typeof right === "number"
        ? left - right
        : String(left).localeCompare(String(right));
    return sort.direction === "asc" ? result : -result;
  });

  const sortHeader = (key: SortKey, label: string) => (
    <th aria-sort={sort.key === key ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}>
      <button
        className="activity-sort-button"
        onClick={() =>
          setSort((current) => ({
            key,
            direction:
              current.key === key
                ? current.direction === "asc"
                  ? "desc"
                  : "asc"
                : ["user", "agent", "model"].includes(key)
                ? "asc"
                : "desc",
          }))
        }
        type="button"
      >
        {label}
        {sort.key === key ? (sort.direction === "asc" ? " ↑" : " ↓") : ""}
      </button>
    </th>
  );

  return (
    <section className="panel full-panel">
      <div className="panel-heading">
        <div>
          <div className="section-kicker">CALL ACTIVITY</div>
          <h2>Recorded calls</h2>
        </div>
        <span className="inventory-count">{formatCount(events.length)} CALLS</span>
      </div>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              {sortHeader("timestamp", "TIME (LOCAL)")}
              {sortHeader("user", "USER")}
              {sortHeader("agent", "AGENT")}
              {sortHeader("model", "MODEL")}
              {sortHeader("input_tokens", "INPUT TOKENS")}
              {sortHeader("output_tokens", "OUTPUT TOKENS")}
              {sortHeader("total_tokens", "TOTAL TOKENS")}
              {sortHeader("latency_ms", "LATENCY")}
              {sortHeader("cost", "EST. COST")}
            </tr>
          </thead>
          <tbody>
            {sortedEvents.map((event, index) => {
              const totalTokens = (event.input_tokens || 0) + (event.output_tokens || 0);
              const latencyText =
                event.latency_ms != null && event.latency_ms > 0
                  ? event.latency_ms >= 1000
                    ? `${(event.latency_ms / 1000).toFixed(2)}s`
                    : `${Math.round(event.latency_ms)}ms`
                  : "—";

              return (
                <tr key={`${event.key || event.timestamp}-${index}`}>
                  <td>
                    <time dateTime={event.timestamp}>
                      {displayCallTime(event.timestamp)}
                    </time>
                  </td>
                  <td>{event.user}</td>
                  <td>{event.agent}</td>
                  <td>{event.model}</td>
                  <td>{formatCount(event.input_tokens)}</td>
                  <td>{formatCount(event.output_tokens)}</td>
                  <td>{formatCount(totalTokens)}</td>
                  <td>{latencyText}</td>
                  <td>{formatMoney(event.cost, currency)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!events.length && <EmptyState loading={loading} label="No call activity in this date range." />}
      </div>
    </section>
  );
}
