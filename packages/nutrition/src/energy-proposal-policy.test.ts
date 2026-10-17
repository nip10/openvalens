import { describe, expect, test } from "bun:test";

import {
  checkProposalAcceptable,
  ENERGY_PROPOSAL_POLICY,
  energyTargetOf,
  planEnergyProposal,
  PROPOSAL_COPY,
  PROPOSAL_DECLINE_COPY,
} from "./energy-proposal-policy";
import { findBannedCopy } from "./nutrition-safety";

/** Synthetic policy tests (Issues #76, #80): maintenance proposals never bypass the limits. */

const NOW = new Date("2026-03-28T12:00:00.000Z");
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
      policyVersion: "nutrition-safety/v1",
    });
  });

  test("adults only, and nothing without an estimate", () => {
    expect(plan({ adultConfirmed: false })).toEqual({ outcome: "declined", reason: "adults_only" });
    expect(plan({ estimate: { status: "no_estimate", estimate: null } })).toEqual({
      outcome: "declined",
      reason: "no_estimate",
    });
  });

  test("weekly step: at most max(200 kcal, 10%) per change, one change per 7 days", () => {
    const up = plan({ estimate: estimated(2900), currentTargetKcal: 2000 });
    expect(up).toMatchObject({ outcome: "proposal", targetKcal: 2200, stepLimited: true });
    const down = plan({ estimate: estimated(2000), currentTargetKcal: 3000 });
    expect(down).toMatchObject({ outcome: "proposal", targetKcal: 2700, stepLimited: true });
    expect(
      plan({ currentTargetKcal: 2000, lastAcceptedAt: new Date(NOW.getTime() - 6 * 86_400_000) }),
    ).toEqual({ outcome: "declined", reason: "recently_changed" });
  });

  test("small differences are not proposed", () => {
    expect(plan({ estimate: estimated(2520), currentTargetKcal: 2500 })).toEqual({
      outcome: "declined",
      reason: "no_change",
    });
  });

  test("never below 1,200 kcal/day", () => {
    expect(plan({ estimate: estimated(1150) })).toEqual({
      outcome: "declined",
      reason: "below_floor",
    });
  });

  test("property: no proposal violates the floor or the step limit, for any input", () => {
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
      expect(result.targetKcal).toBeGreaterThanOrEqual(ENERGY_PROPOSAL_POLICY.neverBelowKcal);
      if (currentTargetKcal !== null) {
        const step = Math.max(
          ENERGY_PROPOSAL_POLICY.step.maxKcal,
          ENERGY_PROPOSAL_POLICY.step.maxFraction * currentTargetKcal,
        );
        // Larger moves only when the stepped target would itself be below 1,200 kcal.
        if (Math.abs(result.targetKcal - currentTargetKcal) > step)
          expect(currentTargetKcal + step).toBeLessThan(ENERGY_PROPOSAL_POLICY.neverBelowKcal);
        // Moves toward the estimate, never past it by more than rounding.
        expect(Math.sign(result.targetKcal - currentTargetKcal)).toBe(
          Math.sign(estimateKcal - currentTargetKcal) ||
            Math.sign(result.targetKcal - currentTargetKcal),
        );
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
