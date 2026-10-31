"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { motion } from "motion/react";
import type { ReactNode } from "react";
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

function ItemBody({ item, active }: { item: RailItem | RailUtility; active?: boolean }) {
  const Icon = item.icon;
  return (
    <>
      <Icon size={18} strokeWidth={1.6} aria-hidden="true" />
      <span className="rail-label">{"short" in item && item.short ? item.short : item.label}</span>
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

/** The icon rail: product mark, destinations, utilities. Folds into a bottom bar on phones. */
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
  return (
    <nav className="rail" aria-label="Primary">
      <Link className="rail-brand" href="/" aria-label="AI Control Plane home">
        <RidgeMark size={24} />
      </Link>
      <ul className="rail-items">
        {items.map((item) => {
          const isActive = item.id === active;
          return (
            <li key={item.id}>
              {item.href ? (
                <Link
                  className="rail-item"
                  href={item.href}
                  aria-label={item.label}
                  data-tip={item.label}
                  data-active={isActive || undefined}
                  aria-current={isActive ? "page" : undefined}
                >
                  <ItemBody item={item} active={isActive} />
                </Link>
              ) : (
                <button
                  className="rail-item"
                  type="button"
                  aria-label={item.label}
                  data-tip={item.label}
                  data-active={isActive || undefined}
                  aria-current={isActive ? "page" : undefined}
                  onClick={item.onSelect}
                >
                  <ItemBody item={item} active={isActive} />
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <ul className="rail-utilities">
        {utilities.map((utility) => (
          <li key={utility.id}>
            {utility.href ? (
              <a className="rail-item" href={utility.href} target="_blank" rel="noreferrer" aria-label={utility.label} data-tip={utility.tip ?? utility.label}>
                <ItemBody item={utility} />
              </a>
            ) : (
              <button className="rail-item" type="button" aria-label={utility.label} data-tip={utility.tip ?? utility.label} onClick={utility.onSelect}>
                <ItemBody item={utility} />
              </button>
            )}
          </li>
        ))}
        {footer}
      </ul>
    </nav>
  );
}
