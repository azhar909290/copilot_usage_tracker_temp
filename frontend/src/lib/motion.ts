"use client";

import { useEffect, useSyncExternalStore } from "react";

/**
 * Motion is an explicit in-app preference rather than a mirror of the OS flag: dashboards that
 * silently go static for anyone with "Reduce motion" enabled look broken. Animation is on unless
 * the user turns it off with the Animations toggle (rail or command menu).
 */
const KEY = "signal-motion";
const EVENT = "dashboard-motion";

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(EVENT, callback);
  };
}

function savedReduced() {
  try {
    return localStorage.getItem(KEY) === "off";
  } catch {
    return false;
  }
}

/** True when the user has switched animations off. Server and first paint always render as "on". */
export function useReducedMotion() {
  const reduced = useSyncExternalStore(subscribe, savedReduced, () => false);
  useEffect(() => {
    document.documentElement.dataset.motion = reduced ? "reduced" : "full";
  }, [reduced]);
  return reduced;
}

export function useMotionToggle() {
  const reduced = useReducedMotion();
  function toggle() {
    try {
      localStorage.setItem(KEY, reduced ? "on" : "off");
    } catch {
      // Storage blocked: the preference simply does not persist.
    }
    window.dispatchEvent(new Event(EVENT));
  }
  return { reduced, toggle };
}
