/**
 * Coach settings presentation shared by web and mobile. Pure TypeScript,
 * no imports — safe for the app bundle. Maps the closed enums on
 * `CoachProfile` to sentence-case labels for display.
 */
export type CoachTone = "strict" | "balanced" | "supportive";
export type CoachRiskTolerance = "conservative" | "moderate" | "aggressive";
export type CoachDisclaimerMode = "always" | "contextual";
export type CoachTemplateId = "cut" | "recovery" | "performance" | "maintenance";

export type CoachProfileLike = {
  tone: CoachTone;
  assertiveness: number;
  riskTolerance: CoachRiskTolerance;
  medicalDisclaimerMode: CoachDisclaimerMode;
  selectedTemplateKey: CoachTemplateId;
};

const TONE_LABELS: Record<CoachTone, string> = {
  strict: "Strict",
  balanced: "Balanced",
  supportive: "Supportive",
};

const RISK_LABELS: Record<CoachRiskTolerance, string> = {
  conservative: "Conservative",
  moderate: "Moderate",
  aggressive: "Aggressive",
};

const DISCLAIMER_LABELS: Record<CoachDisclaimerMode, string> = {
  always: "Always",
  contextual: "Only when relevant",
};

const TEMPLATE_LABELS: Record<CoachTemplateId, string> = {
  cut: "Cut",
  recovery: "Recovery",
  performance: "Performance",
  maintenance: "Maintenance",
};

const TONE_DESCRIPTIONS: Record<CoachTone, string> = {
  strict: "Holds the line on targets and habits.",
  balanced: "Steady but flexible, weighs context.",
  supportive: "Encouraging, focused on consistency.",
};

const RISK_DESCRIPTIONS: Record<CoachRiskTolerance, string> = {
  conservative: "Plays it safe; avoids pushing limits.",
  moderate: "Balances reward and caution.",
  aggressive: "Maximises upside, accepts setbacks.",
};

const TEMPLATE_DESCRIPTIONS: Record<CoachTemplateId, string> = {
  cut: "Caloric deficit, fat-loss focus.",
  recovery: "Deload, sleep, and stress priority.",
  performance: "Output and training readiness.",
  maintenance: "Hold current weight and habits.",
};

export function toneLabel(value: string): string {
  return TONE_LABELS[value as CoachTone] ?? value;
}
export function toneDescription(value: string): string {
  return TONE_DESCRIPTIONS[value as CoachTone] ?? "";
}
export function riskLabel(value: string): string {
  return RISK_LABELS[value as CoachRiskTolerance] ?? value;
}
export function riskDescription(value: string): string {
  return RISK_DESCRIPTIONS[value as CoachRiskTolerance] ?? "";
}
export function disclaimerLabel(value: string): string {
  return DISCLAIMER_LABELS[value as CoachDisclaimerMode] ?? value;
}
export function templateLabel(value: string): string {
  return TEMPLATE_LABELS[value as CoachTemplateId] ?? value;
}
export function templateDescription(value: string): string {
  return TEMPLATE_DESCRIPTIONS[value as CoachTemplateId] ?? "";
}

export const COACH_TONE_VALUES: readonly CoachTone[] = ["strict", "balanced", "supportive"];
export const COACH_RISK_VALUES: readonly CoachRiskTolerance[] = [
  "conservative",
  "moderate",
  "aggressive",
];
export const COACH_DISCLAIMER_VALUES: readonly CoachDisclaimerMode[] = ["always", "contextual"];
export const COACH_TEMPLATE_VALUES: readonly CoachTemplateId[] = [
  "cut",
  "recovery",
  "performance",
  "maintenance",
];

/** "Assertiveness 3 of 5" / maps 1..5 to a plain words sentence. */
export function assertivenessLabel(value: number): string {
  if (value <= 1) return "Very gentle";
  if (value === 2) return "Gentle";
  if (value === 3) return "Direct";
  if (value === 4) return "Forceful";
  return "Very forceful";
}
