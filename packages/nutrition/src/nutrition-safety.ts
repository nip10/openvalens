/**
 * Nutrition safety policy `nutrition-safety/v1` (Issue #80). Pure and
 * client-safe: no database or server import, so web and native can share the
 * copy, the exclusion list and the helplines.
 *
 * This is general wellness, not therapeutic diet planning, and the policy is
 * not clinically validated. No clinician reviews it; the values come from
 * published guidelines and trials (see {@link NUTRITION_SAFETY_SOURCES}) and
 * a few documented product choices. They live in one frozen, versioned
 * config: changing any value is a reviewed change that bumps `version` and
 * adds a `changelog` entry (docs/nutrition-targets.md mirrors it, and a test
 * keeps the two aligned).
 *
 * What the policy guarantees:
 * - New members get maintain behaviour; nothing ever sets or lowers a target
 *   on its own. Targets are entered by the member or accepted from a proposal.
 * - A proposal is never below 1,200 kcal/day, never below the member's
 *   floor, never a deficit larger than the caps, never a step larger than the
 *   weekly step (unless the step would itself be unsafe), and never a deficit
 *   for anyone under the BMI gate or with a self-declared exclusion.
 * - Exclusions are self-declared yes/no answers. They are never inferred and
 *   nothing here diagnoses anything. Logging always stays available.
 */

/** Self-declared answers that turn off deficit (reduction) proposals. */
export const NUTRITION_EXCLUSIONS = [
  "pregnant_or_breastfeeding",
  "eating_disorder",
  "glucose_lowering_medication",
  "chronic_kidney_disease",
  "cancer_treatment",
  "bariatric_surgery",
  "refeeding_syndrome",
] as const;
export type NutritionExclusion = (typeof NUTRITION_EXCLUSIONS)[number];

/** Self-declared answers that keep reductions available but need an extra confirmation. */
export const NUTRITION_SOFT_GATES = ["glp1_medication"] as const;
export type NutritionSoftGateDeclaration = (typeof NUTRITION_SOFT_GATES)[number];

/** Every yes/no declaration a member can make, in display order. */
export const NUTRITION_DECLARATIONS = [...NUTRITION_EXCLUSIONS, ...NUTRITION_SOFT_GATES] as const;
export type NutritionDeclaration = (typeof NUTRITION_DECLARATIONS)[number];

/** Which way the member wants energy suggestions to go. Default: maintain. */
export const ENERGY_DIRECTIONS = ["maintain", "lose", "gain"] as const;
export type EnergyDirection = (typeof ENERGY_DIRECTIONS)[number];

export const NUTRITION_SAFETY_POLICY = Object.freeze({
  version: "nutrition-safety/v1" as const,
  effectiveFrom: "2026-10-16",
  /** New members: maintain, never an automated deficit. */
  defaultDirection: "maintain" as EnergyDirection,
  /** Never propose a target below this, under any setting (kcal/day). NICE NG246. */
  neverBelowKcal: 1200,
  /** Lower bounds by declared sex; not declared uses the higher value (product choice). */
  sexFloorKcal: Object.freeze({ female: 1200, male: 1500, undeclared: 1500 }),
  /** kcal per kg of body-weight change (the 3,500 kcal/lb approximation; Hall 2008). */
  energyDensityKcalPerKg: 7700,
  deficit: Object.freeze({
    /** Default deficit: the smallest of these (AHA 500 kcal/d; Garthe 2011 ~19%). */
    defaultMaxKcal: 500,
    defaultMaxFractionOfEstimate: 0.2,
    defaultMaxWeeklyLossFraction: 0.007,
    /** Hard caps: no deficit proposal exceeds any of these (AHA 750 kcal/d; Helms 2014). */
    hardMaxKcal: 750,
    hardMaxFractionOfEstimate: 0.25,
    hardMaxWeeklyLossFraction: 0.01,
  }),
  gain: Object.freeze({
    /** Surplus capped at 10% of the estimate (recorded product/legal decision). */
    minFractionOfEstimate: 0.1,
    maxFractionOfEstimate: 0.2,
    aimFractionOfEstimate: 0.1,
    /** Gain is capped at 0.5% of body weight per week when a weight is known. */
    maxWeeklyGainFraction: 0.005,
  }),
  step: Object.freeze({
    /** Each change moves the target by at most min(maxKcal, maxFraction × current). */
    maxKcal: 200,
    maxFraction: 0.1,
    /** Days after an accepted change before the next proposal. */
    minDaysBetweenChanges: 7,
  }),
  bmi: Object.freeze({
    /** No reduction if current BMI is below this (WHO underweight cut-off). */
    underweightBelow: 18.5,
  }),
  olderAdult: Object.freeze({
    /** Soft gate from this age: extra confirmation, slower loss, more protein. */
    fromAge: 65,
    maxWeeklyLossFraction: 0.005,
  }),
  protein: Object.freeze({
    /** g per kg body weight (NASEM/EFSA reference intakes; PROT-AGE 2013; KDIGO 2024). */
    defaultGPerKg: 0.8,
    activeGPerKg: Object.freeze({ min: 1.2, max: 1.6 }),
    olderAdultMinGPerKg: 1.0,
    kidneyMaxGPerKg: 0.8,
    precisionG: 5,
  }),
  /** Proposed targets are rounded to this step (kcal/day). */
  targetPrecisionKcal: 50,
  /** Smaller differences are not worth a proposal (kcal/day). */
  minChangeKcal: 50,
  /** Days a pending proposal stays valid. */
  validForDays: 7,
  changelog: Object.freeze([
    Object.freeze({
      version: "nutrition-safety/v1",
      date: "2026-10-16",
      change:
        "First version: floors, deficit and gain caps, weekly step, BMI gate, self-declared exclusions and protein reference (Issue #80). Replaces energy-proposal/v1.",
    }),
  ]),
});

export type NutritionSafetyPolicy = typeof NUTRITION_SAFETY_POLICY;

/** Where each value comes from. Sourced assessment, not clinical advice. */
export const NUTRITION_SAFETY_SOURCES = Object.freeze([
  {
    id: "aha-acc-tos-2013",
    covers: "Sex floors (1,200 / 1,500 kcal/d) and 500–750 kcal/d deficits",
    citation:
      "Jensen MD et al. 2013 AHA/ACC/TOS Guideline for the Management of Overweight and Obesity in Adults. Circulation 2014;129(25 Suppl 2):S102-38.",
  },
  {
    id: "nice-ng246",
    covers: "Never propose below 1,200 kcal/d",
    citation:
      "NICE guideline NG246 (2025), Overweight and obesity management: low-energy (800–1,200 kcal) diets belong to specialist services.",
  },
  {
    id: "garthe-2011",
    covers: "Default deficit ≤ 20% of the estimate",
    citation:
      "Garthe I et al. Effect of two different weight-loss rates on body composition and strength. Int J Sport Nutr Exerc Metab 2011;21(2):97-104.",
  },
  {
    id: "helms-2014",
    covers: "Loss ≤ 1.0% of body weight per week",
    citation:
      "Helms ER et al. Evidence-based recommendations for natural bodybuilding contest preparation. J Int Soc Sports Nutr 2014;11:20.",
  },
  {
    id: "iraki-2019",
    covers: "Gain +10–20% of the estimate, 0.25–0.5% of body weight per week",
    citation:
      "Iraki J et al. Nutrition Recommendations for Bodybuilders in the Off-Season. Sports (Basel) 2019;7(7):154.",
  },
  {
    id: "who-bmi",
    covers: "BMI gate below 18.5",
    citation: "WHO. Body mass index (BMI) classification: underweight < 18.5 kg/m².",
  },
  {
    id: "protein-references",
    covers: "Protein 0.8 g/kg default, 1.0–1.2 g/kg at 65+, ≤ 0.8 g/kg with CKD",
    citation:
      "NASEM Dietary Reference Intakes; EFSA DRV for protein (2012); Bauer J et al. PROT-AGE 2013; KDIGO 2024 CKD guideline 3.3.1.1.",
  },
  {
    id: "mifflin-st-jeor-1990",
    covers: "Estimated resting expenditure used in the floor",
    citation:
      "Mifflin MD, St Jeor ST et al. A new predictive equation for resting energy expenditure in healthy individuals. Am J Clin Nutr 1990;51(2):241-7.",
  },
  {
    id: "aap-2016",
    covers: "Under 18 excluded",
    citation:
      "Golden NH et al. Preventing Obesity and Eating Disorders in Adolescents. Pediatrics 2016;138(3):e20161649.",
  },
  {
    id: "ada-standards",
    covers: "Insulin, sulfonylureas or meglitinides excluded (hypoglycaemia risk)",
    citation: "American Diabetes Association. Standards of Care in Diabetes.",
  },
]);

// ─── Pure helpers ──────────────────────────────────────────────

export type DeclaredSex = "female" | "male" | null;

function ceilTo(value: number, step: number): number {
  return Math.ceil(value / step) * step;
}

/**
 * Estimated resting expenditure (Mifflin–St Jeor), or `null` when weight,
 * height or age is not known. Undeclared sex uses the male constant and an
 * age range uses its youngest age: both give the higher (more conservative)
 * floor.
 */
export function estimateRestingKcal(input: {
  weightKg: number | null;
  heightCm: number | null;
  minAge: number | null;
  sex: DeclaredSex;
}): number | null {
  const { weightKg, heightCm, minAge, sex } = input;
  if (weightKg === null || heightCm === null || minAge === null) return null;
  if (!(weightKg > 0) || !(heightCm > 0) || !(minAge > 0)) return null;
  return 10 * weightKg + 6.25 * heightCm - 5 * minAge + (sex === "female" ? -161 : 5);
}

/** The member's calorie floor: max(1,200, sex floor, estimated resting expenditure), kcal/day. */
export function calorieFloorKcal(
  input: { sex: DeclaredSex; restingKcal: number | null },
  policy: NutritionSafetyPolicy = NUTRITION_SAFETY_POLICY,
): number {
  const sexFloor = policy.sexFloorKcal[input.sex ?? "undeclared"];
  const floor = Math.max(policy.neverBelowKcal, sexFloor, input.restingKcal ?? 0);
  return ceilTo(floor, policy.targetPrecisionKcal);
}

/** kcal/day that corresponds to losing or gaining `fraction` of `weightKg` per week. */
export function kcalPerDayForWeeklyFraction(
  weightKg: number,
  fraction: number,
  policy: NutritionSafetyPolicy = NUTRITION_SAFETY_POLICY,
): number {
  return (weightKg * fraction * policy.energyDensityKcalPerKg) / 7;
}

export function bmiOf(weightKg: number, heightCm: number): number {
  const metres = heightCm / 100;
  return weightKg / (metres * metres);
}

export type NutritionSafetyInput = {
  /** Confirmed 18+ in the wellness profile (#98). Anything else counts as under 18. */
  adultConfirmed: boolean;
  /** Youngest possible age from the profile birth year, or `null` when not shared. */
  minAge: number | null;
  /** Oldest possible age, used for the 65+ soft gate (an ambiguous year counts). */
  maxAge: number | null;
  declarations: readonly NutritionDeclaration[];
  hideNumbers: boolean;
};

export type NutritionSoftGate = "older_adult" | "glp1_medication";

export type NutritionSafety = {
  policyVersion: NutritionSafetyPolicy["version"];
  /** Off after an eating-disorder declaration: no energy targets shown or set. */
  energyTargets: "available" | "off";
  /** Any energy proposal (maintain/gain/lose). Off for under 18 and after an eating-disorder declaration. */
  energySuggestions: "available" | "off";
  /** Reduction proposals. Off for any exclusion. */
  reductionSuggestions: "available" | "off";
  /** Reductions that need an extra confirmation before they are accepted. */
  softGates: NutritionSoftGate[];
  /** Streak surfaces (#90): hidden in hide-numbers mode and for any exclusion. */
  streaks: "available" | "hidden";
  /** True when CKD caps the protein reference. */
  proteinCapped: boolean;
};

/** Applies the declarations and profile to the policy. Never infers a declaration. */
export function evaluateNutritionSafety(input: NutritionSafetyInput): NutritionSafety {
  const declared = new Set(input.declarations);
  const anyExclusion = NUTRITION_EXCLUSIONS.some((key) => declared.has(key));
  const eatingDisorder = declared.has("eating_disorder");
  const softGates: NutritionSoftGate[] = [];
  if (input.maxAge !== null && input.maxAge >= NUTRITION_SAFETY_POLICY.olderAdult.fromAge)
    softGates.push("older_adult");
  if (declared.has("glp1_medication")) softGates.push("glp1_medication");
  const suggestions = input.adultConfirmed && !eatingDisorder;
  return {
    policyVersion: NUTRITION_SAFETY_POLICY.version,
    energyTargets: eatingDisorder ? "off" : "available",
    energySuggestions: suggestions ? "available" : "off",
    reductionSuggestions: suggestions && !anyExclusion ? "available" : "off",
    softGates,
    streaks: input.hideNumbers || anyExclusion || !input.adultConfirmed ? "hidden" : "available",
    proteinCapped: declared.has("chronic_kidney_disease"),
  };
}

export type ProteinReference = {
  minGPerKg: number;
  maxGPerKg: number;
  minG: number;
  maxG: number;
  basis: "default" | "active" | "older_adult" | "kidney_cap";
};

/**
 * Protein reference range from body weight: 0.8 g/kg by default, 1.2–1.6 g/kg
 * only when the member opted in as active, at least 1.0 g/kg at 65+, and
 * capped at 0.8 g/kg with a CKD declaration. `null` without a weight or for
 * anyone not confirmed adult. A reference, never set as a target by itself.
 */
export function proteinReference(
  input: {
    weightKg: number | null;
    adultConfirmed: boolean;
    maxAge: number | null;
    active: boolean;
    kidneyCap: boolean;
  },
  policy: NutritionSafetyPolicy = NUTRITION_SAFETY_POLICY,
): ProteinReference | null {
  if (!input.adultConfirmed || input.weightKg === null || !(input.weightKg > 0)) return null;
  const p = policy.protein;
  let min: number = input.active ? p.activeGPerKg.min : p.defaultGPerKg;
  let max: number = input.active ? p.activeGPerKg.max : p.defaultGPerKg;
  let basis: ProteinReference["basis"] = input.active ? "active" : "default";
  if (input.maxAge !== null && input.maxAge >= policy.olderAdult.fromAge) {
    if (min < p.olderAdultMinGPerKg) basis = "older_adult";
    min = Math.max(min, p.olderAdultMinGPerKg);
    max = Math.max(max, p.olderAdultMinGPerKg);
  }
  if (input.kidneyCap) {
    min = Math.min(min, p.kidneyMaxGPerKg);
    max = Math.min(max, p.kidneyMaxGPerKg);
    basis = "kidney_cap";
  }
  const minUnrounded = min * input.weightKg;
  const maxUnrounded = max * input.weightKg;
  const preserveLowerBound = basis === "older_adult" || min < max;
  const nearestG = Math.round(minUnrounded / p.precisionG) * p.precisionG;
  const minG = input.kidneyCap
    ? Math.floor(minUnrounded / p.precisionG) * p.precisionG
    : preserveLowerBound
      ? Math.ceil(minUnrounded / p.precisionG) * p.precisionG
      : nearestG;
  const maxG = preserveLowerBound ? Math.floor(maxUnrounded / p.precisionG) * p.precisionG : minG;
  return { minGPerKg: min, maxGPerKg: max, minG, maxG, basis };
}

// ─── Helplines (versioned, re-checked every 6 months) ──────────

export type HelplineRegion = "us" | "uk" | "pt";

export type Helpline = {
  name: string;
  /** Phone number as shown by the service, or `null` for a web directory. */
  phone: string | null;
  detail: string | null;
  url: string;
  /** Date the number was checked against the service's own page; `null` = not verified, never shown. */
  verifiedAt: string | null;
};

/**
 * Eating-disorder support lines by profile region. Only entries with a
 * `verifiedAt` are shown; anything unverified falls back to the directory.
 * Re-check every `reviewEveryMonths`; changing a number bumps `version`.
 */
export const NUTRITION_HELPLINES = Object.freeze({
  version: "helplines/v1" as const,
  reviewEveryMonths: 6,
  byRegion: Object.freeze({
    uk: [
      {
        name: "Beat Helpline (England)",
        phone: "0808 801 0677",
        detail: null,
        url: "https://www.beateatingdisorders.org.uk/get-information-and-support/get-help-for-myself/i-need-support-now/helplines/",
        verifiedAt: "2026-10-16",
      },
      {
        name: "Beat Helpline (Scotland)",
        phone: "0808 801 0432",
        detail: null,
        url: "https://www.beateatingdisorders.org.uk/get-information-and-support/get-help-for-myself/i-need-support-now/helplines/",
        verifiedAt: "2026-10-16",
      },
      {
        name: "Beat Helpline (Wales)",
        phone: "0808 801 0433",
        detail: null,
        url: "https://www.beateatingdisorders.org.uk/get-information-and-support/get-help-for-myself/i-need-support-now/helplines/",
        verifiedAt: "2026-10-16",
      },
      {
        name: "Beat Helpline (Northern Ireland)",
        phone: "0808 801 0434",
        detail: null,
        url: "https://www.beateatingdisorders.org.uk/get-information-and-support/get-help-for-myself/i-need-support-now/helplines/",
        verifiedAt: "2026-10-16",
      },
    ],
    us: [
      {
        name: "National Alliance for Eating Disorders",
        phone: "866-662-1235",
        detail: null,
        url: "https://www.allianceforeatingdisorders.com/",
        verifiedAt: "2026-10-16",
      },
      {
        name: "ANAD Helpline",
        phone: "1-888-375-7767",
        detail: null,
        url: "https://www.anad.org/get-help/",
        verifiedAt: "2026-10-16",
      },
    ],
    pt: [
      {
        name: "SNS 24",
        phone: "808 24 24 24",
        detail: "Option 4",
        url: "https://www.sns24.gov.pt/",
        // Not yet checked against the service's own page: hidden until verified.
        verifiedAt: null,
      },
    ],
  } satisfies Record<HelplineRegion, Helpline[]>),
  fallback: Object.freeze({
    name: "Find A Helpline",
    phone: null,
    detail: "Free, confidential helplines by country",
    url: "https://findahelpline.com",
    verifiedAt: "2026-10-16",
  } satisfies Helpline),
});

/**
 * The verified helplines for a region, always at least one entry: the
 * directory is appended for every region and is the only entry when the
 * region is unknown or has no verified number.
 */
export function helplinesFor(region: HelplineRegion | null): Helpline[] {
  const listed = region ? NUTRITION_HELPLINES.byRegion[region] : [];
  return [...listed.filter((line) => line.verifiedAt !== null), NUTRITION_HELPLINES.fallback];
}

// ─── Copy ──────────────────────────────────────────────────────

/** Yes/no questions; person-first, no details asked. */
export const DECLARATION_LABELS: Readonly<Record<NutritionDeclaration, string>> = Object.freeze({
  pregnant_or_breastfeeding: "I am pregnant or breastfeeding",
  eating_disorder: "I have or have had an eating disorder",
  glucose_lowering_medication: "I take insulin, a sulfonylurea or a meglitinide",
  chronic_kidney_disease: "I have chronic kidney disease",
  cancer_treatment: "I am having cancer treatment",
  bariatric_surgery: "I have had bariatric surgery",
  refeeding_syndrome: "I have had refeeding syndrome",
  glp1_medication: "I take a GLP-1 or GIP medication",
});

export const NUTRITION_SAFETY_COPY = Object.freeze({
  /** Shown once, right after an eating-disorder declaration, followed by helplines. */
  eatingDisorderDisclosure:
    "Thanks for telling us. We've turned off calorie targets and weight-change suggestions. You can still log anything you like, or nothing at all, and you can change this in Settings. If things feel hard right now, talking to someone can help:",
  energyTargetsOff: "Calorie targets and weight-change suggestions are turned off.",
  reductionsOff: "We don't suggest reductions for this profile.",
  suggestionsOff: "We don't make energy suggestions for this profile.",
  declarationsIntro:
    "Answer only what you want to. Any yes turns off reduction suggestions; logging always stays available.",
  softGateConfirm:
    "This suggestion lowers your energy target. Confirm you want to review it with that in mind.",
  notClinical:
    "These safeguards come from published guidelines. They are not medical advice and have not been clinically validated.",
  clearEatingDisorderConfirm:
    "Turn calorie targets and suggestions back on. This removes your eating disorder answer.",
});

/**
 * Words the nutrition surfaces never use: moral food words, pressure and
 * verdicts. Shared so every copy test lints the same list.
 */
export const NUTRITION_BANNED_COPY =
  /\b(good|bad|healthy|unhealthy|junk|clean|cheat\w*|guilt\w*|sin\w*|naughty|earn\w*|deserve\w*|over|under|exceed\w*|too much|missed|fail\w*|warning|danger\w*|violat\w*|budget|allowance|burn it off|great job|well done|congrat\w*|on track|off track)\b/i;

/** Returns the banned words found in `text` (empty when clean). Tests use it as the copy lint. */
export function findBannedCopy(text: string): string[] {
  const global = new RegExp(NUTRITION_BANNED_COPY.source, "gi");
  return [...text.matchAll(global)].map((match) => match[0]);
}
