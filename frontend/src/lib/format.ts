const integerFormat = new Intl.NumberFormat("en-US");
const compactFormat = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatCount(value: number) {
  return integerFormat.format(Math.round(value || 0));
}

export function formatCompact(value: number) {
  return compactFormat.format(value || 0);
}

export function formatMoney(value: number, currency: string, digits = 2) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value || 0);
  } catch {
    return `${currency} ${(value || 0).toFixed(digits)}`;
  }
}

export function formatPercent(value: number, digits = 1) {
  return `${(Number.isFinite(value) ? value : 0).toFixed(digits)}%`;
}

export function formatSeconds(ms: number | null | undefined) {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`;
}

export function displayDate(date: string, options?: Intl.DateTimeFormatOptions) {
  return new Date(`${date}T00:00:00`).toLocaleDateString("en-US", options);
}

export function displayCallTime(timestamp: string | null | undefined) {
  if (!timestamp) return "Time unavailable";
  return new Date(timestamp).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  });
}

export function formatAgo(lastSeen: number, now: number) {
  const minutes = Math.floor(Math.max(0, now - lastSeen) / 60_000);
  return minutes < 1 ? "just now" : `${minutes} min ago`;
}

export function formatClock(minutes: number) {
  const whole = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}

export function csvCell(value: string | number | null | undefined) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}
