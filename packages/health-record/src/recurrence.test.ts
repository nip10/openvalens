import { describe, expect, spyOn, test } from "bun:test";

import {
  buildRetentionWindow,
  clusterMetricSamples,
  dedupeDecision,
  isValidRetentionDays,
  isValidTimezone,
  MAX_RETENTION_DAYS,
  MIN_RETENTION_DAYS,
  policyForMetric,
  RetentionPolicyRequiredError,
} from "./recurrence";

describe("recurrence helpers (Issue #17 bounded recurrence slice)", () => {
  describe("isValidTimezone", () => {
    test("accepts canonical IANA zones", () => {
      expect(isValidTimezone("UTC")).toBe(true);
      expect(isValidTimezone("America/Los_Angeles")).toBe(true);
      expect(isValidTimezone("Europe/London")).toBe(true);
      expect(isValidTimezone("Asia/Tokyo")).toBe(true);
    });
    test("rejects unknown zones", () => {
      expect(isValidTimezone("Mars/Olympus")).toBe(false);
      expect(isValidTimezone("not-a-zone")).toBe(false);
      expect(isValidTimezone("")).toBe(false);
    });
  });

  describe("isValidRetentionDays", () => {
    test("accepts integers within the inclusive range", () => {
      expect(isValidRetentionDays(MIN_RETENTION_DAYS)).toBe(true);
      expect(isValidRetentionDays(365)).toBe(true);
      expect(isValidRetentionDays(MAX_RETENTION_DAYS)).toBe(true);
    });
    test("rejects out-of-range or non-integer values", () => {
      expect(isValidRetentionDays(0)).toBe(false);
      expect(isValidRetentionDays(-1)).toBe(false);
      expect(isValidRetentionDays(MAX_RETENTION_DAYS + 1)).toBe(false);
      expect(isValidRetentionDays(1.5)).toBe(false);
      expect(isValidRetentionDays(Number.NaN)).toBe(false);
      expect(isValidRetentionDays(Number.POSITIVE_INFINITY)).toBe(false);
    });
  });

  describe("buildRetentionWindow", () => {
    const now = new Date("2026-09-30T12:00:00.000Z");
    test("missing retentionDays throws instead of inventing a default", () => {
      for (const metricCode of ["weight", "height", "blood_marker_glucose", "sleep_session"]) {
        expect(() => buildRetentionWindow({ now, timezone: "UTC", metricCode } as never)).toThrow(
          RetentionPolicyRequiredError,
        );
      }
    });
    test("explicit retentionDays defines the window", () => {
      const window = buildRetentionWindow({
        now,
        timezone: "UTC",
        metricCode: "weight",
        retentionDays: 7,
      });
      expect(window.retentionDays).toBe(7);
      expect(window.fromUtc.toISOString()).toBe("2026-09-23T12:00:00.000Z");
    });
    test("unknown metric code throws", () => {
      expect(() =>
        buildRetentionWindow({ now, timezone: "UTC", metricCode: "made_up", retentionDays: 7 }),
      ).toThrow(/Unknown metric/);
    });
    test("invalid timezone throws", () => {
      expect(() =>
        buildRetentionWindow({
          now,
          timezone: "Mars/Olympus",
          metricCode: "weight",
          retentionDays: 7,
        }),
      ).toThrow(/Invalid IANA timezone/);
    });
    test("invalid retentionDays override throws", () => {
      expect(() =>
        buildRetentionWindow({
          now,
          timezone: "UTC",
          metricCode: "weight",
          retentionDays: 0,
        }),
      ).toThrow(/retentionDays must be an integer/);
    });
    test("NaN now throws", () => {
      expect(() =>
        buildRetentionWindow({
          now: new Date("invalid"),
          timezone: "UTC",
          metricCode: "weight",
          retentionDays: 7,
        }),
      ).toThrow(/now must be a valid Date/);
    });
  });

  describe("dedupeDecision", () => {
    const observedAt = new Date("2026-09-29T12:00:00.000Z");
    test("returns hash_mismatch when the keys differ — incoming is the new sample", () => {
      const decision = dedupeDecision({
        existingHash: "a",
        incomingHash: "b",
        existingObservedAt: observedAt,
        incomingObservedAt: observedAt,
      });
      expect(decision.keep).toBe("incoming");
      expect(decision.tieBreak).toBe("hash_mismatch");
    });
    test("returns observed_at when the newer sample wins", () => {
      const later = new Date(observedAt.getTime() + 60_000);
      const decision = dedupeDecision({
        existingHash: "same",
        incomingHash: "same",
        existingObservedAt: observedAt,
        incomingObservedAt: later,
      });
      expect(decision.keep).toBe("incoming");
      expect(decision.tieBreak).toBe("observed_at");
    });
    test("returns observed_at when the older sample is the existing", () => {
      const earlier = new Date(observedAt.getTime() - 60_000);
      const decision = dedupeDecision({
        existingHash: "same",
        incomingHash: "same",
        existingObservedAt: observedAt,
        incomingObservedAt: earlier,
      });
      expect(decision.keep).toBe("existing");
      expect(decision.tieBreak).toBe("observed_at");
    });
    test("returns stable_tie keeping the existing on exact match", () => {
      const decision = dedupeDecision({
        existingHash: "same",
        incomingHash: "same",
        existingObservedAt: observedAt,
        incomingObservedAt: new Date(observedAt.getTime()),
      });
      expect(decision.keep).toBe("existing");
      expect(decision.tieBreak).toBe("stable_tie");
    });
    test("deterministic: repeated calls with identical inputs return identical results", () => {
      const first = dedupeDecision({
        existingHash: "h",
        incomingHash: "h",
        existingObservedAt: observedAt,
        incomingObservedAt: observedAt,
      });
      const second = dedupeDecision({
        existingHash: "h",
        incomingHash: "h",
        existingObservedAt: observedAt,
        incomingObservedAt: observedAt,
      });
      expect(first).toEqual(second);
    });
  });

  describe("clusterMetricSamples", () => {
    test("groups rows by metricDefinitionId + sampledAt + dedupeHash", () => {
      const sampledAt = new Date("2026-09-29T12:00:00.000Z");
      const rows = [
        {
          id: 1,
          metricDefinitionId: 10,
          sampledAt,
          dedupeHash: "a",
        },
        {
          id: 2,
          metricDefinitionId: 10,
          sampledAt,
          dedupeHash: "a",
        },
        {
          id: 3,
          metricDefinitionId: 10,
          sampledAt,
          dedupeHash: "b",
        },
        {
          id: 4,
          metricDefinitionId: 11,
          sampledAt,
          dedupeHash: "a",
        },
      ];
      const clusters = clusterMetricSamples(rows);
      expect(clusters.size).toBe(3);
      expect(clusters.get("10|2026-09-29T12:00:00.000Z|a")?.length).toBe(2);
      expect(clusters.get("10|2026-09-29T12:00:00.000Z|b")?.length).toBe(1);
      expect(clusters.get("11|2026-09-29T12:00:00.000Z|a")?.length).toBe(1);
    });
    test("returns an empty map for an empty input", () => {
      const clusters = clusterMetricSamples([]);
      expect(clusters.size).toBe(0);
    });
  });

  describe("policyForMetric", () => {
    test("weight has no retention configured by default (null) + UTC", () => {
      const policy = policyForMetric({ metricCode: "weight" });
      expect(policy).toMatchObject({
        metricCode: "weight",
        canonicalMetricCode: "weight",
        isBloodMarkerFamily: false,
        retentionDays: null,
        timezone: "UTC",
        category: "body",
        unit: "kg",
      });
    });
    test("blood_marker_glucose resolves the family with no invented retention", () => {
      const policy = policyForMetric({ metricCode: "blood_marker_glucose" });
      expect(policy.isBloodMarkerFamily).toBe(true);
      expect(policy.canonicalMetricCode).toBe("blood_marker_glucose");
      expect(policy.retentionDays).toBeNull();
    });
    test("caller can override retentionDays and timezone", () => {
      const policy = policyForMetric({
        metricCode: "weight",
        retentionDays: 30,
        timezone: "America/Los_Angeles",
      });
      expect(policy.retentionDays).toBe(30);
      expect(policy.timezone).toBe("America/Los_Angeles");
    });
    test("rejects unknown metric codes", () => {
      expect(() => policyForMetric({ metricCode: "made_up" })).toThrow(/Unknown metric/);
    });
    test("rejects invalid timezone", () => {
      expect(() => policyForMetric({ metricCode: "weight", timezone: "Mars/Olympus" })).toThrow(
        /Invalid IANA timezone/,
      );
    });
    test("rejects invalid retentionDays override", () => {
      expect(() => policyForMetric({ metricCode: "weight", retentionDays: 0 })).toThrow(
        /retentionDays must be an integer/,
      );
    });
  });

  describe("PHI safety (no console payloads from helper invocations)", () => {
    const observedAt = new Date("2026-09-29T12:00:00.000Z");
    test("buildRetentionWindow emits no console payloads for valid input", () => {
      const logs = [spyOn(console, "log"), spyOn(console, "warn"), spyOn(console, "error")];
      try {
        buildRetentionWindow({
          now: observedAt,
          timezone: "America/Los_Angeles",
          metricCode: "weight",
          retentionDays: 30,
        });
        for (const log of logs) expect(log).not.toHaveBeenCalled();
      } finally {
        for (const log of logs) log.mockRestore();
      }
    });
    test("buildRetentionWindow emits no console payloads when raising typed errors", () => {
      const logs = [spyOn(console, "log"), spyOn(console, "warn"), spyOn(console, "error")];
      try {
        expect(() =>
          buildRetentionWindow({
            now: observedAt,
            timezone: "Mars/Olympus",
            metricCode: "weight",
            retentionDays: 7,
          }),
        ).toThrow(/Invalid IANA timezone/);
        expect(() =>
          buildRetentionWindow({
            now: observedAt,
            timezone: "UTC",
            metricCode: "made_up_metric",
            retentionDays: 7,
          }),
        ).toThrow(/Unknown metric/);
        expect(() =>
          buildRetentionWindow({
            now: observedAt,
            timezone: "UTC",
            metricCode: "weight",
            retentionDays: 0,
          }),
        ).toThrow(/retentionDays/);
        for (const log of logs) expect(log).not.toHaveBeenCalled();
      } finally {
        for (const log of logs) log.mockRestore();
      }
    });
    test("dedupeDecision emits no console payloads across all branches", () => {
      const logs = [spyOn(console, "log"), spyOn(console, "warn"), spyOn(console, "error")];
      try {
        dedupeDecision({
          existingHash: "a",
          incomingHash: "b",
          existingObservedAt: observedAt,
          incomingObservedAt: observedAt,
        });
        dedupeDecision({
          existingHash: "same",
          incomingHash: "same",
          existingObservedAt: observedAt,
          incomingObservedAt: new Date(observedAt.getTime() + 1),
        });
        dedupeDecision({
          existingHash: "same",
          incomingHash: "same",
          existingObservedAt: observedAt,
          incomingObservedAt: observedAt,
        });
        for (const log of logs) expect(log).not.toHaveBeenCalled();
      } finally {
        for (const log of logs) log.mockRestore();
      }
    });
    test("policyForMetric emits no console payloads for valid + invalid inputs", () => {
      const logs = [spyOn(console, "log"), spyOn(console, "warn"), spyOn(console, "error")];
      try {
        policyForMetric({ metricCode: "weight", retentionDays: 60 });
        expect(() => policyForMetric({ metricCode: "made_up" })).toThrow(/Unknown metric/);
        for (const log of logs) expect(log).not.toHaveBeenCalled();
      } finally {
        for (const log of logs) log.mockRestore();
      }
    });
    test("clusterMetricSamples emits no console payloads", () => {
      const logs = [spyOn(console, "log"), spyOn(console, "warn"), spyOn(console, "error")];
      try {
        clusterMetricSamples([
          { id: 1, metricDefinitionId: 1, sampledAt: observedAt, dedupeHash: "h" },
          { id: 2, metricDefinitionId: 1, sampledAt: observedAt, dedupeHash: "h" },
        ]);
        for (const log of logs) expect(log).not.toHaveBeenCalled();
      } finally {
        for (const log of logs) log.mockRestore();
      }
    });
  });
});
