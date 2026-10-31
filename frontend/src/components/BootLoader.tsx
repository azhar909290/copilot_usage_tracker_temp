"use client";

import { useEffect, useState } from "react";
import { RidgeMark } from "./RidgeMark";
import { SignalLines } from "./SignalLines";

export type BootStage = {
  label: string;
  detail?: string;
  /** Measured duration in milliseconds, shown once the stage is complete. */
  duration?: number;
  state: "pending" | "active" | "done" | "failed";
};

/**
 * First-load overlay. It is part of the static HTML, so it paints before JavaScript runs,
 * reports the real loading stages, and wipes away as soon as the data is on screen.
 */
export function BootLoader({ visible, stages }: { visible: boolean; stages: BootStage[] }) {
  const [removed, setRemoved] = useState(false);

  useEffect(() => {
    if (visible) return;
    const timer = window.setTimeout(() => setRemoved(true), 1400);
    return () => window.clearTimeout(timer);
  }, [visible]);

  if (removed) return null;

  return (
    <div
      className="boot"
      data-visible={visible}
      aria-hidden={!visible}
      onTransitionEnd={(event) => {
        if (!visible && event.target === event.currentTarget) setRemoved(true);
      }}
    >
      <div className="boot-frame">
        <div className="boot-brand">
          <RidgeMark size={26} />
          <span>Agent Command Center</span>
        </div>
        <SignalLines className="boot-signal" />
        <ol className="boot-log" role="status" aria-live="polite" aria-label="Loading progress">
          {stages.map((stage, index) => (
            <li key={stage.label} data-state={stage.state}>
              <span className="boot-index">{String(index + 1).padStart(2, "0")}</span>
              <span className="boot-label">{stage.label}</span>
              <span className="boot-detail">{stage.detail}</span>
              <span className="boot-time">
                {stage.state === "active" ? (
                  <i className="boot-caret" aria-hidden="true" />
                ) : stage.state === "failed" ? (
                  "failed"
                ) : stage.duration !== undefined ? (
                  `${(stage.duration / 1000).toFixed(2)} s`
                ) : null}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
