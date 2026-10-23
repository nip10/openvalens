/**
 * Coach settings presentation shared by web and mobile. Maps the closed enums
 * on `CoachProfile` to sentence-case labels for display, as message
 * descriptors the apps render with Lingui (#67). Not reachable from server
 * code (see server-safe.test.ts).
 */
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";

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

const TONE_LABELS: Record<CoachTone, MessageDescriptor> = {
  strict: msg`Strict`,
  balanced: msg`Balanced`,
  supportive: msg`Supportive`,
};

const RISK_LABELS: Record<CoachRiskTolerance, MessageDescriptor> = {
  conservative: msg`Conservative`,
  moderate: msg`Moderate`,
  aggressive: msg`Aggressive`,
};

const DISCLAIMER_LABELS: Record<CoachDisclaimerMode, MessageDescriptor> = {
  always: msg({ message: "Always", comment: "safety" }),
  contextual: msg({ message: "Only when relevant", comment: "safety" }),
};

const TEMPLATE_LABELS: Record<CoachTemplateId, MessageDescriptor> = {
  cut: msg`Cut`,
  recovery: msg`Recovery`,
  performance: msg`Performance`,
  maintenance: msg`Maintenance`,
};

const TONE_DESCRIPTIONS: Record<CoachTone, MessageDescriptor> = {
  strict: msg`Holds the line on targets and habits.`,
  balanced: msg`Steady but flexible, weighs context.`,
  supportive: msg`Encouraging, focused on consistency.`,
};

const RISK_DESCRIPTIONS: Record<CoachRiskTolerance, MessageDescriptor> = {
  conservative: msg`Plays it safe; avoids pushing limits.`,
  moderate: msg`Balances reward and caution.`,
  aggressive: msg`Maximises upside, accepts setbacks.`,
};

const TEMPLATE_DESCRIPTIONS: Record<CoachTemplateId, MessageDescriptor> = {
  cut: msg`Caloric deficit, fat-loss focus.`,
  recovery: msg`Deload, sleep, and stress priority.`,
  performance: msg`Output and training readiness.`,
  maintenance: msg`Hold current weight and habits.`,
};

/** An unrecognised stored value, shown as is. */
function asIs(value: string): MessageDescriptor {
  return msg({ message: `${value}`, comment: "An unrecognised setting value, shown as is" });
}

export function toneLabel(value: string): MessageDescriptor {
  return TONE_LABELS[value as CoachTone] ?? asIs(value);
}
export function toneDescription(value: string): MessageDescriptor | null {
  return TONE_DESCRIPTIONS[value as CoachTone] ?? null;
}
export function riskLabel(value: string): MessageDescriptor {
  return RISK_LABELS[value as CoachRiskTolerance] ?? asIs(value);
}
export function riskDescription(value: string): MessageDescriptor | null {
  return RISK_DESCRIPTIONS[value as CoachRiskTolerance] ?? null;
}
export function disclaimerLabel(value: string): MessageDescriptor {
  return DISCLAIMER_LABELS[value as CoachDisclaimerMode] ?? asIs(value);
}
export function templateLabel(value: string): MessageDescriptor {
  return TEMPLATE_LABELS[value as CoachTemplateId] ?? asIs(value);
}
export function templateDescription(value: string): MessageDescriptor | null {
  return TEMPLATE_DESCRIPTIONS[value as CoachTemplateId] ?? null;
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
export function assertivenessLabel(value: number): MessageDescriptor {
  if (value <= 1) return msg`Very gentle`;
  if (value === 2) return msg`Gentle`;
  if (value === 3) return msg`Direct`;
  if (value === 4) return msg`Forceful`;
  return msg`Very forceful`;
}
