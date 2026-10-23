/**
 * Nutrition targets presentation shared by web and mobile (Issue #80). Pure
 * TypeScript; imports only zod-only contracts and the client-safe safety
 * policy module — safe for app bundles.
 *
 * Copy rules (CONTRIBUTING health-copy rules, docs/nutrition-targets.md):
 * targets are shown separately from what was logged, never compared with it:
 * no "over"/"under", no colours, no verdicts, no moral food words. Refusals
 * say what the app won't do, never a floor, BMI or weight. In hide-numbers
 * mode no intake or target number is shown anywhere.
 */
import { DECLARATION_LABELS, NUTRITION_SAFETY_COPY } from "@openvalens/nutrition/nutrition-safety";

import type { NutrientKey, NutrientTotal, NutrientValues } from "../contracts/nutrition-diary";
import type {
  Declaration,
  EnergyDirection,
  HelplineWire,
  NutritionTargetWire,
  TargetSource,
} from "../contracts/nutrition-targets";
import { MAX_TARGET_AMOUNT } from "../contracts/nutrition-targets";
import {
  NUTRIENT_LABELS,
  SUMMARY_NUTRIENTS,
  formatCoverage,
  formatNutrientValue,
  formatTotalValue,
} from "./nutrition-diary";

export { DECLARATION_LABELS, NUTRITION_SAFETY_COPY };

/** Nutrients a member can set a target for in the apps, in display order. */
export const TARGET_NUTRIENTS: readonly NutrientKey[] = [
  "energyKcal",
  "proteinG",
  "carbohydrateG",
  "fatG",
  "fiberG",
];

/** Shown in place of any number while hide-numbers mode is on. */
export const HIDDEN_VALUE = "Hidden";

/**
 * A food's summary nutrients on one line ("Energy 412 kcal · Protein 9 g · …"),
 * or {@link HIDDEN_VALUE} in hide-numbers mode. Every surface that lists a
 * food's values uses this, so none can show a number the mode hides (#88).
 */
export function formatNutrientSummaryLine(
  values: Pick<NutrientValues, (typeof SUMMARY_NUTRIENTS)[number]>,
  hideNumbers: boolean,
): string {
  if (hideNumbers) return HIDDEN_VALUE;
  return SUMMARY_NUTRIENTS.map(
    (key) => `${NUTRIENT_LABELS[key].label} ${formatNutrientValue(key, values[key])}`,
  ).join(" · ");
}

/** Unknown display preference must never default to exposing health numbers. */
export function resolveHideNumbers(serverPreference?: boolean, scopedOfflinePreference?: boolean) {
  return serverPreference ?? scopedOfflinePreference ?? true;
}

/** A temporary display choice is valid only for the identity scope that made it. */
export function resolveScopedHideNumbers(
  scope: string | null | undefined,
  override: { scope: string; value: boolean } | null,
  serverPreference?: boolean,
  scopedOfflinePreference?: boolean,
) {
  if (!scope) return true;
  if (override?.scope === scope) return override.value;
  return resolveHideNumbers(serverPreference, scopedOfflinePreference);
}

export const TARGET_COPY = Object.freeze({
  title: "Nutrition targets",
  settingsLink: "Targets and display",
  yourTargets: "Your targets",
  targetsNote:
    "Targets are yours to set, change or clear. They are shown next to what you logged, not compared with it.",
  noTargets: "No targets set. Logging works the same without them.",
  hideNumbers: "Hide numbers",
  hideNumbersDescription:
    "Hides energy, nutrient and target numbers in the diary. Logging still works, and you can turn this off at any time.",
  numbersHidden: "Numbers are hidden. Coverage is still shown.",
  directionTitle: "Suggestions",
  directionDescription:
    "Suggestions are based on your estimate and only change a target if you accept them.",
  setTarget: "Save target",
  clearTarget: "Clear target",
  minimum: "Minimum (optional)",
  maximum: "Maximum (optional)",
  effectiveFrom: "Applies from",
  saving: "Saving…",
  saved: "Target saved.",
  cleared: "Target cleared.",
  proteinReferenceTitle: "Protein reference",
  proteinReferenceNote:
    "A general reference from your recent weight, not a target. Enter a target yourself if you want one.",
  proteinReferenceUnavailable: "No recent weight for a reference yet.",
  activeProtein: "I train regularly and want the active reference",
  heightLabel: "Height (cm, optional)",
  heightDescription: "Used only for safeguards on reduction suggestions.",
  declarationsTitle: "About you",
  saveSettings: "Save",
  settingsSaved: "Settings saved.",
  conflict: "These settings changed on another device. The latest version is shown.",
  networkError: "Could not reach the server. Your saved targets are unchanged.",
  suggestionTitle: "Suggestion",
  askSuggestion: "Ask for a suggestion",
  accept: "Accept",
  dismiss: "Dismiss",
  confirmSuggestion: "I have read this and want to review the suggestion",
  accepted: "Suggestion accepted. Your target is updated.",
  dismissed: "Suggestion dismissed. Your target is unchanged.",
  helplinesTitle: "Support",
});

export const DIRECTION_LABELS: Readonly<
  Record<EnergyDirection, { label: string; description: string }>
> = Object.freeze({
  maintain: {
    label: "Maintain",
    description: "Suggestions follow the estimated intake that keeps your weight trend steady.",
  },
  lose: {
    label: "Reduce",
    description:
      "Suggestions are a small, capped reduction from the estimate, within safeguards. Some profiles get no reduction suggestions.",
  },
  gain: {
    label: "Increase",
    description: "Suggestions are a small, capped increase from the estimate.",
  },
});

export const TARGET_SOURCE_LABELS: Readonly<Record<TargetSource, string>> = Object.freeze({
  entered: "Entered by you",
  proposal: "Accepted suggestion",
});

function number(value: number, unit: string): string {
  const digits = unit === "kcal" || unit === "kJ" || unit === "mg" ? 0 : 1;
  return value.toLocaleString("en-US", { maximumFractionDigits: digits });
}

/** `"2,000 kcal"`, `"1,800–2,200 kcal"`, `"At least 55 g"`, `"Up to 2,300 mg"`, or {@link HIDDEN_VALUE}. */
export function formatTarget(
  target: Pick<NutritionTargetWire, "nutrient" | "minAmount" | "maxAmount">,
  hideNumbers: boolean,
): string {
  if (hideNumbers) return HIDDEN_VALUE;
  const { unit } = NUTRIENT_LABELS[target.nutrient];
  const { minAmount: min, maxAmount: max } = target;
  if (min !== null && max !== null)
    return min === max
      ? `${number(min, unit)} ${unit}`
      : `${number(min, unit)}–${number(max, unit)} ${unit}`;
  if (min !== null) return `At least ${number(min, unit)} ${unit}`;
  if (max !== null) return `Up to ${number(max, unit)} ${unit}`;
  return "—";
}

/** `"Entered by you · from 2026-10-01"` (and `"until …"` once ended). */
export function describeTargetSource(
  target: Pick<NutritionTargetWire, "source" | "effectiveFrom" | "effectiveTo">,
): string {
  const span = target.effectiveTo
    ? `from ${target.effectiveFrom} until ${target.effectiveTo}`
    : `from ${target.effectiveFrom}`;
  return `${TARGET_SOURCE_LABELS[target.source]} · ${span}`;
}

/** Accessible one-line reading of a target. */
export function describeTarget(target: NutritionTargetWire, hideNumbers: boolean): string {
  return `${NUTRIENT_LABELS[target.nutrient].label} target: ${formatTarget(target, hideNumbers)}, ${describeTargetSource(target).toLowerCase()}`;
}

/** A day total's value, or {@link HIDDEN_VALUE} in hide-numbers mode. Coverage stays visible. */
export function displayTotalValue(
  key: NutrientKey,
  total: Pick<NutrientTotal, "known" | "reported" | "missing">,
  hideNumbers: boolean,
): string {
  return hideNumbers ? HIDDEN_VALUE : formatTotalValue(key, total);
}

/** Accessible reading of a total; in hide-numbers mode only its coverage. */
export function describeDisplayedTotal(
  key: NutrientKey,
  total: NutrientTotal,
  hideNumbers: boolean,
): string {
  const { label } = NUTRIENT_LABELS[key];
  if (total.coverage === "no_entries") return `${label}: nothing logged`;
  if (hideNumbers) return `${label}: value hidden, ${formatCoverage(total).toLowerCase()}`;
  if (total.known === null) return `${label}: unknown, ${formatCoverage(total).toLowerCase()}`;
  return `${label}: ${formatTotalValue(key, total)}, ${formatCoverage(total).toLowerCase()}`;
}

/** `"55 g a day (0.8 g per kg)"` or `"85–110 g a day (1.2–1.6 g per kg)"`; hidden in hide-numbers mode. */
export function formatProteinReference(
  reference: { minG: number; maxG: number; minGPerKg: number; maxGPerKg: number },
  hideNumbers: boolean,
): string {
  if (hideNumbers) return HIDDEN_VALUE;
  const grams =
    reference.minG === reference.maxG ? `${reference.minG}` : `${reference.minG}–${reference.maxG}`;
  const perKg =
    reference.minGPerKg === reference.maxGPerKg
      ? `${reference.minGPerKg}`
      : `${reference.minGPerKg}–${reference.maxGPerKg}`;
  return `${grams} g a day (${perKg} g per kg)`;
}

/** `"Beat Helpline (England): 0808 801 0677"`, with a detail such as an option number when present. */
export function formatHelpline(line: HelplineWire): string {
  const parts = [line.phone, line.detail].filter(Boolean).join(", ");
  return parts ? `${line.name}: ${parts}` : `${line.name}: ${line.url}`;
}

/** The declarations in display order with their yes/no labels. */
export function declarationChoices(selected: readonly Declaration[]) {
  return (Object.keys(DECLARATION_LABELS) as Declaration[]).map((key) => ({
    key,
    label: DECLARATION_LABELS[key],
    selected: selected.includes(key),
  }));
}

export type TargetFormFields = { min: string; max: string; effectiveFrom: string };

/**
 * Turns target form text into a `setTarget` input. Blank stays unset (never
 * 0); at least one bound is needed and the minimum may not exceed the
 * maximum. Returns a message for invalid input.
 */
export function parseTargetForm(
  nutrient: NutrientKey,
  fields: TargetFormFields,
):
  | {
      ok: true;
      input: {
        nutrient: NutrientKey;
        minAmount: number | null;
        maxAmount: number | null;
        effectiveFrom: string;
      };
    }
  | { ok: false; error: string } {
  const parse = (raw: string): number | null | "invalid" => {
    const text = raw.trim().replace(/,/g, "");
    if (!text) return null;
    const value = Number(text);
    return Number.isFinite(value) && value >= 0 && value <= MAX_TARGET_AMOUNT ? value : "invalid";
  };
  const min = parse(fields.min);
  const max = parse(fields.max);
  const { label } = NUTRIENT_LABELS[nutrient];
  if (min === "invalid" || max === "invalid")
    return { ok: false, error: `${label} targets must be 0 or more, or left blank.` };
  if (min === null && max === null)
    return { ok: false, error: "Enter a minimum, a maximum or both." };
  if (min !== null && max !== null && min > max)
    return { ok: false, error: "The minimum must not be more than the maximum." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.effectiveFrom))
    return { ok: false, error: "Use YYYY-MM-DD for the start date." };
  return {
    ok: true,
    input: { nutrient, minAmount: min, maxAmount: max, effectiveFrom: fields.effectiveFrom },
  };
}

/** Height text to a settings value: blank clears it; otherwise 100–250 cm. */
export function parseHeight(
  raw: string,
): { ok: true; value: number | null } | { ok: false; error: string } {
  const text = raw.trim();
  if (!text) return { ok: true, value: null };
  const value = Number(text);
  if (!Number.isFinite(value) || value < 100 || value > 250)
    return { ok: false, error: "Height must be between 100 and 250 cm, or left blank." };
  return { ok: true, value: Math.round(value * 10) / 10 };
}

/**
 * What a declarations change needs before it is sent: removing the
 * eating-disorder answer needs a deliberate, separate confirmation.
 */
export function declarationsChange(
  before: readonly Declaration[],
  after: readonly Declaration[],
): { removesEatingDisorder: boolean; addsEatingDisorder: boolean } {
  return {
    removesEatingDisorder: before.includes("eating_disorder") && !after.includes("eating_disorder"),
    addsEatingDisorder: !before.includes("eating_disorder") && after.includes("eating_disorder"),
  };
}
