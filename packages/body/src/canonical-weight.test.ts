import assert from "node:assert/strict";
import test from "node:test";

import { resolveCanonicalWeight, type CanonicalWeightAutoEvent } from "./canonical-weight";

function event(overrides: Partial<CanonicalWeightAutoEvent>): CanonicalWeightAutoEvent {
  return {
    id: 1,
    measuredAt: "2026-03-07T08:00:00.000Z",
    weightKg: 84,
    qualityFlag: null,
    ...overrides,
  };
}

test("defaults to auto source when valid auto event is available", () => {
  const result = resolveCanonicalWeight({
    autoEvents: [
      event({
        id: 101,
        measuredAt: "2026-03-07T07:10:00.000Z",
        weightKg: 83.4,
        qualityFlag: "invalid",
      }),
      event({ id: 102, measuredAt: "2026-03-07T08:10:00.000Z", weightKg: 83.8 }),
    ],
    override: null,
  });

  assert.deepEqual(result, {
    source: "auto",
    weightKg: 83.8,
    resolvedFromEventId: 102,
  });
});

test("uses explicit override when provided", () => {
  const result = resolveCanonicalWeight({
    autoEvents: [event({ id: 201, measuredAt: "2026-03-07T08:10:00.000Z", weightKg: 84.2 })],
    override: {
      weightKg: 82.9,
    },
  });

  assert.deepEqual(result, {
    source: "override",
    weightKg: 82.9,
    resolvedFromEventId: null,
  });
});

test("selects a deterministic median auto event for multiple valid inputs", () => {
  const result = resolveCanonicalWeight({
    autoEvents: [
      event({ id: 302, measuredAt: "2026-03-07T08:20:00.000Z", weightKg: 84.3 }),
      event({ id: 301, measuredAt: "2026-03-07T08:00:00.000Z", weightKg: 82.9 }),
      event({ id: 303, measuredAt: "2026-03-07T08:40:00.000Z", weightKg: 83.5 }),
      event({
        id: 304,
        measuredAt: "2026-03-07T08:50:00.000Z",
        weightKg: 83.5,
        qualityFlag: "invalid",
      }),
    ],
    override: null,
  });

  assert.deepEqual(result, {
    source: "auto",
    weightKg: 83.5,
    resolvedFromEventId: 303,
  });
});

test("recomputes from auto events when override is cleared", () => {
  const autoEvents = [
    event({ id: 401, measuredAt: "2026-03-07T08:00:00.000Z", weightKg: 83.6 }),
    event({ id: 402, measuredAt: "2026-03-07T08:10:00.000Z", weightKg: 83.9 }),
    event({ id: 403, measuredAt: "2026-03-07T08:20:00.000Z", weightKg: 84.1 }),
  ];

  const withOverride = resolveCanonicalWeight({
    autoEvents,
    override: { weightKg: 82.7 },
  });
  const withoutOverride = resolveCanonicalWeight({
    autoEvents,
    override: null,
  });

  assert.deepEqual(withOverride, {
    source: "override",
    weightKg: 82.7,
    resolvedFromEventId: null,
  });
  assert.deepEqual(withoutOverride, {
    source: "auto",
    weightKg: 83.9,
    resolvedFromEventId: 402,
  });
});

test("returns null when all auto events are invalid or filtered out", () => {
  const result = resolveCanonicalWeight({
    autoEvents: [
      event({ id: 501, weightKg: 83.2, qualityFlag: "invalid" }),
      event({ id: 502, weightKg: Number.NaN }),
      event({ id: 503, weightKg: Number.POSITIVE_INFINITY }),
      event({ id: 504, weightKg: 0 }),
      event({ id: 505, weightKg: -1.2 }),
    ],
    override: null,
  });

  assert.equal(result, null);
});

test("ignores malformed auto weights and keeps valid candidates", () => {
  const result = resolveCanonicalWeight({
    autoEvents: [
      event({ id: 601, measuredAt: "2026-03-07T08:00:00.000Z", weightKg: Number.NaN }),
      event({
        id: 602,
        measuredAt: "2026-03-07T08:10:00.000Z",
        weightKg: Number.POSITIVE_INFINITY,
      }),
      event({ id: 603, measuredAt: "2026-03-07T08:20:00.000Z", weightKg: -2 }),
      event({ id: 604, measuredAt: "2026-03-07T08:30:00.000Z", weightKg: 0 }),
      event({ id: 605, measuredAt: "2026-03-07T08:40:00.000Z", weightKg: 83.6 }),
      event({ id: 606, measuredAt: "2026-03-07T08:50:00.000Z", weightKg: 84.1 }),
      event({ id: 607, measuredAt: "2026-03-07T09:00:00.000Z", weightKg: 84.8 }),
    ],
    override: null,
  });

  assert.deepEqual(result, {
    source: "auto",
    weightKg: 84.1,
    resolvedFromEventId: 606,
  });
});

test("falls back to auto when override weight is invalid", () => {
  const autoEvents = [
    event({ id: 701, measuredAt: "2026-03-07T08:00:00.000Z", weightKg: 83.5 }),
    event({ id: 702, measuredAt: "2026-03-07T08:10:00.000Z", weightKg: 84.0 }),
    event({ id: 703, measuredAt: "2026-03-07T08:20:00.000Z", weightKg: 84.4 }),
  ];

  const withNaNOverride = resolveCanonicalWeight({
    autoEvents,
    override: { weightKg: Number.NaN },
  });

  const withInfinityOverride = resolveCanonicalWeight({
    autoEvents,
    override: { weightKg: Number.POSITIVE_INFINITY },
  });

  const withZeroOverride = resolveCanonicalWeight({
    autoEvents,
    override: { weightKg: 0 },
  });

  assert.deepEqual(withNaNOverride, {
    source: "auto",
    weightKg: 84,
    resolvedFromEventId: 702,
  });
  assert.deepEqual(withInfinityOverride, {
    source: "auto",
    weightKg: 84,
    resolvedFromEventId: 702,
  });
  assert.deepEqual(withZeroOverride, {
    source: "auto",
    weightKg: 84,
    resolvedFromEventId: 702,
  });
});

test("uses lower median for even count valid auto events", () => {
  const result = resolveCanonicalWeight({
    autoEvents: [
      event({ id: 801, measuredAt: "2026-03-07T08:00:00.000Z", weightKg: 83.1 }),
      event({ id: 802, measuredAt: "2026-03-07T08:10:00.000Z", weightKg: 83.9 }),
      event({ id: 803, measuredAt: "2026-03-07T08:20:00.000Z", weightKg: 84.2 }),
      event({ id: 804, measuredAt: "2026-03-07T08:30:00.000Z", weightKg: 85.0 }),
    ],
    override: null,
  });

  assert.deepEqual(result, {
    source: "auto",
    weightKg: 83.9,
    resolvedFromEventId: 802,
  });
});
