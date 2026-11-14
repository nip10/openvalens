import { describe, expect, test } from "bun:test";

import {
  ONBOARDING_MIN_GROUP_SIZE,
  onboardingTotalsInput,
  presentOnboardingTotals,
  type OnboardingCounts,
} from "./onboarding-measurement";

const window = {
  windowDays: 30,
  from: new Date("2026-10-15T12:00:00.000Z"),
  to: new Date("2026-11-14T12:00:00.000Z"),
};

function counts(eligible: number, reached: number): OnboardingCounts {
  const row = { eligible, reached };
  return {
    signUps: eligible,
    first_entry_10m: row,
    first_entry_1d: row,
    first_entry_7d: row,
    active_days_2_7: row,
  };
}

describe("presentOnboardingTotals (#444)", () => {
  test("the minimum group size is 5", () => {
    expect(ONBOARDING_MIN_GROUP_SIZE).toBe(5);
  });

  test("a group of exactly the minimum shows its count and share", () => {
    const totals = presentOnboardingTotals(counts(5, 2), window);
    expect(totals.figures[0]).toEqual({
      id: "first_entry_10m",
      eligible: 5,
      reached: 2,
      share: 0.4,
      suppressed: false,
    });
  });

  test("a group one below the minimum hides the count and the share", () => {
    const totals = presentOnboardingTotals(counts(4, 4), window);
    expect(totals.signUps).toBe(4);
    for (const figure of totals.figures) {
      expect(figure).toMatchObject({ eligible: 4, reached: null, share: null, suppressed: true });
    }
  });

  test("an empty cohort is suppressed, not a division by zero", () => {
    const totals = presentOnboardingTotals(counts(0, 0), window);
    expect(totals.figures.every((figure) => figure.suppressed && figure.share === null)).toBe(true);
  });

  test("shares are rounded to three decimals; the window is in ISO form", () => {
    const totals = presentOnboardingTotals(counts(7, 4), window);
    expect(totals.figures[0]?.share).toBe(0.571);
    expect(totals).toMatchObject({
      windowDays: 30,
      from: "2026-10-15T12:00:00.000Z",
      to: "2026-11-14T12:00:00.000Z",
      minimumGroupSize: 5,
    });
  });
});

describe("onboardingTotalsInput", () => {
  test("defaults to 30 days and accepts only the offered windows", () => {
    expect(onboardingTotalsInput.parse({})).toEqual({ windowDays: 30 });
    expect(onboardingTotalsInput.parse({ windowDays: 365 })).toEqual({ windowDays: 365 });
    expect(onboardingTotalsInput.safeParse({ windowDays: 7 }).success).toBe(false);
  });
});
