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
  Network,
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
import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { BootLoader, type BootStage } from "@/components/BootLoader";
import { CatalogView } from "@/components/CatalogView";
import { Carousel } from "@/components/Carousel";
import { Sparkline } from "@/components/charts";
import { CommandMenu, type CommandSection } from "@/components/CommandMenu";
import { DailyBars, metricColor } from "@/components/DailyBars";
import { ActivityView, ModelsView, seriesColor } from "@/components/DataViews";
import { Person } from "@/components/Person";
import { Rail, type RailItem } from "@/components/Rail";
import { Reveal, Stagger, staggerFade, staggerItem } from "@/components/Reveal";
import { RidgeMark } from "@/components/RidgeMark";
import { SignalRidge } from "@/components/SignalRidge";
import { Empty } from "@/components/table";
import { TeamsView } from "@/components/TeamsView";
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
  type CatalogResponse,
  type Finding,
  type LiveUser,
  type Metric,
  type Period,
  type Share,
  type UsageRow,
} from "@/lib/usage";
import { normalizeTeams, teamOf, teamToken, type TeamData } from "@/lib/teams";
import { useDashboardTheme } from "../theme";

type View = "overview" | "users" | "agents" | "models" | "activity";
const API_BASE = (process.env.NEXT_PUBLIC_USAGE_API_URL || "http://127.0.0.1:4318").replace(/\/$/, "");
const API_HOST = API_BASE.replace(/^https?:\/\//, "");
const BOOT_MINIMUM_MS = 700;

const VIEWS: { id: View; label: string; icon: LucideIcon }[] = [
  { id: "overview", label: "Overview", icon: LayoutGrid },
  { id: "users", label: "Organization", icon: Network },
  { id: "agents", label: "Catalog", icon: Boxes },
  { id: "models", label: "Models", icon: Cpu },
  { id: "activity", label: "Activity", icon: Activity },
];

const PERIODS: Period[] = [7, 30, 90];

const noSubscription = () => () => {};
function readRequestedView(): View | null {
  const requested = new URLSearchParams(window.location.search).get("view");
  return VIEWS.find((item) => item.id === requested)?.id ?? null;
}

const INITIAL_STAGES: BootStage[] = [
  { label: "Interface", detail: "Loading the dashboard", state: "active" },
  { label: "Receiver", detail: API_HOST, state: "pending" },
  { label: "Ledger", detail: "Usage, calls and catalog", state: "pending" },
  { label: "Composing", detail: "Charts and findings", state: "pending" },
];

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
  hue,
}: {
  label: string;
  allLabel: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  icon: LucideIcon;
  hue?: string;
}) {
  return (
    <label className="select" data-active={value !== "all" || undefined} style={hue ? ({ "--select-hue": hue } as CSSProperties) : undefined}>
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
  // Deep links such as /dashboard?view=users open a view directly (used by the landing page).
  const requestedView = useSyncExternalStore(noSubscription, readRequestedView, () => null);
  const [chosenView, setView] = useState<View | null>(null);
  const view: View = chosenView ?? requestedView ?? "overview";
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
  const [teams, setTeams] = useState<TeamData | null>(null);
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);
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
        setTeams(normalizeTeams(usagePayload.teams));
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
  const baseRows = useMemo(() => filterRows(usageRows, filters), [usageRows, filters]);
  const baseEvents = useMemo(() => filterEvents(callEvents, filters), [callEvents, filters]);
  // A selected team scopes every view except Organization, where it only focuses the hierarchy.
  const teamScoped = selectedTeam !== null && view !== "users";
  const filteredRows = useMemo(
    () => (teamScoped ? baseRows.filter((row) => teamOf(row.user, teams) === selectedTeam) : baseRows),
    [teamScoped, baseRows, teams, selectedTeam],
  );
  const filteredEvents = useMemo(
    () => (teamScoped ? baseEvents.filter((event) => teamOf(event.user, teams) === selectedTeam) : baseEvents),
    [teamScoped, baseEvents, teams, selectedTeam],
  );
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
  // Active agents are catalogue agents with at least one call in the filtered range.
  const agentCatalog = useMemo(() => {
    const names = new Map<string, string>();
    for (const agent of catalog?.agents ?? []) {
      if (agent.kind === "skill_package") continue;
      for (const key of [agent.name, agent.id]) names.set(key.trim().toLowerCase(), agent.id);
    }
    return { names, total: new Set(names.values()).size };
  }, [catalog]);
  const agentActivity = useMemo(() => {
    const active = new Set<string>();
    const outside = new Set<string>();
    for (const row of filteredRows) {
      const name = row.agent.trim();
      if (!row.requests || !name || name.toLowerCase() === "unknown") continue;
      const id = agentCatalog.names.get(name.toLowerCase());
      if (id) active.add(id);
      else outside.add(name);
    }
    return { active: active.size, outside: outside.size };
  }, [filteredRows, agentCatalog]);
  const modelLeader = modelShares.length ? [...modelShares].sort((a, b) => b.calls - a.calls)[0] : null;
  const sparks = useMemo(() => {
    const agents = days.map(() => new Set<string>());
    const models = days.map(() => new Set<string>());
    const latencies = days.map(() => [] as number[]);
    const index = new Map(days.map((day, position) => [day, position]));
    for (const row of filteredRows) {
      const position = index.get(row.date);
      if (position === undefined || !row.requests) continue;
      const id = agentCatalog.names.get(row.agent.trim().toLowerCase());
      if (id) agents[position].add(id);
      models[position].add(row.model);
    }
    for (const event of filteredEvents) {
      const position = index.get(event.date);
      if (position !== undefined && typeof event.latency_ms === "number" && event.latency_ms > 0) latencies[position].push(event.latency_ms);
    }
    return {
      calls: dailyTotals(filteredRows, days, "calls"),
      tokens: dailyTotals(filteredRows, days, "tokens"),
      agents: agents.map((set) => set.size),
      models: models.map((set) => set.size),
      latency: latencies.map((values) => (values.length ? values.sort((a, b) => a - b)[Math.floor(values.length / 2)] : 0)),
    };
  }, [filteredRows, filteredEvents, days, agentCatalog]);
  const teamOptions = teams ? [...teams.names, ...(baseRows.some((row) => teamOf(row.user, teams) === "Unassigned") ? ["Unassigned"] : [])] : [];
  const filtersActive =
    selectedUser !== "all" || selectedAgent !== "all" || selectedModel !== "all" || search !== "" || selectedTeam !== null;

  function clearFilters() {
    setSelectedTeam(null);
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
      const columns: (keyof CallEvent | "team")[] = [
        "timestamp",
        "date",
        "user",
        "team",
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
                : column === "team"
                  ? csvCell(teamOf(event.user, teams))
                  : csvCell(event[column]),
            )
            .join(","),
        ),
      ].join("\n");
      download(csv, "copilot-call-activity.csv");
      return;
    }
    const columns: (keyof UsageRow | "team")[] = [
      "date",
      "first_seen",
      "last_seen",
      "user",
      "team",
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
      ...(view === "users" && selectedTeam ? filteredRows.filter((row) => teamOf(row.user, teams) === selectedTeam) : filteredRows).map((row) =>
        columns.map((column) => csvCell(column === "team" ? teamOf(row.user, teams) : row[column])).join(","),
      ),
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
      heading: "Teams",
      items: (teams?.names ?? []).map((name) => ({
        id: `team-${name}`,
        label: name,
        icon: Network,
        hint: "Team",
        run: () => {
          setSelectedTeam(name);
          showView("users");
        },
      })),
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
  const organization = teams?.organization ?? "tth-cto-innovation";
  const scope = selectedUser !== "all" ? selectedUser : selectedTeam ? `${selectedTeam} team` : "All teams";
  const freshness = error
    ? updatedAt
      ? `Couldn’t refresh · last good ${updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
      : "Receiver unreachable"
    : updatedAt
      ? `Updated ${updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
      : "Connecting";
  // The overview headline leads with usage, not cost.
  const lead = findings.find((finding) => finding.id !== "cost-driver" && finding.id !== "unpriced");
  const resultCount = view === "activity" ? filteredEvents.length : totals.requests;

  return (
    <>
      <BootLoader visible={booting} stages={stages} />
      <div className="sky" aria-hidden="true">
        <i />
      </div>
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
            <strong>AI Control Plane</strong>
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
                <span className="org-tag">
                  <i aria-hidden="true" />
                  {organization}
                </span>
                <span aria-hidden="true">·</span>
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
              {teams && (
                <FilterSelect
                  label="Filter by team"
                  allLabel="All teams"
                  value={selectedTeam ?? "all"}
                  options={teamOptions}
                  onChange={(value) => setSelectedTeam(value === "all" ? null : value)}
                  icon={Network}
                  hue={selectedTeam ? `var(${teamToken(selectedTeam, teams.names.indexOf(selectedTeam))})` : undefined}
                />
              )}
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
              initial={reducedMotion ? { opacity: 0 } : { opacity: 0, transform: "translateY(10px)", filter: "blur(4px)" }}
              animate={reducedMotion ? { opacity: 1 } : { opacity: 1, transform: "translateY(0px)", filter: "blur(0px)" }}
              exit={reducedMotion ? { opacity: 0 } : { opacity: 0, transform: "translateY(-6px)", filter: "blur(2px)", transition: { duration: 0.12 } }}
              transition={{ duration: 0.32, ease: [0.23, 1, 0.32, 1] }}
            >
              {view === "overview" && (
                <>
                  <LiveStrip users={liveUsers} now={now} hues={hues} loading={loading} />
                  <Stagger as="section" className="kpis" stagger={0.06} label={`Totals for the last ${period} days. Calls and tokens also choose the chart metric.`}>
                    <KpiCell
                      label="Active agents"
                      color="var(--c-lime)"
                      spark={sparks.agents}
                      note={
                        agentActivity.outside
                          ? `Catalogue agents with calls · +${formatCount(agentActivity.outside)} outside it`
                          : "Catalogue agents with calls in range"
                      }
                    >
                      <NumberFlow value={agentActivity.active} locales="en-US" />
                      <span className="unit kpi-of">/ {formatCount(agentCatalog.total)}</span>
                    </KpiCell>
                    <KpiCell label="Calls" color="var(--c-calls)" spark={sparks.calls} metric="calls" selected={metric} onSelect={setMetric} note={`${formatCount(activeUsers)} people · ${formatCount(liveUsers.length)} live now`}>
                      <NumberFlow value={totals.requests} locales="en-US" />
                    </KpiCell>
                    <KpiCell label="Tokens" color="var(--c-tokens)" spark={sparks.tokens} metric="tokens" selected={metric} onSelect={setMetric} note={`${formatCompact(totals.input)} in · ${formatCompact(totals.output)} out`}>
                      <NumberFlow value={totals.input + totals.output} locales="en-US" format={{ notation: "compact", maximumFractionDigits: 2 }} />
                    </KpiCell>
                    <KpiCell label="Models" color="var(--c-rose)" spark={sparks.models} note={modelLeader ? `Most calls: ${modelLeader.name}` : "No model calls in range"}>
                      <NumberFlow value={modelShares.length} locales="en-US" />
                    </KpiCell>
                    <KpiCell label="Median latency" color="var(--c-sun)" spark={sparks.latency} note={latency.p95 ? `p95 ${formatSeconds(latency.p95)}` : "No latency recorded"}>
                      {latency.median ? (
                        <>
                          <NumberFlow value={latency.median / 1000} locales="en-US" format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }} />
                          <span className="unit">s</span>
                        </>
                      ) : (
                        <span className="dash">—</span>
                      )}
                    </KpiCell>
                  </Stagger>

                  <OverviewCharts
                    days={days}
                    rows={filteredRows}
                    events={filteredEvents}
                    metric={metric}
                    currency={currency}
                    today={today ?? ""}
                    onOpenDay={openDay}
                  />

                  <Reveal>
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
                  </Reveal>

                  <Stagger className="pair" stagger={0.08}>
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
                  </Stagger>

                  <RecentCalls events={filteredEvents} hues={hues} currency={currency} now={now} onViewAll={() => showView("activity")} />
                </>
              )}

              {view === "agents" && (
                <CatalogView
                  agents={catalog?.agents ?? []}
                  rows={filteredRows}
                  days={days}
                  currency={currency}
                  search={search}
                  hues={hues}
                  error={catalog?.error}
                  onFilterAgent={(name) => {
                    setSelectedAgent(name);
                    showView("overview");
                  }}
                />
              )}

              {view === "users" &&
                (teams ? (
                  <TeamsView
                    rows={filteredRows}
                    teams={teams}
                    days={days}
                    currency={currency}
                    liveUsers={liveUsers}
                    now={now}
                    hues={hues}
                    selectedTeam={selectedTeam}
                    onSelectTeam={setSelectedTeam}
                    onPickUser={(name) => setSelectedUser(name)}
                  />
                ) : (
                  <Empty>{loading ? "Loading the organization…" : "Team assignments are unavailable from the receiver. Restart the API to load them."}</Empty>
                ))}

              {view === "models" && (
                <ModelsView shares={modelShares} totals={totals} currency={currency} loading={loading} onPickModel={(name) => setSelectedModel(name)} />
              )}

              {view === "activity" && <ActivityView events={filteredEvents} loading={loading} currency={currency} hues={hues} teams={teams} />}
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
  color,
  spark,
  metric,
  selected,
  onSelect,
  note,
  children,
}: {
  label: string;
  color: string;
  spark: number[];
  metric?: Metric;
  selected?: Metric;
  onSelect?: (metric: Metric) => void;
  note: ReactNode;
  children: ReactNode;
}) {
  const reduced = useReducedMotion();
  const isSelected = metric !== undefined && metric === selected;
  const style = { "--kpi": color } as CSSProperties;
  const body = (
    <>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value num">{children}</span>
      <span className="kpi-note">{note}</span>
      <Sparkline className="kpi-spark" values={spark} color={color} />
    </>
  );
  return metric && onSelect ? (
    <motion.button className="kpi" type="button" aria-pressed={isSelected} onClick={() => onSelect(metric)} style={style} variants={reduced ? staggerFade : staggerItem}>
      {body}
    </motion.button>
  ) : (
    <motion.div className="kpi" style={style} variants={reduced ? staggerFade : staggerItem}>
      {body}
    </motion.div>
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

  const [front] = metricColor[metric];
  return (
    <div className="chart-row" style={{ "--metric": front } as CSSProperties}>
      <Reveal as="section" className="block ridge-block" style={{ display: "flex", flexDirection: "column" }}>
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
      </Reveal>
      <Reveal as="section" className="block bars-block" delay={0.08} style={{ display: "flex", flexDirection: "column" }}>
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
      </Reveal>
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
  const reduced = useReducedMotion();
  return (
    <motion.section className="block" variants={reduced ? staggerFade : staggerItem}>
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
            {top.map((share, index) => (
              <li key={share.name} style={{ "--fill": largest ? value(share) / largest : 0, "--row": seriesColor(index), "--i": index } as CSSProperties}>
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
    </motion.section>
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
    <Reveal as="section" className="block">
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
    </Reveal>
  );
}
