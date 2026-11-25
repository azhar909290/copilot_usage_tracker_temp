import assert from "node:assert/strict";
import { test } from "node:test";
import { estimateImpact } from "../src/lib/impact";
import { groupCallRuns } from "../src/lib/usage";

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

test("groups each user's back-to-back calls to the same agent and model", () => {
  const call = (key: string, user: string, agent: string, minute: number, input = 10) => ({
    key,
    timestamp: new Date(Date.UTC(2026, 10, 25, 9, minute)).toISOString(),
    date: "2026-11-25",
    user,
    agent,
    model: "m",
    input_tokens: input,
    output_tokens: 1,
    latency_ms: 100,
    cost: 0.5,
  });
  const runs = groupCallRuns([
    call("a1", "azhar", "x", 0),
    call("j1", "jeevan", "xtab", 1),
    call("a2", "azhar", "x", 2, 20),
    call("a3", "azhar", "y", 3),
    call("a4", "azhar", "x", 4),
    call("a5", "azhar", "x", 40),
  ]);
  assert.deepEqual(
    runs.map((run) => [run.user, run.agent, run.calls.map((c) => c.key)]),
    [
      ["azhar", "x", ["a1", "a2"]],
      ["jeevan", "xtab", ["j1"]],
      ["azhar", "y", ["a3"]],
      ["azhar", "x", ["a4"]],
      ["azhar", "x", ["a5"]],
    ],
  );
  assert.equal(runs[0].input_tokens, 30);
  assert.equal(runs[0].total_tokens, 32);
  assert.equal(runs[0].latency_ms, 200);
  assert.equal(runs[0].cost, 1);
});
