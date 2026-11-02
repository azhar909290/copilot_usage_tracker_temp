"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/** Keep continuous effects idle outside the viewport or in a hidden browser tab. */
export function useAnimationActive(ref: RefObject<Element | null>) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let visible = false;
    const update = () => setActive(visible && document.visibilityState === "visible");
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      update();
    });
    observer.observe(element);
    document.addEventListener("visibilitychange", update);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
  }, [ref]);

  return active;
}

/**
 * Schedules the next frame of a demand-driven canvas at a capped rate.
 * Slow ambient drift doesn't need the display's full 60–144 Hz; interactions still call invalidate directly.
 */
export function useCappedInvalidate(invalidate: () => void, fps = 30) {
  const timer = useRef<number | null>(null);
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);
  return useCallback(() => {
    if (timer.current !== null) return;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      invalidate();
    }, Math.max(0, 1000 / fps - 8)); // the render still waits for the next vsync
  }, [invalidate, fps]);
}
