import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";

import {
  ADULT_AGE_YEARS,
  answersEqual,
  CONSENT_PURPOSE_FIELD,
  MIN_BIRTH_YEAR,
  WELLNESS_CONSENT_PURPOSES,
  type WellnessConsentPurpose,
  type WellnessProfileAnswers,
  type WellnessProfileField,
  type WellnessProfileRejection,
  type WellnessProfileSnapshot,
  type WellnessProfileUpdateInput,
} from "../wellness-profile-contract";

/**
 * Issue #98 — platform-neutral setup/edit logic shared by web and native, so
 * both apps resume, diff, validate and explain save failures identically.
 *
 * Setup has no fixed step count: it is a list of independent, optional
 * sections that save on their own. "Resume" opens the first section that has
 * not been answered; a partially answered profile is always editable.
 *
 * Text is returned as message descriptors the apps render with Lingui (#67);
 * this module is not reachable from server code (see server-safe.test.ts).
 */

export const SETUP_SECTIONS = [
  "eligibility",
  "focus",
  "inputMethod",
  "goal",
  "region",
  "ageAndSex",
] as const;
export type SetupSection = (typeof SETUP_SECTIONS)[number];

/** Profile fields each section edits. `goal` uses the existing Goals feature. */
export const SECTION_FIELDS: Record<SetupSection, readonly WellnessProfileField[]> = {
  eligibility: ["eligibility"],
  focus: ["focus"],
  inputMethod: ["inputMethod"],
  goal: [],
  region: ["region"],
  ageAndSex: ["birthYear", "sex"],
};

export const SECTION_TITLES: Record<SetupSection, MessageDescriptor> = {
  eligibility: msg`Age check`,
  focus: msg`What brings you here`,
  inputMethod: msg`How you'll add data`,
  goal: msg`A goal (optional)`,
  region: msg`Region`,
  ageAndSex: msg`Age and sex for guidance`,
};

/** Editable copy of the answers plus the consent toggles for the purpose fields. */
export type WellnessProfileDraft = {
  answers: WellnessProfileAnswers;
  consents: Record<WellnessConsentPurpose, boolean>;
};

export function draftFromSnapshot(snapshot: WellnessProfileSnapshot): WellnessProfileDraft {
  return {
    answers: {
      eligibility: snapshot.eligibility,
      focus: snapshot.focus,
      inputMethod: snapshot.inputMethod,
      region: snapshot.region,
      birthYear: snapshot.birthYear,
      sex: snapshot.sex,
    },
    consents: {
      age_band: snapshot.consents.age_band?.active === true,
      sex: snapshot.consents.sex?.active === true,
    },
  };
}

export function isAdultConfirmed(answers: Pick<WellnessProfileAnswers, "eligibility">): boolean {
  return answers.eligibility.state === "recorded" && answers.eligibility.value === "adult";
}

/** Whether a section is available to fill in (age and sex need the adult answer). */
export function isSectionAvailable(
  section: SetupSection,
  answers: Pick<WellnessProfileAnswers, "eligibility">,
): boolean {
  return section === "ageAndSex" ? isAdultConfirmed(answers) : true;
}

export function isSectionAnswered(
  section: SetupSection,
  snapshot: WellnessProfileSnapshot,
): boolean {
  const fields = SECTION_FIELDS[section];
  if (fields.length === 0) return false;
  const answers = draftFromSnapshot(snapshot).answers;
  return fields.every((field) => answers[field].state !== "unknown");
}

/**
 * The section "Resume setup" should open: the first available section with an
 * unanswered field (the goal section is optional and never blocks resume), or
 * `null` when everything available has an answer.
 */
export function nextSetupSection(snapshot: WellnessProfileSnapshot): SetupSection | null {
  for (const section of SETUP_SECTIONS) {
    if (section === "goal") continue;
    if (!isSectionAvailable(section, snapshot)) continue;
    if (!isSectionAnswered(section, snapshot)) return section;
  }
  return null;
}

/** Whether to offer the optional setup prompt (never started or left part-way). */
export function shouldOfferSetup(snapshot: WellnessProfileSnapshot): boolean {
  return snapshot.setupStatus === null || snapshot.setupStatus === "in_progress";
}

/** Answered vs. available counts, for an honest "3 of 5 answered" summary. */
export function setupProgress(snapshot: WellnessProfileSnapshot): {
  answered: number;
  available: number;
} {
  const sections = SETUP_SECTIONS.filter(
    (section) => section !== "goal" && isSectionAvailable(section, snapshot),
  );
  return {
    answered: sections.filter((section) => isSectionAnswered(section, snapshot)).length,
    available: sections.length,
  };
}

/**
 * Builds the minimal partial update for one section: only fields (and consent
 * toggles) that differ from the server snapshot are sent, so saving one
 * section never touches another. Returns `null` when nothing changed.
 */
export function buildSectionPatch(
  snapshot: WellnessProfileSnapshot,
  draft: WellnessProfileDraft,
  section: SetupSection,
): WellnessProfileUpdateInput | null {
  const baseline = draftFromSnapshot(snapshot);
  const patch: WellnessProfileUpdateInput = { expectedRevision: snapshot.revision };
  let changed = false;

  for (const field of SECTION_FIELDS[section]) {
    if (!answersEqual(draft.answers[field], baseline.answers[field])) {
      (patch as Record<string, unknown>)[field] = draft.answers[field];
      changed = true;
    }
  }

  for (const purpose of WELLNESS_CONSENT_PURPOSES) {
    if (!SECTION_FIELDS[section].includes(CONSENT_PURPOSE_FIELD[purpose])) continue;
    if (draft.consents[purpose] !== baseline.consents[purpose]) {
      patch.consents = {
        ...patch.consents,
        [purpose]: draft.consents[purpose] ? "grant" : "withdraw",
      };
      changed = true;
    }
  }

  return changed ? patch : null;
}

export function isSectionDirty(
  snapshot: WellnessProfileSnapshot,
  draft: WellnessProfileDraft,
  section: SetupSection,
): boolean {
  return buildSectionPatch(snapshot, draft, section) !== null;
}

/**
 * Moves a draft onto a newer server snapshot (after a save, a refetch or a
 * conflict reload): fields the person had not touched take the server value,
 * fields with unsaved edits keep the edit so nothing typed is lost.
 */
export function rebaseDraft(
  previous: WellnessProfileSnapshot,
  next: WellnessProfileSnapshot,
  draft: WellnessProfileDraft,
): WellnessProfileDraft {
  const before = draftFromSnapshot(previous);
  const after = draftFromSnapshot(next);
  const answers = { ...after.answers };
  for (const key of Object.keys(answers) as WellnessProfileField[]) {
    if (!answersEqual(draft.answers[key], before.answers[key])) {
      (answers as Record<string, unknown>)[key] = draft.answers[key];
    }
  }
  const consents = { ...after.consents };
  for (const purpose of WELLNESS_CONSENT_PURPOSES) {
    if (draft.consents[purpose] !== before.consents[purpose])
      consents[purpose] = draft.consents[purpose];
  }
  return { answers, consents };
}

/**
 * Discards one section's unsaved edits (after it saved, or on "Undo
 * changes"), leaving other sections' edits alone.
 */
export function resetSection(
  snapshot: WellnessProfileSnapshot,
  draft: WellnessProfileDraft,
  section: SetupSection,
): WellnessProfileDraft {
  const baseline = draftFromSnapshot(snapshot);
  const answers = { ...draft.answers };
  for (const field of SECTION_FIELDS[section]) {
    (answers as Record<string, unknown>)[field] = baseline.answers[field];
  }
  const consents = { ...draft.consents };
  for (const purpose of WELLNESS_CONSENT_PURPOSES) {
    if (SECTION_FIELDS[section].includes(CONSENT_PURPOSE_FIELD[purpose])) {
      consents[purpose] = baseline.consents[purpose];
    }
  }
  return { answers, consents };
}

/** Sections with unsaved edits, for a "you have unsaved changes" warning. */
export function dirtySections(
  snapshot: WellnessProfileSnapshot,
  draft: WellnessProfileDraft,
): SetupSection[] {
  return SETUP_SECTIONS.filter((section) => isSectionDirty(snapshot, draft, section));
}

const REJECTION_MESSAGES: Record<WellnessProfileRejection, MessageDescriptor> = {
  ADULT_CONFIRMATION_REQUIRED: msg`Confirm you are 18 or older before adding age or sex.`,
  CONSENT_REQUIRED: msg({
    message: "Tick the consent box to save this, or choose 'Prefer not to say'.",
    comment: "safety",
  }),
  BIRTH_YEAR_UNDER_18: msg`That birth year is under 18. OpenValens personalisation is for adults only.`,
  BIRTH_YEAR_OUT_OF_RANGE: msg`Enter a four-digit birth year.`,
  CONSENT_AND_VALUE_CONFLICT: msg({
    message:
      "You withdrew consent for this answer, so it can't be saved. Clear it or keep your consent.",
    comment: "safety",
  }),
};

export function rejectionMessage(reason: WellnessProfileRejection): MessageDescriptor {
  return REJECTION_MESSAGES[reason];
}

/**
 * Parses the birth-year text box. Empty → `null` (no value); anything that is
 * not a plausible adult four-digit year → a rejection to show inline, so the
 * client explains the same rule the server enforces.
 */
export function parseBirthYearInput(
  text: string,
  now: Date,
): { ok: true; year: number | null } | { ok: false; reason: WellnessProfileRejection } {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: true, year: null };
  if (!/^\d{4}$/.test(trimmed)) return { ok: false, reason: "BIRTH_YEAR_OUT_OF_RANGE" };
  const year = Number(trimmed);
  const age = now.getUTCFullYear() - year;
  if (year < MIN_BIRTH_YEAR || age < 0 || age > 120) {
    return { ok: false, reason: "BIRTH_YEAR_OUT_OF_RANGE" };
  }
  if (age < ADULT_AGE_YEARS) return { ok: false, reason: "BIRTH_YEAR_UNDER_18" };
  return { ok: true, year };
}

export type ProfileSaveErrorKind = "conflict" | "offline" | "invalid" | "unknown";

/**
 * Classifies a failed save. Nothing is ever reported as saved unless the
 * server confirmed it; an offline failure keeps the edits on screen only.
 */
export function describeProfileSaveError(error: unknown): {
  kind: ProfileSaveErrorKind;
  message: MessageDescriptor;
} {
  const value = (error ?? {}) as {
    code?: unknown;
    data?: unknown;
    name?: unknown;
    message?: unknown;
  };
  if (value.code === "CONFLICT") {
    return {
      kind: "conflict",
      message: msg`Your profile was changed somewhere else. We've loaded the latest version — check it and save again.`,
    };
  }
  if (value.code === "INVALID_INPUT") {
    const reason = (value.data as { reason?: unknown } | undefined)?.reason;
    if (typeof reason === "string" && reason in REJECTION_MESSAGES) {
      return { kind: "invalid", message: rejectionMessage(reason as WellnessProfileRejection) };
    }
    return {
      kind: "invalid",
      message: msg`Some answers could not be saved. Check them and try again.`,
    };
  }
  const offline =
    (typeof navigator !== "undefined" && (navigator as { onLine?: boolean }).onLine === false) ||
    value.name === "TypeError" ||
    (typeof value.message === "string" && /network|fetch/i.test(value.message));
  if (offline) {
    return {
      kind: "offline",
      message: msg`Not saved — you seem to be offline. Saving needs a connection; your changes are still here.`,
    };
  }
  return { kind: "unknown", message: msg`Not saved. Try again.` };
}

/** Query key for the profile, scoped to the signed-in user so caches never cross accounts. */
export function wellnessProfileQueryKey(userId: string) {
  return ["wellness-profile", userId] as const;
}
