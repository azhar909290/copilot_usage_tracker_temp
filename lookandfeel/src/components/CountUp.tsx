"use client";

import NumberFlow from "@number-flow/react";
import { useInView } from "motion/react";
import { useEffect, useRef, useState, type ComponentProps, type ComponentRef } from "react";
import { useReducedMotion } from "@/lib/motion";

const TIMING = { duration: 750, easing: "cubic-bezier(0.16, 1, 0.3, 1)" };

/**
 * A figure that counts up from zero when it appears (page load or screen change) and rolls to new
 * values on refresh. NumberFlow alone only animates changes, so the first value would just appear.
 */
export function CountUp({ value, ...props }: ComponentProps<typeof NumberFlow>) {
  const reduced = useReducedMotion();
  const ref = useRef<ComponentRef<typeof NumberFlow>>(null);
  const visible = useInView(ref, { once: true });
  const target = typeof value === "number" ? value : Number(value) || 0;
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (!visible || reduced) return;
    const frame = window.requestAnimationFrame(() => setShown(target));
    return () => window.cancelAnimationFrame(frame);
  }, [target, visible, reduced]);

  return <NumberFlow {...props} ref={ref} value={reduced ? target : shown} trend={1} respectMotionPreference={false} transformTiming={TIMING} spinTiming={TIMING} opacityTiming={{ duration: 250 }} />;
}
