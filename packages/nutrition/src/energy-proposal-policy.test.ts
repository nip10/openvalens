import { describe, expect, test } from "bun:test";

import {
  checkProposalAcceptable,
  ENERGY_PROPOSAL_POLICY,
  energyTargetOf,
  planEnergyProposal,
  PROPOSAL_COPY,
  PROPOSAL_DECLINE_COPY,
} from "./energy-proposal-policy";
import { calorieFloorKcal, findBannedCopy } from "./nutrition-safety";

/** Synthetic policy tests (Issues #76, #80): maintenance proposals never bypass the limits. */

const NOW = new Date("2026-03-28T12:00:00.000Z");
const BODY = { weightKg: 80, heightCm: 175, sex: "male" as const, minAge: 40, maxAge: 41 };
const estimated = (kcalPerDay: number) =>
  ({
    status: "estimated",
    estimate: {
      kcalPerDay,
      range: { lowKcal: kcalPerDay - 200, highKcal: kcalPerDay + 200 },
      components: { meanIntakeKcal: kcalPerDay, weightChangeKcalPerDay: 0 },
      uncertainty: {
        intakeStandardErrorKcal: 0,
        weightChangeStandardDeviationKg: 0.5,
        combinedStandardDeviationKcal: 100,
        rangeStandardDeviations: 2,
      },
    },
  }) as const;

const plan = (overrides: Partial<Parameters<typeof planEnergyProposal>[0]> = {}) =>
  planEnergyProposal({
    estimate: estimated(2500),
    adultConfirmed: true,
    currentTargetKcal: null,
    lastAcceptedAt: null,
    now: NOW,
    ...overrides,
  });

describe("planEnergyProposal", () => {
  test("first target: maintenance at the estimate, rounded to 50 kcal", () => {
    expect(plan({ estimate: estimated(2480) })).toEqual({
      outcome: "proposal",
      kind: "maintenance",
      estimateKcal: 2480,
      targetKcal: 2500,
      currentTargetKcal: null,
      stepLimited: false,
      needsConfirmation: false,
      policyVersion: "nutrition-safety/v3",
    });
  });

  test("adults only, and nothing without an estimate", () => {
    expect(plan({ adultConfirmed: false })).toEqual({ outcome: "declined", reason: "adults_only" });
    expect(plan({ estimate: { status: "no_estimate", estimate: null } })).toEqual({
      outcome: "declined",
      reason: "no_estimate",
    });
  });

  test("weekly step: at most the smaller of 200 kcal or 10% per change", () => {
    const up = plan({
      estimate: estimated(2800),
      currentTargetKcal: 2000,
      body: BODY,
      direction: "lose",
    });
    expect(up).toMatchObject({ outcome: "proposal", targetKcal: 2200, stepLimited: true });
    const down = plan({ estimate: estimated(2500), currentTargetKcal: 3000, body: BODY });
    expect(down).toMatchObject({ outcome: "proposal", targetKcal: 2800, stepLimited: true });
    expect(
      plan({ currentTargetKcal: 2000, lastAcceptedAt: new Date(NOW.getTime() - 6 * 86_400_000) }),
    ).toEqual({ outcome: "declined", reason: "recently_changed" });
  });

  test("small differences are not proposed", () => {
    expect(plan({ estimate: estimated(2520), currentTargetKcal: 2500 })).toEqual({
      outcome: "declined",
      reason: "not_suggested_for_profile",
    });
  });

  test("never below 1,200 kcal/day", () => {
    expect(plan({ estimate: estimated(1150) })).toEqual({
      outcome: "declined",
      reason: "below_floor",
    });
  });

  test("property: every returned target respects the floor and weekly step", () => {
    let seed = 76;
    const random = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    for (let i = 0; i < 5000; i += 1) {
      const estimateKcal = Math.round(500 + random() * 6000);
      const currentTargetKcal = random() < 0.2 ? null : Math.round(800 + random() * 4000);
      const result = plan({ estimate: estimated(estimateKcal), currentTargetKcal });
      if (result.outcome !== "proposal") continue;
      expect(result.kind).toBe("maintenance");
      expect(result.targetKcal).toBeGreaterThanOrEqual(
        calorieFloorKcal({ sex: null, restingKcal: null }),
      );
      if (currentTargetKcal !== null) {
        const step = Math.min(
          ENERGY_PROPOSAL_POLICY.step.maxKcal,
          ENERGY_PROPOSAL_POLICY.step.maxFraction * currentTargetKcal,
        );
        expect(Math.abs(result.targetKcal - currentTargetKcal)).toBeLessThanOrEqual(step);
        // A decrease is available only when the member explicitly chose lose.
        if (result.targetKcal < estimateKcal) expect(result.kind).toBe("deficit");
      }
    }
  });
});

describe("checkProposalAcceptable", () => {
  const proposal = {
    status: "pending",
    targetKcal: 2300,
    currentTargetKcal: 2100,
    expiresAt: new Date(NOW.getTime() + 86_400_000),
  };
  const check = (overrides: Partial<Parameters<typeof checkProposalAcceptable>[0]> = {}) =>
    checkProposalAcceptable({
      proposal,
      adultConfirmed: true,
      currentTargetKcal: 2100,
      now: NOW,
      ...overrides,
    });

  test("accepts only a pending, unexpired proposal against an unchanged target", () => {
    expect(check()).toEqual({ ok: true });
    expect(check({ proposal: { ...proposal, status: "dismissed" } })).toEqual({
      ok: false,
      reason: "not_pending",
    });
    expect(check({ now: new Date(NOW.getTime() + 2 * 86_400_000) })).toEqual({
      ok: false,
      reason: "expired",
    });
    expect(check({ currentTargetKcal: 2000 })).toEqual({ ok: false, reason: "target_changed" });
    expect(check({ adultConfirmed: false })).toEqual({ ok: false, reason: "adults_only" });
    expect(check({ proposal: { ...proposal, targetKcal: 1100 } })).toEqual({
      ok: false,
      reason: "below_floor",
    });
  });
});

describe("energyTargetOf", () => {
  test("reads a single target from a goal row", () => {
    expect(energyTargetOf(null)).toBeNull();
    expect(energyTargetOf({ minAmount: 2000, maxAmount: 2000 })).toBe(2000);
    expect(energyTargetOf({ minAmount: 1800, maxAmount: 2200 })).toBe(2000);
    expect(energyTargetOf({ minAmount: null, maxAmount: 2100 })).toBe(2100);
  });
});

describe("copy", () => {
  test("refusals say what the app won't do; no numbers, no judgement", () => {
    for (const text of [...Object.values(PROPOSAL_DECLINE_COPY), ...Object.values(PROPOSAL_COPY)]) {
      expect(text).not.toMatch(/\b(1,?200|BMI|good|bad|cheat|earn\w*|fail\w*|over|under)\b/i);
      expect(findBannedCopy(text)).toEqual([]);
    }
  });
});

describe("chosen weekly rate (#396)", () => {
  // 80 kg: 0.25 %/wk = 220 kcal/d, 0.5 % = 440, 0.75 % = 660, 1.0 % = 880 (7,700 kcal/kg).
  const lose = (ratePercent: number | null, extra: Partial<Parameters<typeof plan>[0]> = {}) =>
    plan({ estimate: estimated(2800), direction: "lose", body: BODY, ratePercent, ...extra });

  test("a chosen loss rate sets the reduction, rounded towards the estimate", () => {
    expect(lose(0.25)).toMatchObject({ outcome: "proposal", kind: "deficit", targetKcal: 2600 });
    expect(lose(0.5)).toMatchObject({ targetKcal: 2400 });
    expect(lose(0.75)).toMatchObject({ targetKcal: 2150 });
  });

  test("the hard caps win over a faster rate: never more than 25 % or 750 kcal", () => {
    // 1.0 %/wk = 880 kcal/d, capped at min(750, 25 % of 2,800 = 700).
    expect(lose(1)).toMatchObject({ targetKcal: 2100 });
    const older = lose(1, { body: { ...BODY, minAge: 70, maxAge: 71 } });
    // 65+: 0.5 %/wk cap (440 kcal/d).
    expect(older).toMatchObject({ targetKcal: 2400 });
  });

  test("the floor still holds whatever the rate", () => {
    const small = { weightKg: 60, heightCm: 165, sex: "female" as const, minAge: 30, maxAge: 31 };
    const result = plan({
      estimate: estimated(1600),
      direction: "lose",
      body: small,
      ratePercent: 1,
    });
    if (result.outcome === "proposal")
      expect(result.targetKcal).toBeGreaterThanOrEqual(
        calorieFloorKcal({ sex: "female", restingKcal: 10 * 60 + 6.25 * 165 - 5 * 30 - 161 }),
      );
    // Refused rather than going under the floor.
    else expect(["below_floor", "not_suggested_for_profile"]).toContain(result.reason);
  });

  test("an unknown rate or no weight falls back to the default size", () => {
    expect(lose(0.3)).toEqual(lose(null));
    expect(
      plan({
        estimate: estimated(2800),
        direction: "lose",
        body: { ...BODY, weightKg: null },
        ratePercent: 1,
      }),
    ).toMatchObject({ outcome: "declined", reason: "needs_body_details" });
  });

  test("gain rates stay at or under 0.5 %/week and +20 %", () => {
    const gain = (ratePercent: number | null) =>
      plan({ estimate: estimated(2800), direction: "gain", body: BODY, ratePercent });
    expect(gain(0.25)).toMatchObject({ kind: "gain", targetKcal: 3000 });
    expect(gain(0.5)).toMatchObject({ targetKcal: 3200 });
    // A loss-only rate counts as the largest gain rate.
    expect(gain(1)).toEqual(gain(0.5));
  });

  test("exclusions still turn reductions off at any rate", () => {
    expect(
      lose(0.5, {
        safety: { energySuggestions: "available", reductionSuggestions: "off", softGates: [] },
      }),
    ).toMatchObject({ outcome: "declined", reason: "not_suggested_for_profile" });
  });
});
