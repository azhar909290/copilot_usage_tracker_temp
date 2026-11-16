"use client";

import { useEffect, useState, type CSSProperties } from "react";

export type BootStage = {
  label: string;
  detail?: string;
  /** Measured duration in milliseconds, shown once the stage is complete. */
  duration?: number;
  state: "pending" | "active" | "done" | "failed";
};

const TITLE = "AI Control Plane";
const PLANES = [
  { y: 150, color: "var(--c-cost)" },
  { y: 112, color: "var(--c-tokens)" },
  { y: 74, color: "var(--c-calls)" },
];
const HALF_W = 92;
const HALF_H = 40;
const CENTER_X = 130;

function rhombus(y: number) {
  return `${CENTER_X},${y - HALF_H} ${CENTER_X + HALF_W},${y} ${CENTER_X},${y + HALF_H} ${CENTER_X - HALF_W},${y}`;
}

/** Grid lines parallel to the rhombus edges, so each plane reads as a surface. */
function gridLines(y: number) {
  const top = [CENTER_X, y - HALF_H];
  const right = [CENTER_X + HALF_W, y];
  const bottom = [CENTER_X, y + HALF_H];
  const left = [CENTER_X - HALF_W, y];
  const mix = (a: number[], b: number[], t: number) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const lines: string[] = [];
  for (const t of [0.25, 0.5, 0.75]) {
    const [x1, y1] = mix(top, right, t);
    const [x2, y2] = mix(left, bottom, t);
    const [x3, y3] = mix(top, left, t);
    const [x4, y4] = mix(right, bottom, t);
    lines.push(`M${x1},${y1}L${x2},${y2}`, `M${x3},${y3}L${x4},${y4}`);
  }
  return lines.join("");
}

const NODES: [number, number][] = [
  [130, 52],
  [92, 70],
  [168, 70],
  [116, 86],
  [150, 88],
  [130, 74],
];
const LINKS: [number, number][] = [
  [0, 5],
  [1, 5],
  [2, 5],
  [3, 5],
  [4, 5],
  [0, 1],
  [0, 2],
  [1, 3],
  [2, 4],
  [3, 4],
];

/**
 * First-load overlay. Three control planes (cost, tokens, calls) rise and stack while a neural
 * mesh lights up on the top plane; one meter reports the real loading stages. CSS-animated, so it
 * moves before and while JavaScript works, and lifts away once the first data is painted.
 */
export function BootLoader({ visible, stages }: { visible: boolean; stages: BootStage[] }) {
  const [removed, setRemoved] = useState(false);

  useEffect(() => {
    if (visible) return;
    const timer = window.setTimeout(() => setRemoved(true), 1500);
    return () => window.clearTimeout(timer);
  }, [visible]);

  if (removed) return null;
  const done = stages.filter((stage) => stage.state === "done").length;
  const activeIndex = stages.findIndex((stage) => stage.state === "active" || stage.state === "failed");
  const progress = Math.min(1, (done + (activeIndex >= 0 ? 0.5 : 0)) / stages.length);
  const current = stages[activeIndex] ?? stages[stages.length - 1];
  const failed = stages.some((stage) => stage.state === "failed");

  return (
    <div
      className="boot"
      data-visible={visible}
      aria-hidden={!visible}
      onTransitionEnd={(event) => {
        if (!visible && event.target === event.currentTarget && event.propertyName === "clip-path") setRemoved(true);
      }}
    >
      <div className="sky" aria-hidden="true">
        <i />
      </div>
      <div className="boot-frame">
        <svg className="boot-stack" viewBox="0 0 260 210" aria-hidden="true" focusable="false">
          <defs>
            <linearGradient id="boot-beam" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--c-calls)" stopOpacity="0.9" />
              <stop offset="55%" stopColor="var(--c-tokens)" stopOpacity="0.55" />
              <stop offset="100%" stopColor="var(--c-cost)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <line className="boot-beam" x1={CENTER_X} x2={CENTER_X} y1={74} y2={196} />
          {PLANES.map((plane, index) => (
            <g key={plane.y} className="boot-plane" style={{ "--i": index, "--plane": plane.color } as CSSProperties}>
              <polygon className="boot-plane-fill" points={rhombus(plane.y)} />
              <path className="boot-plane-grid" d={gridLines(plane.y)} />
              <polygon className="boot-plane-edge" points={rhombus(plane.y)} />
            </g>
          ))}
          <g className="boot-mesh">
            {LINKS.map(([a, b], index) => (
              <line
                key={`${a}-${b}`}
                className="boot-link"
                x1={NODES[a][0]}
                y1={NODES[a][1]}
                x2={NODES[b][0]}
                y2={NODES[b][1]}
                style={{ "--i": index } as CSSProperties}
              />
            ))}
            {NODES.map(([x, y], index) => (
              <circle key={`${x}-${y}`} className="boot-node" cx={x} cy={y} r={index === 5 ? 5 : 3.2} style={{ "--i": index } as CSSProperties} />
            ))}
          </g>
        </svg>
        <p className="boot-title" aria-label={TITLE}>
          {TITLE.split("").map((letter, index) => (
            <span key={index} aria-hidden="true" style={{ "--i": index } as CSSProperties}>
              {letter === " " ? "\u00a0" : letter}
            </span>
          ))}
        </p>
        <p className="boot-sub">tth-cto-innovation</p>
        <div className="boot-meter" data-failed={failed || undefined}>
          <div className="boot-meter-row">
            <span className="boot-stage" key={current?.label}>
              {failed ? `${current?.label} failed` : current ? `${current.label} · ${current.detail ?? ""}` : "Ready"}
            </span>
            <span className="boot-percent">{Math.round(progress * 100)}%</span>
          </div>
          <div className="boot-track" role="progressbar" aria-label="Loading AI Control Plane" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
            <span style={{ "--p": progress } as CSSProperties} />
          </div>
        </div>
        <ol className="visually-hidden" role="status" aria-live="polite" aria-label="Loading progress">
          {stages.map((stage) => (
            <li key={stage.label}>
              {stage.label}: {stage.state}
              {stage.duration !== undefined && stage.state === "done" ? ` in ${(stage.duration / 1000).toFixed(2)} seconds` : ""}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
