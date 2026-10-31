"use client";

import { motion, useReducedMotion, type Variants } from "motion/react";
import type { CSSProperties, ReactNode } from "react";

const EASE_OUT = [0.23, 1, 0.32, 1] as const;

/** One-time entrance as a section scrolls into view: rise, fade and de-blur. */
export function Reveal({
  children,
  delay = 0,
  className,
  style,
  as = "div",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  style?: CSSProperties;
  as?: "div" | "section" | "article" | "li";
}) {
  const reduced = useReducedMotion();
  const Tag = motion[as];
  return (
    <Tag
      className={className}
      style={style}
      initial={reduced ? { opacity: 0 } : { opacity: 0, transform: "translateY(18px)", filter: "blur(6px)" }}
      whileInView={reduced ? { opacity: 1 } : { opacity: 1, transform: "translateY(0px)", filter: "blur(0px)" }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: reduced ? 0.2 : 0.62, delay, ease: EASE_OUT }}
    >
      {children}
    </Tag>
  );
}

const container: Variants = {
  hidden: {},
  shown: (stagger: number) => ({ transition: { staggerChildren: stagger, delayChildren: 0.05 } }),
};

export const staggerItem: Variants = {
  hidden: { opacity: 0, transform: "translateY(16px) scale(0.98)" },
  shown: { opacity: 1, transform: "translateY(0px) scale(1)", transition: { duration: 0.55, ease: EASE_OUT } },
};

export const staggerFade: Variants = {
  hidden: { opacity: 0 },
  shown: { opacity: 1, transition: { duration: 0.2 } },
};

/** Staggers its StaggerItem children (40–70ms apart) when the group enters the viewport. */
export function Stagger({
  children,
  className,
  stagger = 0.055,
  style,
  label,
  as = "div",
}: {
  children: ReactNode;
  className?: string;
  stagger?: number;
  style?: CSSProperties;
  label?: string;
  as?: "div" | "ul" | "ol" | "section";
}) {
  const Tag = motion[as];
  return (
    <Tag className={className} style={style} aria-label={label} variants={container} custom={stagger} initial="hidden" whileInView="shown" viewport={{ once: true, margin: "-30px" }}>
      {children}
    </Tag>
  );
}

export function StaggerItem({
  children,
  className,
  style,
  as = "div",
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  as?: "div" | "li" | "article";
}) {
  const reduced = useReducedMotion();
  const Tag = motion[as];
  return (
    <Tag className={className} style={style} variants={reduced ? staggerFade : staggerItem}>
      {children}
    </Tag>
  );
}
