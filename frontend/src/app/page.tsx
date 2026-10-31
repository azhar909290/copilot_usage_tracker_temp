"use client";

import NumberFlow from "@number-flow/react";
import { ArrowRight, BookOpen, Boxes, Cpu, Moon, Network, Radio, Sun, Waypoints } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useReducedMotion } from "motion/react";
import { Component, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { useCssColors } from "@/components/charts";
import { Reveal, Stagger, StaggerItem } from "@/components/Reveal";
import { RidgeMark } from "@/components/RidgeMark";
import { normalizeTeams, type TeamData } from "@/lib/teams";
import type { CatalogResponse, UsageRow } from "@/lib/usage";
import { useDashboardTheme } from "./theme";

const LandingScene = dynamic(() => import("@/components/LandingScene"), { ssr: false });
const API_BASE = (process.env.NEXT_PUBLIC_USAGE_API_URL || "http://127.0.0.1:4318").replace(/\/$/, "");
const DAY_MS = 86_400_000;

class SceneBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

let webglSupport: boolean | undefined;
function supportsWebGL() {
  if (webglSupport === undefined) {
    try {
      const canvas = document.createElement("canvas");
      webglSupport = Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
    } catch {
      webglSupport = false;
    }
  }
  return webglSupport;
}
const noSubscription = () => () => {};

type Stats = { calls: number; activeAgents: number; agents: number; teams: number; members: number; models: number };

/** The same three stacked planes as the 3D scene, drawn flat for browsers without WebGL. */
function PlanesFallback() {
  return (
    <svg className="landing-fallback" viewBox="0 0 260 210" aria-hidden="true">
      {[
        { y: 150, color: "var(--c-cost)" },
        { y: 112, color: "var(--c-tokens)" },
        { y: 74, color: "var(--c-calls)" },
      ].map((plane) => (
        <polygon key={plane.y} points={`130,${plane.y - 40} 222,${plane.y} 130,${plane.y + 40} 38,${plane.y}`} fill="none" stroke={plane.color} strokeWidth="1.6" />
      ))}
      <circle cx="130" cy="40" r="12" fill="var(--c-tokens)" />
    </svg>
  );
}

// Server and browser can format the last digit of trigonometry differently; round for hydration.
const round = (value: number) => Math.round(value * 100) / 100;

function OrbitArt() {
  const teams = ["var(--team-data)", "var(--team-ai)", "var(--team-cognitive)", "var(--team-rapid)", "var(--team-innovation)"];
  return (
    <svg className="art art-orbit" viewBox="0 0 240 240" aria-hidden="true">
      <circle cx="120" cy="120" r="78" className="art-ring" />
      <g className="art-spin">
        {teams.map((color, index) => {
          const angle = (index / teams.length) * Math.PI * 2;
          const x = round(120 + Math.cos(angle) * 78);
          const y = round(120 + Math.sin(angle) * 78);
          return (
            <g key={color}>
              <line x1="120" y1="120" x2={x} y2={y} stroke={color} strokeOpacity="0.4" />
              <circle cx={x} cy={y} r="13" fill={color} />
              {[0, 1, 2].map((member) => {
                const a = angle + member * 2.1;
                return <circle key={member} cx={round(x + Math.cos(a) * 24)} cy={round(y + Math.sin(a) * 24)} r="5" fill="var(--surface)" stroke={color} strokeWidth="2" />;
              })}
            </g>
          );
        })}
      </g>
      <circle cx="120" cy="120" r="20" fill="var(--c-tokens)" className="art-core" />
    </svg>
  );
}

function MosaicArt() {
  const families = [
    ["var(--c-calls)", "var(--c-tokens)"],
    ["var(--c-rose)", "var(--c-sun)"],
    ["var(--c-cost)", "var(--c-sun)"],
    ["var(--c-lime)", "var(--c-sky)"],
  ];
  return (
    <div className="art art-mosaic" aria-hidden="true">
      {Array.from({ length: 16 }, (_, index) => {
        const [a, b] = families[index % 4];
        return <span key={index} style={{ "--a": a, "--b": b, "--i": index } as CSSProperties} />;
      })}
    </div>
  );
}

function NetworkArt() {
  const columns = [3, 4, 4, 3];
  const nodes = columns.flatMap((count, column) => Array.from({ length: count }, (_, row) => ({ x: 30 + column * 60, y: 120 + (row - (count - 1) / 2) * 44, column })));
  const links = nodes.flatMap((a, i) => nodes.filter((b) => b.column === a.column + 1).map((b, j) => ({ a, b, key: `${i}-${j}` })));
  const colors = ["var(--c-lime)", "var(--c-calls)", "var(--c-tokens)", "var(--c-cost)"];
  return (
    <svg className="art art-network" viewBox="0 0 240 240" aria-hidden="true">
      {links.map(({ a, b, key }, index) => (
        <g key={key}>
          <path id={`art-link-${key}`} d={`M${a.x},${a.y}C${a.x + 30},${a.y} ${b.x - 30},${b.y} ${b.x},${b.y}`} stroke={colors[b.column]} className="art-link" />
          {index % 3 === 0 && (
            <circle r="2.6" fill={colors[b.column]} className="art-signal">
              <animateMotion dur={`${1.6 + (index % 5) * 0.3}s`} begin={`${(index % 7) * 0.3}s`} repeatCount="indefinite">
                <mpath href={`#art-link-${key}`} />
              </animateMotion>
            </circle>
          )}
        </g>
      ))}
      {nodes.map((node, index) => (
        <circle key={index} cx={node.x} cy={node.y} r="7" fill="var(--surface)" stroke={colors[node.column]} strokeWidth="2.4" />
      ))}
    </svg>
  );
}

function RidgeArt() {
  const rows = 9;
  return (
    <svg className="art art-ridge" viewBox="0 0 240 240" aria-hidden="true">
      {Array.from({ length: rows }, (_, row) => {
        const base = 60 + row * 18;
        const points: string[] = [];
        for (let x = 10; x <= 230; x += 6) {
          const bump = Math.exp(-(((x - 120 - Math.sin(row) * 30) / 26) ** 2)) * (18 + (row % 3) * 10) + Math.exp(-(((x - 70) / 14) ** 2)) * 8;
          points.push(`${x},${(base - bump).toFixed(1)}`);
        }
        const near = row / (rows - 1);
        return (
          <g key={row} className="art-ridge-row" style={{ "--i": row } as CSSProperties}>
            <path d={`M${points.join("L")}V${base}H10Z`} fill="var(--surface)" />
            <path d={`M${points.join("L")}`} fill="none" stroke={row === rows - 1 ? "var(--text)" : near > 0.5 ? "var(--c-calls)" : "var(--c-tokens)"} strokeOpacity={0.35 + 0.65 * near} strokeWidth="1.4" />
          </g>
        );
      })}
    </svg>
  );
}

const CAPABILITIES = [
  {
    icon: Network,
    title: "Five teams, one constellation",
    text: "tth-cto-innovation appears as a living organization: Data, AI, Cognitive core, Rapid labs and Innovation orbit the core, each person a badge circling their team. Select a team and the whole control plane focuses on it.",
    art: <OrbitArt />,
    hue: "var(--c-tokens)",
  },
  {
    icon: Boxes,
    title: "Every DevJourney agent, by family",
    text: "The AgentVerse catalogue, grouped into development, assurance, modernisation and data families, each in its own colours, with the calls, tokens and people behind every agent.",
    art: <MosaicArt />,
    hue: "var(--c-cost)",
  },
  {
    icon: Waypoints,
    title: "Signals you can trace",
    text: "A live network follows calls from teams to people, agents and models. Link width and signal pace come from real traffic, so the busiest paths are the brightest.",
    art: <NetworkArt />,
    hue: "var(--c-calls)",
  },
  {
    icon: Radio,
    title: "The rhythm of the work",
    text: "Daily ridgelines in 3D, hour-by-hour heat fields and per-model economics show when the organization builds, which models it leans on and what each call costs.",
    art: <RidgeArt />,
    hue: "var(--c-lime)",
  },
];

const FLOW = [
  { icon: Cpu, title: "Copilot in VS Code", text: "Agents and chat export OpenTelemetry spans as people work." },
  { icon: Radio, title: "OTLP receiver", text: "Calls, tokens, latency and identities are parsed and priced." },
  { icon: Network, title: "Ledger", text: "Usage is joined with teams and the DevJourney catalogue." },
  { icon: Waypoints, title: "AI Control Plane", text: "One picture of agents, people, teams and models." },
];

export default function Landing() {
  const reducedMotion = Boolean(useReducedMotion());
  const { theme, toggleTheme } = useDashboardTheme();
  const [stats, setStats] = useState<Stats | null>(null);
  const [status, setStatus] = useState<"loading" | "live" | "offline">("loading");
  const [visible, setVisible] = useState(true);
  const heroRef = useRef<HTMLElement>(null);
  const webgl = useSyncExternalStore<boolean | null>(noSubscription, supportsWebGL, () => null);
  const css = useCssColors(["--c-calls", "--c-tokens", "--c-cost", "--c-rose", "--c-lime", "--c-sky", "--text", "--surface"]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 15_000);
    Promise.all([
      fetch(`${API_BASE}/api/v1/usage`, { cache: "no-store", signal: controller.signal }).then((response) => (response.ok ? response.json() : Promise.reject(response.status))),
      fetch(`${API_BASE}/api/v1/agents`, { cache: "no-store", signal: controller.signal }).then((response) => (response.ok ? response.json() : Promise.reject(response.status))),
    ])
      .then(([usage, catalog]: [{ rows?: UsageRow[]; teams?: unknown }, CatalogResponse]) => {
        if (!active) return;
        const rows = Array.isArray(usage.rows) ? usage.rows : [];
        const cutoff = new Date(Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`) - 29 * DAY_MS).toISOString().slice(0, 10);
        const recent = rows.filter((row) => row.date >= cutoff);
        const catalogNames = new Map<string, string>();
        for (const agent of catalog.agents ?? []) {
          if (agent.kind === "skill_package") continue;
          for (const key of [agent.name, agent.id]) catalogNames.set(key.trim().toLowerCase(), agent.id);
        }
        const active30 = new Set(recent.filter((row) => row.requests > 0).map((row) => catalogNames.get(row.agent.trim().toLowerCase())).filter(Boolean));
        const teams: TeamData | null = normalizeTeams(usage.teams);
        setStats({
          calls: recent.reduce((sum, row) => sum + row.requests, 0),
          activeAgents: active30.size,
          agents: new Set(catalogNames.values()).size,
          teams: teams?.names.length ?? 0,
          members: teams ? Object.keys(teams.assignments).length : 0,
          models: new Set(recent.map((row) => row.model)).size,
        });
        setStatus("live");
      })
      .catch(() => active && setStatus("offline"))
      .finally(() => window.clearTimeout(timer));
    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    const hero = heroRef.current;
    if (!hero) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.02 });
    observer.observe(hero);
    return () => observer.disconnect();
  }, []);

  const light = theme === "light";
  const sceneColors = useMemo(
    () =>
      css
        ? { calls: css["--c-calls"], tokens: css["--c-tokens"], cost: css["--c-cost"], rose: css["--c-rose"], lime: css["--c-lime"], sky: css["--c-sky"], text: css["--text"] }
        : null,
    [css],
  );

  return (
    <div className="landing">
      <div className="sky" aria-hidden="true">
        <i />
      </div>
      <header className="landing-nav">
        <Link href="/" className="landing-brand" aria-label="AI Control Plane home">
          <RidgeMark size={26} />
          <span>AI Control Plane</span>
        </Link>
        <nav aria-label="Sections">
          <a href="#capabilities">Capabilities</a>
          <a href="#flow">How it works</a>
          <Link href="/github-metrics">GitHub metrics</Link>
        </nav>
        <div className="landing-nav-actions">
          <button className="icon-button" type="button" onClick={toggleTheme} aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}>
            {theme === "dark" ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
          </button>
          <Link className="button" href="/dashboard">
            Open the control plane <ArrowRight size={15} aria-hidden="true" />
          </Link>
        </div>
      </header>

      <main>
        <section className="landing-hero" ref={heroRef}>
          <div className="landing-stage" aria-hidden="true">
            {webgl === false ? (
              <PlanesFallback />
            ) : webgl && sceneColors ? (
              <SceneBoundary fallback={<PlanesFallback />}>
                <LandingScene colors={sceneColors} light={light} agents={stats?.agents ?? 63} reducedMotion={reducedMotion} running={visible} />
              </SceneBoundary>
            ) : null}
          </div>
          <div className="landing-copy">
            <Reveal>
              <h1>
                AI Control Plane
                <span>for tth-cto-innovation</span>
              </h1>
            </Reveal>
            <Reveal delay={0.08}>
              <p className="landing-lede">
                One living picture of how the organization builds with AI: every agent, every call and every team. The control plane turns Copilot and AgentVerse telemetry into answers about who is building, with which agents and models, and where the work is moving.
              </p>
            </Reveal>
            <Reveal delay={0.16} className="landing-ctas">
              <Link className="button landing-primary" href="/dashboard">
                Open the control plane <ArrowRight size={16} aria-hidden="true" />
              </Link>
              <Link className="button is-quiet" href="/dashboard?view=users">
                <Network size={16} aria-hidden="true" /> Meet the organization
              </Link>
            </Reveal>
            <Stagger as="section" className="landing-stats" label="Live figures for the last 30 days">
              <StaggerItem className="landing-stat" style={{ "--s": "var(--c-lime)" } as CSSProperties}>
                <span className="landing-stat-label">Active agents</span>
                <strong className="landing-stat-value">
                  {stats ? (
                    <>
                      <NumberFlow value={stats.activeAgents} locales="en-US" />
                      <small>/ {stats.agents}</small>
                    </>
                  ) : (
                    "—"
                  )}
                </strong>
              </StaggerItem>
              <StaggerItem className="landing-stat" style={{ "--s": "var(--c-calls)" } as CSSProperties}>
                <span className="landing-stat-label">Calls, 30 days</span>
                <strong className="landing-stat-value">{stats ? <NumberFlow value={stats.calls} locales="en-US" /> : "—"}</strong>
              </StaggerItem>
              <StaggerItem className="landing-stat" style={{ "--s": "var(--c-tokens)" } as CSSProperties}>
                <span className="landing-stat-label">Teams · people</span>
                <strong className="landing-stat-value">{stats ? `${stats.teams} · ${stats.members}` : "—"}</strong>
              </StaggerItem>
              <StaggerItem className="landing-stat" style={{ "--s": "var(--c-cost)" } as CSSProperties}>
                <span className="landing-stat-label">Models</span>
                <strong className="landing-stat-value">{stats ? <NumberFlow value={stats.models} locales="en-US" /> : "—"}</strong>
              </StaggerItem>
            </Stagger>
            <p className="landing-status" data-state={status}>
              <i aria-hidden="true" />
              {status === "live" ? "Live from the telemetry receiver" : status === "offline" ? "The telemetry receiver is offline; figures appear once it is running" : "Connecting to the telemetry receiver"}
            </p>
          </div>
        </section>

        <section className="landing-section" id="capabilities">
          <Reveal className="landing-section-head">
            <h2>What the control plane shows</h2>
            <p>Four lenses on the same telemetry, each answering a question leaders ask every week.</p>
          </Reveal>
          <div className="capabilities">
            {CAPABILITIES.map((capability, index) => {
              const Icon = capability.icon;
              return (
                <Reveal key={capability.title} className="capability" style={{ "--hue": capability.hue } as CSSProperties}>
                  <div className="capability-copy">
                    <span className="capability-icon">
                      <Icon size={18} aria-hidden="true" />
                    </span>
                    <h3>{capability.title}</h3>
                    <p>{capability.text}</p>
                  </div>
                  <div className="capability-art" data-flip={index % 2 === 1 || undefined}>
                    {capability.art}
                  </div>
                </Reveal>
              );
            })}
          </div>
        </section>

        <section className="landing-section" id="flow">
          <Reveal className="landing-section-head">
            <h2>How it works</h2>
            <p>From a prompt in VS Code to a decision in the control plane, in seconds.</p>
          </Reveal>
          <Stagger as="ol" className="flow" stagger={0.1}>
            {FLOW.map((step) => {
              const Icon = step.icon;
              return (
                <StaggerItem as="li" key={step.title} className="flow-step">
                  <span className="flow-icon">
                    <Icon size={18} aria-hidden="true" />
                  </span>
                  <h3>{step.title}</h3>
                  <p>{step.text}</p>
                </StaggerItem>
              );
            })}
          </Stagger>
        </section>

        <Reveal as="section" className="landing-cta">
          <h2>See the whole organization at once</h2>
          <p>Agents, people, teams and models, live from the receiver.</p>
          <Link className="button landing-primary" href="/dashboard">
            Open the control plane <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </Reveal>
      </main>

      <footer className="landing-footer">
        <span>
          <RidgeMark size={18} /> AI Control Plane · tth-cto-innovation
        </span>
        <a href={`${API_BASE}/docs`} target="_blank" rel="noreferrer">
          <BookOpen size={13} aria-hidden="true" /> API reference
        </a>
      </footer>
    </div>
  );
}
