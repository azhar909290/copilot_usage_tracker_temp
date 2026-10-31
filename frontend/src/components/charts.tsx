"use client";

import { motion, useReducedMotion } from "motion/react";
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { displayDate, formatCompact, formatCount } from "@/lib/format";

const EASE_OUT = [0.23, 1, 0.32, 1] as const;

/** Smooth path through points using a monotone-ish Catmull-Rom to Bézier conversion. */
export function smoothPath(points: [number, number][]) {
  if (!points.length) return "";
  if (points.length === 1) return `M${points[0][0]},${points[0][1]}`;
  let d = `M${points[0][0].toFixed(2)},${points[0][1].toFixed(2)}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[Math.max(0, index - 1)];
    const p1 = points[index];
    const p2 = points[index + 1];
    const p3 = points[Math.min(points.length - 1, index + 2)];
    const t = 0.18;
    const c1y = Math.min(Math.max(p1[1] + (p2[1] - p0[1]) * t, Math.min(p1[1], p2[1])), Math.max(p1[1], p2[1]));
    const c2y = Math.min(Math.max(p2[1] - (p3[1] - p1[1]) * t, Math.min(p1[1], p2[1])), Math.max(p1[1], p2[1]));
    const c1x = p1[0] + (p2[0] - p0[0]) * t;
    const c2x = p2[0] - (p3[0] - p1[0]) * t;
    d += `C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2[0].toFixed(2)},${p2[1].toFixed(2)}`;
  }
  return d;
}

/** A drawn-in sparkline whose area takes the series hue. Purely decorative: values are stated beside it. */
export function Sparkline({ values, color, className, height = 30 }: { values: number[]; color: string; className?: string; height?: number }) {
  const id = useId().replace(/:/g, "");
  const reduced = useReducedMotion();
  const max = Math.max(0, ...values);
  const points = values.map((value, index): [number, number] => [
    values.length > 1 ? (index / (values.length - 1)) * 100 : 50,
    height - 2 - (max ? (value / max) * (height - 6) : 0),
  ]);
  const line = smoothPath(points);
  const area = points.length ? `${line}L100,${height}L0,${height}Z` : "";
  const key = `${values.length}-${max}`;
  return (
    <svg className={className} viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" style={{ stopColor: color, stopOpacity: 0.55 }} />
          <stop offset="100%" style={{ stopColor: color, stopOpacity: 0 }} />
        </linearGradient>
      </defs>
      {area && (
        <motion.path
          key={`a-${key}`}
          className="area"
          d={area}
          fill={`url(#spark-${id})`}
          initial={reduced ? false : { opacity: 0 }}
          animate={{ opacity: 0.5 }}
          transition={{ duration: 0.9, delay: 0.35, ease: EASE_OUT }}
        />
      )}
      {line && (
        <motion.path
          key={`l-${key}`}
          className="line"
          d={line}
          style={{ stroke: color }}
          initial={reduced ? false : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1.2, ease: EASE_OUT }}
        />
      )}
    </svg>
  );
}

export type DonutItem = { name: string; value: number; color: string; detail?: string };

function arcPath(cx: number, cy: number, radius: number, start: number, end: number) {
  const sweep = Math.max(0.0001, end - start);
  const large = sweep > Math.PI ? 1 : 0;
  const x0 = cx + radius * Math.cos(start);
  const y0 = cy + radius * Math.sin(start);
  const x1 = cx + radius * Math.cos(start + sweep);
  const y1 = cy + radius * Math.sin(start + sweep);
  return `M${x0.toFixed(3)},${y0.toFixed(3)}A${radius},${radius} 0 ${large} 1 ${x1.toFixed(3)},${y1.toFixed(3)}`;
}

/** An orbital donut: arcs sweep in one after another; the hovered arc swells and is named in the centre. */
export function Donut({
  items,
  total,
  label,
  format,
  active,
  onActive,
  onPick,
  ariaLabel,
}: {
  items: DonutItem[];
  total?: number;
  label: string;
  format: (value: number) => string;
  active?: string | null;
  onActive?: (name: string | null) => void;
  onPick?: (name: string) => void;
  ariaLabel: string;
}) {
  const reduced = useReducedMotion();
  const sum = total ?? items.reduce((value, item) => value + item.value, 0);
  const gap = items.length > 1 ? 0.035 : 0;
  const visible = items.filter((item) => item.value > 0);
  const sweeps = visible.map((item) => (sum ? (item.value / sum) * Math.PI * 2 : 0));
  const arcs = visible.map((item, index) => {
    const offset = -Math.PI / 2 + sweeps.slice(0, index).reduce((total, sweep) => total + sweep, 0);
    const start = offset + gap / 2;
    const end = offset + sweeps[index] - gap / 2;
    return { ...item, d: arcPath(100, 100, 78, start, Math.max(start + 0.002, end)) };
  });
  const focus = arcs.find((arc) => arc.name === active);
  return (
    <div className="donut" role="img" aria-label={ariaLabel}>
      <svg viewBox="0 0 200 200">
        <circle cx="100" cy="100" r="78" fill="none" stroke="var(--raised)" strokeWidth="18" />
        <circle cx="100" cy="100" r="96" fill="none" stroke="var(--rule)" strokeWidth="1" strokeDasharray="1 5" />
        {arcs.map((arc, index) => (
          <motion.path
            key={`${arc.name}-${items.length}`}
            className={`donut-arc${active && active !== arc.name ? " is-dim" : ""}`}
            d={arc.d}
            stroke={arc.color}
            strokeWidth={active === arc.name ? 26 : 18}
            strokeLinecap="butt"
            style={{ filter: active === arc.name ? `drop-shadow(0 0 10px ${arc.color})` : undefined }}
            initial={reduced ? false : { pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.9, delay: 0.15 + index * 0.09, ease: EASE_OUT }}
            onPointerEnter={() => onActive?.(arc.name)}
            onPointerLeave={() => onActive?.(null)}
            onClick={() => onPick?.(arc.name)}
          />
        ))}
      </svg>
      <div className="donut-center">
        <strong className="num">{format(focus ? focus.value : sum)}</strong>
        <span>{focus ? `${sum ? ((focus.value / sum) * 100).toFixed(1) : "0"}% of ${label}` : label}</span>
        {focus && <em title={focus.name}>{focus.name}</em>}
      </div>
    </div>
  );
}

export type StreamSeries = { name: string; color: string; values: number[] };

/**
 * Stacked daily streams, one band per team. The whole field is revealed left to right, and a
 * cursor reads every band for the hovered day.
 */
export function StreamChart({
  days,
  series,
  focus,
  onFocus,
  unit,
}: {
  days: string[];
  series: StreamSeries[];
  focus?: string | null;
  onFocus?: (name: string | null) => void;
  unit: string;
}) {
  const reduced = useReducedMotion();
  const id = useId().replace(/:/g, "");
  const frameRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const height = 300;
  const pad = { top: 14, right: 8, bottom: 28, left: 44 };

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  const plotW = Math.max(0, width - pad.left - pad.right);
  const plotH = height - pad.top - pad.bottom;
  const totals = days.map((_, day) => series.reduce((sum, item) => sum + (item.values[day] ?? 0), 0));
  const max = Math.max(1, ...totals);
  const x = (day: number) => pad.left + (days.length > 1 ? (day / (days.length - 1)) * plotW : plotW / 2);
  const y = (value: number) => pad.top + plotH - (value / max) * plotH;

  const layers = useMemo(() => {
    const floor = days.map(() => 0);
    return series.map((item) => {
      const lower = [...floor];
      const upper = floor.map((value, day) => value + (item.values[day] ?? 0));
      upper.forEach((value, day) => (floor[day] = value));
      return { ...item, lower, upper };
    });
  }, [days, series]);

  const ticks = [0, 0.5, 1].map((part) => Math.round(max * part));
  const labelStep = Math.max(1, Math.ceil(days.length / Math.max(2, Math.floor(plotW / 90))));
  const revealKey = `${days[0]}-${days.length}-${series.map((item) => item.name).join("|")}`;

  return (
    <div className="stream" ref={frameRef} onPointerLeave={() => setHover(null)}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`Daily ${unit} stacked by team from ${days[0] ? displayDate(days[0], { month: "short", day: "numeric" }) : ""} to ${days.length ? displayDate(days[days.length - 1], { month: "short", day: "numeric" }) : ""}.`}
          onPointerMove={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            const relative = event.clientX - box.left - pad.left;
            const day = Math.round((relative / Math.max(1, plotW)) * (days.length - 1));
            setHover(day >= 0 && day < days.length ? day : null);
          }}
        >
          <defs>
            <clipPath id={`reveal-${id}`}>
              <motion.rect
                key={revealKey}
                x={pad.left - 2}
                y={0}
                height={height}
                initial={reduced ? { width: plotW + 6 } : { width: 0 }}
                animate={{ width: plotW + 6 }}
                transition={{ duration: 1.3, ease: EASE_OUT }}
              />
            </clipPath>
            {layers.map((layer, index) => (
              <linearGradient key={layer.name} id={`band-${id}-${index}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" style={{ stopColor: layer.color, stopOpacity: 0.9 }} />
                <stop offset="100%" style={{ stopColor: layer.color, stopOpacity: 0.35 }} />
              </linearGradient>
            ))}
          </defs>
          {ticks.map((tick) => (
            <g key={tick}>
              <line className="stream-grid" x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} />
              <text className="stream-axis" x={pad.left - 10} y={y(tick)} dy="0.32em" textAnchor="end">
                {formatCompact(tick)}
              </text>
            </g>
          ))}
          <g clipPath={`url(#reveal-${id})`}>
            {layers.map((layer, index) => {
              const top = layer.upper.map((value, day): [number, number] => [x(day), y(value)]);
              const bottom = layer.lower.map((value, day): [number, number] => [x(day), y(value)]).reverse();
              const upperPath = smoothPath(top);
              const lowerPath = smoothPath(bottom).replace(/^M/, "L");
              return (
                <g
                  key={layer.name}
                  className={`stream-layer${focus && focus !== layer.name ? " is-dim" : ""}`}
                  onPointerEnter={() => onFocus?.(layer.name)}
                  onPointerLeave={() => onFocus?.(null)}
                >
                  <path d={`${upperPath}${lowerPath}Z`} fill={`url(#band-${id}-${index})`} />
                  <path d={upperPath} fill="none" stroke={layer.color} strokeWidth={1.4} />
                </g>
              );
            })}
          </g>
          {days.map((day, position) =>
            (days.length - 1 - position) % labelStep === 0 ? (
              <text key={day} className="stream-axis" x={Math.min(width - pad.right - 18, Math.max(pad.left + 18, x(position)))} y={height - 8} textAnchor="middle">
                {displayDate(day, { month: "short", day: "numeric" })}
              </text>
            ) : null,
          )}
          {hover !== null && <line className="stream-cursor" x1={x(hover)} x2={x(hover)} y1={pad.top} y2={pad.top + plotH} />}
        </svg>
      )}
      {hover !== null && width > 0 && (
        <div className="chart-tip" style={{ left: Math.min(width - 90, Math.max(110, x(hover))), top: pad.top + 6, transform: "translate(-50%, 0)", flexDirection: "column", gap: 3 }}>
          <span style={{ color: "var(--text)", fontWeight: 650 }}>{displayDate(days[hover], { weekday: "short", month: "short", day: "numeric" })}</span>
          {[...layers].reverse().map((layer) => (
            <span key={layer.name} style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
              <span>
                <i className="swatch" style={{ "--sw": layer.color } as CSSProperties} />
                {layer.name}
              </span>
              <strong className="num">{formatCount(layer.values[hover] ?? 0)}</strong>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function subscribeTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

/** Resolves CSS custom properties to concrete colours (for WebGL), and follows theme changes. */
export function useCssColors(names: string[]) {
  const joined = names.join(",");
  const snapshot = useSyncExternalStore(
    subscribeTheme,
    () => {
      const style = getComputedStyle(document.documentElement);
      return joined
        .split(",")
        .map((name) => style.getPropertyValue(name).trim())
        .join("|");
    },
    () => "",
  );
  return useMemo(() => {
    if (!snapshot) return null;
    const values = snapshot.split("|");
    return Object.fromEntries(joined.split(",").map((name, index) => [name, values[index] || "#888888"])) as Record<string, string>;
  }, [snapshot, joined]);
}

export function Legend({ items }: { items: { name: string; color: string; value?: ReactNode }[] }) {
  return (
    <div className="legend-row">
      {items.map((item) => (
        <span className="chip" key={item.name} style={{ "--chip": item.color, cursor: "default" } as CSSProperties}>
          <i />
          {item.name}
          {item.value !== undefined && <span className="num">{item.value}</span>}
        </span>
      ))}
    </div>
  );
}
