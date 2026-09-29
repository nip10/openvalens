import assert from "node:assert/strict";
import test from "node:test";
import { pickBodyFatSource } from "./body-composition-source";

test("prefers manual body fat when DEXA is absent", () => {
  const result = pickBodyFatSource({
    dexa: null,
    smartScale: null,
    manual: {
      date: "2026-03-01",
      bodyFatPct: 22.4,
    },
  });

  assert.deepEqual(result, {
    source: "manual",
    date: "2026-03-01",
    measuredDate: "2026-03-01",
    confidence: 0.5,
    bodyFatPct: 22.4,
  });
});

test("uses DEXA when available", () => {
  const result = pickBodyFatSource({
    dexa: {
      date: "2026-02-11",
      bodyFatPct: 26.7,
    },
    smartScale: {
      date: "2026-03-01",
      bodyFatPct: 22.1,
    },
    manual: {
      date: "2026-03-01",
      bodyFatPct: 22.4,
    },
  });

  assert.deepEqual(result, {
    source: "dexa",
    date: "2026-02-11",
    measuredDate: "2026-02-11",
    confidence: 1,
    bodyFatPct: 26.7,
  });
});

test("uses smart scale when DEXA is absent", () => {
  const result = pickBodyFatSource({
    dexa: null,
    smartScale: {
      date: "2026-03-01",
      bodyFatPct: 22.1,
    },
    manual: {
      date: "2026-03-01",
      bodyFatPct: 22.4,
    },
  });

  assert.deepEqual(result, {
    source: "smart_scale",
    date: "2026-03-01",
    measuredDate: "2026-03-01",
    confidence: 0.8,
    bodyFatPct: 22.1,
  });
});

test("prefers higher confidence source for same-day entries", () => {
  const result = pickBodyFatSource({
    dexa: {
      date: "2026-03-01",
      bodyFatPct: 21.8,
    },
    smartScale: {
      date: "2026-03-01",
      bodyFatPct: 22.1,
    },
    manual: {
      date: "2026-03-01",
      bodyFatPct: 22.4,
    },
  });

  assert.deepEqual(result, {
    source: "dexa",
    date: "2026-03-01",
    measuredDate: "2026-03-01",
    confidence: 1,
    bodyFatPct: 21.8,
  });
});

test("handles missing source data", () => {
  const result = pickBodyFatSource({
    dexa: null,
    smartScale: null,
    manual: null,
  });

  assert.equal(result, null);
});

test("keeps backward compatibility when smartScale is omitted", () => {
  const result = pickBodyFatSource({
    dexa: null,
    manual: {
      date: "2026-03-01",
      bodyFatPct: 22.4,
    },
  });

  assert.deepEqual(result, {
    source: "manual",
    date: "2026-03-01",
    measuredDate: "2026-03-01",
    confidence: 0.5,
    bodyFatPct: 22.4,
  });
});
