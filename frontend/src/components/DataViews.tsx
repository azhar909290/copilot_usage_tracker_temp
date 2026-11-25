"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { displayCallTime, displayDate, formatCompact, formatCount, formatMoney, formatSeconds } from "@/lib/format";
import type { TeamData } from "@/lib/teams";
import { groupCallRuns, isAgentVerseAgent, type CallEvent, type CatalogResponse, type Share, type Totals } from "@/lib/usage";
import { Donut } from "./charts";
import { ModelPodium } from "./ModelPodium";
import { NeuralFlow } from "./NeuralFlow";
import { Person } from "./Person";
import { Reveal } from "./Reveal";
import { Empty, ShareBar, SortHeader, sortBy, useSort } from "./table";

export const SERIES_TOKENS = ["--c-calls", "--c-tokens", "--c-cost", "--c-rose", "--c-sun", "--c-lime", "--c-sky"];
export const seriesColor = (index: number) => (index < SERIES_TOKENS.length ? `var(${SERIES_TOKENS[index]})` : "var(--faint)");

const IST = "Asia/Kolkata";

/** "Nov 25, 15:17" for one call, "Nov 25, 15:17–15:21" for a same-day run. */
function formatRunTime(start: string, end: string, seconds = false) {
  const from = Date.parse(start);
  const to = Date.parse(end);
  if (Number.isNaN(from) || Number.isNaN(to)) return "Time unavailable";
  const clock: Intl.DateTimeFormatOptions = { timeZone: IST, hour: "2-digit", minute: "2-digit", second: seconds ? "2-digit" : undefined, hour12: false };
  const day = (time: number) => new Date(time).toLocaleDateString("en-US", { timeZone: IST, month: "short", day: "numeric" });
  const at = (time: number) => new Date(time).toLocaleTimeString("en-US", clock);
  const first = `${day(from)}, ${at(from)}`;
  if (at(from) === at(to) && day(from) === day(to)) return first;
  return day(from) === day(to) ? `${first}–${at(to)}` : `${first} – ${day(to)}, ${at(to)}`;
}

export function ModelsView({
  shares,
  totals,
  currency,
  loading,
  onPickModel,
}: {
  shares: Share[];
  totals: Totals;
  currency: string;
  loading: boolean;
  onPickModel: (model: string) => void;
}) {
  type Key = "name" | "calls" | "tokens" | "cost" | "share" | "rate";
  const [sort, onSort] = useSort<Key>({ key: "tokens", direction: "desc" }, ["name"]);
  const [focus, setFocus] = useState<string | null>(null);
  const totalTokens = totals.input + totals.output;
  const ranked = useMemo(() => [...shares].sort((a, b) => b.tokens - a.tokens), [shares]);
  const color = new Map(ranked.map((share, index) => [share.name, seriesColor(index)]));
  const items = ranked.map((share) => ({
    ...share,
    share: totalTokens ? (share.tokens / totalTokens) * 100 : 0,
    rate: share.tokens ? (share.cost / share.tokens) * 1000 : 0,
    perCall: share.calls ? share.tokens / share.calls : 0,
  }));
  const sorted = sortBy(items, sort, (item, key) => item[key]);
  const maxPerCall = Math.max(0, ...items.map((item) => item.perCall));

  if (!shares.length) return <Empty>{loading ? "Loading usage…" : "No model usage in this date range."}</Empty>;

  return (
    <>
      <Reveal as="div">
        <ModelPodium
          shares={shares}
          currency={currency}
          totalTokens={totalTokens}
          totalCalls={totals.requests}
          totalCost={totals.cost}
          onPickModel={onPickModel}
        />
      </Reveal>
      <Reveal as="section" className="block">
        <header className="block-head">
          <div className="block-title">
            <h2>Model mix</h2>
            <p>Each model’s part of all tokens in range. Select an arc to filter the dashboard.</p>
          </div>
          <span className="muted">
            <span className="num">{formatCount(shares.length)}</span> models
          </span>
        </header>
        <div className="models-layout">
          <Donut
            items={ranked.map((share) => ({ name: share.name, value: share.tokens, color: color.get(share.name)! }))}
            label="tokens"
            format={(value) => formatCompact(value)}
            active={focus}
            onActive={setFocus}
            onPick={onPickModel}
            ariaLabel={`Token share by model: ${items.map((item) => `${item.name} ${item.share.toFixed(1)}%`).join(", ")}`}
          />
          <div>
            <h3 style={{ fontSize: 15, marginBottom: 4 }}>Average tokens per call</h3>
            <p className="caption" style={{ marginBottom: 12 }}>How much context and output each model handles per request</p>
            <ol className="leader">
              {[...items]
                .sort((a, b) => b.perCall - a.perCall)
                .map((item, index) => (
                  <li
                    key={item.name}
                    style={{ "--team": color.get(item.name), "--fill": maxPerCall ? item.perCall / maxPerCall : 0, "--i": index, gridTemplateColumns: "14px minmax(0,1fr) auto" } as CSSProperties}
                    onPointerEnter={() => setFocus(item.name)}
                    onPointerLeave={() => setFocus(null)}
                  >
                    <i className="swatch" style={{ "--sw": color.get(item.name) } as CSSProperties} />
                    <button type="button" className="share-name" onClick={() => onPickModel(item.name)} title={`Filter to ${item.name}`}>
                      {item.name}
                    </button>
                    <span className="num">{item.perCall ? formatCount(item.perCall) : "—"}</span>
                  </li>
                ))}
            </ol>
          </div>
        </div>
      </Reveal>
      <Reveal as="section" className="block">
        <header className="block-head">
          <div className="block-title">
            <h2>Usage by model</h2>
            <p>Calls, tokens and estimated cost; share is of all tokens in range</p>
          </div>
        </header>
        <div className="table-frame">
          <table className="table">
            <thead>
              <tr>
                <SortHeader sortKey="name" label="Model" sort={sort} onSort={onSort} />
                <SortHeader sortKey="calls" label="Calls" sort={sort} onSort={onSort} numeric />
                <SortHeader sortKey="tokens" label="Tokens" sort={sort} onSort={onSort} numeric />
                <SortHeader sortKey="cost" label="Est. cost" sort={sort} onSort={onSort} numeric />
                <SortHeader sortKey="rate" label="Per 1k tokens" sort={sort} onSort={onSort} numeric />
                <SortHeader sortKey="share" label="Share" sort={sort} onSort={onSort} numeric />
              </tr>
            </thead>
            <tbody>
              {sorted.map((model, index) => (
                <tr key={model.name} className="is-entering" style={{ "--i": index } as CSSProperties}>
                  <td className="strong">
                    <i className="swatch" style={{ "--sw": color.get(model.name) } as CSSProperties} />
                    {model.name}
                  </td>
                  <td className="num">{formatCount(model.calls)}</td>
                  <td className="num">{formatCount(model.tokens)}</td>
                  <td className="num">{formatMoney(model.cost, currency)}</td>
                  <td className="num muted">{model.rate ? formatMoney(model.rate, currency, 4) : "—"}</td>
                  <td className="num">
                    <ShareBar share={model.share} from={color.get(model.name)} to={color.get(model.name)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Reveal>
    </>
  );
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY = 86_400_000;
const isoDay = (time: number) => new Date(time).toISOString().slice(0, 10);

/**
 * A real calendar of the selected range: one row per week, one cell per receiver day, shaded by
 * calls (aurora to ember). Below it, the hours of the day those calls fall in. Selecting a day
 * filters the dashboard to it.
 */
function CallCalendar({ events, days, today, onPickDay }: { events: CallEvent[]; days: string[]; today: string; onPickDay: (date: string) => void }) {
  const { counts, max, peakDay, weeks, hours, hourMax, peakHour } = useMemo(() => {
    const counts = new Map<string, number>();
    const hours = new Array<number>(24).fill(0);
    for (const event of events) {
      const time = new Date(event.timestamp);
      const istDate = !Number.isNaN(time.getTime())
        ? new Date(time.getTime() + 19_800_000).toISOString().slice(0, 10)
        : event.date;
      counts.set(istDate, (counts.get(istDate) ?? 0) + 1);
      if (!Number.isNaN(time.getTime())) {
        const istHour = new Date(time.getTime() + 19_800_000).getUTCHours();
        hours[istHour] += 1;
      }
    }
    let max = 0;
    let peakDay = "";
    for (const [date, value] of counts) {
      if (value > max) {
        max = value;
        peakDay = date;
      }
    }
    const first = days[0] ? Date.parse(`${days[0]}T00:00:00Z`) : 0;
    const last = days.length ? Date.parse(`${days[days.length - 1]}T00:00:00Z`) : 0;
    const weeks: { start: string; cells: { date: string; inRange: boolean }[] }[] = [];
    if (days.length) {
      const offset = (new Date(first).getUTCDay() + 6) % 7;
      for (let start = first - offset * DAY; start <= last; start += 7 * DAY) {
        weeks.push({
          start: isoDay(start),
          cells: Array.from({ length: 7 }, (_, index) => {
            const time = start + index * DAY;
            return { date: isoDay(time), inRange: time >= first && time <= last };
          }),
        });
      }
    }
    const hourMax = Math.max(0, ...hours);
    return { counts, max, peakDay, weeks, hours, hourMax, peakHour: hourMax ? hours.indexOf(hourMax) : -1 };
  }, [events, days]);
  const [hover, setHover] = useState<string | null>(null);
  const shown = hover ?? (max ? peakDay : null);
  let index = 0;

  return (
    <div className="cal-wrap">
      <p className="ridge-readout" aria-live="polite">
        {shown ? (
          <>
            <span className="ridge-day">{displayDate(shown, { weekday: "short", month: "short", day: "numeric" })}</span>
            <span className="num">{formatCount(counts.get(shown) ?? 0)} calls</span>
            {!hover && <span>busiest day in range</span>}
          </>
        ) : (
          <span>No calls in this range.</span>
        )}
      </p>
      <div className="cal" role="group" aria-label="Calls per day. Select a day to filter the dashboard to it." onPointerLeave={() => setHover(null)}>
        <div className="cal-head" aria-hidden="true">
          <span />
          {WEEKDAYS.map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
        {weeks.map((week) => (
          <div className="cal-week" key={week.start}>
            <span className="cal-label num">{displayDate(week.start, { month: "short", day: "numeric" })}</span>
            {week.cells.map((cell) => {
              if (!cell.inRange) return <span className="cal-cell is-out" key={cell.date} aria-hidden="true" />;
              const value = counts.get(cell.date) ?? 0;
              const level = max ? Math.sqrt(value / max) : 0;
              const order = index++;
              return (
                <button
                  key={cell.date}
                  type="button"
                  className="cal-cell"
                  data-hot={level > 0.6 || undefined}
                  data-today={cell.date === today || undefined}
                  data-empty={value === 0 || undefined}
                  style={{ "--v": level.toFixed(3), "--i": order } as CSSProperties}
                  aria-label={`${displayDate(cell.date, { weekday: "long", month: "long", day: "numeric" })}: ${formatCount(value)} calls`}
                  onPointerEnter={() => setHover(cell.date)}
                  onFocus={() => setHover(cell.date)}
                  onClick={() => onPickDay(cell.date)}
                >
                  <span className="cal-date">{Number(cell.date.slice(8))}</span>
                  {value > 0 && <span className="cal-count num">{formatCount(value)}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <div className="cal-hours" role="img" aria-label={peakHour >= 0 ? `Calls by hour of the day, IST. Busiest hour ${String(peakHour).padStart(2, "0")}:00 IST with ${hourMax} calls.` : "No timed calls."}>
        <span className="cal-hours-title">Hour of day (IST)</span>
        <div className="cal-bars">
          {hours.map((value, hour) => (
            <i
              key={hour}
              data-peak={hour === peakHour || undefined}
              title={`${String(hour).padStart(2, "0")}:00 IST · ${formatCount(value)} calls`}
              style={{ "--h": hourMax ? Math.max(value ? 0.06 : 0, value / hourMax) : 0, "--i": hour } as CSSProperties}
            />
          ))}
        </div>
        <div className="cal-ticks" aria-hidden="true">
          {hours.map((_, hour) => (
            <span key={hour}>{hour % 6 === 0 ? String(hour).padStart(2, "0") : ""}</span>
          ))}
        </div>
      </div>
      <div className="heat-scale">
        Fewer <i aria-hidden="true" /> More calls
      </div>
    </div>
  );
}

export function ActivityView({
  events,
  loading,
  currency,
  hues,
  teams,
  days,
  today,
  catalog,
  onPickDay,
}: {
  events: CallEvent[];
  loading: boolean;
  currency: string;
  hues: Map<string, number>;
  teams: TeamData | null;
  days: string[];
  today: string;
  catalog?: CatalogResponse | null;
  onPickDay: (date: string) => void;
}) {
  type Key = "timestamp" | "user" | "agent" | "model" | "calls" | "input_tokens" | "output_tokens" | "total_tokens" | "latency_ms" | "cost";
  const [sort, onSort] = useSort<Key>({ key: "timestamp", direction: "desc" }, ["user", "agent", "model"]);
  const [limit, setLimit] = useState(60);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const runs = useMemo(() => groupCallRuns(events), [events]);
  const sorted = sortBy(runs, sort, (run, key) => {
    if (key === "timestamp") return Date.parse(run.end || "1970-01-01");
    if (key === "calls") return run.calls.length;
    return run[key] ?? -1;
  });
  const toggleRun = (key: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const catalogNames = useMemo(() => {
    if (!catalog?.agents?.length) return undefined;
    const set = new Set<string>();
    for (const a of catalog.agents) {
      if (a.kind === "skill_package") continue;
      set.add(a.id.trim().toLowerCase());
      set.add(a.name.trim().toLowerCase());
    }
    return set;
  }, [catalog]);

  const agentVerseCalls = useMemo(
    () => events.filter((e) => isAgentVerseAgent(e.agent, catalogNames)),
    [events, catalogNames],
  );

  const agents = useMemo(() => {
    const counts = new Map<string, number>();
    for (const event of events) {
      if (isAgentVerseAgent(event.agent, catalogNames)) {
        counts.set(event.agent, (counts.get(event.agent) ?? 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7);
  }, [events, catalogNames]);
  const topAgent = agents[0]?.[1] ?? 1;

  return (
    <>
      <Reveal as="section" className="block neural-block">
        <header className="block-head">
          <div className="block-title">
            <h2>Signal network</h2>
            <p>How calls flow from teams to people, AgentVerse agents and models. Link width and signal pace follow call volume.</p>
          </div>
          <span className="muted">
            <span className="num">{formatCount(agentVerseCalls.length)}</span> AgentVerse calls traced
          </span>
        </header>
        <NeuralFlow events={events} teams={teams} catalogNames={catalogNames} />
      </Reveal>
      <div className="activity-pair">
        <Reveal as="section" className="block">
          <header className="block-head">
            <div className="block-title">
              <h2>Activity calendar</h2>
              <p>Calls per receiver day. Select a day to open its calls.</p>
            </div>
          </header>
          <CallCalendar events={events} days={days} today={today} onPickDay={onPickDay} />
        </Reveal>
        <Reveal as="section" className="block" delay={0.08}>
          <header className="block-head">
            <div className="block-title">
              <h2>Busiest AgentVerse agents</h2>
              <p>Top custom agents by invocation count</p>
            </div>
            <span className="muted">
              <span className="num">{agents.length}</span> active
            </span>
          </header>
          {agents.length ? (
            <ol className="leader">
              {agents.map(([agent, calls], index) => (
                <li key={agent} style={{ "--team": seriesColor(index), "--fill": calls / topAgent, "--i": index, gridTemplateColumns: "26px minmax(0,1fr) auto" } as CSSProperties}>
                  <span className="rank">{index + 1}</span>
                  <span className="person-name" title={agent}>
                    {agent}
                  </span>
                  <span className="num">{formatCount(calls)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <Empty>No calls in this range.</Empty>
          )}
        </Reveal>
      </div>
      <Reveal as="section" className="block">
        <header className="block-head">
          <div className="block-title">
            <h2>Recorded calls</h2>
            <p>Back-to-back calls by the same person, agent and model are combined. Select a row to see each call.</p>
          </div>
          <span className="muted">
            <span className="num">{formatCount(events.length)}</span> calls · <span className="num">{formatCount(runs.length)}</span> rows
          </span>
        </header>
        <div className="table-frame">
          <table className="table">
            <thead>
              <tr>
                <SortHeader sortKey="timestamp" label="Time (IST)" sort={sort} onSort={onSort} />
                <SortHeader sortKey="user" label="User" sort={sort} onSort={onSort} />
                <SortHeader sortKey="agent" label="Agent" sort={sort} onSort={onSort} />
                <SortHeader sortKey="model" label="Model" sort={sort} onSort={onSort} />
                <SortHeader sortKey="calls" label="Calls" sort={sort} onSort={onSort} numeric />
                <SortHeader sortKey="input_tokens" label="Input" sort={sort} onSort={onSort} numeric />
                <SortHeader sortKey="output_tokens" label="Output" sort={sort} onSort={onSort} numeric />
                <SortHeader sortKey="total_tokens" label="Total" sort={sort} onSort={onSort} numeric />
                <SortHeader sortKey="latency_ms" label="Latency" sort={sort} onSort={onSort} numeric />
                <SortHeader sortKey="cost" label="Est. cost" sort={sort} onSort={onSort} numeric />
              </tr>
            </thead>
            <tbody>
              {sorted.slice(0, limit).flatMap((run, index) => {
                const grouped = run.calls.length > 1;
                const open = grouped && expanded.has(run.key);
                const rows = [
                  <tr
                    key={`${run.key}-${index}`}
                    className="is-entering"
                    style={{ "--i": index, cursor: grouped ? "pointer" : undefined } as CSSProperties}
                    onClick={grouped ? () => toggleRun(run.key) : undefined}
                    aria-expanded={grouped ? open : undefined}
                  >
                    <td className="num muted nowrap">
                      <time dateTime={run.end} title={displayCallTime(run.end)}>
                        {formatRunTime(run.start, run.end)}
                      </time>
                    </td>
                    <td>
                      <Person name={run.user} hue={hues.get(run.user)} />
                    </td>
                    <td className="ellipsis" title={run.agent}>
                      {run.agent}
                    </td>
                    <td className="ellipsis muted" title={run.model}>
                      {run.model}
                    </td>
                    <td className="num">
                      {grouped ? `${open ? "▾" : "▸"} ${formatCount(run.calls.length)}` : "1"}
                    </td>
                    <td className="num muted">{formatCount(run.input_tokens)}</td>
                    <td className="num muted">{formatCount(run.output_tokens)}</td>
                    <td className="num">{formatCount(run.total_tokens)}</td>
                    <td className="num muted" title={grouped ? "Total model time across these calls" : undefined}>
                      {formatSeconds(run.latency_ms)}
                    </td>
                    <td className="num">{formatMoney(run.cost, currency, 4)}</td>
                  </tr>,
                ];
                if (open) {
                  for (const call of [...run.calls].reverse()) {
                    rows.push(
                      <tr key={`${run.key}-${call.key}`} className="muted" style={{ fontSize: "0.92em" }}>
                        <td className="num nowrap" style={{ paddingLeft: 24 }}>
                          <time dateTime={call.timestamp}>{formatRunTime(call.timestamp, call.timestamp, true)}</time>
                        </td>
                        <td colSpan={4} />
                        <td className="num">{formatCount(call.input_tokens)}</td>
                        <td className="num">{formatCount(call.output_tokens)}</td>
                        <td className="num">{formatCount((call.input_tokens || 0) + (call.output_tokens || 0))}</td>
                        <td className="num">{formatSeconds(call.latency_ms)}</td>
                        <td className="num">{formatMoney(call.cost, currency, 4)}</td>
                      </tr>,
                    );
                  }
                }
                return rows;
              })}
            </tbody>
          </table>
          {!events.length && <Empty>{loading ? "Loading calls…" : "No calls match these filters."}</Empty>}
        </div>
        {sorted.length > limit && (
          <div style={{ display: "flex", justifyContent: "center", marginTop: 14 }}>
            <button className="button is-quiet" type="button" onClick={() => setLimit((value) => value + 120)}>
              Show {formatCount(Math.min(120, sorted.length - limit))} more of {formatCount(sorted.length - limit)}
            </button>
          </div>
        )}
      </Reveal>
    </>
  );
}
