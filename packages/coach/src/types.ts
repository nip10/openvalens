/**
 * Coach — public type surface (Issue #19).
 *
 * Mirrors the OpenValens tables in `packages/db/src/schema/coach.ts`:
 *
 * - `coachProfile`     — org-scoped profile (tone, assertiveness,
 *   riskTolerance, medicalDisclaimerMode, selectedTemplateKey).
 * - `coachTemplate`    — global catalog (no org). The "anchovy-compatible"
 *   preset list (`cut` / `recovery` / `performance` / `maintenance`)
 *   ships as the initial seed and is the source of truth at runtime.
 * - `aiFeedback`       — org-scoped feedback rows written by AI chat.
 * - `insight`          — org-scoped insight rows. The coach router
 *   exposes read-only listings — generation is owned by #13.
 *
 * No PHI is included in the type surface. `notes` (insight body,
 * feedback comment) round-trip as opaque strings the caller owns.
 * Logs never carry them.
 */

export type CoachTone = "strict" | "balanced" | "supportive";

export type CoachRiskTolerance = "conservative" | "moderate" | "aggressive";

export type CoachDisclaimerMode = "always" | "contextual";

export type CoachTemplateId = "cut" | "recovery" | "performance" | "maintenance";

export type InstructionPreset = {
  objective: string;
  directives: string[];
  outputStyle: string;
};

export type CoachTemplate = {
  key: CoachTemplateId;
  title: string;
  description: string;
  instructionPreset: InstructionPreset;
  isActive: boolean;
};

export type CoachProfile = {
  id: number;
  organizationId: string;
  tone: CoachTone;
  assertiveness: number;
  riskTolerance: CoachRiskTolerance;
  medicalDisclaimerMode: CoachDisclaimerMode;
  selectedTemplateKey: CoachTemplateId;
  updatedAt: string;
};

export type ResolvedCoachConfig = {
  profile: CoachProfile;
  templates: CoachTemplate[];
  selectedTemplate: CoachTemplate;
};

export type AiFeedback = {
  id: number;
  organizationId: string;
  source: "insight" | "chat";
  referenceId: number | null;
  rating: "up" | "down";
  comment: string | null;
  createdAt: string;
};

export type Insight = {
  id: number;
  organizationId: string;
  type: "trend" | "flag" | "recommendation";
  severity: "info" | "warning" | "critical" | null;
  title: string;
  body: string | null;
  createdAt: string;
};

export const COACH_TONES: ReadonlyArray<CoachTone> = ["strict", "balanced", "supportive"];
export const COACH_RISK_TOLERANCES: ReadonlyArray<CoachRiskTolerance> = [
  "conservative",
  "moderate",
  "aggressive",
];
export const COACH_DISCLAIMER_MODES: ReadonlyArray<CoachDisclaimerMode> = ["always", "contextual"];
export const COACH_TEMPLATE_IDS: ReadonlyArray<CoachTemplateId> = [
  "cut",
  "recovery",
  "performance",
  "maintenance",
];

export function isCoachTone(value: string): value is CoachTone {
  return (COACH_TONES as ReadonlyArray<string>).includes(value);
}

export function isCoachRiskTolerance(value: string): value is CoachRiskTolerance {
  return (COACH_RISK_TOLERANCES as ReadonlyArray<string>).includes(value);
}

export function isCoachDisclaimerMode(value: string): value is CoachDisclaimerMode {
  return (COACH_DISCLAIMER_MODES as ReadonlyArray<string>).includes(value);
}

export function isCoachTemplateId(value: string): value is CoachTemplateId {
  return (COACH_TEMPLATE_IDS as ReadonlyArray<string>).includes(value);
}
