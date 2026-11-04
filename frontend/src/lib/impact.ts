export const ESTIMATED_MINUTES_PER_CALL = 6;
export const ESTIMATED_VALUE_USD_PER_HOUR = 25;

export type RoiEstimate =
  | { kind: "available"; multiple: number }
  | {
      kind: "unavailable";
      reason: "no-calls" | "no-spend" | "unpriced" | "currency-unavailable" | "currency-mismatch" | "invalid-spend";
    };

export type ImpactEstimate =
  | { kind: "invalid-requests" }
  | { kind: "available"; hours: number; valueUsd: number; roi: RoiEstimate };

export function estimateImpact(
  totals: { requests: number; cost: number; unpriced: number },
  currency: string | null,
): ImpactEstimate {
  const { requests, cost, unpriced } = totals;
  if (!Number.isSafeInteger(requests) || requests < 0) return { kind: "invalid-requests" };

  const hours = (requests * ESTIMATED_MINUTES_PER_CALL) / 60;
  const valueUsd = hours * ESTIMATED_VALUE_USD_PER_HOUR;
  let roi: RoiEstimate;

  if (
    !Number.isFinite(cost) ||
    cost < 0 ||
    !Number.isSafeInteger(unpriced) ||
    unpriced < 0 ||
    unpriced > requests ||
    (requests === 0 && cost > 0)
  ) {
    roi = { kind: "unavailable", reason: "invalid-spend" };
  } else if (requests === 0) {
    roi = { kind: "unavailable", reason: "no-calls" };
  } else if (unpriced > 0) {
    roi = { kind: "unavailable", reason: "unpriced" };
  } else if (!currency) {
    roi = { kind: "unavailable", reason: "currency-unavailable" };
  } else if (currency !== "USD") {
    roi = { kind: "unavailable", reason: "currency-mismatch" };
  } else if (cost === 0) {
    roi = { kind: "unavailable", reason: "no-spend" };
  } else {
    const multiple = (valueUsd - cost) / cost;
    roi = Number.isFinite(multiple)
      ? { kind: "available", multiple }
      : { kind: "unavailable", reason: "invalid-spend" };
  }

  return { kind: "available", hours, valueUsd, roi };
}
