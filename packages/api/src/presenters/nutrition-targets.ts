/**
 * Nutrition targets presentation shared by web and mobile (Issue #80). Pure
 * TypeScript; imports only zod-only contracts and the client-safe safety
 * policy module — safe for app bundles.
 *
 * Copy rules (CONTRIBUTING health-copy rules, docs/nutrition-targets.md):
 * a target is written as text beside the total ("1,450 of 1,700–2,100 kcal",
 * D1 in #390), or as what remains to it when the member picks that reading.
 * No rings or bars, no "over"/"under", no colours that judge, no "met"
 * highlight, no verdicts, no moral food words. Refusals
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
  values: Partial<Pick<NutrientValues, (typeof SUMMARY_NUTRIENTS)[number]>>,
  hideNumbers: boolean,
  i18n: I18n,
): string {
  if (hideNumbers) return i18n._(HIDDEN_VALUE);
  return SUMMARY_NUTRIENTS.map((key) => {
    const label = i18n._(NUTRIENT_LABELS[key].label);
    const value = formatNutrientValue(key, values[key] ?? null, i18n);
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

function number(value: number, unit: string, locale: string): string {
  const digits = unit === "kcal" || unit === "kJ" || unit === "mg" ? 0 : 1;
  return value.toLocaleString(locale, { maximumFractionDigits: digits });
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
      ? `${number(min, unit, i18n.locale)} ${unit}`
      : `${number(min, unit, i18n.locale)}–${number(max, unit, i18n.locale)} ${unit}`;
  if (min !== null) {
    const value = number(min, unit, i18n.locale);
    return i18n._(msg`At least ${value} ${unit}`);
  }
  if (max !== null) {
    const value = number(max, unit, i18n.locale);
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

// ─── Totals beside targets (#394) ─────────────────────────────

/** How the day summary reads a total: what was logged, or what remains to the target. */
export const SUMMARY_MODES = ["consumed", "remaining"] as const;
export type SummaryMode = (typeof SUMMARY_MODES)[number];

export const SUMMARY_COPY = Object.freeze({
  consumed: msg({ message: "Logged", context: "day summary reading" }),
  remaining: msg({ message: "Remaining", context: "day summary reading" }),
  modeLabel: msg`How totals are shown`,
  noTarget: msg`No target`,
  targetSet: msg`Target set`,
});

/** A total in the day summary: the big figure, the line beside it, and both read out. */
export type TotalReading = { figure: string; note: string; spoken: string };

/**
 * A day total with its target as text (#394, D1 in #390). `consumed`:
 * "1,450 kcal" + "of 1,700–2,100 kcal". `remaining`: what is left to the
 * target ("250–650 kcal" + "remaining to 1,700–2,100 kcal"); once nothing is
 * left it falls back to the logged reading with the target beside it, never
 * "over". Hide-numbers mode shows no number at all.
 */
export function readTotalAgainstTarget(
  key: NutrientKey,
  total: Pick<NutrientTotal, "known" | "reported" | "missing" | "coverage">,
  target: Pick<NutritionTargetWire, "minAmount" | "maxAmount"> | undefined,
  mode: SummaryMode,
  hideNumbers: boolean,
  i18n: I18n,
): TotalReading {
  const label = i18n._(NUTRIENT_LABELS[key].label);
  const hasTarget = !!target && (target.minAmount !== null || target.maxAmount !== null);
  if (hideNumbers) {
    const note = i18n._(hasTarget ? SUMMARY_COPY.targetSet : SUMMARY_COPY.noTarget);
    const figure = i18n._(HIDDEN_VALUE);
    return { figure, note, spoken: i18n._(msg`${label}: ${figure}, ${note}`) };
  }
  const { unit } = NUTRIENT_LABELS[key];
  const known = total.known;
  const logged =
    known === null
      ? total.coverage === "no_entries"
        ? `0 ${unit}`
        : i18n._(msg`Unknown`)
      : `${number(known, unit, i18n.locale)} ${unit}`;
  const min = target?.minAmount ?? null;
  const max = target?.maxAmount ?? null;
  /** "1,700–2,100 kcal", "at least 100 g" or "up to 2,000 mg", for use inside a sentence. */
  const targetText = (): string => {
    if (min !== null && max !== null) {
      const range =
        min === max
          ? number(min, unit, i18n.locale)
          : `${number(min, unit, i18n.locale)}–${number(max, unit, i18n.locale)}`;
      return `${range} ${unit}`;
    }
    if (min !== null) {
      const value = number(min, unit, i18n.locale);
      return i18n._(msg({ message: `at least ${value} ${unit}`, context: "inside a sentence" }));
    }
    const value = number(max ?? 0, unit, i18n.locale);
    return i18n._(msg({ message: `up to ${value} ${unit}`, context: "inside a sentence" }));
  };
  const ofTarget = (): string => {
    const text = targetText();
    return i18n._(msg`of ${text}`);
  };
  const consumedReading = (): TotalReading => {
    const note = hasTarget ? ofTarget() : i18n._(SUMMARY_COPY.noTarget);
    return { figure: logged, note, spoken: i18n._(msg`${label}: ${logged}, ${note}`) };
  };
  if (mode === "consumed" || !hasTarget) return consumedReading();
  const eaten = known ?? 0;
  if (known === null && total.coverage !== "no_entries") return consumedReading();
  const toTarget = (): string => {
    const text = targetText();
    return i18n._(msg`remaining to ${text}`);
  };
  let figure: string | null = null;
  if (min !== null && eaten < min) {
    const low = number(min - eaten, unit, i18n.locale);
    figure =
      max !== null && max !== min
        ? `${low}–${number(max - eaten, unit, i18n.locale)} ${unit}`
        : `${low} ${unit}`;
  } else if (max !== null && eaten <= max && (min === null || max !== min)) {
    const high = number(max - eaten, unit, i18n.locale);
    figure = min !== null ? i18n._(msg`up to ${high} ${unit}`) : `${high} ${unit}`;
  }
  if (figure === null) {
    // Nothing remains: show what was logged with the target beside it.
    const text = targetText();
    const note = i18n._(msg`logged, target ${text}`);
    return { figure: logged, note, spoken: i18n._(msg`${label}: ${logged}, ${note}`) };
  }
  const note = toTarget();
  return { figure, note, spoken: i18n._(msg`${label}: ${figure}, ${note}`) };
}

// ─── Goal rate (#396) ─────────────────────────────────────────

/** Rates offered per direction, in % of body weight a week (mirrors the safety policy). */
export const RATE_OPTIONS = Object.freeze({
  lose: [0.25, 0.5, 0.75, 1] as const,
  gain: [0.25, 0.5] as const,
});
export const DEFAULT_RATE = Object.freeze({ lose: 0.5, gain: 0.25 } as const);

export const GOAL_COPY = Object.freeze({
  rateTitle: msg({ message: "Rate", context: "goal speed" }),
  rateDescription: msg`How fast suggestions aim to change your weight trend, as a share of body weight a week. The safeguards below always apply on top.`,
  floorNote: msg({
    message:
      "Suggestions never go below 1,200 kcal a day, your profile's minimum or your estimated resting energy, whichever is highest. Reductions are turned off while any answer in About you is yes, and for anyone younger than 18. These safeguards come from published guidelines. They are not medical advice.",
    comment: "safety",
  }),
});

/** `"0.5 % a week"`. */
export function formatRate(percent: number, i18n: I18n): string {
  const value = percent.toLocaleString(i18n.locale, { maximumFractionDigits: 2 });
  return i18n._(msg`${value} % a week`);
}

/** The rate to keep when the direction changes: the current one if offered, else the default. */
export function rateForDirection(
  direction: EnergyDirection,
  current: number | null,
): 0.25 | 0.5 | 0.75 | 1 | null {
  if (direction === "maintain") return null;
  const options: readonly number[] = RATE_OPTIONS[direction];
  if (current !== null && options.includes(current)) return current as 0.25 | 0.5 | 0.75 | 1;
  return DEFAULT_RATE[direction];
}

// ─── Weekly check-in (#397) ───────────────────────────────────

export {
  CHECK_IN_DAYS,
  checkInState,
  loggedDaysOfLastWeek,
  type CheckInDay,
  type CheckInState,
} from "@openvalens/nutrition/check-in";

export const CHECK_IN_COPY = Object.freeze({
  modeTitle: msg`Targets`,
  manual: msg({ message: "Manual", context: "targets mode" }),
  weekly: msg({ message: "Weekly check-in", context: "targets mode" }),
  manualDescription: msg`You set every target yourself. Suggestions only come when you ask.`,
  weeklyDescription: msg`Each week the app proposes an energy target from your estimate and your goal. Nothing changes until you accept.`,
  dayTitle: msg`Check-in day`,
  title: msg`Proposed target for next week`,
  ready: msg`Your weekly check-in is ready`,
  open: msg`Open check-in`,
  accept: msg`Accept proposal`,
  keep: msg`Keep current targets`,
  target: msg({ message: "Target", context: "check-in column" }),
  now: msg({ message: "Now", context: "check-in column" }),
  proposed: msg({ message: "Proposed", context: "check-in column" }),
  adherence: msg`Last week's intake against your target doesn't change the proposal.`,
  pauseRule: msg`The estimate pauses when more than 3 of the last 7 days have no usable log.`,
  paused: msg`No proposal this week. You can keep your targets and check in again next week.`,
  hidden: msg`Numbers are hidden. Turn them on in Targets and display to review a proposal.`,
  off: msg`Weekly check-ins are not available for this profile.`,
  kept: msg`Check-in done. Your targets are unchanged.`,
  accepted: msg`Check-in done. Your energy target is updated.`,
  acceptedWithMacros: msg`Check-in done. Your energy, protein, carbohydrate and fat targets are updated.`,
  macrosNotSaved: msg`Your energy target is updated, but the protein, carbohydrate and fat targets could not be saved. Try again from Macro targets from a style.`,
  notDue: msg`Your next check-in is not open yet.`,
  experimental: msg`Based on an experimental estimate that has not been validated.`,
});

/** `"Monday"` for ISO weekday 1, in the reader's language. */
export function weekdayName(
  isoDay: number,
  locale: string,
  width: "long" | "short" = "long",
): string {
  // 2026-11-09 is a Monday.
  const date = new Date(Date.UTC(2026, 10, 8 + isoDay, 12));
  try {
    return new Intl.DateTimeFormat(locale, { weekday: width, timeZone: "UTC" }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en", { weekday: width, timeZone: "UTC" }).format(date);
  }
}

/** `"Logged on 6 of the last 7 days."` */
export function loggedDaysLine(logged: number, of: number, i18n: I18n): string {
  return i18n._(msg`Usable logs on ${logged} of the last ${of} days.`);
}

/** `"Weekly check-in, Monday 10 Nov"`-style header line. */
export function checkInHeader(dateText: string, i18n: I18n): string {
  return i18n._(msg`Weekly check-in, ${dateText}`);
}

/** The goal in words for the check-in explanation: `"reduce, 0.5 % a week"`. */
export function goalLine(direction: EnergyDirection, rate: number | null, i18n: I18n): string {
  const label = i18n._(DIRECTION_LABELS[direction].label);
  if (direction === "maintain") return label;
  const value = formatRate(rateForDirection(direction, rate) ?? 0, i18n);
  return i18n._(msg`${label}, ${value}`);
}

/** `"Based on your estimate (2,240 kcal a day) and your goal: Reduce, 0.5 % a week."` */
export function checkInBasis(estimateKcal: number, goal: string, i18n: I18n): string {
  const kcal = Math.round(estimateKcal).toLocaleString(i18n.locale);
  return i18n._(
    msg`Based on your expenditure estimate (${kcal} kcal a day) and your goal: ${goal}.`,
  );
}
