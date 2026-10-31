"use client";

import dynamic from "next/dynamic";
import { useReducedMotion } from "motion/react";
import { Component, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { displayDate, formatClock } from "@/lib/format";
import { RIDGE_BIN_MINUTES, type Metric, type RidgeData } from "@/lib/usage";
import { formatMetric, metricNoun } from "./DailyBars";
import type { RidgeColors } from "./RidgeScene";

const RidgeScene = dynamic(() => import("./RidgeScene"), { ssr: false });

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

/** A flat joyplot of the same data, for browsers without WebGL. */
function RidgeSvg({ data, accentRow }: { data: RidgeData; accentRow: number | null }) {
  const count = data.rows.length;
  const gap = count > 1 ? 150 / (count - 1) : 0;
  return (
    <svg className="ridge-svg" viewBox="0 0 1000 260" preserveAspectRatio="none" aria-hidden="true">
      {data.rows.map((row, index) => {
        const base = 80 + index * gap;
        const points = row.map((value, sample) => `${((sample / (row.length - 1)) * 1000).toFixed(1)} ${(base - (data.max ? value / data.max : 0) * 70).toFixed(1)}`);
        const line = `M${points.join("L")}`;
        return (
          <g key={data.days[index]}>
            <path d={`${line}V${base}H0Z`} className="ridge-svg-fill" />
            <path d={line} className={index === accentRow ? "ridge-svg-line is-accent" : "ridge-svg-line"} style={{ opacity: 0.25 + 0.7 * (count > 1 ? index / (count - 1) : 1) }} />
          </g>
        );
      })}
    </svg>
  );
}

// The theme lives on <html data-theme>; follow the attribute itself so the canvas repaints with the
// tokens that are actually applied, whichever component changed them.
function subscribeTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

function readPalette() {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return [
    read("--surface", "#0f1220"),
    read("--c-calls", "#38e2c8"),
    read("--c-tokens", "#a08bff"),
    read("--c-cost", "#ff8f5e"),
    read("--text", "#edf0ff"),
  ].join("|");
}

const METRIC_DEPTH: Record<Metric, [number, number]> = { calls: [2, 1], tokens: [1, 2], cost: [2, 3] };

export function SignalRidge({
  data,
  metric,
  dayTotals,
  currency,
  today,
  highlightDate,
  onHoverDate,
  onSelectDate,
}: {
  data: RidgeData;
  metric: Metric;
  dayTotals: number[];
  currency: string;
  today: string;
  highlightDate: string | null;
  onHoverDate: (date: string | null) => void;
  onSelectDate: (date: string) => void;
}) {
  const reducedMotion = Boolean(useReducedMotion());
  const stageRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const palette = useSyncExternalStore(subscribeTheme, readPalette, () => "");
  const colors = useMemo<RidgeColors | null>(() => {
    if (!palette) return null;
    const values = palette.split("|");
    const [back, front] = METRIC_DEPTH[metric];
    return { surface: values[0], ink: values[back], front: values[front], accent: values[4] };
  }, [palette, metric]);
  const webgl = useSyncExternalStore<boolean | null>(noSubscription, supportsWebGL, () => null);
  const [pointer, setPointer] = useState<{ row: number; minute: number } | null>(null);
  const [nowMinute, setNowMinute] = useState<number | null>(null);

  useEffect(() => {
    const update = () => {
      const now = new Date();
      setNowMinute(now.getUTCHours() * 60 + now.getUTCMinutes());
    };
    update();
    const timer = window.setInterval(update, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const count = data.days.length;
  const newest = count - 1;
  const highlighted = highlightDate ? data.days.indexOf(highlightDate) : -1;
  const focusRow = pointer?.row ?? (highlighted >= 0 ? highlighted : null);
  const readRow = focusRow ?? newest;
  const labelStep = Math.max(1, Math.ceil(count / 6));
  const peakBin = useMemo(() => {
    const bins = data.bins[readRow] ?? [];
    const best = Math.max(0, ...bins);
    return best > 0 ? bins.indexOf(best) : -1;
  }, [data, readRow]);

  const bin = pointer ? Math.floor(pointer.minute / RIDGE_BIN_MINUTES) : null;
  const binValue = bin !== null ? (data.bins[readRow]?.[bin] ?? 0) : null;
  const dayValue = dayTotals[readRow] ?? 0;

  const fallback = <RidgeSvg data={data} accentRow={newest} />;

  return (
    <div className="ridge">
      <p className="ridge-readout" aria-live="polite">
        {count ? (
          <>
            <span className="ridge-day">
              {displayDate(data.days[readRow], { weekday: "short", month: "short", day: "numeric" })}
              {data.days[readRow] === today ? " · today" : ""}
            </span>
            <span className="num">
              {formatMetric(dayValue, metric, currency)} {metric === "cost" ? "" : metricNoun[metric]}
            </span>
            {bin !== null && binValue !== null ? (
              <span>
                {formatClock(bin * RIDGE_BIN_MINUTES)}–{formatClock((bin + 1) * RIDGE_BIN_MINUTES)} UTC:{" "}
                <span className="num">{formatMetric(binValue, metric, currency)}</span>
              </span>
            ) : peakBin >= 0 ? (
              <span>
                busiest {formatClock(peakBin * RIDGE_BIN_MINUTES)}–{formatClock((peakBin + 1) * RIDGE_BIN_MINUTES)} UTC
              </span>
            ) : (
              <span>no calls this day</span>
            )}
          </>
        ) : (
          <span>No days in this range.</span>
        )}
      </p>
      <div
        className="ridge-stage"
        ref={stageRef}
        onPointerLeave={() => {
          setPointer(null);
          onHoverDate(null);
        }}
      >
        {webgl === false ? (
          fallback
        ) : webgl && colors && count > 0 ? (
          <SceneBoundary fallback={fallback}>
            <RidgeScene
              rows={data.rows}
              max={data.max}
              accentRow={data.days[newest] ? newest : null}
              highlight={focusRow}
              colors={colors}
              reducedMotion={reducedMotion}
              labelLayer={labelRef}
              onHover={(row, minute) => {
                setPointer((current) => (current?.row === row && Math.floor(current.minute / RIDGE_BIN_MINUTES) === Math.floor(minute / RIDGE_BIN_MINUTES) ? current : { row, minute }));
                if (pointer?.row !== row) onHoverDate(data.days[row] ?? null);
              }}
              onSelect={(row) => {
                if (data.days[row]) onSelectDate(data.days[row]);
              }}
            />
          </SceneBoundary>
        ) : null}
        {webgl !== false && (
          <div className="ridge-labels" ref={labelRef} aria-hidden="true">
            {data.days.map((day, row) =>
              (newest - row) % labelStep === 0 ? (
                <span key={day} data-row={row} className={row === readRow ? "is-current" : undefined}>
                  {displayDate(day, { month: "short", day: "numeric" })}
                </span>
              ) : null,
            )}
            {[0, 360, 720, 1080, 1440]
              .filter((minute) => nowMinute === null || data.days[newest] !== today || Math.abs(minute - nowMinute) >= 75)
              .map((minute) => (
                <span key={minute} data-minute={minute}>
                  {minute === 1440 ? "24:00" : formatClock(minute)}
                </span>
              ))}
            {nowMinute !== null && data.days[newest] === today && (
              <span data-minute={nowMinute} className="ridge-now">
                now
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
