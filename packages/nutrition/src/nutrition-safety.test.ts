import { describe, expect, test } from "bun:test";

import {
  checkProposalAcceptable,
  defaultDeficitKcal,
  isSafeTarget,
  maxDeficitKcal,
  maxSurplusKcal,
  planEnergyProposal,
  PROPOSAL_COPY,
  PROPOSAL_DECLINE_COPY,
  type ProposalBody,
} from "./energy-proposal-policy";
import {
  bmiOf,
  calorieFloorKcal,
  DECLARATION_LABELS,
  ENERGY_DIRECTIONS,
  estimateRestingKcal,
  evaluateNutritionSafety,
  findBannedCopy,
  helplinesFor,
  NUTRITION_DECLARATIONS,
  NUTRITION_EXCLUSIONS,
  NUTRITION_HELPLINES,
  NUTRITION_SAFETY_COPY,
  NUTRITION_SAFETY_POLICY,
  proteinReference,
  type EnergyDirection,
  type NutritionDeclaration,
} from "./nutrition-safety";

/** Synthetic tests for `nutrition-safety/v1` (Issue #80). No real person's data. */

const NOW = new Date("2026-03-28T12:00:00.000Z");
const P = NUTRITION_SAFETY_POLICY;

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

const BODY: ProposalBody = { weightKg: 80, heightCm: 175, sex: "male", minAge: 40, maxAge: 41 };

function safetyFor(declarations: NutritionDeclaration[] = [], maxAge: number | null = 41) {
  return evaluateNutritionSafety({
    adultConfirmed: true,
    minAge: maxAge === null ? null : maxAge - 1,
    maxAge,
    declarations,
    hideNumbers: false,
  });
}

const plan = (
  direction: EnergyDirection,
  overrides: Partial<Parameters<typeof planEnergyProposal>[0]> = {},
) =>
  planEnergyProposal({
    estimate: estimated(2500),
    adultConfirmed: true,
    currentTargetKcal: null,
    lastAcceptedAt: null,
    now: NOW,
    direction,
    safety: safetyFor(),
    body: BODY,
    ...overrides,
  });

describe("defaults", () => {
  test("new members get maintain behaviour; no automated deficit", () => {
    expect(P.defaultDirection).toBe("maintain");
    const result = planEnergyProposal({
      estimate: estimated(2500),
      adultConfirmed: true,
      currentTargetKcal: null,
      lastAcceptedAt: null,
      now: NOW,
    });
    expect(result).toMatchObject({ outcome: "proposal", kind: "maintenance", targetKcal: 2500 });
  });

  test("policy is versioned with a changelog entry for the current version", () => {
    expect(P.version).toBe("nutrition-safety/v1");
    expect(P.changelog.at(-1)?.version).toBe(P.version);
    expect(Object.isFrozen(P)).toBe(true);
    expect(Object.isFrozen(P.deficit)).toBe(true);
  });

  test("the docs changelog lists the current policy version", async () => {
    const doc = await Bun.file(
      new URL("../../../docs/nutrition-targets.md", import.meta.url),
    ).text();
    for (const entry of P.changelog)
      expect(doc).toContain(`| \`${entry.version}\` | ${entry.date}`);
  });
});

describe("floors and references", () => {
  test("floor is max(1,200, sex floor, resting estimate); undeclared uses the higher value", () => {
    expect(calorieFloorKcal({ sex: "female", restingKcal: null })).toBe(1200);
    expect(calorieFloorKcal({ sex: "male", restingKcal: null })).toBe(1500);
    expect(calorieFloorKcal({ sex: null, restingKcal: null })).toBe(1500);
    expect(calorieFloorKcal({ sex: "female", restingKcal: 1630 })).toBe(1650);
  });

  test("resting estimate needs weight, height and age; undeclared sex is conservative", () => {
    expect(estimateRestingKcal({ ...BODY, heightCm: null })).toBeNull();
    const male = estimateRestingKcal(BODY)!;
    expect(male).toBeCloseTo(10 * 80 + 6.25 * 175 - 5 * 40 + 5);
    expect(estimateRestingKcal({ ...BODY, sex: null })).toBe(male);
    expect(estimateRestingKcal({ ...BODY, sex: "female" })).toBe(male - 166);
  });

  test("protein reference: 0.8 g/kg, active 1.2–1.6, ≥ 1.0 at 65+, capped at 0.8 with CKD", () => {
    const base = {
      weightKg: 70,
      adultConfirmed: true,
      maxAge: 40,
      active: false,
      kidneyCap: false,
    };
    expect(proteinReference(base)).toEqual({
      minGPerKg: 0.8,
      maxGPerKg: 0.8,
      minG: 55,
      maxG: 55,
      basis: "default",
    });
    expect(proteinReference({ ...base, active: true })).toMatchObject({
      minGPerKg: 1.2,
      maxGPerKg: 1.6,
      basis: "active",
    });
    expect(proteinReference({ ...base, maxAge: 66 })).toMatchObject({
      minGPerKg: 1.0,
      basis: "older_adult",
    });
    expect(proteinReference({ ...base, active: true, kidneyCap: true })).toMatchObject({
      minGPerKg: 0.8,
      maxGPerKg: 0.8,
      basis: "kidney_cap",
    });
    const ckd80kg = proteinReference({ ...base, weightKg: 80, kidneyCap: true })!;
    expect(ckd80kg.maxG).toBeLessThanOrEqual(80 * 0.8);
    const older67kg = proteinReference({ ...base, weightKg: 67, maxAge: 66 })!;
    expect(older67kg.minG).toBeGreaterThanOrEqual(67);
    expect(older67kg).toMatchObject({ minG: 70, maxG: 70 });
    expect(older67kg.minG).toBeLessThanOrEqual(older67kg.maxG);
    expect(proteinReference({ ...base, weightKg: null })).toBeNull();
    expect(proteinReference({ ...base, adultConfirmed: false })).toBeNull();
  });

  test("rounded protein reference stays ordered for non-five-kilogram weights", () => {
    for (const weightKg of [51, 52, 53, 57, 62, 67, 68, 73, 77]) {
      for (const input of [
        { maxAge: 40, active: false, kidneyCap: false },
        { maxAge: 40, active: true, kidneyCap: false },
        { maxAge: 66, active: false, kidneyCap: false },
        { maxAge: 66, active: true, kidneyCap: false },
        { maxAge: 66, active: false, kidneyCap: true },
        { maxAge: 66, active: true, kidneyCap: true },
      ]) {
        const reference = proteinReference({
          weightKg,
          adultConfirmed: true,
          ...input,
        })!;
        expect(reference.minG).toBeLessThanOrEqual(reference.maxG);
        if (input.kidneyCap)
          expect(reference.maxG).toBeLessThanOrEqual(
            weightKg * NUTRITION_SAFETY_POLICY.protein.kidneyMaxGPerKg,
          );
      }
    }
  });
});

describe("exclusions", () => {
  test("each exclusion turns off reductions without turning off logging or maintenance", () => {
    for (const exclusion of NUTRITION_EXCLUSIONS) {
      const safety = safetyFor([exclusion]);
      expect(safety.reductionSuggestions).toBe("off");
      expect(safety.streaks).toBe("hidden");
      expect(plan("lose", { safety })).toEqual({
        outcome: "declined",
        reason: exclusion === "eating_disorder" ? "suggestions_off" : "not_suggested_for_profile",
      });
      if (exclusion !== "eating_disorder")
        expect(plan("maintain", { safety })).toMatchObject({ outcome: "proposal" });
    }
  });

  test("an eating-disorder declaration turns off energy targets and all suggestions", () => {
    const safety = safetyFor(["eating_disorder"]);
    expect(safety).toMatchObject({ energyTargets: "off", energySuggestions: "off" });
    for (const direction of ENERGY_DIRECTIONS)
      expect(plan(direction, { safety })).toEqual({
        outcome: "declined",
        reason: "suggestions_off",
      });
  });

  test("under 18 (or not confirmed adult) gets no proposals and no streaks", () => {
    const safety = evaluateNutritionSafety({
      adultConfirmed: false,
      minAge: null,
      maxAge: null,
      declarations: [],
      hideNumbers: false,
    });
    expect(safety).toMatchObject({ energySuggestions: "off", streaks: "hidden" });
    expect(plan("maintain", { adultConfirmed: false, safety })).toEqual({
      outcome: "declined",
      reason: "adults_only",
    });
  });

  test("hide-numbers mode hides streaks; soft gates need confirmation, not refusal", () => {
    expect(
      evaluateNutritionSafety({
        adultConfirmed: true,
        minAge: 30,
        maxAge: 31,
        declarations: [],
        hideNumbers: true,
      }).streaks,
    ).toBe("hidden");
    const glp1 = safetyFor(["glp1_medication"]);
    expect(glp1).toMatchObject({
      reductionSuggestions: "available",
      softGates: ["glp1_medication"],
    });
    expect(plan("lose", { safety: glp1 })).toMatchObject({
      outcome: "proposal",
      kind: "deficit",
      needsConfirmation: true,
    });
    const older = safetyFor([], 66);
    expect(older.softGates).toEqual(["older_adult"]);
  });
});

describe("deficit and gain proposals", () => {
  test("lose: default deficit is the smallest of 500 kcal, 20% and 0.7%/week", () => {
    // 80 kg × 0.7% × 7700 / 7 = 616 kcal; 20% of 2500 = 500; so 500.
    expect(defaultDeficitKcal(2500, BODY)).toBe(500);
    expect(plan("lose")).toMatchObject({ kind: "deficit", targetKcal: 2000, stepLimited: false });
    // Smaller person: 55 kg → 423 kcal; target rounds towards the estimate.
    const small = { ...BODY, weightKg: 55, heightCm: 160 };
    expect(plan("lose", { body: small })).toMatchObject({ kind: "deficit", targetKcal: 2100 });
  });

  test("lose needs a weight and height, and respects the BMI gate", () => {
    expect(plan("lose", { body: { ...BODY, heightCm: null } })).toEqual({
      outcome: "declined",
      reason: "needs_body_details",
    });
    // BMI 18.0 now.
    expect(plan("lose", { body: { ...BODY, weightKg: 55.1 } })).toEqual({
      outcome: "declined",
      reason: "not_suggested_for_profile",
    });
    // The policy has no invented fixed projection horizon; current BMI is the gate.
    expect(plan("lose", { body: { ...BODY, weightKg: 57.3 } })).toMatchObject({
      outcome: "proposal",
      kind: "deficit",
    });
  });

  test("lose never goes below the member's floor", () => {
    expect(plan("lose", { estimate: estimated(1600), body: { ...BODY, sex: "male" } })).toEqual({
      outcome: "declined",
      reason: "not_suggested_for_profile",
    });
  });

  test("65+ caps loss at 0.5% per week", () => {
    const body = { ...BODY, minAge: 66, maxAge: 67 };
    // 80 kg × 0.5% × 7700 / 7 = 440 kcal.
    expect(maxDeficitKcal(2500, body)).toBeCloseTo(440);
    expect(plan("lose", { body, safety: safetyFor([], 67) })).toMatchObject({
      kind: "deficit",
      targetKcal: 2100,
      needsConfirmation: true,
    });
  });

  test("gain: a 10% default surplus, capped at 20% and weekly body-weight limit", () => {
    expect(plan("gain")).toMatchObject({ kind: "gain", targetKcal: 2750 });
    // 50 kg caps the surplus at 0.5%/week = 275 kcal.
    expect(maxSurplusKcal(2500, { ...BODY, weightKg: 50 })).toBe(275);
    expect(plan("gain", { body: { ...BODY, weightKg: 50 } })).toMatchObject({ targetKcal: 2750 });
  });

  test("an unsafe intermediate step withholds a proposal rather than jumping", () => {
    expect(plan("maintain", { currentTargetKcal: 900 })).toEqual({
      outcome: "declined",
      reason: "below_floor",
    });
    expect(plan("lose", { currentTargetKcal: 1600 })).toEqual({
      outcome: "declined",
      reason: "not_suggested_for_profile",
    });
  });

  test("actual target constraints apply regardless of direction label", () => {
    const pregnantSafety = safetyFor(["pregnant_or_breastfeeding"]);
    for (const direction of ENERGY_DIRECTIONS)
      expect(
        planEnergyProposal({
          estimate: estimated(3000),
          adultConfirmed: true,
          currentTargetKcal: 1800,
          lastAcceptedAt: null,
          now: NOW,
          direction,
          safety: pregnantSafety,
          body: BODY,
        }),
      ).toMatchObject({ outcome: "declined" });

    // Without an exclusion, a lower actual target still requires an explicit
    // lose choice; maintain/gain labels cannot disguise the reduction.
    for (const direction of ["maintain", "gain"] as const)
      expect(
        planEnergyProposal({
          estimate: estimated(3000),
          adultConfirmed: true,
          currentTargetKcal: 2500,
          lastAcceptedAt: null,
          now: NOW,
          direction,
          safety: safetyFor(),
          body: BODY,
        }),
      ).toEqual({ outcome: "declined", reason: "not_suggested_for_profile" });

    expect(
      planEnergyProposal({
        estimate: estimated(3000),
        adultConfirmed: true,
        currentTargetKcal: 1200,
        lastAcceptedAt: null,
        now: NOW,
        direction: "gain",
        safety: safetyFor(),
        body: BODY,
      }),
    ).toMatchObject({ outcome: "declined", reason: "below_floor" });

    expect(
      planEnergyProposal({
        estimate: estimated(1300),
        adultConfirmed: true,
        currentTargetKcal: null,
        lastAcceptedAt: null,
        now: NOW,
        direction: "maintain",
        safety: safetyFor(),
        body: BODY,
      }),
    ).toMatchObject({ outcome: "declined", reason: "below_floor" });

    expect(
      planEnergyProposal({
        estimate: estimated(2500),
        adultConfirmed: true,
        currentTargetKcal: 3000,
        lastAcceptedAt: null,
        now: NOW,
        direction: "maintain",
        safety: safetyFor(),
        body: BODY,
      }),
    ).toMatchObject({ outcome: "proposal", targetKcal: 2800, stepLimited: true });
  });

  test("infeasible floor and step combination withholds the proposal", () => {
    expect(
      plan("gain", {
        estimate: estimated(3000),
        currentTargetKcal: 1200,
        body: { ...BODY, sex: "male" },
      }),
    ).toMatchObject({ outcome: "declined", reason: "below_floor" });
  });
});

describe("property: no proposal violates floor, caps, step size or BMI gate", () => {
  test("for any input", () => {
    let seed = 80;
    const random = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const pick = <T>(values: readonly T[]): T => values[Math.floor(random() * values.length)]!;
    let deficits = 0;
    for (let i = 0; i < 20_000; i += 1) {
      const estimateKcal = Math.round(800 + random() * 5500);
      const currentTargetKcal = random() < 0.3 ? null : Math.round(600 + random() * 4500);
      const age = random() < 0.2 ? null : Math.round(18 + random() * 70);
      const body: ProposalBody = {
        weightKg: random() < 0.15 ? null : 35 + random() * 120,
        heightCm: random() < 0.15 ? null : 140 + random() * 60,
        sex: pick(["female", "male", null] as const),
        minAge: age,
        maxAge: age === null ? null : age + 1,
      };
      const declarations = NUTRITION_DECLARATIONS.filter(() => random() < 0.05);
      const adultConfirmed = random() < 0.95;
      const direction = pick(ENERGY_DIRECTIONS);
      const safety = evaluateNutritionSafety({
        adultConfirmed,
        minAge: body.minAge,
        maxAge: body.maxAge,
        declarations,
        hideNumbers: false,
      });
      const result = planEnergyProposal({
        estimate: estimated(estimateKcal),
        adultConfirmed,
        currentTargetKcal,
        lastAcceptedAt: null,
        now: NOW,
        direction,
        safety,
        body,
      });
      if (result.outcome !== "proposal") continue;
      const target = result.targetKcal;

      expect(adultConfirmed).toBe(true);
      expect(safety.energySuggestions).toBe("available");
      expect(target).toBeGreaterThanOrEqual(P.neverBelowKcal);
      expect(target).toBeGreaterThanOrEqual(
        calorieFloorKcal({ sex: body.sex, restingKcal: estimateRestingKcal(body) }),
      );
      if (!result.stepLimited) expect(target % P.targetPrecisionKcal).toBe(0);
      expect(isSafeTarget(target, result.kind, estimateKcal, body)).toBe(true);
      expect(result.kind).toBe(
        direction === "lose" ? "deficit" : direction === "gain" ? "gain" : "maintenance",
      );

      if (target < estimateKcal) {
        deficits += 1;
        expect(
          declarations.some((d) => (NUTRITION_EXCLUSIONS as readonly string[]).includes(d)),
        ).toBe(false);
        const deficit = estimateKcal - target;
        expect(deficit).toBeLessThanOrEqual(P.deficit.hardMaxKcal);
        expect(deficit).toBeLessThanOrEqual(P.deficit.hardMaxFractionOfEstimate * estimateKcal);
        const weeklyLoss = (Math.max(0, deficit) * 7) / P.energyDensityKcalPerKg / body.weightKg!;
        const older = body.maxAge !== null && body.maxAge >= P.olderAdult.fromAge;
        expect(weeklyLoss).toBeLessThanOrEqual(
          (older ? P.olderAdult.maxWeeklyLossFraction : P.deficit.hardMaxWeeklyLossFraction) + 1e-9,
        );
        expect(target).toBeGreaterThanOrEqual(
          calorieFloorKcal({ sex: body.sex, restingKcal: estimateRestingKcal(body) }),
        );
        expect(bmiOf(body.weightKg!, body.heightCm!)).toBeGreaterThanOrEqual(
          P.bmi.underweightBelow,
        );
        expect(safety.reductionSuggestions).toBe("available");
      }
      if (target > estimateKcal)
        expect(target - estimateKcal).toBeLessThanOrEqual(maxSurplusKcal(estimateKcal, body));

      if (currentTargetKcal !== null) {
        const step = Math.min(P.step.maxKcal, P.step.maxFraction * currentTargetKcal);
        const moved = Math.abs(target - currentTargetKcal);
        expect(moved).toBeLessThanOrEqual(step);
      }
    }
    // The generator must actually exercise reductions.
    expect(deficits).toBeGreaterThan(500);
  });
});

describe("checkProposalAcceptable", () => {
  const proposal = {
    status: "pending",
    kind: "deficit",
    targetKcal: 2000,
    currentTargetKcal: null,
    expiresAt: new Date(NOW.getTime() + 86_400_000),
  };
  const check = (overrides: Partial<Parameters<typeof checkProposalAcceptable>[0]> = {}) =>
    checkProposalAcceptable({
      proposal,
      adultConfirmed: true,
      currentTargetKcal: null,
      now: NOW,
      safety: safetyFor(),
      ...overrides,
    });

  test("a newly declared exclusion blocks accepting a pending reduction", () => {
    expect(check()).toEqual({ ok: true });
    expect(check({ safety: safetyFor(["chronic_kidney_disease"]) })).toEqual({
      ok: false,
      reason: "not_suggested_for_profile",
    });
    expect(check({ safety: safetyFor(["eating_disorder"]) })).toEqual({
      ok: false,
      reason: "suggestions_off",
    });
  });

  test("soft gates need an explicit confirmation", () => {
    const safety = safetyFor(["glp1_medication"]);
    expect(check({ safety })).toEqual({ ok: false, reason: "needs_confirmation" });
    expect(check({ safety, confirmed: true })).toEqual({ ok: true });
  });
});

describe("helplines", () => {
  test("every region renders at least one verified helpline, plus the directory", () => {
    for (const region of ["us", "uk", "pt", null] as const) {
      const lines = helplinesFor(region);
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.at(-1)).toEqual(NUTRITION_HELPLINES.fallback);
      for (const line of lines) expect(line.verifiedAt).not.toBeNull();
    }
    expect(helplinesFor("uk").map((line) => line.phone)).toContain("0808 801 0677");
    expect(helplinesFor("us").map((line) => line.phone)).toContain("866-662-1235");
  });

  test("verified dates are within the 6-month review window of the policy date", () => {
    const all = [
      ...Object.values(NUTRITION_HELPLINES.byRegion).flat(),
      NUTRITION_HELPLINES.fallback,
    ];
    for (const line of all) {
      if (line.verifiedAt === null) continue;
      const months =
        (Date.parse(P.effectiveFrom) - Date.parse(line.verifiedAt)) / (30.44 * 86_400_000);
      expect(months).toBeLessThanOrEqual(NUTRITION_HELPLINES.reviewEveryMonths);
    }
  });
});

describe("copy lint", () => {
  test("the lint catches banned words", () => {
    expect(findBannedCopy("A cheat day you earned")).toEqual(["cheat", "earned"]);
    expect(findBannedCopy("Guilt-free and good")).toEqual(["Guilt", "good"]);
    expect(findBannedCopy("Logged 3 entries")).toEqual([]);
  });

  test("no safety, decline or proposal copy uses banned words, floors or body values", () => {
    const strings = [
      ...Object.values(NUTRITION_SAFETY_COPY),
      ...Object.values(DECLARATION_LABELS),
      ...Object.values(PROPOSAL_DECLINE_COPY),
      ...Object.values(PROPOSAL_COPY),
    ];
    for (const text of strings) {
      expect(findBannedCopy(text)).toEqual([]);
      expect(text).not.toMatch(/\b(1,?200|1,?500|BMI|18\.5|kg)\b/);
    }
  });

  test("the eating-disorder disclosure is the agreed text", () => {
    expect(NUTRITION_SAFETY_COPY.eatingDisorderDisclosure).toBe(
      "Thanks for telling us. We've turned off calorie targets and weight-change suggestions. You can still log anything you like, or nothing at all, and you can change this in Settings. If things feel hard right now, talking to someone can help:",
    );
  });
});
