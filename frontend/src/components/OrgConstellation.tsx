"use client";

import dynamic from "next/dynamic";
import { useReducedMotion } from "motion/react";
import { Component, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { formatCompact, formatCount, formatMoney } from "@/lib/format";
import type { TeamSummary } from "@/lib/teams";
import { useCssColors } from "./charts";
import type { ConstellationHover, ConstellationTeam } from "./OrgConstellationScene";

const Scene = dynamic(() => import("./OrgConstellationScene"), { ssr: false });

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

/** Flat orbit diagram of the same hierarchy for browsers without WebGL. */
function OrbitFallback({ organization, teams, selected, onSelect }: { organization: string; teams: TeamSummary[]; selected: string | null; onSelect: (team: string | null) => void }) {
  const maxTokens = Math.max(1, ...teams.map((team) => team.tokens));
  return (
    <svg viewBox="-200 -170 400 340" style={{ width: "100%", height: "100%" }} role="img" aria-label={`${organization} with ${teams.length} teams`}>
      <circle r="120" fill="none" stroke="var(--control)" strokeDasharray="2 6" />
      <circle r="26" fill="var(--c-tokens)" opacity="0.9" />
      {teams.map((team, index) => {
        const angle = (index / teams.length) * Math.PI * 2 - Math.PI / 2;
        const x = Math.cos(angle) * 120;
        const y = Math.sin(angle) * 120;
        const radius = 10 + 14 * Math.sqrt(team.tokens / maxTokens);
        return (
          <g key={team.name} style={{ cursor: "pointer", opacity: selected && selected !== team.name ? 0.35 : 1 }} onClick={() => onSelect(selected === team.name ? null : team.name)}>
            <line x1="0" y1="0" x2={x} y2={y} stroke={`var(${team.token})`} strokeOpacity="0.4" />
            <circle cx={x} cy={y} r={radius} fill={`var(${team.token})`} />
            {team.members.map((member, position) => {
              const a = (position / Math.max(1, team.members.length)) * Math.PI * 2;
              return <circle key={member.user} cx={x + Math.cos(a) * (radius + 14)} cy={y + Math.sin(a) * (radius + 14)} r="3" fill={`var(${team.token})`} opacity={member.requests ? 1 : 0.35} />;
            })}
            <text x={x} y={y + radius + 30} textAnchor="middle" fill="var(--text)" fontSize="12" fontWeight="600">
              {team.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function OrgConstellation({
  organization,
  teams,
  currency,
  selected,
  onSelect,
}: {
  organization: string;
  teams: TeamSummary[];
  currency: string;
  selected: string | null;
  onSelect: (team: string | null) => void;
}) {
  const reducedMotion = Boolean(useReducedMotion());
  const frameRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const press = useRef<{ x: number; y: number } | null>(null);
  const dragged = useRef(false);
  const [hover, setHover] = useState<ConstellationHover | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number; width: number } | null>(null);
  const [visible, setVisible] = useState(true);
  const [pageVisible, setPageVisible] = useState(true);
  const webgl = useSyncExternalStore<boolean | null>(noSubscription, supportsWebGL, () => null);
  const tokens = useMemo(() => [...new Set(["--c-calls", "--c-tokens", "--c-cost", "--muted", "--surface", ...teams.map((team) => team.token)])], [teams]);
  const colors = useCssColors(tokens);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.05 });
    observer.observe(frame);
    const onVisibility = () => setPageVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const light = useMemo(() => {
    const surface = colors?.["--surface"];
    if (!surface || !surface.startsWith("#") || surface.length < 7) return false;
    const value = parseInt(surface.slice(1, 7), 16);
    return ((value >> 16) & 255) * 0.299 + ((value >> 8) & 255) * 0.587 + (value & 255) * 0.114 > 160;
  }, [colors]);

  const sceneTeams = useMemo<ConstellationTeam[]>(
    () =>
      teams.map((team) => ({
        name: team.name,
        color: colors?.[team.token] ?? "#888888",
        tokens: team.tokens,
        requests: team.requests,
        members: team.members.map((member) => ({ user: member.user, tokens: member.tokens, requests: member.requests, cost: member.cost })),
      })),
    [teams, colors],
  );

  const select = (team: string | null) => {
    if (dragged.current) return;
    onSelect(team);
  };

  const hoveredTeam = hover && hover.kind !== "org" ? teams.find((team) => team.name === hover.team) : undefined;
  const hoveredMember = hover?.kind === "member" ? hoveredTeam?.members.find((member) => member.user === hover.user) : undefined;
  const totals = teams.reduce((sum, team) => ({ requests: sum.requests + team.requests, tokens: sum.tokens + team.tokens, cost: sum.cost + team.cost }), { requests: 0, tokens: 0, cost: 0 });
  const memberCount = teams.reduce((sum, team) => sum + team.members.length, 0);

  const fallback = <OrbitFallback organization={organization} teams={teams} selected={selected} onSelect={onSelect} />;

  return (
    <div
      className="constellation"
      ref={frameRef}
      onPointerDown={(event) => {
        press.current = { x: event.clientX, y: event.clientY };
        dragged.current = false;
      }}
      onPointerMove={(event) => {
        const box = event.currentTarget.getBoundingClientRect();
        setPointer({ x: event.clientX - box.left, y: event.clientY - box.top, width: box.width });
        if (press.current && Math.hypot(event.clientX - press.current.x, event.clientY - press.current.y) > 5) dragged.current = true;
      }}
      onPointerUp={() => {
        press.current = null;
        window.setTimeout(() => (dragged.current = false), 0);
      }}
      onPointerLeave={() => {
        setPointer(null);
        setHover(null);
      }}
    >
      {webgl === false ? (
        fallback
      ) : webgl && colors ? (
        <SceneBoundary fallback={fallback}>
          <Scene
            teams={sceneTeams}
            coreColors={[colors["--c-calls"], colors["--c-tokens"], colors["--c-cost"]]}
            starColor={colors["--muted"]}
            light={light}
            selected={selected}
            reducedMotion={reducedMotion}
            running={visible && pageVisible}
            labelLayer={labelRef}
            onHover={setHover}
            onSelect={select}
          />
        </SceneBoundary>
      ) : null}
      {webgl !== false && (
        <div className="constellation-labels" ref={labelRef} aria-hidden="true">
          <span className="is-org">{organization}</span>
          {teams.map((team, index) => (
            <span
              key={team.name}
              data-team={index}
              className={selected && selected !== team.name ? "is-dim" : undefined}
              style={{ "--team": `var(${team.token})` } as CSSProperties}
            >
              {team.name} <span className="num">{team.members.length}</span>
            </span>
          ))}
        </div>
      )}
      {hover && pointer && (
        <div
          className="constellation-tip"
          style={{ left: Math.min(pointer.x, pointer.width - 220), top: pointer.y, "--team": hoveredTeam ? `var(${hoveredTeam.token})` : undefined } as CSSProperties}
        >
          {hover.kind === "org" ? (
            <>
              <strong>{organization}</strong>
              {teams.length} teams · {memberCount} members
              <dl>
                <dt>Calls</dt>
                <dd>{formatCount(totals.requests)}</dd>
                <dt>Tokens</dt>
                <dd>{formatCompact(totals.tokens)}</dd>
                <dt>Est. cost</dt>
                <dd>{formatMoney(totals.cost, currency)}</dd>
              </dl>
            </>
          ) : hoveredMember ? (
            <>
              <strong>{hoveredMember.user}</strong>
              {hoveredTeam?.name} team
              <dl>
                <dt>Calls</dt>
                <dd>{formatCount(hoveredMember.requests)}</dd>
                <dt>Tokens</dt>
                <dd>{formatCompact(hoveredMember.tokens)}</dd>
                <dt>Est. cost</dt>
                <dd>{formatMoney(hoveredMember.cost, currency)}</dd>
              </dl>
            </>
          ) : hoveredTeam ? (
            <>
              <strong>{hoveredTeam.name}</strong>
              {hoveredTeam.members.length} members · {hoveredTeam.activeMembers} active
              <dl>
                <dt>Calls</dt>
                <dd>{formatCount(hoveredTeam.requests)}</dd>
                <dt>Tokens</dt>
                <dd>{formatCompact(hoveredTeam.tokens)}</dd>
                <dt>Share</dt>
                <dd>{hoveredTeam.share.toFixed(1)}%</dd>
              </dl>
            </>
          ) : null}
        </div>
      )}
      <p className="constellation-hint">{webgl === false ? "Select a team" : "Drag to orbit · select a team to focus"}</p>
    </div>
  );
}
