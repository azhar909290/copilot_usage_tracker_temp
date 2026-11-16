import assert from "node:assert/strict";
import { test } from "node:test";
import { estimateImpact } from "../src/lib/impact";

test("estimates hours, value and net ROI from recorded calls", () => {
  assert.deepEqual(estimateImpact({ requests: 7590, cost: 32.93, unpriced: 0 }, "USD"), {
    kind: "available",
    hours: 759,
    valueUsd: 18975,
    roi: { kind: "available", multiple: (18975 - 32.93) / 32.93 },
  });
  assert.deepEqual(estimateImpact({ requests: 1, cost: 0.5, unpriced: 0 }, "USD"), {
    kind: "available",
    hours: 0.1,
    valueUsd: 2.5,
    roi: { kind: "available", multiple: 4 },
  });
});

test("reports a negative net ROI when estimated spend exceeds value", () => {
  assert.deepEqual(estimateImpact({ requests: 100, cost: 1000, unpriced: 0 }, "USD"), {
    kind: "available",
    hours: 10,
    valueUsd: 250,
    roi: { kind: "available", multiple: -0.75 },
  });
});

test("does not calculate ROI without calls or positive model spend", () => {
  assert.deepEqual(estimateImpact({ requests: 0, cost: 0, unpriced: 0 }, "USD"), {
    kind: "available",
    hours: 0,
    valueUsd: 0,
    roi: { kind: "unavailable", reason: "no-calls" },
  });
  assert.deepEqual(estimateImpact({ requests: 10, cost: 0, unpriced: 0 }, "USD"), {
    kind: "available",
    hours: 1,
    valueUsd: 25,
    roi: { kind: "unavailable", reason: "no-spend" },
  });
});

test("keeps the time and value estimates but withholds ROI for incomplete pricing", () => {
  assert.deepEqual(estimateImpact({ requests: 10, cost: 2, unpriced: 1 }, "USD"), {
    kind: "available",
    hours: 1,
    valueUsd: 25,
    roi: { kind: "unavailable", reason: "unpriced" },
  });
  assert.deepEqual(estimateImpact({ requests: 10, cost: 2, unpriced: 0 }, null), {
    kind: "available",
    hours: 1,
    valueUsd: 25,
    roi: { kind: "unavailable", reason: "currency-unavailable" },
  });
  assert.deepEqual(estimateImpact({ requests: 10, cost: 2, unpriced: 0 }, "EUR"), {
    kind: "available",
    hours: 1,
    valueUsd: 25,
    roi: { kind: "unavailable", reason: "currency-mismatch" },
  });
});

test("does not present estimates for invalid call counts", () => {
  for (const requests of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.deepEqual(estimateImpact({ requests, cost: 1, unpriced: 0 }, "USD"), { kind: "invalid-requests" });
  }
});

test("does not calculate ROI from invalid spend or pricing counts", () => {
  for (const totals of [
    { requests: 10, cost: -1, unpriced: 0 },
    { requests: 10, cost: NaN, unpriced: 0 },
    { requests: 10, cost: Infinity, unpriced: 0 },
    { requests: 10, cost: Number.MIN_VALUE, unpriced: 0 },
    { requests: 10, cost: 1, unpriced: -1 },
    { requests: 10, cost: 1, unpriced: 0.5 },
    { requests: 10, cost: 1, unpriced: 11 },
    { requests: 0, cost: 1, unpriced: 0 },
  ]) {
    const estimate = estimateImpact(totals, "USD");
    assert.equal(estimate.kind, "available");
    if (estimate.kind === "available") {
      assert.deepEqual(estimate.roi, { kind: "unavailable", reason: "invalid-spend" });
    }
  }
});
