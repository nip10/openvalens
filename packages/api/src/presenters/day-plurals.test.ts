import { describe, expect, test } from "bun:test";
import { serverI18n } from "@openvalens/i18n/server";

import { nutritionObservationView } from "./insights";

/** #237: a count of one reads "1 day" / "1 dia", never "1 days" / "1 dias". */
const observation = (days: number) =>
  ({
    ruleId: "observation.meals_near_sleep",
    window: { from: "2026-10-01", to: "2026-10-07", days },
    matchingEvents: 3,
    minimumMatchingEvents: 3,
    completeness: "c",
    title: "t",
    body: "b",
  }) as Parameters<typeof nutritionObservationView>[1];

describe("day counts use plural forms (#237)", () => {
  test("English", () => {
    const en = serverI18n("en");
    expect(nutritionObservationView(en, observation(1)).period).toBe(
      "Period: 2026-10-01 to 2026-10-07 (1 day)",
    );
    expect(nutritionObservationView(en, observation(7)).period).toBe(
      "Period: 2026-10-01 to 2026-10-07 (7 days)",
    );
  });

  test("pt-PT", () => {
    const pt = serverI18n("pt-PT");
    expect(nutritionObservationView(pt, observation(1)).period).toContain("(1 dia)");
    expect(nutritionObservationView(pt, observation(7)).period).toContain("(7 dias)");
  });
});
