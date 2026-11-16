"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

function subscribeTheme(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener("dashboard-theme", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener("dashboard-theme", callback);
  };
}

function savedTheme() {
  try {
    return localStorage.getItem("atlex-theme") === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function useDashboardTheme() {
  const [temporaryTheme, setTemporaryTheme] = useState<string | null>(null);
  const storedTheme = useSyncExternalStore(subscribeTheme, savedTheme, () => "light");
  const theme = temporaryTheme ?? storedTheme;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  function toggleTheme() {
    try {
      localStorage.setItem("atlex-theme", theme === "dark" ? "light" : "dark");
      setTemporaryTheme(null);
      window.dispatchEvent(new Event("dashboard-theme"));
    } catch {
      setTemporaryTheme(theme === "dark" ? "light" : "dark");
    }
  }

  return { theme, toggleTheme };
}
