"use client";

import { ArrowUpRight, ExternalLink, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { formatCompact, formatCount, formatMoney } from "@/lib/format";
import type { CatalogAgent, UsageRow } from "@/lib/usage";
import { Sparkline } from "./charts";
import { Person } from "./Person";
import { Reveal } from "./Reveal";
import { Empty } from "./table";

type Family = { id: string; code: string; name: string; hues: [string, string, string] };

/** Each catalogue family wears a two-to-three hue signature drawn from the triad and its neighbours. */
const FAMILIES: Family[] = [
  { id: "A-DEV", code: "A-DEV", name: "Development journey", hues: ["var(--c-calls)", "var(--c-tokens)", "var(--c-sky)"] },
  { id: "A-ASR", code: "A-ASR", name: "Assurance & testing", hues: ["var(--c-rose)", "var(--c-tokens)", "var(--c-sun)"] },
  { id: "B-MOD", code: "B-MOD", name: "Modernisation", hues: ["var(--c-cost)", "var(--c-sun)", "var(--c-rose)"] },
  { id: "D-DATA", code: "D-DATA", name: "Data & analytics", hues: ["var(--c-lime)", "var(--c-calls)", "var(--c-sky)"] },
  { id: "OTHER", code: "Other", name: "Standalone agents", hues: ["var(--c-sky)", "var(--c-tokens)", "var(--c-calls)"] },
  { id: "TELEMETRY", code: "Observed", name: "Telemetry only", hues: ["var(--muted)", "var(--c-tokens)", "var(--faint)"] },
];
const FAMILY = new Map(FAMILIES.map((family) => [family.id, family]));

function familyOf(catalogue?: string | null) {
  const match = FAMILIES.find((family) => catalogue?.toUpperCase().startsWith(family.id));
  return match ?? FAMILY.get("OTHER")!;
}

function agentCode(name: string) {
  const match = name.match(/^([a-z])(\d+(?:\.\d+)?)/i);
  return match ? `${match[1].toUpperCase()}${match[2]}` : name.slice(0, 3).toUpperCase();
}

/** Catalogue headings sometimes carry a status suffix ("Name — ✅ Built"); the status pill shows it instead. */
function cleanTitle(title: string) {
  return title.replace(/\s+[—–]\s+(?:\p{Extended_Pictographic}\uFE0F?\s*)?(?:built|planned|draft|in progress|accepted)?\s*$/iu, "").trim() || title;
}

type Tile = {
  key: string;
  name: string;
  title: string;
  code: string;
  description: string;
  hint?: string;
  status?: string;
  url?: string;
  path?: string;
  family: Family;
  requests: number;
  tokens: number;
  cost: number;
  users: Map<string, number>;
  daily: number[];
};

type SortKey = "requests" | "tokens" | "cost" | "code" | "title";

export function CatalogView({
  agents,
  rows,
  days,
  currency,
  search,
  hues,
  error,
  onFilterAgent,
}: {
  agents: CatalogAgent[];
  rows: UsageRow[];
  days: string[];
  currency: string;
  search: string;
  hues: Map<string, number>;
  error?: string | null;
  onFilterAgent: (agent: string) => void;
}) {
  const reduced = useReducedMotion();
  const [family, setFamily] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("requests");
  const [usedOnly, setUsedOnly] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const tiles = useMemo(() => {
    const dayIndex = new Map(days.map((day, position) => [day, position]));
    const usage = new Map<string, { requests: number; tokens: number; cost: number; users: Map<string, number>; daily: number[]; name: string }>();
    for (const row of rows) {
      const key = row.agent.trim().toLowerCase();
      const entry = usage.get(key) ?? { requests: 0, tokens: 0, cost: 0, users: new Map(), daily: days.map(() => 0), name: row.agent };
      entry.requests += row.requests;
      entry.tokens += row.input_tokens + row.output_tokens;
      entry.cost += row.cost;
      entry.users.set(row.user, (entry.users.get(row.user) ?? 0) + row.requests);
      const position = dayIndex.get(row.date);
      if (position !== undefined) entry.daily[position] += row.requests;
      usage.set(key, entry);
    }
    const listed = new Set<string>();
    const result: Tile[] = agents
      .filter((agent) => agent.kind !== "skill_package")
      .map((agent, index) => {
        const keys = [agent.name, agent.id].map((value) => value.trim().toLowerCase());
        keys.forEach((key) => listed.add(key));
        const measure = keys.map((key) => usage.get(key)).find(Boolean);
        return {
          key: `${agent.id}-${index}`,
          name: agent.name,
          title: cleanTitle(agent.display_name || agent.name),
          code: agentCode(agent.name),
          description: agent.description,
          hint: agent.argument_hint || undefined,
          status: agent.status || undefined,
          url: agent.url,
          path: agent.path,
          family: familyOf(agent.catalogue),
          requests: measure?.requests ?? 0,
          tokens: measure?.tokens ?? 0,
          cost: measure?.cost ?? 0,
          users: measure?.users ?? new Map(),
          daily: measure?.daily ?? days.map(() => 0),
        };
      });
    for (const [key, measure] of usage) {
      if (listed.has(key)) continue;
      result.push({
        key: `observed-${key}`,
        name: measure.name,
        title: measure.name,
        code: agentCode(measure.name),
        description: "Seen in usage telemetry but not defined in the AgentVerse DevJourney catalogue.",
        family: FAMILY.get("TELEMETRY")!,
        requests: measure.requests,
        tokens: measure.tokens,
        cost: measure.cost,
        users: measure.users,
        daily: measure.daily,
      });
    }
    return result;
  }, [agents, rows, days]);

  const query = search.trim().toLowerCase();
  const familyStats = FAMILIES.map((item) => {
    const members = tiles.filter((tile) => tile.family.id === item.id);
    return {
      family: item,
      count: members.length,
      active: members.filter((tile) => tile.requests > 0).length,
      requests: members.reduce((sum, tile) => sum + tile.requests, 0),
      tokens: members.reduce((sum, tile) => sum + tile.tokens, 0),
      members,
    };
  }).filter((stat) => stat.count > 0);

  const visible = tiles
    .filter((tile) => !family || tile.family.id === family)
    .filter((tile) => !usedOnly || tile.requests > 0)
    .filter((tile) => !query || [tile.name, tile.title, tile.description, tile.code, tile.family.name].some((value) => value.toLowerCase().includes(query)))
    .sort((a, b) => {
      if (sort === "code" || sort === "title") return a[sort].localeCompare(b[sort], undefined, { numeric: true });
      return b[sort] - a[sort] || a.code.localeCompare(b.code, undefined, { numeric: true });
    });
  const maxCalls = Math.max(1, ...tiles.map((tile) => tile.requests));
  const active = tiles.find((tile) => tile.key === open) ?? null;

  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  return (
    <>
      <div className="section-title">
        <div>
          <h2>AgentVerse DevJourney catalogue</h2>
          <p>
            {formatCount(tiles.length)} agents across {familyStats.length} families · {formatCount(tiles.filter((tile) => tile.requests > 0).length)} used in range
          </p>
        </div>
      </div>

      <div className="family-grid">
        {familyStats.map((stat, index) => {
          const [h1, h2, h3] = stat.family.hues;
          const pressed = family === stat.family.id;
          return (
            <Reveal key={stat.family.id} delay={index * 0.06} style={{ display: "flex" }}>
              <button
                type="button"
                className="family-card"
                aria-pressed={pressed}
                onClick={() => setFamily(pressed ? null : stat.family.id)}
                style={{ "--h1": h1, "--h2": h2, "--h3": h3, width: "100%" } as CSSProperties}
              >
                <span className="family-code">
                  <i aria-hidden="true">
                    <b style={{ background: h1 }} />
                    <b style={{ background: h2 }} />
                    <b style={{ background: h3 }} />
                  </i>
                  {stat.family.code}
                </span>
                <h3>{stat.family.name}</h3>
                <div className="family-figures">
                  <strong className="num" style={{ color: h1 }}>
                    {stat.count}
                  </strong>
                  <span>agents · {stat.active} used</span>
                  <span className="num">{formatCount(stat.requests)} calls</span>
                </div>
                <div className="family-bar" aria-hidden="true">
                  {stat.members
                    .filter((tile) => tile.requests > 0)
                    .sort((a, b) => b.requests - a.requests)
                    .map((tile, position) => (
                      <span key={tile.key} style={{ flex: tile.requests, background: [h1, h2, h3][position % 3], animationDelay: `${300 + position * 40}ms` }} />
                    ))}
                  {stat.active === 0 && <span style={{ flex: 1, background: "var(--control)" }} />}
                </div>
              </button>
            </Reveal>
          );
        })}
      </div>

      <div className="catalog-controls">
        <div className="catalog-chips" role="group" aria-label="Catalogue family">
          <button type="button" className="chip" aria-pressed={!family} onClick={() => setFamily(null)} style={{ "--chip": "var(--text)" } as CSSProperties}>
            <i />
            All families <span className="num">{tiles.length}</span>
          </button>
          {familyStats.map((stat) => (
            <button
              key={stat.family.id}
              type="button"
              className="chip"
              aria-pressed={family === stat.family.id}
              onClick={() => setFamily(family === stat.family.id ? null : stat.family.id)}
              style={{ "--chip": stat.family.hues[0] } as CSSProperties}
            >
              <i />
              {stat.family.name} <span className="num">{stat.count}</span>
            </button>
          ))}
        </div>
        <div className="catalog-chips">
          <button type="button" className="chip" aria-pressed={usedOnly} onClick={() => setUsedOnly((value) => !value)} style={{ "--chip": "var(--positive)" } as CSSProperties}>
            <i />
            Used in range
          </button>
          <label className="select">
            <span className="visually-hidden">Sort agents</span>
            <select aria-label="Sort agents" value={sort} onChange={(event) => setSort(event.target.value as SortKey)}>
              <option value="requests">Most calls</option>
              <option value="tokens">Most tokens</option>
              <option value="cost">Highest cost</option>
              <option value="code">Journey order</option>
              <option value="title">Name</option>
            </select>
          </label>
        </div>
      </div>

      {visible.length ? (
        <motion.div className="catalog-grid" layout={!reduced}>
          <AnimatePresence mode="popLayout" initial={true}>
            {visible.map((tile, index) => {
              const [h1, h2, h3] = tile.family.hues;
              return (
                <motion.button
                  layout={!reduced}
                  key={tile.key}
                  type="button"
                  className="agent-tile"
                  data-idle={tile.requests === 0 || undefined}
                  style={{ "--h1": h1, "--h2": h2, "--h3": h3 } as CSSProperties}
                  initial={reduced ? { opacity: 0 } : { opacity: 0, transform: "translateY(18px) scale(0.97)" }}
                  animate={reduced ? { opacity: 1 } : { opacity: 1, transform: "translateY(0px) scale(1)" }}
                  exit={reduced ? { opacity: 0 } : { opacity: 0, transform: "scale(0.96)", transition: { duration: 0.16 } }}
                  transition={{ duration: 0.5, delay: Math.min(index, 18) * 0.03, ease: [0.23, 1, 0.32, 1] }}
                  onClick={() => setOpen(tile.key)}
                >
                  <span className="agent-top">
                    <span className="agent-code">{tile.code}</span>
                    {tile.requests > 0 ? (
                      <span className="pill is-positive">In use</span>
                    ) : (
                      <span className="pill is-neutral">{tile.status ? tile.status.replace(/\s*\(.*\)$/, "") : "Idle"}</span>
                    )}
                  </span>
                  <h3>{tile.title}</h3>
                  <span className="agent-id id">{tile.name}</span>
                  <p className="agent-desc">{tile.description || "No description provided."}</p>
                  <span className="agent-meter" aria-hidden="true">
                    <span style={{ "--v": tile.requests / maxCalls } as CSSProperties} />
                  </span>
                  <dl className="agent-figures">
                    <div>
                      <dt>Calls</dt>
                      <dd>{formatCount(tile.requests)}</dd>
                    </div>
                    <div>
                      <dt>Tokens</dt>
                      <dd>{formatCompact(tile.tokens)}</dd>
                    </div>
                    <div>
                      <dt>Est. cost</dt>
                      <dd>{formatMoney(tile.cost, currency)}</dd>
                    </div>
                  </dl>
                </motion.button>
              );
            })}
          </AnimatePresence>
        </motion.div>
      ) : (
        <Empty>No agents match {query ? `“${search}”` : "these filters"}.</Empty>
      )}
      {!!error && <p className="table-note">Catalogue refresh issue: {error}</p>}

      <AnimatePresence>
        {active && (
          <>
            <motion.div className="agent-panel-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.15 } }} onClick={() => setOpen(null)} />
            <motion.aside
              className="agent-panel"
              role="dialog"
              aria-modal="true"
              aria-label={active.title}
              style={{ "--h1": active.family.hues[0], "--h2": active.family.hues[1], "--h3": active.family.hues[2] } as CSSProperties}
              initial={reduced ? { opacity: 0 } : { opacity: 0, transform: "translateX(40px)" }}
              animate={reduced ? { opacity: 1 } : { opacity: 1, transform: "translateX(0px)" }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, transform: "translateX(28px)", transition: { duration: 0.18 } }}
              transition={{ duration: 0.42, ease: [0.32, 0.72, 0, 1] }}
            >
              <button className="icon-button panel-close" type="button" aria-label="Close agent details" onClick={() => setOpen(null)} autoFocus>
                <X size={15} aria-hidden="true" />
              </button>
              <span className="family-code">
                <i aria-hidden="true">
                  {active.family.hues.map((hue) => (
                    <b key={hue} style={{ background: hue }} />
                  ))}
                </i>
                {active.family.name} · {active.code}
              </span>
              <div>
                <h2>{active.title}</h2>
                <span className="agent-id id">{active.name}</span>
              </div>
              <p>{active.description || "No description provided."}</p>
              <dl className="panel-figures">
                <div>
                  <dt>Calls</dt>
                  <dd className="num" style={{ color: active.family.hues[0] }}>
                    {formatCount(active.requests)}
                  </dd>
                </div>
                <div>
                  <dt>Tokens</dt>
                  <dd className="num">{formatCompact(active.tokens)}</dd>
                </div>
                <div>
                  <dt>Est. cost</dt>
                  <dd className="num">{formatMoney(active.cost, currency)}</dd>
                </div>
              </dl>
              <Sparkline className="team-spark" values={active.daily} color={active.family.hues[0]} height={40} />
              <dl className="panel-meta">
                {active.status && (
                  <>
                    <dt>Status</dt>
                    <dd>{active.status}</dd>
                  </>
                )}
                {active.hint && (
                  <>
                    <dt>Arguments</dt>
                    <dd>{active.hint}</dd>
                  </>
                )}
                {active.path && (
                  <>
                    <dt>Definition</dt>
                    <dd className="id">{active.path}</dd>
                  </>
                )}
              </dl>
              {active.users.size > 0 && (
                <div>
                  <h3 style={{ fontSize: 15, marginBottom: 10 }}>Who uses it</h3>
                  <ul className="panel-users">
                    {[...active.users.entries()]
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 6)
                      .map(([user, calls]) => (
                        <li key={user}>
                          <Person name={user} hue={hues.get(user)} />
                          <span className="num muted">{formatCount(calls)} calls</span>
                        </li>
                      ))}
                  </ul>
                </div>
              )}
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: "auto" }}>
                {active.requests > 0 && (
                  <button
                    className="button"
                    type="button"
                    onClick={() => {
                      onFilterAgent(active.name);
                      setOpen(null);
                    }}
                  >
                    Filter dashboard to this agent <ArrowUpRight size={14} aria-hidden="true" />
                  </button>
                )}
                {active.url && (
                  <a className="button is-quiet" href={active.url} target="_blank" rel="noreferrer">
                    Open definition <ExternalLink size={14} aria-hidden="true" />
                  </a>
                )}
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
