"use client";

import { motion, useReducedMotion } from "motion/react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { displayDate, formatCompact, formatCount, formatMoney } from "@/lib/format";
import type { Metric } from "@/lib/usage";

const PAD = { top: 12, right: 2, bottom: 26, left: 46 };

function niceTicks(max: number, metric: Metric) {
  if (max <= 0) return [0];
  const raw = max / 4;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  let step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10) * magnitude;
  if (metric !== "cost") step = Math.max(1, Math.round(step));
  const ticks = [0];
  while (ticks[ticks.length - 1] <= max) ticks.push(Number((ticks.length * step).toPrecision(12)));
  return ticks;
}

export function formatMetric(value: number, metric: Metric, currency: string, compact = false) {
  if (metric === "cost") return formatMoney(value, currency, value > 0 && value < 0.1 ? 3 : 2);
  if (compact || metric === "tokens") return value >= 10_000 ? formatCompact(value) : formatCount(value);
  return formatCount(value);
}

export const metricColor: Record<Metric, [string, string]> = {
  calls: ["var(--c-calls)", "var(--c-tokens)"],
  tokens: ["var(--c-tokens)", "var(--c-calls)"],
  cost: ["var(--c-cost)", "var(--c-rose)"],
};

export const metricNoun: Record<Metric, string> = {
  calls: "calls",
  tokens: "tokens",
  cost: "estimated cost",
};

export function DailyBars({
  days,
  values,
  metric,
  currency,
  highlight,
  onHover,
  onSelect,
}: {
  days: string[];
  values: number[];
  metric: Metric;
  currency: string;
  highlight: string | null;
  onHover: (date: string | null) => void;
  onSelect: (date: string) => void;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const gradientId = `bars-${useId().replace(/:/g, "")}`;
  const reduced = useReducedMotion();
  const [barTop, barBottom] = metricColor[metric];
  const [{ width, height: HEIGHT }, setSize] = useState({ width: 0, height: 250 });
  const [focusIndex, setFocusIndex] = useState<number | null>(null);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({ width: Math.round(entry.contentRect.width), height: Math.max(180, Math.round(entry.contentRect.height)) }),
    );
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  const max = Math.max(0, ...values);
  const ticks = niceTicks(max, metric);
  const top = ticks[ticks.length - 1] || 1;
  const plotWidth = Math.max(0, width - PAD.left - PAD.right);
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const band = days.length ? plotWidth / days.length : 0;
  const barWidth = Math.max(1, Math.min(26, band * (days.length > 45 ? 0.72 : 0.6)));
  // About one date label per 64px, stepped back from the newest day so the last label is always "today".
  const labelStep = Math.max(1, Math.ceil(days.length / Math.max(2, Math.min(6, Math.floor(plotWidth / 64)))));
  const highlighted = highlight ? days.indexOf(highlight) : -1;
  const peak = values.indexOf(max);
  const summary = max
    ? `${metricNoun[metric]} per day from ${displayDate(days[0], { month: "short", day: "numeric" })} to ${displayDate(days[days.length - 1], { month: "short", day: "numeric" })}; highest ${formatMetric(max, metric, currency)} on ${displayDate(days[peak], { month: "short", day: "numeric" })}.`
    : `No ${metricNoun[metric]} in this range.`;

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!days.length) return;
    const current = focusIndex ?? days.length - 1;
    let next = current;
    if (event.key === "ArrowRight") next = Math.min(days.length - 1, current + 1);
    else if (event.key === "ArrowLeft") next = Math.max(0, current - 1);
    else if (event.key === "Enter" && focusIndex !== null) {
      onSelect(days[focusIndex]);
      return;
    } else return;
    event.preventDefault();
    setFocusIndex(next);
    onHover(days[next]);
  }

  const tooltipIndex = highlighted >= 0 ? highlighted : null;

  return (
    <div
      className="bars"
      ref={frameRef}
      tabIndex={0}
      role="group"
      aria-roledescription="bar chart"
      aria-label={`${summary} Use the arrow keys to read a day and Enter to open it.`}
      onKeyDown={onKeyDown}
      onBlur={() => {
        setFocusIndex(null);
        onHover(null);
      }}
      onPointerLeave={() => onHover(null)}
    >
      {width > 0 && (
        <svg width={width} height={HEIGHT} aria-hidden="true">
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" style={{ stopColor: barTop, stopOpacity: 1 }} />
              <stop offset="100%" style={{ stopColor: barBottom, stopOpacity: 0.35 }} />
            </linearGradient>
          </defs>
          {ticks.map((tick) => {
            const y = PAD.top + plotHeight - (tick / top) * plotHeight;
            return (
              <g key={tick}>
                <line className={tick === 0 ? "bars-baseline" : "bars-grid"} x1={PAD.left} x2={width - PAD.right} y1={y} y2={y} />
                {(tick > 0 || ticks.length > 1) && (
                  <text className="bars-tick" x={PAD.left - 10} y={y} dy="0.32em" textAnchor="end">
                    {formatMetric(tick, metric, currency, true)}
                  </text>
                )}
              </g>
            );
          })}
          {values.map((value, position) => {
            const height = (value / top) * plotHeight;
            const x = PAD.left + position * band + (band - barWidth) / 2;
            const y = PAD.top + plotHeight - height;
            const isHighlighted = position === highlighted;
            const isLatest = position === days.length - 1;
            return (
              <g key={days[position]}>
                {value > 0 && (
                  <motion.rect
                    key={`${metric}-${days[0]}-${days.length}`}
                    className={`bars-bar${isHighlighted ? " is-highlighted" : ""}${highlighted >= 0 && !isHighlighted ? " is-dim" : ""}`}
                    x={x}
                    y={y}
                    width={barWidth}
                    height={height}
                    rx={Math.min(4, barWidth / 2)}
                    fill={`url(#${gradientId})`}
                    style={isLatest ? { filter: `drop-shadow(0 0 8px ${barTop})` } : undefined}
                    initial={reduced ? false : { scaleY: 0, opacity: 0 }}
                    animate={{ scaleY: 1, opacity: 1 }}
                    transition={{ duration: 0.7, delay: reduced ? 0 : Math.min(position * 0.018, 0.6), ease: [0.23, 1, 0.32, 1] }}
                  />
                )}
                {isHighlighted && (
                  <line className="bars-cap" x1={x - 2} x2={x + barWidth + 2} y1={y - 0.5} y2={y - 0.5} />
                )}
                <rect
                  className="bars-hit"
                  x={PAD.left + position * band}
                  y={PAD.top}
                  width={band}
                  height={plotHeight}
                  onPointerEnter={() => onHover(days[position])}
                  onClick={() => onSelect(days[position])}
                />
              </g>
            );
          })}
          {days.map((day, position) => {
            if ((days.length - 1 - position) % labelStep !== 0) return null;
            const x = Math.min(width - PAD.right - 22, Math.max(PAD.left + 22, PAD.left + position * band + band / 2));
            return (
              <text className="bars-tick" key={day} x={x} y={HEIGHT - 6} textAnchor="middle">
                {displayDate(day, { month: "short", day: "numeric" })}
              </text>
            );
          })}
        </svg>
      )}
      {tooltipIndex !== null && width > 0 && (
        <div
          className="chart-tip"
          aria-live={focusIndex !== null ? "polite" : undefined}
          style={{
            left: Math.min(width - 8, Math.max(PAD.left, PAD.left + tooltipIndex * band + band / 2)),
            top: PAD.top + plotHeight - (values[tooltipIndex] / top) * plotHeight - 10,
          }}
        >
          <span>{displayDate(days[tooltipIndex], { weekday: "short", month: "short", day: "numeric" })}</span>
          <strong className="num">{formatMetric(values[tooltipIndex], metric, currency)}</strong>
        </div>
      )}
      {!max && <p className="bars-empty">No {metricNoun[metric]} in this range.</p>}
    </div>
  );
}
