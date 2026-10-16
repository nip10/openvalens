import { describe, expect, test } from "bun:test";

import type { ActiveMinutes } from "./activity-load-contract";
import type { ComparisonMetric, MetricComparison } from "./reference-comparison-contract";
import {
  computeReferenceComparisons,
  ownTrendOf,
  referenceComparisonsAdultsOnly,
  type ComparisonDay,
  type ReferenceComparisonInput,
} from "./reference-comparison-compute";
import {
  deriveWellnessProfileInputs,
  EMPTY_WELLNESS_PROFILE,
  type WellnessProfileSnapshot,
} from "./wellness-profile-contract";

const AS_OF = "2026-10-16";
const NOW = new Date(`${AS_OF}T12:00:00.000Z`);
const consent = { active: true, version: "v", grantedAt: NOW.toISOString(), withdrawnAt: null };

function daysBefore(offset: number): string {
  const value = new Date(`${AS_OF}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() - offset);
  return value.toISOString().slice(0, 10);
}

function series(days: number, value: number, source: string | null = null): ComparisonDay[] {
  return Array.from({ length: days }, (_, i) => ({ date: daysBefore(i), value, source }));
}

/** Synthetic adult: born 1980 → 45–46 in 2026, female, both consents active. */
function profile(overrides: Partial<WellnessProfileSnapshot> = {}) {
  return deriveWellnessProfileInputs(
    {
      ...EMPTY_WELLNESS_PROFILE,
      eligibility: { state: "recorded", value: "adult" },
      birthYear: { state: "recorded", value: 1980 },
      sex: { state: "recorded", value: "female" },
      consents: { age_band: consent, sex: consent },
      ...overrides,
    },
    NOW,
  );
}

const ACTIVE: ActiveMinutes = {
  status: "available",
  activeMinutes: 120,
  moderateMinutes: 80,
  vigorousMinutes: 20,
  lightMinutes: 0,
  whoRange: { lower: 150, upper: 300 },
  whoPosition: "below_range",
  coverage: {
    sessions: 3,
    sessionsWithIntensity: 3,
    sessionsMissingIntensity: 0,
    minutesMissingIntensity: 0,
    sessionsMissingDuration: 0,
    intensityMethods: ["self_reported_talk_test"],
  },
};

const ALL: ComparisonMetric[] = ["resting_heart_rate", "sleep_duration", "active_minutes"];

function run(overrides: Partial<ReferenceComparisonInput> = {}) {
  return computeReferenceComparisons({
    asOf: AS_OF,
    profile: profile(),
    viewerOwnsWorkspace: true,
    optedIn: new Set(ALL),
    restingHeartRate: series(28, 70),
    sleepMinutes: series(28, 450),
    activeMinutes: ACTIVE,
    ...overrides,
  });
}

function metric(result: ReturnType<typeof run>, key: ComparisonMetric): MetricComparison {
  return result.comparisons.find((c) => c.metric === key)!;
}

describe("own trend", () => {
  test("recent value and the 28-day median; missing days are unknown, not zero", () => {
    const trend = ownTrendOf(
      [
        { date: daysBefore(0), value: null },
        { date: daysBefore(1), value: 64 },
        { date: daysBefore(2), value: 0 },
        { date: daysBefore(3), value: 60 },
        { date: daysBefore(4), value: 58 },
        { date: daysBefore(40), value: 99 },
      ],
      AS_OF,
    );
    expect(trend).toMatchObject({
      recentValue: 64,
      recentDate: daysBefore(1),
      usualValue: 60,
      usualDays: 3,
    });
  });

  test("is returned even when every comparison is off", () => {
    const result = run({ optedIn: new Set() });
    for (const comparison of result.comparisons) {
      expect(comparison.status).toBe("off");
      expect(comparison.band).toBeNull();
      expect(comparison.guideline).toBeNull();
    }
    expect(metric(result, "resting_heart_rate").ownTrend.usualValue).toBe(70);
  });
});

describe("resting heart rate band (NCHS NHSR 41)", () => {
  test("manual entries: coarse band for women 40–59 with the protocol note", () => {
    const rhr = metric(run(), "resting_heart_rate");
    expect(rhr).toMatchObject({ status: "available", comparedValue: 70, method: "manual" });
    expect(rhr.band).toMatchObject({
      sex: "female",
      minAge: 40,
      maxAge: 59,
      lowerQuartile: 64,
      upperQuartile: 79,
      position: "within",
      nearEdge: false,
    });
    expect(rhr.notes).toEqual(["manual_pulse_protocol", "us_reference_population"]);
    expect(rhr.guideline).toBeNull();
  });

  test("device readings are downgraded with the measured-differently note", () => {
    const rhr = metric(run({ restingHeartRate: series(28, 55, "ds:7") }), "resting_heart_rate");
    expect(rhr.method).toBe("device");
    expect(rhr.band?.position).toBe("below");
    expect(rhr.notes).toContain("device_resting_pulse_measured_differently");
    expect(rhr.notes).not.toContain("manual_pulse_protocol");
  });

  test("a value close to a band edge is flagged as near the edge", () => {
    const rhr = metric(run({ restingHeartRate: series(28, 80) }), "resting_heart_rate");
    expect(rhr.band).toMatchObject({ position: "above", nearEdge: true });
    expect(rhr.notes).toContain("near_band_edge");
  });

  test("the compared value is the rounded usual, not a single day", () => {
    const days = [...series(27, 70), { date: daysBefore(0), value: 95, source: null }];
    expect(metric(run({ restingHeartRate: days }), "resting_heart_rate").comparedValue).toBe(70);
  });

  test("sex not provided, declined or not applicable → unavailable, nothing inferred", () => {
    for (const sex of [
      { state: "unknown" },
      { state: "declined" },
      { state: "not_applicable" },
    ] as const) {
      const rhr = metric(run({ profile: profile({ sex }) }), "resting_heart_rate");
      expect(rhr.status).toBe("unavailable");
      expect(rhr.band).toBeNull();
      expect(rhr.comparedValue).toBeNull();
    }
    const missing = metric(
      run({ profile: profile({ sex: { state: "unknown" } }) }),
      "resting_heart_rate",
    );
    expect(missing.unavailableReason).toBe("not_provided");
  });

  test("withdrawn consent → consent_required", () => {
    const withdrawn = { ...consent, active: false, withdrawnAt: NOW.toISOString() };
    const rhr = metric(
      run({ profile: profile({ consents: { age_band: consent, sex: withdrawn } }) }),
      "resting_heart_rate",
    );
    expect(rhr).toMatchObject({ status: "unavailable", unavailableReason: "consent_required" });
  });

  test("an age range straddling two reference rows (39–40) is not placed in either", () => {
    const rhr = metric(
      run({ profile: profile({ birthYear: { state: "recorded", value: 1986 } }) }),
      "resting_heart_rate",
    );
    expect(rhr).toMatchObject({
      status: "unavailable",
      unavailableReason: "age_outside_reference",
    });
  });

  test("ages 18–19 are outside the adult reference rows", () => {
    const rhr = metric(
      run({ profile: profile({ birthYear: { state: "recorded", value: 2007 } }) }),
      "resting_heart_rate",
    );
    expect(rhr.unavailableReason).toBe("age_outside_reference");
  });

  test("a profile age band that is ambiguous (29–30) still fits one reference row (20–39)", () => {
    const inputs = profile({ birthYear: { state: "recorded", value: 1996 } });
    expect(inputs.ageBand).toEqual({ available: false, reason: "age_band_ambiguous" });
    const rhr = metric(run({ profile: inputs }), "resting_heart_rate");
    expect(rhr.band).toMatchObject({ minAge: 20, maxAge: 39 });
  });

  test("fewer than 7 days of data → not_enough_data", () => {
    const rhr = metric(run({ restingHeartRate: series(6, 70) }), "resting_heart_rate");
    expect(rhr).toMatchObject({ status: "unavailable", unavailableReason: "not_enough_data" });
  });
});

describe("guideline ranges", () => {
  test("sleep: your NSF row when your age fits one", () => {
    const sleep = metric(run({ sleepMinutes: series(28, 400) }), "sleep_duration");
    expect(sleep.status).toBe("available");
    expect(sleep.guideline).toMatchObject({
      datasetId: "nsf-2015-sleep-duration",
      matchedRow: 0,
      position: "below",
    });
    expect(sleep.band).toBeNull();
  });

  test("sleep: without a birth year every row is shown and none is picked", () => {
    const sleep = metric(
      run({ profile: profile({ birthYear: { state: "unknown" } }) }),
      "sleep_duration",
    );
    expect(sleep.status).toBe("available");
    expect(sleep.guideline).toMatchObject({
      matchedRow: null,
      position: null,
      ageUnavailableReason: "not_provided",
    });
    expect(sleep.guideline!.rows).toHaveLength(2);
  });

  test("sleep: an age range straddling 64/65 is not placed in either row", () => {
    const sleep = metric(
      run({ profile: profile({ birthYear: { state: "recorded", value: 1961 } }) }),
      "sleep_duration",
    );
    expect(sleep.guideline).toMatchObject({
      matchedRow: null,
      ageUnavailableReason: "age_outside_reference",
    });
  });

  test("active minutes: WHO range for every adult, no age needed", () => {
    const active = metric(
      run({ profile: profile({ birthYear: { state: "declined" }, sex: { state: "declined" } }) }),
      "active_minutes",
    );
    expect(active).toMatchObject({ status: "available", comparedValue: 120 });
    expect(active.guideline).toMatchObject({ matchedRow: 0, position: "below" });
  });

  test("active minutes without intensity data → not_enough_data", () => {
    const active = metric(
      run({ activeMinutes: { ...ACTIVE, status: "no_intensity", activeMinutes: null } }),
      "active_minutes",
    );
    expect(active).toMatchObject({ status: "unavailable", unavailableReason: "not_enough_data" });
  });
});

describe("gates", () => {
  test("adult answer missing → every comparison unavailable", () => {
    const result = run({ profile: profile({ eligibility: { state: "unknown" } }) });
    for (const comparison of result.comparisons)
      expect(comparison.unavailableReason).toBe("adult_confirmation_required");
  });

  test("someone else's workspace → no population comparison, own trend still shown", () => {
    const result = run({ viewerOwnsWorkspace: false });
    for (const comparison of result.comparisons) {
      expect(comparison).toMatchObject({
        status: "unavailable",
        unavailableReason: "not_your_workspace",
      });
      expect(comparison.band).toBeNull();
    }
    expect(metric(result, "sleep_duration").ownTrend.usualValue).toBe(450);
  });

  test("no ranks, steps and body metrics are listed as not compared", () => {
    const result = run();
    expect(result.notCompared).toEqual([
      "steps",
      "body_metrics",
      "heart_rate_variability",
      "vo2max",
      "grip_strength",
    ]);
    expect(JSON.stringify(result)).not.toMatch(/percentile|rank/i);
  });

  test("withheld for a declared under-18", () => {
    expect(referenceComparisonsAdultsOnly(AS_OF)).toMatchObject({
      status: "withheld",
      withheldReason: "adults_only",
      comparisons: [],
    });
  });
});
