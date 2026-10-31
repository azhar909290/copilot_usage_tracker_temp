"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { displayCallTime, formatCompact, formatCount, formatMoney, formatSeconds } from "@/lib/format";
import type { TeamData } from "@/lib/teams";
import type { CallEvent, Share, Totals } from "@/lib/usage";
import { Donut } from "./charts";
import { NeuralFlow } from "./NeuralFlow";
import { Person } from "./Person";
import { Reveal } from "./Reveal";
import { Empty, ShareBar, SortHeader, sortBy, useSort } from "./table";

export const SERIES_TOKENS = ["--c-calls", "--c-tokens", "--c-cost", "--c-rose", "--c-sun", "--c-lime", "--c-sky"];
export const seriesColor = (index: number) => (index < SERIES_TOKENS.length ? `var(${SERIES_TOKENS[index]})` : "var(--faint)");

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

/** Weekday × hour heat field (local time). Hotter cells shift from aurora to ember. */
function HeatField({ events }: { events: CallEvent[] }) {
  const { grid, max, hours, peak } = useMemo(() => {
    const grid = WEEKDAYS.map(() => new Array<number>(24).fill(0));
    const hours = new Array<number>(24).fill(0);
    for (const event of events) {
      const time = new Date(event.timestamp);
      if (Number.isNaN(time.getTime())) continue;
      const day = (time.getDay() + 6) % 7;
      grid[day][time.getHours()] += 1;
      hours[time.getHours()] += 1;
    }
    let max = 0;
    let peak = { day: 0, hour: 0 };
    grid.forEach((row, day) =>
      row.forEach((value, hour) => {
        if (value > max) {
          max = value;
          peak = { day, hour };
        }
      }),
    );
    return { grid, max, hours, peak };
  }, [events]);
  const [hover, setHover] = useState<{ day: number; hour: number } | null>(null);
  const read = hover ?? (max ? peak : null);
  return (
    <div className="heat-wrap">
      <p className="ridge-readout" aria-live="polite">
        {read ? (
          <>
            <span className="ridge-day">
              {WEEKDAYS[read.day]} {String(read.hour).padStart(2, "0")}:00–{String((read.hour + 1) % 24).padStart(2, "0")}:00
            </span>
            <span className="num">{formatCount(grid[read.day][read.hour])} calls</span>
            {!hover && <span>busiest hour in range</span>}
          </>
        ) : (
          <span>No timed calls in this range.</span>
        )}
      </p>
      <div className="heat" role="img" aria-label={`Calls by weekday and hour, local time. Busiest: ${WEEKDAYS[peak.day]} at ${peak.hour}:00 with ${max} calls.`} onPointerLeave={() => setHover(null)}>
        {grid.map((row, day) => (
          <div key={WEEKDAYS[day]} style={{ display: "contents" }}>
            <span className="heat-day">{WEEKDAYS[day]}</span>
            {row.map((value, hour) => {
              const level = max ? Math.sqrt(value / max) : 0;
              return (
                <span
                  key={hour}
                  className="heat-cell"
                  data-hot={level > 0.6 || undefined}
                  style={{ "--v": level.toFixed(3), "--d": day, "--h": hour } as CSSProperties}
                  onPointerEnter={() => setHover({ day, hour })}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="heat-hours" aria-hidden="true">
        <span />
        {hours.map((_, hour) => (
          <span key={hour}>{hour % 3 === 0 ? String(hour).padStart(2, "0") : ""}</span>
        ))}
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
}: {
  events: CallEvent[];
  loading: boolean;
  currency: string;
  hues: Map<string, number>;
  teams: TeamData | null;
}) {
  type Key = "timestamp" | "user" | "agent" | "model" | "input_tokens" | "output_tokens" | "total_tokens" | "latency_ms" | "cost";
  const [sort, onSort] = useSort<Key>({ key: "timestamp", direction: "desc" }, ["user", "agent", "model"]);
  const [limit, setLimit] = useState(60);
  const sorted = sortBy(events, sort, (event, key) => {
    if (key === "total_tokens") return (event.input_tokens || 0) + (event.output_tokens || 0);
    if (key === "timestamp") return Date.parse(event.timestamp || event.date || "1970-01-01");
    return event[key] ?? (typeof event.input_tokens === "number" ? -1 : "");
  });
  const agents = useMemo(() => {
    const counts = new Map<string, number>();
    for (const event of events) counts.set(event.agent, (counts.get(event.agent) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7);
  }, [events]);
  const topAgent = agents[0]?.[1] ?? 1;

  return (
    <>
      <div className="activity-pair">
        <Reveal as="section" className="block">
          <header className="block-head">
            <div className="block-title">
              <h2>When the organization works</h2>
              <p>Calls by weekday and hour, in your local time</p>
            </div>
          </header>
          <HeatField events={events} />
        </Reveal>
        <Reveal as="section" className="block" delay={0.08}>
          <header className="block-head">
            <div className="block-title">
              <h2>Busiest agents</h2>
              <p>Calls in the filtered range</p>
            </div>
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
      <Reveal as="section" className="block neural-block">
        <header className="block-head">
          <div className="block-title">
            <h2>Signal network</h2>
            <p>How calls flow from teams to people, agents and models. Link width and signal pace follow call volume.</p>
          </div>
          <span className="muted">
            <span className="num">{formatCount(events.length)}</span> calls traced
          </span>
        </header>
        <NeuralFlow events={events} teams={teams} />
      </Reveal>
      <Reveal as="section" className="block">
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
              {sorted.slice(0, limit).map((event, index) => (
                <tr key={`${event.key}-${index}`} className="is-entering" style={{ "--i": index } as CSSProperties}>
                  <td className="num muted nowrap">
                    <time dateTime={event.timestamp} title={displayCallTime(event.timestamp)}>
                      {Number.isNaN(Date.parse(event.timestamp))
                        ? "Time unavailable"
                        : new Date(event.timestamp).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}
                    </time>
                  </td>
                  <td>
                    <Person name={event.user} hue={hues.get(event.user)} />
                  </td>
                  <td className="ellipsis" title={event.agent}>
                    {event.agent}
                  </td>
                  <td className="ellipsis muted" title={event.model}>
                    {event.model}
                  </td>
                  <td className="num muted">{formatCount(event.input_tokens)}</td>
                  <td className="num muted">{formatCount(event.output_tokens)}</td>
                  <td className="num">{formatCount((event.input_tokens || 0) + (event.output_tokens || 0))}</td>
                  <td className="num muted">{formatSeconds(event.latency_ms)}</td>
                  <td className="num">{formatMoney(event.cost, currency, 4)}</td>
                </tr>
              ))}
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
