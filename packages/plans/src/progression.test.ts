import { describe, expect, test } from "bun:test";

import {
  suggestProgression,
  type ProgressionPerformance,
  type ProgressionTarget,
} from "./progression";

const target: ProgressionTarget = { sets: 3, minReps: 8, maxReps: 12, weightKg: 40 };
const session = (reps: number[], weightKg: number | null = 40): ProgressionPerformance => ({
  date: "2026-01-01",
  sets: reps.map((count) => ({ reps: count, weightKg })),
});

describe("suggestProgression", () => {
  test("none is a neutral no-op and does not depend on history", () => {
    expect(suggestProgression({ kind: "none" }, target, [session([12, 12, 12])])).toEqual({
      weightKg: 40,
      reps: 8,
      reason: "rule_disabled",
    });
  });

  test("empty history uses the configured starting target without applying a speculative increment", () => {
    expect(suggestProgression({ kind: "double", incrementKg: 2.5 }, target, [])).toMatchObject({
      weightKg: 40,
      reps: 8,
      reason: "no_history",
    });
  });

  test("double progression advances reps until every planned set reaches the top", () => {
    expect(
      suggestProgression({ kind: "double", incrementKg: 2.5 }, target, [session([10, 9, 11])]),
    ).toMatchObject({ weightKg: 40, reps: 12, reason: "reps_advanced" });
    expect(
      suggestProgression({ kind: "double", incrementKg: 2.5 }, target, [session([12, 12, 12])]),
    ).toMatchObject({
      weightKg: 42.5,
      reps: 8,
      reason: "double_progression_increased",
      incrementKg: 2.5,
    });
    expect(
      suggestProgression({ kind: "double", incrementKg: 2.5 }, target, [session([11, 12, 12])]),
    ).toMatchObject({ weightKg: 40, reason: "reps_advanced" });
  });

  test("partial/missing sets and sets below the rep range are not success", () => {
    const rule = { kind: "double", incrementKg: 2.5 } as const;
    expect(
      suggestProgression(rule, target, [
        {
          date: "d",
          sets: [
            { reps: 12, weightKg: 40 },
            { reps: 12, weightKg: 40 },
          ],
        },
      ]),
    ).toMatchObject({ reason: "incomplete_session", weightKg: 40 });
    expect(
      suggestProgression(rule, target, [
        {
          ...session([12, 12, 12]),
          sets: session([12, 12, 12]).sets.map((s, i) => ({ ...s, completed: i !== 1 })),
        },
      ]),
    ).toMatchObject({ reason: "incomplete_session" });
    expect(suggestProgression(rule, target, [session([7, 12, 12])])).toMatchObject({
      reason: "reps_below_target",
    });
  });

  test("target-load mismatch is conservative, while logged overrides become the next base", () => {
    expect(
      suggestProgression({ kind: "double", incrementKg: 1 }, target, [session([12, 12, 12], 42)]),
    ).toMatchObject({ weightKg: 40, reason: "load_mismatch" });
    expect(
      suggestProgression(
        { kind: "linear", incrementKg: 1, deloadPercent: 10, failureThreshold: 3 },
        target,
        [{ ...session([8, 8, 8], 43), effectivePrescribedWeightKg: 43 }],
      ),
    ).toMatchObject({ weightKg: 44, reason: "linear_progression_increased" });
  });

  test("uses explicit historical prescriptions across progression cycles; absent provenance uses target", () => {
    const rule = { kind: "double", incrementKg: 2.5 } as const;
    const at42_5 = { ...session([12, 12, 12], 42.5), effectivePrescribedWeightKg: 42.5 };
    expect(suggestProgression(rule, target, [at42_5])).toMatchObject({
      weightKg: 45,
      reason: "double_progression_increased",
    });
    expect(suggestProgression(rule, target, [session([12, 12, 12], 42.5)])).toMatchObject({
      weightKg: 40,
      reason: "load_mismatch",
    });
  });

  test("linear success adds increment; failures are consecutive sessions, not calendar days", () => {
    const rule = {
      kind: "linear",
      incrementKg: 2.5,
      deloadPercent: 10,
      failureThreshold: 2,
    } as const;
    expect(suggestProgression(rule, target, [session([8, 8, 8])])).toMatchObject({
      weightKg: 42.5,
      reason: "linear_progression_increased",
      failures: 0,
    });
    const failed = { date: "2026-01-01", sets: [{ reps: 2, weightKg: 40 }] };
    expect(suggestProgression(rule, target, [failed])).toMatchObject({
      weightKg: 40,
      failures: 1,
      reason: "linear_failure_recorded",
    });
    expect(
      suggestProgression(rule, target, [failed, { ...failed, date: "2025-01-01" }]),
    ).toMatchObject({ weightKg: 36, failures: 2, reason: "linear_deload", deloadPercent: 10 });
    expect(suggestProgression(rule, target, [failed, session([8, 8, 8])])).toMatchObject({
      failures: 1,
      reason: "linear_failure_recorded",
    });
  });

  test("deload is pure and never compounds across repeated calls", () => {
    const input = [
      { ...session([2, 2, 2], 50), effectivePrescribedWeightKg: 50 },
      { ...session([2, 2, 2], 50), effectivePrescribedWeightKg: 50 },
    ];
    const rule = {
      kind: "linear",
      incrementKg: 2,
      deloadPercent: 20,
      failureThreshold: 2,
    } as const;
    const once = suggestProgression(rule, target, input);
    expect(once.weightKg).toBe(40);
    expect(suggestProgression(rule, target, input)).toEqual(once);
    expect(input[0]?.sets[0]?.weightKg).toBe(50);
  });

  test("invalid rules and targets fail safely; zero increments are valid", () => {
    expect(
      suggestProgression({ kind: "double", incrementKg: 0 }, target, [session([12, 12, 12])]),
    ).toMatchObject({ weightKg: 40, reason: "double_progression_increased", incrementKg: 0 });
    for (const incrementKg of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(suggestProgression({ kind: "double", incrementKg }, target, [])).toMatchObject({
        weightKg: 40,
        reason: "invalid_options",
      });
    }
    expect(
      suggestProgression(
        { kind: "linear", incrementKg: 1, deloadPercent: 101, failureThreshold: 2 },
        target,
        [],
      ),
    ).toMatchObject({ reason: "invalid_options" });
    expect(
      suggestProgression({ kind: "double", incrementKg: 1 }, { ...target, sets: 0 }, []),
    ).toMatchObject({ weightKg: 40, reason: "invalid_options" });
  });

  test("bodyweight, null load, and exact fractional kg increments stay canonical", () => {
    const bodyweight = { ...target, weightKg: null };
    expect(
      suggestProgression({ kind: "double", incrementKg: 2.5 }, bodyweight, [
        session([12, 12, 12], null),
      ]),
    ).toMatchObject({ weightKg: null, reason: "progression_held" });
    expect(
      suggestProgression(
        { kind: "linear", incrementKg: 1.25, deloadPercent: 10, failureThreshold: 3 },
        target,
        [{ ...session([8, 8, 8], 20.1), effectivePrescribedWeightKg: 20.1 }],
      ).weightKg,
    ).toBe(21.35);
    // Unit conversion happens at the edge; this engine receives and returns kg.
    expect(
      suggestProgression({ kind: "double", incrementKg: 2.26796185 }, target, [
        session([12, 12, 12]),
      ]).weightKg,
    ).toBe(42.26796185);
  });

  test("explicit null prescription remains bodyweight rather than falling back to the target", () => {
    expect(
      suggestProgression({ kind: "double", incrementKg: 2.5 }, target, [
        { ...session([12, 12, 12], null), effectivePrescribedWeightKg: null },
      ]),
    ).toMatchObject({ weightKg: null, reason: "progression_held" });
  });
});
