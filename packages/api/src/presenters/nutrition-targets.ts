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
import type { I18n, MessageDescriptor } from "@lingui/core";
import { msg, select } from "@lingui/core/macro";
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
  coveragePhrase,
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
export const HIDDEN_VALUE: MessageDescriptor = msg`Hidden`;

/**
 * A food's summary nutrients on one line ("Energy 412 kcal, Protein 9 g, …"),
 * or {@link HIDDEN_VALUE} in hide-numbers mode. Every surface that lists a
 * food's values uses this, so none can show a number the mode hides (#88).
 */
export function formatNutrientSummaryLine(
  values: Pick<NutrientValues, (typeof SUMMARY_NUTRIENTS)[number]>,
  hideNumbers: boolean,
  i18n: I18n,
): string {
  if (hideNumbers) return i18n._(HIDDEN_VALUE);
  return SUMMARY_NUTRIENTS.map((key) => {
    const label = i18n._(NUTRIENT_LABELS[key].label);
    const value = formatNutrientValue(key, values[key], i18n);
    return i18n._(msg`${label} ${value}`);
  }).join(", ");
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
  title: msg`Nutrition targets`,
  settingsLink: msg`Targets and display`,
  yourTargets: msg`Your targets`,
  targetsNote: msg`Targets are yours to set, change or clear. They are shown next to what you logged, not compared with it.`,
  noTargets: msg`No targets set. Logging works the same without them.`,
  hideNumbers: msg`Hide numbers`,
  hideNumbersDescription: msg`Hides energy, nutrient and target numbers in the diary. Logging still works, and you can turn this off at any time.`,
  numbersHidden: msg`Numbers are hidden. Coverage is still shown.`,
  directionTitle: msg`Suggestions`,
  directionDescription: msg`Suggestions are based on your estimate and only change a target if you accept them.`,
  setTarget: msg`Save target`,
  clearTarget: msg`Clear target`,
  minimum: msg`Minimum (optional)`,
  maximum: msg`Maximum (optional)`,
  effectiveFrom: msg`Applies from`,
  saving: msg`Saving…`,
  saved: msg`Target saved.`,
  cleared: msg`Target cleared.`,
  proteinReferenceTitle: msg`Protein reference`,
  proteinReferenceNote: msg`A general reference from your recent weight, not a target. Enter a target yourself if you want one.`,
  proteinReferenceUnavailable: msg`No recent weight for a reference yet.`,
  activeProtein: msg`I train regularly and want the active reference`,
  heightLabel: msg`Height (cm, optional)`,
  heightDescription: msg`Used only for safeguards on reduction suggestions.`,
  declarationsTitle: msg`About you`,
  saveSettings: msg`Save`,
  settingsSaved: msg`Settings saved.`,
  conflict: msg`These settings changed on another device. The latest version is shown.`,
  networkError: msg`Could not reach the server. Your saved targets are unchanged.`,
  suggestionTitle: msg`Suggestion`,
  askSuggestion: msg`Ask for a suggestion`,
  accept: msg`Accept`,
  dismiss: msg`Dismiss`,
  confirmSuggestion: msg({
    message: "I have read this and want to review the suggestion",
    comment: "safety",
  }),
  accepted: msg`Suggestion accepted. Your target is updated.`,
  dismissed: msg`Suggestion dismissed. Your target is unchanged.`,
  helplinesTitle: msg`Support`,
});

export const DIRECTION_LABELS: Readonly<
  Record<EnergyDirection, { label: MessageDescriptor; description: MessageDescriptor }>
> = Object.freeze({
  maintain: {
    label: msg`Maintain`,
    description: msg`Suggestions follow the estimated intake that keeps your weight trend steady.`,
  },
  lose: {
    label: msg`Reduce`,
    description: msg`Suggestions are a small, capped reduction from the estimate, within safeguards. Some profiles get no reduction suggestions.`,
  },
  gain: {
    label: msg`Increase`,
    description: msg`Suggestions are a small, capped increase from the estimate.`,
  },
});

export const TARGET_SOURCE_LABELS: Readonly<Record<TargetSource, MessageDescriptor>> =
  Object.freeze({
    entered: msg`Entered by you`,
    proposal: msg`Accepted suggestion`,
  });

function number(value: number, unit: string): string {
  const digits = unit === "kcal" || unit === "kJ" || unit === "mg" ? 0 : 1;
  return value.toLocaleString("en-US", { maximumFractionDigits: digits });
}

/** `"2,000 kcal"`, `"1,800–2,200 kcal"`, `"At least 55 g"`, `"Up to 2,300 mg"`, or {@link HIDDEN_VALUE}. */
export function formatTarget(
  target: Pick<NutritionTargetWire, "nutrient" | "minAmount" | "maxAmount">,
  hideNumbers: boolean,
  i18n: I18n,
): string {
  if (hideNumbers) return i18n._(HIDDEN_VALUE);
  const { unit } = NUTRIENT_LABELS[target.nutrient];
  const { minAmount: min, maxAmount: max } = target;
  if (min !== null && max !== null)
    return min === max
      ? `${number(min, unit)} ${unit}`
      : `${number(min, unit)}–${number(max, unit)} ${unit}`;
  if (min !== null) {
    const value = number(min, unit);
    return i18n._(msg`At least ${value} ${unit}`);
  }
  if (max !== null) {
    const value = number(max, unit);
    return i18n._(msg`Up to ${value} ${unit}`);
  }
  return "—";
}

/** `"Entered by you, from 2026-10-01"` (and `"until …"` once ended). */
export function describeTargetSource(
  target: Pick<NutritionTargetWire, "source" | "effectiveFrom" | "effectiveTo">,
): MessageDescriptor {
  const from = target.effectiveFrom;
  const to = target.effectiveTo;
  return to
    ? msg`${select(target.source, {
        entered: "Entered by you",
        proposal: "Accepted suggestion",
        other: "Target",
      })}, from ${from} until ${to}`
    : msg`${select(target.source, {
        entered: "Entered by you",
        proposal: "Accepted suggestion",
        other: "Target",
      })}, from ${from}`;
}

/** Accessible one-line reading of a target. */
export function describeTarget(
  target: NutritionTargetWire,
  hideNumbers: boolean,
  i18n: I18n,
): string {
  const label = i18n._(NUTRIENT_LABELS[target.nutrient].label);
  const value = formatTarget(target, hideNumbers, i18n);
  const source = i18n._(describeTargetSource(target)).toLocaleLowerCase(i18n.locale);
  return i18n._(msg`${label} target: ${value}, ${source}`);
}

/** A day total's value, or {@link HIDDEN_VALUE} in hide-numbers mode. Coverage stays visible. */
export function displayTotalValue(
  key: NutrientKey,
  total: Pick<NutrientTotal, "known" | "reported" | "missing">,
  hideNumbers: boolean,
  i18n: I18n,
): string {
  return hideNumbers ? i18n._(HIDDEN_VALUE) : formatTotalValue(key, total, i18n);
}

/** Accessible reading of a total; in hide-numbers mode only its coverage. */
export function describeDisplayedTotal(
  key: NutrientKey,
  total: NutrientTotal,
  hideNumbers: boolean,
  i18n: I18n,
): string {
  const label = i18n._(NUTRIENT_LABELS[key].label);
  if (total.coverage === "no_entries") return i18n._(msg`${label}: nothing logged`);
  const coverage = coveragePhrase(total, i18n);
  if (hideNumbers) return i18n._(msg`${label}: value hidden, ${coverage}`);
  if (total.known === null) return i18n._(msg`${label}: unknown, ${coverage}`);
  const value = formatTotalValue(key, total, i18n);
  return i18n._(msg`${label}: ${value}, ${coverage}`);
}

/** `"55 g a day (0.8 g per kg)"` or `"85–110 g a day (1.2–1.6 g per kg)"`; hidden in hide-numbers mode. */
export function formatProteinReference(
  reference: { minG: number; maxG: number; minGPerKg: number; maxGPerKg: number },
  hideNumbers: boolean,
  i18n: I18n,
): string {
  if (hideNumbers) return i18n._(HIDDEN_VALUE);
  const grams =
    reference.minG === reference.maxG ? `${reference.minG}` : `${reference.minG}–${reference.maxG}`;
  const perKg =
    reference.minGPerKg === reference.maxGPerKg
      ? `${reference.minGPerKg}`
      : `${reference.minGPerKg}–${reference.maxGPerKg}`;
  return i18n._(msg({ message: `${grams} g a day (${perKg} g per kg)`, comment: "safety" }));
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
  | { ok: false; error: MessageDescriptor } {
  const parse = (raw: string): number | null | "invalid" => {
    const text = raw.trim().replace(/,/g, "");
    if (!text) return null;
    const value = Number(text);
    return Number.isFinite(value) && value >= 0 && value <= MAX_TARGET_AMOUNT ? value : "invalid";
  };
  const min = parse(fields.min);
  const max = parse(fields.max);
  if (min === "invalid" || max === "invalid")
    return {
      ok: false,
      error: msg`${select(nutrient, {
        energyKcal: "Energy",
        energyKj: "Energy",
        proteinG: "Protein",
        carbohydrateG: "Carbohydrate",
        fatG: "Fat",
        saturatedFatG: "Saturated fat",
        fiberG: "Fibre",
        totalSugarsG: "Total sugars",
        addedSugarsG: "Added sugars",
        freeSugarsG: "Free sugars",
        sodiumMg: "Sodium",
        saltG: "Salt",
        other: "Nutrient",
      })} targets must be 0 or more, or left blank.`,
    };
  if (min === null && max === null)
    return { ok: false, error: msg`Enter a minimum, a maximum or both.` };
  if (min !== null && max !== null && min > max)
    return { ok: false, error: msg`The minimum must not be more than the maximum.` };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.effectiveFrom))
    return { ok: false, error: msg`Use YYYY-MM-DD for the start date.` };
  return {
    ok: true,
    input: { nutrient, minAmount: min, maxAmount: max, effectiveFrom: fields.effectiveFrom },
  };
}

/** Height text to a settings value: blank clears it; otherwise 100–250 cm. */
export function parseHeight(
  raw: string,
): { ok: true; value: number | null } | { ok: false; error: MessageDescriptor } {
  const text = raw.trim();
  if (!text) return { ok: true, value: null };
  const value = Number(text);
  if (!Number.isFinite(value) || value < 100 || value > 250)
    return { ok: false, error: msg`Height must be between 100 and 250 cm, or left blank.` };
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
