"use client";

import { useReducedMotion } from "motion/react";
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { formatCount } from "@/lib/format";
import { teamColor, teamOf, type TeamData } from "@/lib/teams";
import { isUnknownUser, type CallEvent } from "@/lib/usage";

type Layer = "team" | "person" | "agent" | "model";
type NetNode = { id: string; layer: Layer; label: string; weight: number; color: string; x: number; y: number; r: number };
type NetEdge = { id: string; from: string; to: string; weight: number; color: string; d: string };

const LAYERS: { key: Layer; title: string; limit: number }[] = [
  { key: "team", title: "Teams", limit: 6 },
  { key: "person", title: "People", limit: 8 },
  { key: "agent", title: "Agents", limit: 8 },
  { key: "model", title: "Models", limit: 6 },
];
const LAYER_COLOR: Record<Exclude<Layer, "team">, string> = {
  person: "var(--c-calls)",
  agent: "var(--c-tokens)",
  model: "var(--c-cost)",
};
const HEIGHT = 380;
const PAD = { top: 44, bottom: 22, left: 26, right: 26 };

function top(counts: Map<string, number>, limit: number) {
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit);
}

function shorten(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Calls drawn as a four-layer network: teams → people → agents → models. Node size and link width
 * follow call counts; signals travel each link at a pace set by its traffic.
 */
export function NeuralFlow({ events, teams }: { events: CallEvent[]; teams: TeamData | null }) {
  const reduced = useReducedMotion();
  const uid = useId().replace(/:/g, "");
  const frameRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [focus, setFocus] = useState<string | null>(null);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  const graph = useMemo(() => {
    const counts = { team: new Map<string, number>(), person: new Map<string, number>(), agent: new Map<string, number>(), model: new Map<string, number>() };
    const pairs = new Map<string, number>();
    const bump = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);
    for (const event of events) {
      if (isUnknownUser(event.user)) continue;
      const team = teamOf(event.user, teams);
      bump(counts.team, team);
      bump(counts.person, event.user);
      bump(counts.agent, event.agent);
      bump(counts.model, event.model);
      bump(pairs, `team:${team}|person:${event.user}`);
      bump(pairs, `person:${event.user}|agent:${event.agent}`);
      bump(pairs, `agent:${event.agent}|model:${event.model}`);
    }
    const chosen = Object.fromEntries(LAYERS.map((layer) => [layer.key, top(counts[layer.key], layer.limit)])) as Record<Layer, [string, number][]>;
    return { chosen, pairs };
  }, [events, teams]);

  const layout = useMemo(() => {
    if (!width) return { nodes: [] as NetNode[], edges: [] as NetEdge[], columns: [] as number[] };
    // Leave room for team labels on the left and model labels on the right.
    const first = PAD.left + 104;
    const last = width - PAD.right - 168;
    const columns = LAYERS.map((_, index) => first + (index / (LAYERS.length - 1)) * (last - first));
    const max = Math.max(1, ...LAYERS.flatMap((layer) => graph.chosen[layer.key].map(([, count]) => count)));
    const nodes: NetNode[] = [];
    LAYERS.forEach((layer, column) => {
      const entries = graph.chosen[layer.key];
      const span = HEIGHT - PAD.top - PAD.bottom;
      entries.forEach(([name, count], row) => {
        const color =
          layer.key === "team" ? teamColor(name, teams?.names.indexOf(name) ?? row) : LAYER_COLOR[layer.key];
        nodes.push({
          id: `${layer.key}:${name}`,
          layer: layer.key,
          label: name,
          weight: count,
          color,
          x: columns[column],
          y: PAD.top + (entries.length > 1 ? (row / (entries.length - 1)) * span : span / 2),
          r: 5 + 9 * Math.sqrt(count / max),
        });
      });
    });
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const edges: NetEdge[] = [];
    for (const [key, weight] of graph.pairs) {
      const [from, to] = key.split("|");
      const a = byId.get(from);
      const b = byId.get(to);
      if (!a || !b) continue;
      const bend = (b.x - a.x) * 0.48;
      edges.push({ id: key, from, to, weight, color: b.color, d: `M${a.x},${a.y}C${a.x + bend},${a.y} ${b.x - bend},${b.y} ${b.x},${b.y}` });
    }
    return { nodes, edges, columns };
  }, [width, graph, teams]);

  const maxEdge = Math.max(1, ...layout.edges.map((edge) => edge.weight));
  const linked = useMemo(() => {
    if (!focus) return null;
    // Follow the focused node's links both upstream and downstream through the layers.
    const keep = new Set([focus]);
    const order = LAYERS.map((layer) => layer.key);
    const layerOf = (id: string) => order.indexOf(id.split(":")[0] as Layer);
    const start = layerOf(focus);
    for (let step = 0; step < order.length; step += 1) {
      for (const edge of layout.edges) {
        if (keep.has(edge.from) && layerOf(edge.to) > start) keep.add(edge.to);
        if (keep.has(edge.to) && layerOf(edge.from) < start) keep.add(edge.from);
      }
    }
    return keep;
  }, [focus, layout.edges]);
  const focused = layout.nodes.find((node) => node.id === focus);

  return (
    <div className="neural" ref={frameRef} onPointerLeave={() => setFocus(null)}>
      {width > 0 && layout.nodes.length > 0 ? (
        <svg width={width} height={HEIGHT} role="img" aria-label={`Signal network of ${formatCount(events.length)} calls: top teams, people, agents and models, linked by call volume.`}>
          {LAYERS.map((layer, index) => (
            <text key={layer.key} className="neural-heading" x={layout.columns[index]} y={18} textAnchor="middle">
              {layer.title}
            </text>
          ))}
          <g className="neural-edges">
            {layout.edges.map((edge, index) => {
              const dim = linked && !(linked.has(edge.from) && linked.has(edge.to));
              const strength = edge.weight / maxEdge;
              return (
                <g key={edge.id} className={dim ? "is-dim" : undefined}>
                  <path
                    id={`neural-${uid}-${index}`}
                    className="neural-edge"
                    d={edge.d}
                    pathLength={1}
                    stroke={edge.color}
                    strokeWidth={0.6 + 3.2 * Math.sqrt(strength)}
                    style={{ "--i": index % 24 } as CSSProperties}
                  />
                  {!reduced && !dim && (
                    <circle className="neural-pulse" r={1.6 + 2 * Math.sqrt(strength)} fill={edge.color} style={{ color: edge.color }}>
                      <animateMotion dur={`${(3.4 - 2.2 * Math.sqrt(strength)).toFixed(2)}s`} begin={`${((index * 0.37) % 3).toFixed(2)}s`} repeatCount="indefinite">
                        <mpath href={`#neural-${uid}-${index}`} />
                      </animateMotion>
                    </circle>
                  )}
                </g>
              );
            })}
          </g>
          <g className="neural-nodes">
            {layout.nodes.map((node, index) => {
              const column = LAYERS.findIndex((layer) => layer.key === node.layer);
              const dim = linked && !linked.has(node.id);
              const anchor = column === 0 ? "end" : "start";
              const labelX = column === 0 ? node.x - node.r - 8 : node.x + node.r + 8;
              const max = column === 0 ? 14 : column === LAYERS.length - 1 ? 22 : 20;
              return (
                <g
                  key={node.id}
                  className={`neural-node${dim ? " is-dim" : ""}${focus === node.id ? " is-focus" : ""}`}
                  style={{ "--c": node.color, "--col": column, "--i": index } as CSSProperties}
                  onPointerEnter={() => setFocus(node.id)}
                  onFocus={() => setFocus(node.id)}
                  onBlur={() => setFocus(null)}
                  tabIndex={0}
                  role="button"
                  aria-label={`${node.label}: ${formatCount(node.weight)} calls`}
                >
                  <circle className="neural-halo" cx={node.x} cy={node.y} r={node.r + 6} />
                  <circle className="neural-core" cx={node.x} cy={node.y} r={node.r} />
                  <text className="neural-label" x={labelX} y={node.y} dy="0.32em" textAnchor={anchor}>
                    {shorten(node.label, max)}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      ) : (
        <p className="empty">{events.length ? "Preparing the network…" : "No calls in this range."}</p>
      )}
      <p className="neural-readout" aria-live="polite">
        {focused ? (
          <>
            <strong>{focused.label}</strong> · {formatCount(focused.weight)} calls · {focused.layer}
          </>
        ) : (
          "Hover or focus a node to trace its signal path"
        )}
      </p>
    </div>
  );
}
