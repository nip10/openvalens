import { describe, expect, test } from "bun:test";
import { englishI18n } from "@openvalens/i18n/testing";

import { progressionWhy } from "./workout-progression";

const prescription = { repsMin: 8, repsMax: 12 };
const text = (reason: string, extra: Record<string, number> = {}) =>
  englishI18n._(
    progressionWhy({ reason, weightKg: 50, reps: 8, ...extra }, prescription, "metric"),
  );

describe("progressionWhy", () => {
  test("explains every stable progression reason in plain English", () => {
    expect([
      text("rule_disabled"),
      text("no_history"),
      text("incomplete_session"),
      text("reps_below_target"),
      text("load_mismatch"),
      text("progression_held"),
      text("reps_advanced"),
      text("double_progression_increased", { incrementKg: 2.5 }),
      text("linear_progression_increased", { incrementKg: 5 }),
      text("linear_failure_recorded", { failures: 2 }),
      text("linear_deload", { failures: 3, deloadPercent: 10 }),
      text("invalid_options"),
    ]).toMatchInlineSnapshot(`
      [
        "No progression rule is set, so the prescription stays the same.",
        "There is no previous session to compare, so the prescription stays the same.",
        "The last session did not include all prescribed sets, so the prescription stays the same.",
        "At least one set was below the target of 8 reps, so the load stays the same.",
        "The last session used different loads between sets, so the prescription stays the same.",
        "The load stays the same because it cannot be increased for this exercise.",
        "Reps increased to 8 while the load stays the same.",
        "All sets reached 12 reps last time, so add 2.5 kg.",
        "The last session was complete, so add 5 kg.",
        "2 incomplete sessions recorded; the load stays the same.",
        "3 attempted failures recorded, so reduce the load by 10%.",
        "The progression settings are invalid, so the prescription stays the same.",
      ]
    `);
  });

  test("converts increments to rounded display units and pluralises one failure", () => {
    expect(
      englishI18n._(
        progressionWhy(
          { reason: "double_progression_increased", weightKg: 52.5, reps: 8, incrementKg: 2.5 },
          prescription,
          "imperial",
        ),
      ),
    ).toBe("All sets reached 12 reps last time, so add 5.51 lb.");
    expect(text("linear_deload", { failures: 1, deloadPercent: 10 })).toBe(
      "1 attempted failure recorded, so reduce the load by 10%.",
    );
  });
});
