import { describe, expect, test } from "bun:test";

import { goalWaterTargetMl } from "./goal-water-link";

describe("shared water-goal eligibility", () => {
  const base = {
    source: "water",
    metric: "water_ml",
    unit: "ml",
    rule: { kind: "recurring", cadence: "daily", completion: { kind: "minimum", value: 2000 } },
  };

  test("accepts only positive daily minimum water goals", () => {
    expect(goalWaterTargetMl(base)).toBe(2000);
    expect(goalWaterTargetMl({ ...base, rule: { ...base.rule, cadence: "weekdays" } })).toBeNull();
    expect(
      goalWaterTargetMl({
        ...base,
        rule: { ...base.rule, completion: { kind: "minimum", value: 0 } },
      }),
    ).toBeNull();
    expect(goalWaterTargetMl({ ...base, metric: "sleep_hours" })).toBeNull();
    expect(goalWaterTargetMl({ ...base, source: "manual" })).toBeNull();
    expect(goalWaterTargetMl(null)).toBeNull();
  });
});
