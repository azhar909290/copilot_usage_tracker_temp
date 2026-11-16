"use client";

import Link from "next/link";
import { PanelLeftClose, PanelLeftOpen, type LucideIcon } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { RidgeMark } from "./RidgeMark";

export type RailItem = {
  id: string;
  label: string;
  /** Shorter label for the phone's bottom bar. */
  short?: string;
  icon: LucideIcon;
  href?: string;
  onSelect?: () => void;
};

export type RailUtility = {
  id: string;
  label: string;
  /** Tooltip text when it should differ from the accessible name (e.g. a shortcut hint). */
  tip?: string;
  icon: LucideIcon;
  onSelect?: () => void;
  href?: string;
};

const MIN_WIDTH = 180;
const MAX_WIDTH = 360;
const DEFAULT_EXPANDED_WIDTH = 240;
const COLLAPSED_WIDTH = 64;

function ItemBody({ item, active, expanded }: { item: RailItem | RailUtility; active?: boolean; expanded?: boolean }) {
  const Icon = item.icon;
  return (
    <>
      <Icon size={18} strokeWidth={1.6} aria-hidden="true" className="rail-icon" />
      <span className="rail-label">{"short" in item && !expanded && item.short ? item.short : item.label}</span>
      {active && (
        <motion.span
          className="rail-indicator"
          layoutId="rail-indicator"
          transition={{ type: "spring", stiffness: 560, damping: 44 }}
        />
      )}
    </>
  );
}

/**
 * Flexible navigation sidebar:
 * - In compact mode (64px): minimal icon rail.
 * - In expanded mode: shows full section labels, brand title, and utility actions.
 * - Draggable resize handle allows freely expanding or contracting the width.
 * - Remembers user's preference in localStorage.
 * - Keyboard shortcut '[' toggles expansion.
 */
export function Rail({
  items,
  active,
  utilities,
  footer,
}: {
  items: RailItem[];
  active: string;
  utilities: RailUtility[];
  footer?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const [width, setWidth] = useState(DEFAULT_EXPANDED_WIDTH);
  const [isDragging, setIsDragging] = useState(false);
  const startDragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  // Initialize from localStorage on client
  useEffect(() => {
    try {
      const savedExp = localStorage.getItem("copilot_rail_expanded");
      if (savedExp !== null) {
        setExpanded(savedExp === "true");
      }
      const savedW = localStorage.getItem("copilot_rail_width");
      if (savedW) {
        const parsed = parseInt(savedW, 10);
        if (!isNaN(parsed) && parsed >= MIN_WIDTH && parsed <= MAX_WIDTH) {
          setWidth(parsed);
        }
      }
    } catch {
      // Storage access may be restricted
    }
  }, []);

  // Sync --rail-w CSS variable to root/app element so grid layout seamlessly adapts
  useEffect(() => {
    const currentW = expanded ? width : COLLAPSED_WIDTH;
    document.documentElement.style.setProperty("--rail-w", `${currentW}px`);
    return () => {
      document.documentElement.style.removeProperty("--rail-w");
    };
  }, [expanded, width]);

  // Keyboard shortcut: '[' toggles sidebar
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "[" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const target = e.target as HTMLElement | null;
        if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
          return;
        }
        e.preventDefault();
        setExpanded((prev) => {
          const next = !prev;
          try {
            localStorage.setItem("copilot_rail_expanded", String(next));
          } catch {}
          return next;
        });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const toggleExpanded = () => {
    setExpanded((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("copilot_rail_expanded", String(next));
      } catch {}
      return next;
    });
  };

  // Drag to resize handler
  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    setIsDragging(true);
    startDragRef.current = {
      startX: e.clientX,
      startWidth: expanded ? width : COLLAPSED_WIDTH,
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (!startDragRef.current) return;
      const delta = moveEvent.clientX - startDragRef.current.startX;
      const newWidth = startDragRef.current.startWidth + delta;

      if (newWidth < 110) {
        setExpanded(false);
        try {
          localStorage.setItem("copilot_rail_expanded", "false");
        } catch {}
      } else {
        const clamped = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, newWidth));
        setWidth(clamped);
        setExpanded(true);
        try {
          localStorage.setItem("copilot_rail_expanded", "true");
          localStorage.setItem("copilot_rail_width", String(clamped));
        } catch {}
      }
    };

    const handlePointerUp = () => {
      setIsDragging(false);
      startDragRef.current = null;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  const handleDoubleClickResizer = () => {
    if (expanded) {
      setExpanded(false);
      try {
        localStorage.setItem("copilot_rail_expanded", "false");
      } catch {}
    } else {
      setExpanded(true);
      setWidth(DEFAULT_EXPANDED_WIDTH);
      try {
        localStorage.setItem("copilot_rail_expanded", "true");
        localStorage.setItem("copilot_rail_width", String(DEFAULT_EXPANDED_WIDTH));
      } catch {}
    }
  };

  return (
    <nav
      className={`rail ${expanded ? "is-expanded" : ""} ${isDragging ? "is-resizing" : ""}`}
      style={{ "--sidebar-width": `${expanded ? width : COLLAPSED_WIDTH}px` } as CSSProperties}
      aria-label="Primary"
    >
      <div className="rail-top">
        <Link className="rail-brand" href="/" aria-label="AI Control Plane home">
          <RidgeMark size={24} />
          {expanded && (
            <div className="rail-brand-meta">
              <span className="rail-brand-title">AI Control Plane</span>
              <span className="rail-brand-sub">Telemetry Hub</span>
            </div>
          )}
        </Link>
        <button
          className="rail-toggle-btn"
          type="button"
          onClick={toggleExpanded}
          aria-label={expanded ? "Collapse sidebar ( [ )" : "Expand sidebar ( [ )"}
          data-tip={expanded ? "Collapse sidebar ( [ )" : "Expand sidebar ( [ )"}
        >
          {expanded ? <PanelLeftClose size={17} aria-hidden="true" /> : <PanelLeftOpen size={17} aria-hidden="true" />}
        </button>
      </div>

      <ul className="rail-items">
        {items.map((item) => {
          const isActive = item.id === active;
          return (
            <li key={item.id} className="rail-item-wrap">
              {item.href ? (
                <Link
                  className="rail-item"
                  href={item.href}
                  aria-label={item.label}
                  data-tip={!expanded ? item.label : undefined}
                  data-active={isActive || undefined}
                  aria-current={isActive ? "page" : undefined}
                >
                  <ItemBody item={item} active={isActive} expanded={expanded} />
                </Link>
              ) : (
                <button
                  className="rail-item"
                  type="button"
                  aria-label={item.label}
                  data-tip={!expanded ? item.label : undefined}
                  data-active={isActive || undefined}
                  aria-current={isActive ? "page" : undefined}
                  onClick={item.onSelect}
                >
                  <ItemBody item={item} active={isActive} expanded={expanded} />
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <ul className="rail-utilities">
        {utilities.map((utility) => (
          <li key={utility.id} className="rail-item-wrap">
            {utility.href ? (
              <a
                className="rail-item"
                href={utility.href}
                target="_blank"
                rel="noreferrer"
                aria-label={utility.label}
                data-tip={!expanded ? utility.tip ?? utility.label : undefined}
              >
                <ItemBody item={utility} expanded={expanded} />
              </a>
            ) : (
              <button
                className="rail-item"
                type="button"
                aria-label={utility.label}
                data-tip={!expanded ? utility.tip ?? utility.label : undefined}
                onClick={utility.onSelect}
              >
                <ItemBody item={utility} expanded={expanded} />
              </button>
            )}
          </li>
        ))}
        {footer}
      </ul>

      {/* Flexible resize border handle */}
      <div
        className="rail-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        title="Drag to resize · Double-click to toggle"
        onPointerDown={handlePointerDown}
        onDoubleClick={handleDoubleClickResizer}
      />
    </nav>
  );
}
