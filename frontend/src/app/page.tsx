"use client";

import {
  Activity,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Binary,
  Bot,
  Boxes,
  Braces,
  BrainCircuit,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  Code,
  Command,
  Compass,
  Copy,
  Cpu,
  Database,
  FileText,
  GitBranch,
  Layers,
  Layers2,
  LayoutDashboard,
  LoaderCircle,
  Moon,
  Network,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Sun,
  Terminal,
  TestTube,
  Users,
  Workflow,
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
import { useEffect, useMemo, useRef, useState } from "react";
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
  display_name?: string;
  description: string;
  argument_hint?: string;
  plugin_id: string;
  plugin_name: string;
  version: string;
  status?: string;
  has_definition?: boolean;
  catalogue?: string;
  path: string;
  url?: string;
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
  const [now, setNow] = useState(0);
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
        setNow(Date.now());
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

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(interval);
  }, []);

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
      view === "agents" || !query ||
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
  const liveUsers = getLiveUsers(callEvents, now);

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
  const agentNames = [...new Set([
    ...usageRows.map((row) => row.agent),
    ...callEvents.map((event) => event.agent),
    ...(catalog?.agents ?? []).map((agent) => agent.name),
  ])].sort();
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
              <LiveUsers users={liveUsers} now={now} loading={loading} />
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
              <div className="panel-heading"><div><div className="section-kicker">AGENTVERSE DEVJOURNEY</div><h2>Agent catalogue</h2></div><span className="inventory-count">{catalog?.agents.length ?? 0} AGENTS</span></div>
              <p className="catalog-caption">Built agents documented across enterprise engineering domains. Select a domain below to browse agents.</p>
              <AgentCatalog agents={catalog?.agents || []} usage={filteredRows} currency={currency} search={search} selectedAgent={selectedAgent} loading={loading} />
              {!!catalog?.error && <p className="table-note">Catalog refresh issue: {catalog.error}</p>}
            </section>
          )}

          {view === "users" && (
            <section className="panel full-panel">
              <div className="panel-heading"><div><div className="section-kicker">TEAM USAGE</div><h2>Usage by user</h2></div><span className="inventory-count">{userNames.length} USERS · {liveUsers.length} LIVE</span></div>
              <UserTable rows={filteredRows} currency={currency} liveUsers={liveUsers} now={now} />
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

type AgentCategory =
  | "AI in SDLC"
  | "AI in Assurance"
  | "AI in Modernization"
  | "AI in Data & Analytics"
  | "AI Platform & Tools";

interface CategoryMeta {
  id: AgentCategory;
  name: string;
  shortName: string;
  catalogueMatch: string;
  description: string;
  badgeClass: string;
  icon: any;
}

const CATEGORY_LIST: CategoryMeta[] = [
  {
    id: "AI in SDLC",
    name: "AI in SDLC",
    shortName: "SDLC",
    catalogueMatch: "A-DEV",
    description: "Software development lifecycle agents for product discovery, user stories, architecture, code generation, and DevOps pipelines.",
    badgeClass: "cat-badge-sdlc",
    icon: Sparkles,
  },
  {
    id: "AI in Assurance",
    name: "AI in Assurance",
    shortName: "Assurance",
    catalogueMatch: "A-ASR",
    description: "Quality assurance and testing agents: risk-led test strategy, automated test design, regression suites, and entry/exit sign-off verification.",
    badgeClass: "cat-badge-asr",
    icon: ShieldAlert,
  },
  {
    id: "AI in Modernization",
    name: "AI in Modernization",
    shortName: "Modernization",
    catalogueMatch: "B-MOD",
    description: "Enterprise legacy modernization: TIBCO extraction, IBM Sterling & Seeburger migration, Swing to Angular, and ColdFusion to React transformations.",
    badgeClass: "cat-badge-mod",
    icon: RefreshCw,
  },
  {
    id: "AI in Data & Analytics",
    name: "AI in Data & Analytics",
    shortName: "Data & AI",
    catalogueMatch: "D-DATA",
    description: "Data platform agents: automated data engineering, ETL/ELT pipelines, transformation code generation, metadata governance, and analytical intelligence.",
    badgeClass: "cat-badge-data",
    icon: Boxes,
  },
  {
    id: "AI Platform & Tools",
    name: "AI Platform & Tools",
    shortName: "Platform",
    catalogueMatch: "OTHER",
    description: "Core AI platform documentation builders, specification analyzers, and developer toolchain agents.",
    badgeClass: "cat-badge-platform",
    icon: Cpu,
  },
];

function getAgentCategory(agent: CatalogAgent): AgentCategory {
  const cat = agent.catalogue || "";
  if (cat.includes("A-DEV")) return "AI in SDLC";
  if (cat.includes("A-ASR")) return "AI in Assurance";
  if (cat.includes("B-MOD")) return "AI in Modernization";
  if (cat.includes("D-DATA")) return "AI in Data & Analytics";
  return "AI Platform & Tools";
}

function getCategoryBadgeClass(category: string): string {
  switch (category) {
    case "AI in SDLC":
      return "cat-badge-sdlc";
    case "AI in Assurance":
      return "cat-badge-asr";
    case "AI in Modernization":
      return "cat-badge-mod";
    case "AI in Data & Analytics":
      return "cat-badge-data";
    case "AI Platform & Tools":
      return "cat-badge-platform";
    default:
      return "cat-badge-all";
  }
}

function getAgentSymbol(agent: CatalogAgent) {
  const name = (agent.name || "").toLowerCase();
  const id = (agent.id || "").toLowerCase();
  const title = (agent.display_name || "").toLowerCase();
  const combined = `${id} ${name} ${title}`;

  // Testing & Quality Assurance
  if (
    combined.includes("test") ||
    combined.includes("qa") ||
    combined.includes("validation") ||
    combined.includes("assurance")
  ) {
    if (combined.includes("strategy") || combined.includes("risk")) return ShieldAlert;
    if (
      combined.includes("functional") ||
      combined.includes("integration") ||
      combined.includes("e2e") ||
      combined.includes("uat") ||
      combined.includes("nfr")
    ) {
      return TestTube;
    }
    return ShieldCheck;
  }

  // Code generation & Software Engineering
  if (
    combined.includes("codegen") ||
    combined.includes("software-engineer") ||
    combined.includes("code-generation") ||
    combined.includes("implementation-codegen")
  ) {
    return Code;
  }
  if (combined.includes("build") || combined.includes("terminal")) {
    return Terminal;
  }

  // Modernization, Migration & Reverse Engineering
  if (
    combined.includes("migration") ||
    combined.includes("modernisation") ||
    combined.includes("modernize")
  ) {
    return RefreshCw;
  }
  if (
    combined.includes("tibco") ||
    combined.includes("sterling") ||
    combined.includes("seeburger") ||
    combined.includes("reverse-engineering") ||
    combined.includes("decomposition") ||
    combined.includes("extraction")
  ) {
    return Binary;
  }
  if (
    combined.includes("swing") ||
    combined.includes("coldfusion") ||
    combined.includes("angular") ||
    combined.includes("react")
  ) {
    return Braces;
  }

  // Conversational AI, Knowledge & Intelligence
  if (
    combined.includes("talk-to-data") ||
    combined.includes("knowledge") ||
    combined.includes("intelligence") ||
    combined.includes("evaluator")
  ) {
    return BrainCircuit;
  }

  // Data Engineering & Analytics
  if (
    combined.includes("data") ||
    combined.includes("bigquery") ||
    combined.includes("teradata") ||
    combined.includes("etl")
  ) {
    if (
      combined.includes("lineage") ||
      combined.includes("dependency") ||
      combined.includes("contract")
    ) {
      return Network;
    }
    if (combined.includes("visualisation") || combined.includes("reporting")) {
      return Layers2;
    }
    if (
      combined.includes("mapping") ||
      combined.includes("pipeline") ||
      combined.includes("workflow")
    ) {
      return Workflow;
    }
    return Database;
  }

  // Requirements, User Journeys, Rules & Specifications
  if (
    combined.includes("requirement") ||
    combined.includes("journey") ||
    combined.includes("rule") ||
    combined.includes("story") ||
    combined.includes("backlog") ||
    combined.includes("specification") ||
    combined.includes("fsd") ||
    combined.includes("glossary") ||
    combined.includes("dictionary")
  ) {
    return FileText;
  }

  // Architecture & Solution Design
  if (
    combined.includes("architecture") ||
    combined.includes("design") ||
    combined.includes("solution")
  ) {
    return Layers;
  }

  // Product Discovery & Ideation
  if (
    combined.includes("discovery") ||
    combined.includes("ideation") ||
    combined.includes("product")
  ) {
    return Compass;
  }

  // Fallback by Domain / Category
  const cat = getAgentCategory(agent);
  if (cat === "AI in SDLC") return Sparkles;
  if (cat === "AI in Assurance") return ShieldAlert;
  if (cat === "AI in Modernization") return RefreshCw;
  if (cat === "AI in Data & Analytics") return Database;
  return Bot;
}

type AgentDetailState = {
  agent: CatalogAgent;
  category: string;
  requests: number;
  tokens: number;
  cost: number;
};

function AgentDetailModal({
  data,
  currency,
  onClose,
}: {
  data: AgentDetailState;
  currency: string;
  onClose: () => void;
}) {
  const { agent, category, requests, tokens, cost } = data;
  const [copiedId, setCopiedId] = useState(false);
  const [copiedHint, setCopiedHint] = useState(false);
  const AgentSymbol = getAgentSymbol(agent);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const copyText = (text: string, type: "id" | "hint") => {
    navigator.clipboard?.writeText(text);
    if (type === "id") {
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    } else {
      setCopiedHint(true);
      setTimeout(() => setCopiedHint(false), 2000);
    }
  };

  return (
    <div
      className="agent-modal-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="agent-modal-title"
    >
      <div className="agent-modal-dialog" onClick={(e) => e.stopPropagation()}>
        <header className="agent-modal-header">
          <div className="agent-modal-header-main">
            <span className={`agent-modal-avatar ${getCategoryBadgeClass(category)}`}>
              <AgentSymbol size={24} />
            </span>
            <div className="agent-modal-title-group">
              <div className="agent-modal-top-tags">
                <span className={`category-badge-chip ${getCategoryBadgeClass(category)}`}>
                  {category}
                </span>
                <span className={`usage-pill-compact ${requests > 0 ? "active" : ""}`}>
                  <span className="usage-dot" />
                  {requests > 0 ? "Telemetry Tracked" : "No telemetry recorded"}
                </span>
              </div>
              <h2 id="agent-modal-title">{agent.display_name || agent.name}</h2>
              <div className="agent-modal-id-bar">
                <code>{agent.name}</code>
                <button
                  type="button"
                  className="modal-copy-btn"
                  onClick={() => copyText(agent.name, "id")}
                  title="Copy Agent ID"
                  aria-label="Copy Agent ID"
                >
                  {copiedId ? <Check size={12} /> : <Copy size={12} />}
                  <span>{copiedId ? "Copied" : "Copy ID"}</span>
                </button>
              </div>
            </div>
          </div>
          <button
            type="button"
            className="agent-modal-close-btn"
            onClick={onClose}
            aria-label="Close details"
          >
            <X size={18} />
          </button>
        </header>

        <div className="agent-modal-body">
          <div>
            <div className="agent-modal-section-title">Overview & Capabilities</div>
            <p className="agent-modal-desc">
              {agent.description || "No description provided in catalogue definition."}
            </p>
          </div>

          <div>
            <div className="agent-modal-section-title">Tracked Usage & Telemetry</div>
            <div className="agent-modal-metrics-grid">
              <div className="agent-modal-metric-box">
                <dt>Calls</dt>
                <dd>{formatCount(requests)}</dd>
              </div>
              <div className="agent-modal-metric-box">
                <dt>Tokens</dt>
                <dd>{formatCompact(tokens)}</dd>
              </div>
              <div className="agent-modal-metric-box">
                <dt>Est. Cost</dt>
                <dd>{formatMoney(cost, currency)}</dd>
              </div>
            </div>
          </div>

          {agent.argument_hint && (
            <div>
              <div className="agent-modal-section-header">
                <div className="agent-modal-section-title">Usage Arguments / Prompt Format</div>
                <button
                  type="button"
                  className="modal-copy-btn"
                  onClick={() => copyText(agent.argument_hint || "", "hint")}
                >
                  {copiedHint ? <Check size={12} /> : <Copy size={12} />}
                  <span>{copiedHint ? "Copied" : "Copy"}</span>
                </button>
              </div>
              <pre className="agent-modal-code-block">
                <code>{agent.argument_hint}</code>
              </pre>
            </div>
          )}

          {!!agent.skills?.length && (
            <div>
              <div className="agent-modal-section-title">
                Equipped Skills ({agent.skills.length})
              </div>
              <div className="agent-modal-skills-list">
                {agent.skills.map((skill) => (
                  <span className="agent-modal-skill-tag" key={skill}>
                    {skill}
                  </span>
                ))}
              </div>
            </div>
          )}

          {agent.path && (
            <div className="agent-modal-path-note">
              <span>Source path:</span> <code>{agent.path}</code>
            </div>
          )}
        </div>

        <footer className="agent-modal-footer">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}

function AgentCatalog({
  agents,
  usage,
  currency,
  search,
  selectedAgent,
  loading,
}: {
  agents: CatalogAgent[];
  usage: UsageRow[];
  currency: string;
  search: string;
  selectedAgent: string;
  loading: boolean;
}) {
  type SortKey = "name" | "requests" | "tokens" | "cost";
  const [selectedCategory, setSelectedCategory] = useState<AgentCategory | null>(null);
  const [categorySearch, setCategorySearch] = useState<string>("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [onlyTracked, setOnlyTracked] = useState<boolean>(false);
  const [detailModal, setDetailModal] = useState<AgentDetailState | null>(null);

  // Compute metrics map for all agents
  const agentMetrics = useMemo(() => {
    const map = new Map<string, { requests: number; tokens: number; cost: number }>();
    for (const agent of agents) {
      const aliases = new Set(
        [agent.id, agent.name, agent.display_name]
          .filter((name): name is string => Boolean(name))
          .map((name) => name.trim().toLowerCase()),
      );
      const metrics = usage.reduce(
        (total, row) => {
          if (aliases.has(row.agent.trim().toLowerCase())) {
            total.requests += row.requests;
            total.tokens += row.input_tokens + row.output_tokens;
            total.cost += row.cost;
          }
          return total;
        },
        { requests: 0, tokens: 0, cost: 0 },
      );
      map.set(agent.id, metrics);
    }
    return map;
  }, [agents, usage]);

  // Summaries per Category Tile
  const categoryTiles = useMemo(() => {
    return CATEGORY_LIST.map((meta) => {
      const catAgents = agents.filter((a) => getAgentCategory(a) === meta.id);
      let totalCalls = 0;
      let totalTokens = 0;
      let totalCost = 0;
      let trackedCount = 0;

      for (const agent of catAgents) {
        const m = agentMetrics.get(agent.id);
        if (m) {
          totalCalls += m.requests;
          totalTokens += m.tokens;
          totalCost += m.cost;
          if (m.requests > 0) trackedCount += 1;
        }
      }

      return {
        meta,
        agents: catAgents,
        agentCount: catAgents.length,
        trackedCount,
        totalCalls,
        totalTokens,
        totalCost,
      };
    });
  }, [agents, agentMetrics]);

  const activeCategoryMeta = selectedCategory
    ? CATEGORY_LIST.find((c) => c.id === selectedCategory) || null
    : null;

  // Active agents when inside a category or global search
  const query = (search || categorySearch).trim().toLowerCase();

  const filteredAgents = useMemo(() => {
    return agents
      .filter((agent) => {
        const category = getAgentCategory(agent);
        if (selectedCategory && category !== selectedCategory) {
          return false;
        }

        const matchesAgent =
          selectedAgent === "all" ||
          [agent.id, agent.name, agent.display_name].some(
            (name) => name?.toLowerCase() === selectedAgent.toLowerCase(),
          );

        const matchesSearch =
          !query ||
          [
            agent.id,
            agent.name,
            agent.display_name,
            agent.description,
            agent.path,
            agent.catalogue,
            category,
            ...(agent.skills ?? []),
          ].some((value) => value?.toLowerCase().includes(query));

        return matchesAgent && matchesSearch;
      })
      .map((agent) => {
        const category = getAgentCategory(agent);
        const metrics = agentMetrics.get(agent.id) || { requests: 0, tokens: 0, cost: 0 };
        return { agent, category, ...metrics };
      })
      .filter((item) => {
        if (onlyTracked && item.requests === 0) return false;
        return true;
      })
      .sort((a, b) =>
        sortKey === "name"
          ? a.agent.name.localeCompare(b.agent.name)
          : b[sortKey] - a[sortKey] || a.agent.name.localeCompare(b.agent.name),
      );
  }, [agents, selectedCategory, selectedAgent, query, agentMetrics, onlyTracked, sortKey]);

  // If a top-level search query is typed while in category tile view, show search results
  const isBrowsingCategory = selectedCategory !== null;
  const isGlobalSearchActive = !selectedCategory && Boolean(query);

  return (
    <>
      {/* LEVEL 1: Category Tiles View */}
      {!isBrowsingCategory && !isGlobalSearchActive && (
        <div className="category-hub-section">
          <div className="category-hub-intro">
            <h3 className="category-hub-heading">Select a domain</h3>
            <span className="inventory-count">5 DOMAINS · {agents.length} AGENTS</span>
          </div>

          <div className="category-hub-grid" role="region" aria-label="AI Agent Categories">
            {categoryTiles.map(
              ({
                meta,
                agentCount,
              }) => {
                const Icon = meta.icon;
                return (
                  <article
                    key={meta.id}
                    className={`category-domain-card ${meta.badgeClass}`}
                    onClick={() => {
                      setSelectedCategory(meta.id);
                      setCategorySearch("");
                    }}
                    tabIndex={0}
                    role="button"
                    aria-label={`Open ${meta.name} domain containing ${agentCount} agents`}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedCategory(meta.id);
                        setCategorySearch("");
                      }
                    }}
                  >
                    <div className="category-domain-top">
                      <div className="category-domain-icon-wrap">
                        <Icon size={18} />
                      </div>
                      <span className="category-domain-count-badge">
                        {agentCount} {agentCount === 1 ? "Agent" : "Agents"}
                      </span>
                    </div>

                    <div className="category-domain-bottom">
                      <h3 className="category-domain-title">{meta.name}</h3>
                      <div className="category-domain-action">
                        <span>Explore</span>
                        <ArrowRight size={13} className="domain-arrow" />
                      </div>
                    </div>
                  </article>
                );
              },
            )}
          </div>
        </div>
      )}

      {/* LEVEL 2: Inside Category - Small Agent Tiles */}
      {(isBrowsingCategory || isGlobalSearchActive) && (
        <div className="category-drilldown-section">
          {/* Breadcrumb & Quick Switcher */}
          <div className="category-drilldown-header">
            <button
              type="button"
              className="category-back-btn"
              onClick={() => {
                setSelectedCategory(null);
                setCategorySearch("");
              }}
              title="Return to all domain tiles"
            >
              <ArrowLeft size={15} />
              <span>All Domains</span>
            </button>

            {/* Quick Domain Switcher Pills */}
            <div className="category-switcher-pills" role="tablist" aria-label="Switch Domain">
              {CATEGORY_LIST.map((meta) => {
                const isCurrent = selectedCategory === meta.id;
                const count = agents.filter((a) => getAgentCategory(a) === meta.id).length;
                return (
                  <button
                    key={meta.id}
                    role="tab"
                    aria-selected={isCurrent}
                    type="button"
                    className={`category-switch-pill ${isCurrent ? "active" : ""}`}
                    onClick={() => {
                      setSelectedCategory(meta.id);
                      setCategorySearch("");
                    }}
                  >
                    <span className={`category-dot ${meta.badgeClass}`} />
                    <span>{meta.shortName}</span>
                    <span className="category-switch-count">{count}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Current Category Banner */}
          {activeCategoryMeta && (
            <div className={`category-active-banner ${activeCategoryMeta.badgeClass}`}>
              <div className="category-banner-icon">
                <activeCategoryMeta.icon size={28} />
              </div>
              <div className="category-banner-info">
                <div className="category-banner-title-row">
                  <h2>{activeCategoryMeta.name}</h2>
                  <span className="category-banner-count">
                    {filteredAgents.length} Agents listed
                  </span>
                </div>
                <p>{activeCategoryMeta.description}</p>
              </div>
            </div>
          )}

          {isGlobalSearchActive && !activeCategoryMeta && (
            <div className="category-search-notice">
              <span>Showing search results for <strong>&ldquo;{query}&rdquo;</strong> across all domains</span>
              <button
                type="button"
                className="text-link"
                onClick={() => {
                  setCategorySearch("");
                  setSelectedCategory(null);
                }}
              >
                Clear search to see domain tiles
              </button>
            </div>
          )}

          {/* Sub-toolbar inside Category */}
          <div className="catalog-toolbar">
            <div className="catalog-toolbar-left">
              <div className="category-search-box">
                <Search size={14} />
                <input
                  type="text"
                  placeholder={`Search in ${activeCategoryMeta?.shortName || "agents"}...`}
                  value={categorySearch}
                  onChange={(e) => setCategorySearch(e.target.value)}
                  aria-label="Filter agents inside this domain"
                />
                {categorySearch && (
                  <button
                    type="button"
                    onClick={() => setCategorySearch("")}
                    aria-label="Clear filter"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>

              <button
                type="button"
                className={`catalog-tracked-filter ${onlyTracked ? "active" : ""}`}
                onClick={() => setOnlyTracked(!onlyTracked)}
                title="Toggle only agents with recorded telemetry"
              >
                <span className="usage-dot" />
                <span>Tracked only</span>
              </button>
            </div>

            <div className="catalog-toolbar-right">
              <label className="select-filter">
                <span className="select-filter-label">Sort:</span>
                <select
                  aria-label="Sort agents"
                  value={sortKey}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (
                      value === "name" ||
                      value === "requests" ||
                      value === "tokens" ||
                      value === "cost"
                    )
                      setSortKey(value);
                  }}
                >
                  <option value="name">Name (A-Z)</option>
                  <option value="requests">Most calls</option>
                  <option value="tokens">Most tokens</option>
                  <option value="cost">Highest cost</option>
                </select>
              </label>
            </div>
          </div>

          {/* Small Agent Tiles Grid */}
          <div className="catalog-grid compact-grid" aria-label="Category Agents">
            {filteredAgents.map(({ agent, category, requests, tokens, cost }) => {
              const AgentSymbol = getAgentSymbol(agent);
              return (
                <article
                  className="compact-tile"
                  key={agent.id}
                  tabIndex={0}
                  role="button"
                  aria-haspopup="dialog"
                  aria-label={`View details for ${agent.display_name || agent.name}`}
                  onClick={() => setDetailModal({ agent, category, requests, tokens, cost })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setDetailModal({ agent, category, requests, tokens, cost });
                    }
                  }}
                >
                  <div className="compact-tile-top">
                    <span className={`category-badge-chip ${getCategoryBadgeClass(category)}`}>
                      {category === "AI Platform & Tools"
                        ? "Platform"
                        : category.replace("AI in ", "")}
                    </span>
                    <span className={`usage-pill-compact ${requests > 0 ? "active" : ""}`}>
                      <span className="usage-dot" />
                      {requests > 0 ? "Tracked" : "Unused"}
                    </span>
                  </div>

                  <div className="compact-tile-main">
                    <div className="compact-tile-identity">
                      <span
                        className={`compact-agent-symbol ${getCategoryBadgeClass(category)}`}
                        aria-hidden="true"
                      >
                        <AgentSymbol size={18} />
                      </span>
                      <div className="compact-tile-title-group">
                        <h4 className="compact-tile-title" title={agent.display_name || agent.name}>
                          {agent.display_name || agent.name}
                        </h4>
                        <div className="compact-tile-id" title={agent.name}>
                          <code>{agent.name}</code>
                        </div>
                      </div>
                    </div>
                    <p className="compact-tile-desc" title={agent.description}>
                      {agent.description || "No description provided."}
                    </p>
                  </div>

                  <div className="compact-metrics">
                    <div className="compact-metric-item">
                      <span className="compact-metric-label">Calls</span>
                      <span className="compact-metric-value">{formatCount(requests)}</span>
                    </div>
                    <div className="compact-metric-item">
                      <span className="compact-metric-label">Tokens</span>
                      <span className="compact-metric-value">{formatCompact(tokens)}</span>
                    </div>
                    <div className="compact-metric-item">
                      <span className="compact-metric-label">Cost</span>
                      <span className="compact-metric-value">{formatMoney(cost, currency)}</span>
                    </div>
                  </div>

                  <div className="compact-tile-footer">
                    <span className="compact-source-label">
                      {agent.has_definition ? ".agent.md" : "catalogue"}
                    </span>
                    <span className="compact-click-hint">Click for details →</span>
                  </div>
                </article>
              );
            })}
          </div>

          {!filteredAgents.length && (
            <EmptyState
              loading={loading}
              label="No agents in this domain match your search or filter criteria."
            />
          )}
        </div>
      )}

      {/* LEVEL 3: Agent Detail Modal */}
      {detailModal && (
        <AgentDetailModal
          data={detailModal}
          currency={currency}
          onClose={() => setDetailModal(null)}
        />
      )}
    </>
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
              const AgentSymbol = getAgentSymbol(agent);
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
                      {isSkillPackage ? <Boxes size={16} /> : <AgentSymbol size={16} />}
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

const LIVE_WINDOW_MS = 5 * 60_000;

type LiveUser = { user: string; lastSeen: number };

function getLiveUsers(events: CallEvent[], now: number): LiveUser[] {
  const latest = new Map<string, number>();
  for (const event of events) {
    if (event.user.trim().toLowerCase() === "unknown") continue;
    const seen = Date.parse(event.timestamp);
    if (Number.isNaN(seen) || now - seen > LIVE_WINDOW_MS) continue;
    latest.set(event.user, Math.max(latest.get(event.user) ?? 0, seen));
  }
  return [...latest.entries()]
    .map(([user, lastSeen]) => ({ user, lastSeen }))
    .sort((a, b) => b.lastSeen - a.lastSeen);
}

function formatAgo(lastSeen: number, now: number) {
  const minutes = Math.floor(Math.max(0, now - lastSeen) / 60_000);
  return minutes < 1 ? "just now" : `${minutes} min ago`;
}

function LiveUsers({ users, now, loading }: { users: LiveUser[]; now: number; loading: boolean }) {
  return (
    <section className="live-users" aria-label="Users active in the last 5 minutes">
      <div className="live-users-summary">
        <span className={`live-dot${users.length ? " is-live" : ""}`} />
        <strong>{loading ? "—" : formatCount(users.length)}</strong>
        <span>{users.length === 1 ? "user" : "users"} active in the last 5 minutes</span>
      </div>
      {users.length ? (
        <ul className="live-users-list">
          {users.map((item) => (
            <li className="live-user-chip" key={item.user}>
              <span className="live-dot is-live" />
              <strong>{item.user}</strong>
              <time dateTime={new Date(item.lastSeen).toISOString()}>{formatAgo(item.lastSeen, now)}</time>
            </li>
          ))}
        </ul>
      ) : (
        <span className="live-users-empty">{loading ? "Loading…" : "No recent Copilot calls."}</span>
      )}
    </section>
  );
}

function UserTable({
  rows,
  currency,
  liveUsers,
  now,
}: {
  rows: UsageRow[];
  currency: string;
  liveUsers: LiveUser[];
  now: number;
}) {
  const liveSince = new Map(liveUsers.map((item) => [item.user, item.lastSeen]));
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
          {sortedUsers.map((item) => {
            const lastSeen = liveSince.get(item.user);
            return (
            <tr className={lastSeen !== undefined ? "user-row-live" : undefined} key={item.user}>
              <td>
                {item.user}
                {lastSeen !== undefined && (
                  <span className="live-badge" title={`Last call ${formatAgo(lastSeen, now)}`}>
                    <span className="live-dot is-live" /> LIVE
                  </span>
                )}
              </td>
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
            );
          })}
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
