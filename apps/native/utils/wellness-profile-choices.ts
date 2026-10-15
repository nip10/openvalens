import type { WellnessProfileDraft } from "@openvalens/api/presenters/wellness-profile";
import {
  DECLINE_LABEL,
  ELIGIBILITY_LABELS,
  FOCUS_AREA_LABELS,
  INPUT_METHOD_LABELS,
  JUST_EXPLORING_LABEL,
  REGION_LABELS,
  SEX_LABELS,
  SEX_NOT_APPLICABLE_LABEL,
  WELLNESS_ELIGIBILITY,
  WELLNESS_FOCUS_AREAS,
  WELLNESS_INPUT_METHODS,
  WELLNESS_REGIONS,
  WELLNESS_SEXES,
  type WellnessFocusArea,
  type WellnessProfileAnswers,
} from "@openvalens/api/wellness-profile-contract";

/**
 * Issue #98 — native chip-group mapping for the wellness profile.
 *
 * Dependency-free (no RPC client / Varlock) so it is unit-tested directly.
 * Each chip key maps to exactly one answer state, keeping unknown, declined,
 * not applicable and recorded distinct; tapping a selected single-choice chip
 * clears it back to unknown, mirroring the web "Clear answer" button.
 */

export type ChipField = "eligibility" | "focus" | "inputMethod" | "region" | "sex";

export type Chip = { key: string; label: string; disabled?: boolean };

const DECLINED = "declined";
const NOT_APPLICABLE = "not_applicable";
const JUST_EXPLORING = "just_exploring";

export function chipsFor(field: ChipField, draft: WellnessProfileDraft): Chip[] {
  switch (field) {
    case "eligibility":
      return [
        ...WELLNESS_ELIGIBILITY.map((key) => ({ key, label: ELIGIBILITY_LABELS[key] })),
        { key: DECLINED, label: DECLINE_LABEL },
      ];
    case "focus":
      return [
        ...WELLNESS_FOCUS_AREAS.map((key) => ({ key, label: FOCUS_AREA_LABELS[key] })),
        { key: JUST_EXPLORING, label: JUST_EXPLORING_LABEL },
      ];
    case "inputMethod":
      return [
        ...WELLNESS_INPUT_METHODS.map((key) => ({ key, label: INPUT_METHOD_LABELS[key] })),
        { key: DECLINED, label: "Not sure yet" },
      ];
    case "region":
      return [
        ...WELLNESS_REGIONS.map((key) => ({ key, label: REGION_LABELS[key] })),
        { key: DECLINED, label: DECLINE_LABEL },
      ];
    case "sex":
      return [
        // Recording a sex needs the purpose consent first; declining does not.
        ...WELLNESS_SEXES.map((key) => ({
          key,
          label: SEX_LABELS[key],
          disabled: !draft.consents.sex,
        })),
        { key: NOT_APPLICABLE, label: SEX_NOT_APPLICABLE_LABEL },
        { key: DECLINED, label: DECLINE_LABEL },
      ];
  }
}

export function selectedChips(field: ChipField, answers: WellnessProfileAnswers): string[] {
  const answer = answers[field] as { state: string; value?: unknown };
  if (answer.state === "unknown") return [];
  if (answer.state !== "recorded") return [answer.state];
  return Array.isArray(answer.value) ? (answer.value as string[]) : [String(answer.value)];
}

/** The draft after tapping `key` in `field`'s chip group. */
export function toggleChip(
  field: ChipField,
  key: string,
  draft: WellnessProfileDraft,
): WellnessProfileDraft {
  const answers = { ...draft.answers };
  const selected = selectedChips(field, draft.answers).includes(key);

  if (field === "focus") {
    if (key === JUST_EXPLORING) {
      answers.focus = selected ? { state: "unknown" } : { state: "just_exploring" };
    } else {
      const current: WellnessFocusArea[] =
        draft.answers.focus.state === "recorded" ? [...draft.answers.focus.value] : [];
      const next = selected
        ? current.filter((area) => area !== key)
        : [...current, key as WellnessFocusArea];
      answers.focus = next.length > 0 ? { state: "recorded", value: next } : { state: "unknown" };
    }
    return { ...draft, answers };
  }

  const value = selected
    ? { state: "unknown" }
    : key === DECLINED
      ? { state: "declined" }
      : key === NOT_APPLICABLE
        ? { state: "not_applicable" }
        : { state: "recorded", value: key };
  (answers as Record<string, unknown>)[field] = value;
  return { ...draft, answers };
}

/** Toggling a purpose consent off also clears the value it covered (in the draft). */
export function toggleConsent(
  purpose: "age_band" | "sex",
  draft: WellnessProfileDraft,
): WellnessProfileDraft {
  const granted = !draft.consents[purpose];
  const answers = { ...draft.answers };
  if (!granted && purpose === "age_band" && answers.birthYear.state === "recorded") {
    answers.birthYear = { state: "unknown" };
  }
  if (!granted && purpose === "sex" && answers.sex.state === "recorded") {
    answers.sex = { state: "unknown" };
  }
  return { answers, consents: { ...draft.consents, [purpose]: granted } };
}
