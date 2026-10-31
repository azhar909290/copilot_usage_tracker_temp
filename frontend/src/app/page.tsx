"use client";

import NumberFlow from "@number-flow/react";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpRight,
  BookOpen,
  Bot,
  Boxes,
  ChevronDown,
  Command as CommandIcon,
  Cpu,
  Download,
  GitBranch,
  LayoutGrid,
  Moon,
  RefreshCw,
  Search,
  Sun,
  TriangleAlert,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { BootLoader, type BootStage } from "@/components/BootLoader";
import { Carousel } from "@/components/Carousel";
import { CommandMenu, type CommandSection } from "@/components/CommandMenu";
import { DailyBars } from "@/components/DailyBars";
import { Person } from "@/components/Person";
import { Rail, type RailItem } from "@/components/Rail";
import { RidgeMark } from "@/components/RidgeMark";
import { SignalRidge } from "@/components/SignalRidge";
import {
  csvCell,
  displayCallTime,
  formatAgo,
  formatCompact,
  formatCount,
  formatMoney,
  formatPercent,
  formatSeconds,
} from "@/lib/format";
import {
  computeFindings,
  cutoffDate,
  dailyTotals,
  dayRange,
  filterEvents,
  filterRows,
  getLiveUsers,
  groupShares,
  isUnknownUser,
  latencyStats,
  personHues,
  ridgeData,
  sumTotals,
  type CallEvent,
  type CatalogAgent,
  type CatalogResponse,
  type Finding,
  type LiveUser,
  type Metric,
  type Period,
  type Share,
  type Totals,
  type UsageRow,
} from "@/lib/usage";
import { useDashboardTheme } from "./theme";

type View = "overview" | "users" | "agents" | "models" | "activity";
type SortDirection = "asc" | "desc";
type Sort<K extends string> = { key: K; direction: SortDirection };

const API_BASE = (process.env.NEXT_PUBLIC_USAGE_API_URL || "http://127.0.0.1:4318").replace(/\/$/, "");
const API_HOST = API_BASE.replace(/^https?:\/\//, "");
const BOOT_MINIMUM_MS = 700;

const VIEWS: { id: View; label: string; icon: LucideIcon }[] = [
  { id: "overview", label: "Overview", icon: LayoutGrid },
  { id: "users", label: "Users", icon: Users },
  { id: "agents", label: "Catalog", icon: Boxes },
  { id: "models", label: "Models", icon: Cpu },
  { id: "activity", label: "Activity", icon: Activity },
];

const PERIODS: Period[] = [7, 30, 90];

const INITIAL_STAGES: BootStage[] = [
  { label: "Interface", detail: "Loading the dashboard", state: "active" },
  { label: "Receiver", detail: API_HOST, state: "pending" },
  { label: "Ledger", detail: "Usage, calls and catalog", state: "pending" },
  { label: "Composing", detail: "Charts and findings", state: "pending" },
];

function compareValues(left: unknown, right: unknown) {
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left ?? "").localeCompare(String(right ?? ""));
}

function useSort<K extends string>(initial: Sort<K>, textKeys: K[]) {
  const [sort, setSort] = useState(initial);
  const toggle = (key: K) =>
    setSort((current) => ({
      key,
      direction:
        current.key === key
          ? current.direction === "asc"
            ? "desc"
            : "asc"
          : textKeys.includes(key)
            ? "asc"
            : "desc",
    }));
  return [sort, toggle] as const;
}

function SortHeader<K extends string>({
  sortKey,
  label,
  sort,
  onSort,
  numeric = false,
}: {
  sortKey: K;
  label: string;
  sort: Sort<K>;
  onSort: (key: K) => void;
  numeric?: boolean;
}) {
  const active = sort.key === sortKey;
  return (
    <th
      className={numeric ? "num" : undefined}
      aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
    >
      <button className="sort-button" data-active={active || undefined} type="button" onClick={() => onSort(sortKey)}>
        <span className="sort-label">{label}</span>
        {active && <span aria-hidden="true">{sort.direction === "asc" ? "↑" : "↓"}</span>}
      </button>
    </th>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
  format,
  id,
}: {
  label: string;
  options: T[];
  value: T;
  onChange: (value: T) => void;
  format: (value: T) => string;
  id: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button key={option} type="button" aria-pressed={option === value} onClick={() => onChange(option)}>
          {format(option)}
          {option === value && (
            <motion.span className="select-line" layoutId={id} transition={{ type: "spring", stiffness: 560, damping: 44 }} />
          )}
        </button>
      ))}
    </div>
  );
}

function FilterSelect({
  label,
  allLabel,
  value,
  options,
  onChange,
  icon: Icon,
}: {
  label: string;
  allLabel: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  icon: LucideIcon;
}) {
  return (
    <label className="select" data-active={value !== "all" || undefined}>
      <Icon size={14} strokeWidth={1.6} aria-hidden="true" />
      <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="all">{allLabel}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <ChevronDown size={14} aria-hidden="true" />
    </label>
  );
}

export default function Home() {
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const { theme, toggleTheme } = useDashboardTheme();
  const [view, setView] = useState<View>("overview");
  const [period, setPeriod] = useState<Period>(30);
  const [metric, setMetric] = useState<Metric>("calls");
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
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [stages, setStages] = useState<BootStage[]>(INITIAL_STAGES);
  const [booting, setBooting] = useState(true);
  const searchRef = useRef<HTMLInputElement>(null);
  const bootPending = useRef(true);
  const composeStarted = useRef(0);

  function updateStage(index: number, patch: Partial<BootStage>) {
    setStages((current) => current.map((stage, position) => (position === index ? { ...stage, ...patch } : stage)));
  }

  function finishBoot(delay = 0) {
    window.setTimeout(() => setBooting(false), Math.max(delay, BOOT_MINIMUM_MS - performance.now()));
  }

  function showView(next: View) {
    setView(next);
    window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      )
        return;
      event.preventDefault();
      searchRef.current?.focus();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    let active = true;

    async function loadDashboard() {
      const boot = bootPending.current;
      const started = performance.now();
      if (active) setRefreshing(true);
      if (active && boot) {
        updateStage(0, { state: "done", duration: started });
        updateStage(1, { state: "active" });
      }
      try {
        const [usageResponse, agentResponse] = await Promise.all([
          fetch(`${API_BASE}/api/v1/usage`, { cache: "no-store" }),
          fetch(`${API_BASE}/api/v1/agents`, { cache: "no-store" }),
        ]);
        if (!usageResponse.ok || !agentResponse.ok) {
          throw new Error(`API request failed: usage ${usageResponse.status}, agents ${agentResponse.status}`);
        }
        const connected = performance.now();
        if (active && boot) {
          updateStage(1, { state: "done", duration: connected - started });
          updateStage(2, { state: "active" });
        }
        const [usagePayload, agentPayload] = await Promise.all([usageResponse.json(), agentResponse.json()]);
        if (!active) return;
        const rows: UsageRow[] = Array.isArray(usagePayload.rows) ? usagePayload.rows : [];
        const events: CallEvent[] =
          Array.isArray(usagePayload.events) && usagePayload.events.length > 0
            ? usagePayload.events
            : rows.map((row, index) => ({
                key: `${row.date}-${row.user}-${row.agent}-${row.model}-${index}`,
                timestamp: row.last_seen || row.first_seen || `${row.date}T00:00:00Z`,
                date: row.date,
                user: row.user,
                agent: row.agent,
                model: row.model,
                input_tokens: row.input_tokens,
                output_tokens: row.output_tokens,
                total_tokens: (row.input_tokens || 0) + (row.output_tokens || 0),
                latency_ms: row.latency_ms_avg ?? null,
                cost: row.cost,
              }));
        if (boot) {
          updateStage(2, {
            state: "done",
            duration: performance.now() - connected,
            detail: `${formatCount(events.length)} calls · ${formatCount(agentPayload?.agents?.length ?? 0)} catalog items`,
          });
          updateStage(3, { state: "active" });
          composeStarted.current = performance.now();
        }
        setUsageRows(rows);
        setCurrency(usagePayload.currency || "USD");
        setCatalog(agentPayload);
        setCallEvents(events);
        setUpdatedAt(new Date());
        setNow(Date.now());
        setError(null);
      } catch (loadError) {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : "Could not connect to the usage API.");
        if (boot) {
          setStages((current) =>
            current.map((stage) => (stage.state === "active" ? { ...stage, state: "failed" } : stage)),
          );
          bootPending.current = false;
          finishBoot(900);
        }
      } finally {
        if (active) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    }

    void loadDashboard();
    const interval = autoRefresh ? window.setInterval(() => void loadDashboard(), 30_000) : undefined;
    return () => {
      active = false;
      if (interval) window.clearInterval(interval);
    };
  }, [autoRefresh, refreshKey]);

  // The last boot stage completes once the first data has been committed and painted.
  useEffect(() => {
    if (!updatedAt || !bootPending.current) return;
    bootPending.current = false;
    const frame = window.requestAnimationFrame(() => {
      updateStage(3, { state: "done", duration: performance.now() - composeStarted.current });
      finishBoot();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [updatedAt]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(interval);
  }, []);

  const filters = useMemo(
    () => ({
      cutoff: cutoffDate(updatedAt, period),
      user: selectedUser,
      agent: selectedAgent,
      model: selectedModel,
      search,
    }),
    [updatedAt, period, selectedUser, selectedAgent, selectedModel, search],
  );
  const filteredRows = useMemo(() => filterRows(usageRows, filters), [usageRows, filters]);
  const filteredEvents = useMemo(() => filterEvents(callEvents, filters), [callEvents, filters]);
  const totals = useMemo(() => sumTotals(filteredRows), [filteredRows]);
  const latency = useMemo(() => latencyStats(filteredEvents), [filteredEvents]);
  const liveUsers = useMemo(() => getLiveUsers(callEvents, now), [callEvents, now]);
  const today = updatedAt ? updatedAt.toISOString().slice(0, 10) : null;
  const days = useMemo(() => {
    if (!today || !filters.cutoff) return [];
    const latest = filteredRows.reduce((last, row) => (row.date > last ? row.date : last), today);
    return dayRange(filters.cutoff, latest);
  }, [today, filters.cutoff, filteredRows]);
  const agentNames = useMemo(
    () => [...new Set([...usageRows.map((row) => row.agent), ...callEvents.map((event) => event.agent)])].sort(),
    [usageRows, callEvents],
  );
  const modelNames = useMemo(
    () => [...new Set([...usageRows.map((row) => row.model), ...callEvents.map((event) => event.model)])].sort(),
    [usageRows, callEvents],
  );
  const userNames = useMemo(
    () => [...new Set([...usageRows.map((row) => row.user), ...callEvents.map((event) => event.user)])].sort(),
    [usageRows, callEvents],
  );
  const hues = useMemo(() => personHues(userNames), [userNames]);
  const rangeLabel = `the last ${period} days`;
  const findings = useMemo(
    () => computeFindings({ rows: filteredRows, events: filteredEvents, totals, rangeLabel }),
    [filteredRows, filteredEvents, totals, rangeLabel],
  );
  const modelShares = useMemo(() => groupShares(filteredRows, "model"), [filteredRows]);
  const activeUsers = useMemo(
    () => new Set(filteredRows.map((row) => row.user).filter((user) => !isUnknownUser(user))).size,
    [filteredRows],
  );
  const filtersActive = selectedUser !== "all" || selectedAgent !== "all" || selectedModel !== "all" || search !== "";

  function clearFilters() {
    setSelectedUser("all");
    setSelectedAgent("all");
    setSelectedModel("all");
    setSearch("");
  }

  function applyFinding(finding: Finding) {
    const action = finding.action;
    if (!action) return;
    switch (action.kind) {
      case "models":
      case "users":
      case "activity":
        showView(action.kind);
        break;
      case "model":
        setSelectedModel(action.value);
        break;
      case "agent":
        setSelectedAgent(action.value);
        break;
      case "user":
        setSelectedUser(action.value);
        break;
      case "date":
        openDay(action.value);
        break;
    }
  }

  function openDay(date: string) {
    setSearch(date);
    showView("activity");
  }

  function exportCsv() {
    const download = (content: string, filename: string) => {
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
      link.download = filename;
      link.click();
      URL.revokeObjectURL(link.href);
    };
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
        columns.map(csvCell).join(","),
        ...filteredEvents.map((event) =>
          columns
            .map((column) =>
              column === "total_tokens"
                ? csvCell((event.input_tokens || 0) + (event.output_tokens || 0))
                : csvCell(event[column]),
            )
            .join(","),
        ),
      ].join("\n");
      download(csv, "copilot-call-activity.csv");
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
      columns.map(csvCell).join(","),
      ...filteredRows.map((row) => columns.map((column) => csvCell(row[column])).join(",")),
    ].join("\n");
    download(csv, "copilot-usage.csv");
  }

  const railItems: RailItem[] = [
    ...VIEWS.map((item) => ({ ...item, onSelect: () => showView(item.id) })),
    { id: "github", label: "GitHub metrics", short: "GitHub", icon: GitBranch, href: "/github-metrics" },
  ];

  const sections: CommandSection[] = [
    {
      heading: "Views",
      items: [
        ...VIEWS.map((item) => ({ id: item.id, label: item.label, icon: item.icon, run: () => showView(item.id) })),
        { id: "github", label: "GitHub metrics", icon: GitBranch, run: () => router.push("/github-metrics") },
      ],
    },
    {
      heading: "Agents",
      items: agentNames.map((name) => ({
        id: name,
        label: name,
        icon: Bot,
        hint: "Agent",
        run: () => {
          showView("agents");
          setSelectedAgent(name);
          setSelectedUser("all");
          setSelectedModel("all");
          setSearch("");
        },
      })),
    },
    {
      heading: "Users",
      items: userNames.map((name) => ({
        id: name,
        label: name,
        icon: Users,
        hint: "User",
        run: () => {
          showView("users");
          setSelectedUser(name);
          setSelectedAgent("all");
          setSelectedModel("all");
          setSearch("");
        },
      })),
    },
    {
      heading: "Models",
      items: modelNames.map((name) => ({
        id: name,
        label: name,
        icon: Cpu,
        hint: "Model",
        run: () => {
          showView("models");
          setSelectedModel(name);
        },
      })),
    },
    {
      heading: "Actions",
      items: [
        { id: "refresh", label: "Refresh data", icon: RefreshCw, run: () => setRefreshKey((key) => key + 1) },
        {
          id: "theme",
          label: theme === "dark" ? "Switch to light mode" : "Switch to dark mode",
          icon: theme === "dark" ? Sun : Moon,
          run: toggleTheme,
        },
        {
          id: "auto-refresh",
          label: autoRefresh ? "Pause auto-refresh" : "Resume auto-refresh",
          icon: RefreshCw,
          run: () => setAutoRefresh((value) => !value),
        },
        { id: "export", label: "Export CSV", icon: Download, run: exportCsv },
        { id: "clear", label: "Clear filters", icon: X, run: clearFilters },
      ],
    },
  ];

  const viewLabel = VIEWS.find((item) => item.id === view)?.label ?? "Overview";
  const scope = selectedUser === "all" ? "Team workspace" : selectedUser;
  const freshness = error
    ? updatedAt
      ? `Couldn’t refresh · last good ${updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
      : "Receiver unreachable"
    : updatedAt
      ? `Updated ${updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
      : "Connecting";
  const lead = findings[0];
  const resultCount = view === "activity" ? filteredEvents.length : totals.requests;

  return (
    <>
      <BootLoader visible={booting} stages={stages} />
      <div className="app" inert={booting}>
        <Rail
          items={railItems}
          active={view}
          utilities={[
            { id: "search", label: "Search", tip: "Search  ⌘K", icon: CommandIcon, onSelect: () => setPaletteOpen(true) },
            {
              id: "theme",
              label: theme === "dark" ? "Light mode" : "Dark mode",
              icon: theme === "dark" ? Sun : Moon,
              onSelect: toggleTheme,
            },
            { id: "docs", label: "API reference", icon: BookOpen, href: `${API_BASE}/docs` },
          ]}
        />
        <main className="canvas" id="main">
          <div className="mobile-bar">
            <RidgeMark size={22} />
            <strong>Agent Command Center</strong>
            <button className="icon-button" type="button" aria-label="Search" onClick={() => setPaletteOpen(true)}>
              <Search size={16} aria-hidden="true" />
            </button>
            <button
              className="icon-button"
              type="button"
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              onClick={toggleTheme}
            >
              {theme === "dark" ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
            </button>
          </div>

          <header className="title-row">
            <div className="title-block">
              <h1>{viewLabel}</h1>
              <p className="title-meta">
                <span>{scope}</span>
                <span aria-hidden="true">·</span>
                <span>last {period} days</span>
                <span aria-hidden="true">·</span>
                <span className="freshness" data-state={error ? "error" : updatedAt ? "ok" : "pending"}>
                  <i aria-hidden="true" />
                  {freshness}
                </span>
              </p>
              {view === "overview" && lead && (
                <p className="title-finding">
                  <span className="num">
                    {lead.figure}
                    {lead.unit === "%" ? "%" : ` ${lead.unit ?? ""}`}
                  </span>{" "}
                  {lead.text}
                </p>
              )}
            </div>
            <div className="title-actions">
              <Segmented
                id="period-line"
                label="Date range"
                options={PERIODS}
                value={period}
                onChange={setPeriod}
                format={(days) => `${days}d`}
              />
              <button className="toggle" type="button" aria-pressed={autoRefresh} onClick={() => setAutoRefresh((value) => !value)}>
                Auto-refresh
              </button>
              <button
                className="icon-button"
                type="button"
                title="Refresh data"
                aria-label="Refresh data"
                disabled={refreshing}
                onClick={() => setRefreshKey((key) => key + 1)}
              >
                <RefreshCw size={15} className={refreshing ? "spin" : undefined} aria-hidden="true" />
              </button>
              <button
                className="button"
                type="button"
                disabled={view === "activity" ? !filteredEvents.length : !filteredRows.length}
                onClick={exportCsv}
              >
                <ArrowDownToLine size={14} aria-hidden="true" />
                <span className="button-label">Export CSV</span>
              </button>
            </div>
          </header>

          <section className="toolbar" aria-label="Filters">
            <label className="search">
              <Search size={15} aria-hidden="true" />
              <input
                ref={searchRef}
                aria-label="Search usage"
                placeholder="Search date, user, agent, model"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              {search ? (
                <button type="button" className="search-clear" aria-label="Clear search" onClick={() => setSearch("")}>
                  <X size={13} aria-hidden="true" />
                </button>
              ) : (
                <kbd>/</kbd>
              )}
            </label>
            <div className="toolbar-selects">
              <FilterSelect label="Filter by user" allLabel="All users" value={selectedUser} options={userNames} onChange={setSelectedUser} icon={Users} />
              <FilterSelect label="Filter by agent" allLabel="All agents" value={selectedAgent} options={agentNames} onChange={setSelectedAgent} icon={Bot} />
              <FilterSelect label="Filter by model" allLabel="All models" value={selectedModel} options={modelNames} onChange={setSelectedModel} icon={Cpu} />
            </div>
            <div className="toolbar-end">
              <span className="muted">
                <span className="num">{formatCount(resultCount)}</span> {resultCount === 1 ? "call" : "calls"}
              </span>
              {filtersActive && (
                <button className="text-button" type="button" onClick={clearFilters}>
                  Clear filters
                </button>
              )}
            </div>
          </section>

          {error && (
            <div className="notice is-negative" role="alert">
              <TriangleAlert size={15} aria-hidden="true" />
              <span>
                Couldn’t load usage from {API_HOST}.{" "}
                {updatedAt
                  ? `Showing data from ${updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`
                  : "Nothing has loaded yet."}{" "}
                <span className="muted">{error}</span>
              </span>
              <button className="text-button" type="button" onClick={() => setRefreshKey((key) => key + 1)}>
                Retry
              </button>
            </div>
          )}
          {catalog?.stale && (
            <div className="notice is-warning" role="status">
              <TriangleAlert size={15} aria-hidden="true" />
              <span>Showing the last saved agent catalog; its refresh failed.</span>
            </div>
          )}

          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={view}
              className="view"
              initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            >
              {view === "overview" && (
                <>
                  <LiveStrip users={liveUsers} now={now} hues={hues} loading={loading} />
                  <section className="kpis" aria-label={`Totals for the last ${period} days. Calls, tokens and cost also choose the chart metric.`}>
                    <KpiCell label="Calls" metric="calls" selected={metric} onSelect={setMetric} note={`${formatCount(new Set(filteredRows.map((row) => row.agent)).size)} agents · ${formatCount(new Set(filteredRows.map((row) => row.model)).size)} models`}>
                      <NumberFlow value={totals.requests} locales="en-US" />
                    </KpiCell>
                    <KpiCell label="Tokens" metric="tokens" selected={metric} onSelect={setMetric} note={`${formatCompact(totals.input)} in · ${formatCompact(totals.output)} out`}>
                      <NumberFlow value={totals.input + totals.output} locales="en-US" format={{ notation: "compact", maximumFractionDigits: 2 }} />
                    </KpiCell>
                    <KpiCell
                      label="Est. cost"
                      metric="cost"
                      selected={metric}
                      onSelect={setMetric}
                      note={
                        totals.unpriced ? (
                          <span className="pill is-warning">{formatCount(totals.unpriced)} unpriced</span>
                        ) : totals.input + totals.output ? (
                          `${formatMoney((totals.cost / (totals.input + totals.output)) * 1000, currency, 4)} per 1k tokens`
                        ) : (
                          "No priced calls"
                        )
                      }
                    >
                      <NumberFlow value={totals.cost} locales="en-US" format={{ style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }} />
                    </KpiCell>
                    <KpiCell label="Users" note={`${formatCount(liveUsers.length)} live now`}>
                      <NumberFlow value={activeUsers} locales="en-US" />
                    </KpiCell>
                    <KpiCell label="Median latency" note={latency.p95 ? `p95 ${formatSeconds(latency.p95)}` : "No latency recorded"}>
                      {latency.median ? (
                        <>
                          <NumberFlow value={latency.median / 1000} locales="en-US" format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }} />
                          <span className="unit">s</span>
                        </>
                      ) : (
                        <span className="dash">—</span>
                      )}
                    </KpiCell>
                  </section>

                  <OverviewCharts
                    days={days}
                    rows={filteredRows}
                    events={filteredEvents}
                    metric={metric}
                    currency={currency}
                    today={today ?? ""}
                    onOpenDay={openDay}
                  />

                  <Carousel
                    label="Findings"
                    heading={
                      <>
                        <h2>Findings</h2>
                        <p>
                          {findings.length
                            ? `${findings.length} facts from ${rangeLabel}, strongest first`
                            : `Facts appear once calls are recorded in ${rangeLabel}`}
                        </p>
                      </>
                    }
                  >
                    {findings.map((finding) => (
                      <FindingCard key={finding.id} finding={finding} onAct={() => applyFinding(finding)} />
                    ))}
                  </Carousel>

                  <div className="pair">
                    <ShareList
                      title="Models"
                      note="Share of tokens"
                      shares={modelShares}
                      value={(share) => share.tokens}
                      format={(value) => formatCompact(value)}
                      unit="tokens"
                      onOpen={() => showView("models")}
                      onPick={(name) => setSelectedModel(name)}
                    />
                    <ShareList
                      title="Agents"
                      note="Share of calls"
                      shares={groupShares(filteredRows, "agent")}
                      value={(share) => share.calls}
                      format={(value) => formatCount(value)}
                      unit="calls"
                      onOpen={() => showView("agents")}
                      onPick={(name) => setSelectedAgent(name)}
                    />
                  </div>

                  <RecentCalls events={filteredEvents} hues={hues} currency={currency} now={now} onViewAll={() => showView("activity")} />
                </>
              )}

              {view === "agents" && (
                <section className="block">
                  <header className="block-head">
                    <div className="block-title">
                      <h2>Agents and skill packages</h2>
                      <p>Marketplace inventory matched to recorded usage</p>
                    </div>
                    <span className="muted">
                      <span className="num">{formatCount(catalog?.agents.length ?? 0)}</span> listed
                    </span>
                  </header>
                  <CatalogTable agents={catalog?.agents ?? []} usage={filteredRows} currency={currency} />
                  {!!catalog?.error && <p className="table-note">Catalog refresh issue: {catalog.error}</p>}
                </section>
              )}

              {view === "users" && (
                <section className="block">
                  <header className="block-head">
                    <div className="block-title">
                      <h2>Usage by user</h2>
                      <p>Calls, tokens and estimated cost per person</p>
                    </div>
                    <span className="muted">
                      <span className="num">{formatCount(userNames.length)}</span> users ·{" "}
                      <span className="num">{formatCount(liveUsers.length)}</span> live
                    </span>
                  </header>
                  <UserTable rows={filteredRows} currency={currency} liveUsers={liveUsers} now={now} hues={hues} />
                </section>
              )}

              {view === "models" && (
                <section className="block">
                  <header className="block-head">
                    <div className="block-title">
                      <h2>Usage by model</h2>
                      <p>Share is each model’s part of all tokens in range</p>
                    </div>
                    <span className="muted">
                      <span className="num">{formatCount(modelShares.length)}</span> models
                    </span>
                  </header>
                  <ModelTable shares={modelShares} totals={totals} currency={currency} loading={loading} />
                </section>
              )}

              {view === "activity" && (
                <ActivityTable events={filteredEvents} loading={loading} currency={currency} hues={hues} />
              )}
            </motion.div>
          </AnimatePresence>

          <footer className="status-footer">
            <span className="freshness" data-state={error ? "error" : updatedAt ? "ok" : "pending"}>
              <i aria-hidden="true" />
              Receiver {error ? "unavailable" : "operational"}
            </span>
            <span className="num">{API_HOST}</span>
            <a href={`${API_BASE}/docs`} target="_blank" rel="noreferrer">
              API reference <ArrowUpRight size={12} aria-hidden="true" />
            </a>
          </footer>
        </main>
      </div>
      {paletteOpen && <CommandMenu open onOpenChange={setPaletteOpen} sections={sections} />}
    </>
  );
}

function KpiCell({
  label,
  metric,
  selected,
  onSelect,
  note,
  children,
}: {
  label: string;
  metric?: Metric;
  selected?: Metric;
  onSelect?: (metric: Metric) => void;
  note: ReactNode;
  children: ReactNode;
}) {
  const isSelected = metric !== undefined && metric === selected;
  const body = (
    <>
      <span className="kpi-label">
        {label}
        {isSelected && (
          <motion.span className="select-line kpi-line" layoutId="kpi-line" transition={{ type: "spring", stiffness: 560, damping: 44 }} />
        )}
      </span>
      <span className="kpi-value num">{children}</span>
      <span className="kpi-note">{note}</span>
    </>
  );
  return metric && onSelect ? (
    <button className="kpi" type="button" aria-pressed={isSelected} onClick={() => onSelect(metric)}>
      {body}
    </button>
  ) : (
    <div className="kpi">{body}</div>
  );
}

function LiveStrip({
  users,
  now,
  hues,
  loading,
}: {
  users: LiveUser[];
  now: number;
  hues: Map<string, number>;
  loading: boolean;
}) {
  return (
    <section className="live" aria-label="Users active in the last 5 minutes">
      <span className="freshness" data-state={users.length ? "live" : "idle"}>
        <i aria-hidden="true" />
        {loading
          ? "Checking for live users"
          : users.length
            ? `${formatCount(users.length)} ${users.length === 1 ? "user" : "users"} active in the last 5 minutes`
            : "No Copilot calls in the last 5 minutes"}
      </span>
      {users.length > 0 && (
        <ul className="live-list">
          {users.map((item) => (
            <li key={item.user}>
              <Person name={item.user} hue={hues.get(item.user)}>
                <time className="muted" dateTime={new Date(item.lastSeen).toISOString()}>
                  {formatAgo(item.lastSeen, now)}
                </time>
              </Person>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const OverviewCharts = memo(function OverviewCharts({
  days,
  rows,
  events,
  metric,
  currency,
  today,
  onOpenDay,
}: {
  days: string[];
  rows: UsageRow[];
  events: CallEvent[];
  metric: Metric;
  currency: string;
  today: string;
  onOpenDay: (date: string) => void;
}) {
  const [hoverDate, setHoverDate] = useState<string | null>(null);
  const totals = useMemo(() => dailyTotals(rows, days, metric), [rows, days, metric]);
  const ridge = useMemo(() => ridgeData(events, days, metric), [events, days, metric]);
  const noun = metric === "cost" ? "Estimated cost" : metric === "tokens" ? "Tokens" : "Calls";

  return (
    <div className="chart-row">
      <section className="block ridge-block">
        <header className="block-head">
          <div className="block-title">
            <h2>Daily rhythm</h2>
            <p>{noun} by time of day, one line per day, newest in front</p>
          </div>
          <span className="muted">UTC · 18-min smoothing</span>
        </header>
        <SignalRidge
          data={ridge}
          metric={metric}
          dayTotals={totals}
          currency={currency}
          today={today}
          highlightDate={hoverDate}
          onHoverDate={setHoverDate}
          onSelectDate={onOpenDay}
        />
      </section>
      <section className="block bars-block">
        <header className="block-head">
          <div className="block-title">
            <h2>{noun} per day</h2>
            <p>Receiver days, same filters as above</p>
          </div>
        </header>
        <DailyBars
          days={days}
          values={totals}
          metric={metric}
          currency={currency}
          highlight={hoverDate}
          onHover={setHoverDate}
          onSelect={onOpenDay}
        />
      </section>
    </div>
  );
});

function FindingCard({ finding, onAct }: { finding: Finding; onAct: () => void }) {
  return (
    <article className="finding">
      <p className="finding-label">{finding.label}</p>
      <p className="finding-figure num">
        {finding.figure}
        {finding.unit && <span className="unit">{finding.unit}</span>}
      </p>
      <p className="finding-text">{finding.text}</p>
      {finding.action && (
        <button className="text-button finding-action" type="button" onClick={onAct}>
          {finding.action.label} <ArrowUpRight size={13} aria-hidden="true" />
        </button>
      )}
    </article>
  );
}

function ShareList({
  title,
  note,
  shares,
  value,
  format,
  unit,
  onOpen,
  onPick,
}: {
  title: string;
  note: string;
  shares: Share[];
  value: (share: Share) => number;
  format: (value: number) => string;
  unit: string;
  onOpen: () => void;
  onPick: (name: string) => void;
}) {
  const sorted = [...shares].sort((a, b) => value(b) - value(a));
  const total = sorted.reduce((sum, share) => sum + value(share), 0);
  const top = sorted.slice(0, 5);
  const largest = top[0] ? value(top[0]) : 0;
  return (
    <section className="block">
      <header className="block-head">
        <div className="block-title">
          <h2>{title}</h2>
          <p>
            {note} · {formatCount(sorted.length)} in range
          </p>
        </div>
        <button className="text-button" type="button" onClick={onOpen}>
          View all <ArrowUpRight size={13} aria-hidden="true" />
        </button>
      </header>
      {top.length ? (
        <div className="share">
          <div className="share-head" aria-hidden="true">
            <span>Name</span>
            <span className="num">Share</span>
            <span className="num">{unit[0].toUpperCase() + unit.slice(1)}</span>
          </div>
          <ol className="share-rows">
            {top.map((share) => (
              <li key={share.name} style={{ "--fill": largest ? value(share) / largest : 0 } as CSSProperties}>
                <button type="button" className="share-name" title={`Filter to ${share.name}`} onClick={() => onPick(share.name)}>
                  {share.name}
                </button>
                <span className="num muted">{formatPercent(total ? (value(share) / total) * 100 : 0)}</span>
                <span className="num">{format(value(share))}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <Empty>No {unit} in this range.</Empty>
      )}
    </section>
  );
}

function RecentCalls({
  events,
  hues,
  currency,
  now,
  onViewAll,
}: {
  events: CallEvent[];
  hues: Map<string, number>;
  currency: string;
  now: number;
  onViewAll: () => void;
}) {
  const recent = [...events]
    .sort((a, b) => Date.parse(b.timestamp || b.date) - Date.parse(a.timestamp || a.date))
    .slice(0, 5);
  return (
    <section className="block">
      <header className="block-head">
        <div className="block-title">
          <h2>Recent calls</h2>
          <p>Latest recorded model calls, newest first</p>
        </div>
        <button className="text-button" type="button" onClick={onViewAll}>
          Full activity <ArrowUpRight size={13} aria-hidden="true" />
        </button>
      </header>
      {recent.length ? (
        <div className="table-frame">
          <table className="table">
            <thead>
              <tr>
                <th>Time</th>
                <th>User</th>
                <th>Agent</th>
                <th>Model</th>
                <th className="num">Tokens</th>
                <th className="num">Latency</th>
                <th className="num">Est. cost</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((call, index) => {
                const time = Date.parse(call.timestamp);
                return (
                  <tr key={`${call.key}-${index}`}>
                    <td className="num muted nowrap">
                      <time dateTime={call.timestamp} title={displayCallTime(call.timestamp)}>
                        {Number.isNaN(time)
                          ? "Time unavailable"
                          : now && now - time < 3_600_000
                            ? formatAgo(time, now)
                            : new Date(time).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}
                      </time>
                    </td>
                    <td>
                      <Person name={call.user} hue={hues.get(call.user)} />
                    </td>
                    <td className="ellipsis" title={call.agent}>{call.agent}</td>
                    <td className="ellipsis muted" title={call.model}>{call.model}</td>
                    <td className="num">{formatCount((call.input_tokens || 0) + (call.output_tokens || 0))}</td>
                    <td className="num muted">{formatSeconds(call.latency_ms)}</td>
                    <td className="num">{formatMoney(call.cost, currency, 4)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>No calls match these filters.</Empty>
      )}
    </section>
  );
}

function ShareBar({ share }: { share: number }) {
  return (
    <span className="share-cell">
      <span className="share-track" aria-hidden="true">
        <span style={{ width: `${Math.min(100, share)}%` }} />
      </span>
      <span className="num">{formatPercent(share)}</span>
    </span>
  );
}

function ModelTable({
  shares,
  totals,
  currency,
  loading,
}: {
  shares: Share[];
  totals: Totals;
  currency: string;
  loading: boolean;
}) {
  type Key = "name" | "calls" | "tokens" | "cost" | "share";
  const [sort, onSort] = useSort<Key>({ key: "tokens", direction: "desc" }, ["name"]);
  const totalTokens = totals.input + totals.output;
  const items = shares.map((share) => ({ ...share, share: totalTokens ? (share.tokens / totalTokens) * 100 : 0 }));
  const sorted = [...items].sort((a, b) => {
    const result = compareValues(a[sort.key], b[sort.key]);
    return sort.direction === "asc" ? result : -result;
  });
  return (
    <div className="table-frame">
      <table className="table">
        <thead>
          <tr>
            <SortHeader sortKey="name" label="Model" sort={sort} onSort={onSort} />
            <SortHeader sortKey="calls" label="Calls" sort={sort} onSort={onSort} numeric />
            <SortHeader sortKey="tokens" label="Tokens" sort={sort} onSort={onSort} numeric />
            <SortHeader sortKey="cost" label="Est. cost" sort={sort} onSort={onSort} numeric />
            <SortHeader sortKey="share" label="Share" sort={sort} onSort={onSort} numeric />
          </tr>
        </thead>
        <tbody>
          {sorted.map((model) => (
            <tr key={model.name}>
              <td className="strong">{model.name}</td>
              <td className="num">{formatCount(model.calls)}</td>
              <td className="num">{formatCount(model.tokens)}</td>
              <td className="num">{formatMoney(model.cost, currency)}</td>
              <td className="num">
                <ShareBar share={model.share} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!shares.length && <Empty>{loading ? "Loading usage…" : "No model usage in this date range."}</Empty>}
    </div>
  );
}

function CatalogTable({ agents, usage, currency }: { agents: CatalogAgent[]; usage: UsageRow[]; currency: string }) {
  type Key = "name" | "plugin" | "requests" | "tokens" | "cost" | "status";
  const [sort, onSort] = useSort<Key>({ key: "requests", direction: "desc" }, ["name", "plugin"]);

  const metrics = new Map<string, { requests: number; tokens: number; cost: number }>();
  const observedNames = new Map<string, string>();
  for (const row of usage) {
    const key = row.agent.trim().toLocaleLowerCase();
    const current = metrics.get(key) || { requests: 0, tokens: 0, cost: 0 };
    current.requests += row.requests;
    current.tokens += row.input_tokens + row.output_tokens;
    current.cost += row.cost;
    metrics.set(key, current);
    observedNames.set(key, row.agent);
  }
  const catalogNames = new Set(
    agents.flatMap((agent) => [agent.name, agent.id].map((name) => name.trim().toLocaleLowerCase())),
  );

  type Row = {
    key: string;
    name: string;
    kind: string;
    description: string;
    skills?: string[];
    plugin: string;
    version: string;
    isSkillPackage: boolean;
    requests: number;
    tokens: number;
    cost: number;
    status: "Tracked" | "No usage" | "Skills only";
    statusScore: number;
  };

  const catalogRows: Row[] = agents.map((agent, index) => {
    const isSkillPackage = agent.kind === "skill_package";
    const metricKey = isSkillPackage
      ? undefined
      : [agent.name, agent.id].map((candidate) => candidate.trim().toLocaleLowerCase()).find((candidate) => metrics.has(candidate));
    const measure = metricKey ? metrics.get(metricKey) : undefined;
    return {
      key: `${agent.plugin_id}-${agent.id}-${index}`,
      name: agent.name,
      kind: isSkillPackage ? "Skill package" : "Agent",
      description: isSkillPackage ? `${agent.skills?.length ?? 0} skills` : agent.description,
      skills: agent.skills,
      plugin: agent.plugin_name || agent.plugin_id || "—",
      version: agent.version ? `v${agent.version}` : "",
      isSkillPackage,
      requests: isSkillPackage ? 0 : measure?.requests || 0,
      tokens: isSkillPackage ? 0 : measure?.tokens || 0,
      cost: isSkillPackage ? 0 : measure?.cost || 0,
      status: isSkillPackage ? "Skills only" : measure ? "Tracked" : "No usage",
      statusScore: isSkillPackage ? 1 : measure ? 2 : 0,
    };
  });
  const unlistedRows: Row[] = [...metrics.entries()]
    .filter(([key]) => !catalogNames.has(key))
    .map(([key, measure]) => ({
      key: `tracked-${key}`,
      name: observedNames.get(key) || key,
      kind: "Telemetry only",
      description: "Observed in usage telemetry",
      plugin: "Not in marketplace",
      version: "",
      isSkillPackage: false,
      requests: measure.requests,
      tokens: measure.tokens,
      cost: measure.cost,
      status: "Tracked",
      statusScore: 2,
    }));
  const rows = [...catalogRows, ...unlistedRows];
  const sorted = [...rows].sort((a, b) => {
    const result =
      sort.key === "status" ? a.statusScore - b.statusScore : compareValues(a[sort.key], b[sort.key]);
    return sort.direction === "asc" ? result : -result;
  });

  return (
    <div className="table-frame">
      <table className="table catalog-table">
        <thead>
          <tr>
            <SortHeader sortKey="name" label="Agent or package" sort={sort} onSort={onSort} />
            <SortHeader sortKey="plugin" label="Plugin" sort={sort} onSort={onSort} />
            <SortHeader sortKey="requests" label="Calls" sort={sort} onSort={onSort} numeric />
            <SortHeader sortKey="tokens" label="Tokens" sort={sort} onSort={onSort} numeric />
            <SortHeader sortKey="cost" label="Est. cost" sort={sort} onSort={onSort} numeric />
            <SortHeader sortKey="status" label="Status" sort={sort} onSort={onSort} />
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={row.key}>
              <td>
                <span className="stack">
                  <strong>{row.name}</strong>
                  <small title={row.description}>
                    {row.kind} · {row.description}
                  </small>
                  {row.isSkillPackage && !!row.skills?.length && (
                    <small title={row.skills.join(", ")}>{row.skills.join(", ")}</small>
                  )}
                </span>
              </td>
              <td>
                <span className="stack">
                  <span>{row.plugin}</span>
                  {row.version && <small className="num">{row.version}</small>}
                </span>
              </td>
              <td className="num">{row.isSkillPackage ? <span className="dash">—</span> : formatCount(row.requests)}</td>
              <td className="num">{row.isSkillPackage ? <span className="dash">—</span> : formatCompact(row.tokens)}</td>
              <td className="num">{row.isSkillPackage ? <span className="dash">—</span> : formatMoney(row.cost, currency)}</td>
              <td>
                <span className={`pill ${row.status === "Tracked" ? "is-positive" : "is-neutral"}`}>{row.status}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <Empty>No marketplace agents found.</Empty>}
    </div>
  );
}

function UserTable({
  rows,
  currency,
  liveUsers,
  now,
  hues,
}: {
  rows: UsageRow[];
  currency: string;
  liveUsers: LiveUser[];
  now: number;
  hues: Map<string, number>;
}) {
  type Key = "user" | "requests" | "input" | "output" | "tokens" | "cost" | "share";
  const [sort, onSort] = useSort<Key>({ key: "cost", direction: "desc" }, ["user"]);
  const liveSince = new Map(liveUsers.map((item) => [item.user, item.lastSeen]));
  const metrics = new Map<string, { requests: number; input: number; output: number; cost: number; unpriced: number }>();
  for (const row of rows) {
    const current = metrics.get(row.user) || { requests: 0, input: 0, output: 0, cost: 0, unpriced: 0 };
    current.requests += row.requests;
    current.input += row.input_tokens;
    current.output += row.output_tokens;
    current.cost += row.cost;
    current.unpriced += row.unpriced_requests;
    metrics.set(row.user, current);
  }
  const totalTokens = [...metrics.values()].reduce((total, measure) => total + measure.input + measure.output, 0);
  const items = [...metrics.entries()].map(([user, measure]) => {
    const tokens = measure.input + measure.output;
    return { user, ...measure, tokens, share: totalTokens ? (tokens / totalTokens) * 100 : 0 };
  });
  const sorted = [...items].sort((a, b) => {
    const result = compareValues(a[sort.key], b[sort.key]);
    return sort.direction === "asc" ? result : -result;
  });

  return (
    <div className="table-frame">
      <table className="table">
        <thead>
          <tr>
            <SortHeader sortKey="user" label="User" sort={sort} onSort={onSort} />
            <SortHeader sortKey="requests" label="Calls" sort={sort} onSort={onSort} numeric />
            <SortHeader sortKey="input" label="Input tokens" sort={sort} onSort={onSort} numeric />
            <SortHeader sortKey="output" label="Output tokens" sort={sort} onSort={onSort} numeric />
            <SortHeader sortKey="tokens" label="Total tokens" sort={sort} onSort={onSort} numeric />
            <SortHeader sortKey="cost" label="Est. cost" sort={sort} onSort={onSort} numeric />
            <SortHeader sortKey="share" label="Share" sort={sort} onSort={onSort} numeric />
          </tr>
        </thead>
        <tbody>
          {sorted.map((item) => {
            const lastSeen = liveSince.get(item.user);
            return (
              <tr key={item.user}>
                <td>
                  <Person name={item.user} hue={hues.get(item.user)}>
                    {lastSeen !== undefined && (
                      <span className="pill is-positive" title={`Last call ${formatAgo(lastSeen, now)}`}>
                        Live
                      </span>
                    )}
                  </Person>
                </td>
                <td className="num">{formatCount(item.requests)}</td>
                <td className="num muted">{formatCount(item.input)}</td>
                <td className="num muted">{formatCount(item.output)}</td>
                <td className="num">{formatCount(item.tokens)}</td>
                <td className="num">
                  <span className="stack is-end">
                    <span>{formatMoney(item.cost, currency)}</span>
                    {item.unpriced > 0 && <small>{formatCount(item.unpriced)} unpriced</small>}
                  </span>
                </td>
                <td className="num">
                  <ShareBar share={item.share} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!items.length && <Empty>No user usage in this date range.</Empty>}
    </div>
  );
}

function ActivityTable({
  events,
  loading,
  currency,
  hues,
}: {
  events: CallEvent[];
  loading: boolean;
  currency: string;
  hues: Map<string, number>;
}) {
  type Key = "timestamp" | "user" | "agent" | "model" | "input_tokens" | "output_tokens" | "total_tokens" | "latency_ms" | "cost";
  const [sort, onSort] = useSort<Key>({ key: "timestamp", direction: "desc" }, ["user", "agent", "model"]);
  const sorted = [...events].sort((a, b) => {
    let left: unknown = a[sort.key];
    let right: unknown = b[sort.key];
    if (sort.key === "total_tokens") {
      left = (a.input_tokens || 0) + (a.output_tokens || 0);
      right = (b.input_tokens || 0) + (b.output_tokens || 0);
    } else if (sort.key === "timestamp") {
      left = Date.parse(a.timestamp || a.date || "1970-01-01");
      right = Date.parse(b.timestamp || b.date || "1970-01-01");
    }
    if (left == null || right == null) return left == null ? (right == null ? 0 : 1) : -1;
    const result = compareValues(left, right);
    return sort.direction === "asc" ? result : -result;
  });

  return (
    <section className="block">
      <header className="block-head">
        <div className="block-title">
          <h2>Recorded calls</h2>
          <p>Every model call in range, in your local time</p>
        </div>
        <span className="muted">
          <span className="num">{formatCount(events.length)}</span> calls
        </span>
      </header>
      <div className="table-frame">
        <table className="table">
          <thead>
            <tr>
              <SortHeader sortKey="timestamp" label="Time (local)" sort={sort} onSort={onSort} />
              <SortHeader sortKey="user" label="User" sort={sort} onSort={onSort} />
              <SortHeader sortKey="agent" label="Agent" sort={sort} onSort={onSort} />
              <SortHeader sortKey="model" label="Model" sort={sort} onSort={onSort} />
              <SortHeader sortKey="input_tokens" label="Input" sort={sort} onSort={onSort} numeric />
              <SortHeader sortKey="output_tokens" label="Output" sort={sort} onSort={onSort} numeric />
              <SortHeader sortKey="total_tokens" label="Total" sort={sort} onSort={onSort} numeric />
              <SortHeader sortKey="latency_ms" label="Latency" sort={sort} onSort={onSort} numeric />
              <SortHeader sortKey="cost" label="Est. cost" sort={sort} onSort={onSort} numeric />
            </tr>
          </thead>
          <tbody>
            {sorted.map((event, index) => (
              <tr key={`${event.key || event.timestamp}-${index}`}>
                <td className="num muted nowrap">
                  <time dateTime={event.timestamp}>{displayCallTime(event.timestamp)}</time>
                </td>
                <td>
                  <Person name={event.user} hue={hues.get(event.user)} />
                </td>
                <td className="ellipsis" title={event.agent}>{event.agent}</td>
                <td className="ellipsis muted" title={event.model}>{event.model}</td>
                <td className="num muted">{formatCount(event.input_tokens)}</td>
                <td className="num muted">{formatCount(event.output_tokens)}</td>
                <td className="num">{formatCount((event.input_tokens || 0) + (event.output_tokens || 0))}</td>
                <td className="num muted">{formatSeconds(event.latency_ms)}</td>
                <td className="num">{formatMoney(event.cost, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!events.length && <Empty>{loading ? "Loading calls…" : "No call activity in this date range."}</Empty>}
      </div>
    </section>
  );
}

