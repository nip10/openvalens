import type { CoachTemplate, CoachTemplateId } from "./types";

/**
 * Default profile — used when the org has no row yet, or when stored
 * fields fail validation. Mirrors `anchovy/.../lib/coach/defaults.ts`
 * `GLOBAL_COACH_PROFILE_DEFAULTS`.
 */
export const GLOBAL_COACH_PROFILE_DEFAULTS = {
  tone: "balanced" as const,
  assertiveness: 3,
  riskTolerance: "moderate" as const,
  medicalDisclaimerMode: "always" as const,
  selectedTemplateKey: "cut" as CoachTemplateId,
};

/**
 * Canonical coach template list (Issue #19).
 *
 * These are the seeds the runtime `coachTemplate` rows are reconciled
 * against. The list is intentionally a closed union: `selectedTemplateKey`
 * must match one of {@link COACH_TEMPLATE_IDS}, and the seed set is what
 * the runtime catalog tracks until a future "template admin" lands.
 *
 * `validateTemplate()` runs every candidate through this set to make
 * sure no rogue template key bypasses the boundary.
 */
const TEMPLATE_MAP: Record<CoachTemplateId, CoachTemplate> = {
  cut: {
    key: "cut",
    title: "Fat Loss Cut",
    description: "Drive steady fat loss while preserving lean mass and adherence.",
    instructionPreset: {
      objective: "Drive sustainable fat loss while preserving muscle and recovery capacity.",
      directives: [
        "Prefer minimal effective changes over aggressive protocol churn.",
        "Prioritize adherence, protein adequacy, sleep quality, and training consistency.",
        "Flag any suggestion that increases injury or recovery risk when recent blood data is missing or out of range.",
      ],
      outputStyle: "Actionable weekly checklist with clear caution notes.",
    },
    isActive: true,
  },
  recovery: {
    key: "recovery",
    title: "Recovery and Return",
    description:
      "Stabilize baseline health markers before escalating training or protocol intensity.",
    instructionPreset: {
      objective: "Restore recovery and reduce physiological stress before progression.",
      directives: [
        "Favor conservative progression and symptom stabilization.",
        "Keep recommendations low-risk while key stress markers remain elevated.",
        "Use clear re-entry criteria before higher training loads.",
      ],
      outputStyle: "Conservative step-by-step recovery path with stop conditions.",
    },
    isActive: true,
  },
  performance: {
    key: "performance",
    title: "Performance Build",
    description: "Optimize training output while preserving safety and recovery.",
    instructionPreset: {
      objective: "Increase performance capacity through targeted, measurable adjustments.",
      directives: [
        "Prioritize training quality and bottleneck removal.",
        "Limit recommendations to top-impact changes each cycle.",
        "Preserve safety constraints from deterministic health state.",
      ],
      outputStyle: "Prioritized performance actions with expected impact.",
    },
    isActive: true,
  },
  maintenance: {
    key: "maintenance",
    title: "Maintenance",
    description: "Maintain outcomes with minimal cognitive and operational load.",
    instructionPreset: {
      objective: "Maintain current composition and biomarker stability with low friction.",
      directives: [
        "Recommend minimal effective actions.",
        "Avoid unnecessary complexity.",
        "Escalate only with sustained trend deterioration.",
      ],
      outputStyle: "Simple maintenance checklist with clear thresholds for escalation.",
    },
    isActive: true,
  },
};

export const COACH_TEMPLATES: ReadonlyArray<CoachTemplate> = Object.values(TEMPLATE_MAP);

/**
 * Returns the seed template for a given key, or `null` when the key is
 * not part of the closed union. Used by `validateTemplate()` to reject
 * unknown keys at the boundary.
 */
export function getSeedTemplate(key: string): CoachTemplate | null {
  if (!isKnownTemplateKey(key)) return null;
  return TEMPLATE_MAP[key];
}

function isKnownTemplateKey(value: string): value is CoachTemplateId {
  return (
    value === "cut" || value === "recovery" || value === "performance" || value === "maintenance"
  );
}
