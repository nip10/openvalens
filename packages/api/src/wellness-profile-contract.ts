import { z } from "zod";

/**
 * Issue #98 — client-safe wellness profile contract.
 *
 * Free of any `@openvalens/db` / `@openvalens/auth` import so the web and
 * native bundles share one definition of the fields, their meaning, their
 * validation and the copy that explains them. The server service applies the
 * same {@link applyWellnessProfileUpdate} rules inside its transaction.
 *
 * Model:
 * - The profile is **user-owned**: it follows the signed-in person across
 *   workspaces and is never readable through a workspace role.
 * - Every answer is optional. Each one is a tagged state so "never answered"
 *   (`unknown`), `declined`, `not_applicable` and a `recorded` value stay
 *   distinct; nothing is ever defaulted or inferred.
 * - Updates are partial: an omitted key is untouched; `{ state: "unknown" }`
 *   explicitly clears an answer.
 * - Birth year and sex are adult-only, purpose-specific inputs: recording one
 *   requires the adult answer and an active consent for its purpose.
 * - Values are self-reported in the app (provenance `self_reported`); the
 *   profile holds preferences and self-declarations, not measurements.
 */

// ─── Vocabulary ────────────────────────────────────────────────

export const WELLNESS_FOCUS_AREAS = [
  "sleep_recovery",
  "activity_fitness",
  "nutrition",
  "body_goals",
  "wellbeing",
] as const;
export type WellnessFocusArea = (typeof WELLNESS_FOCUS_AREAS)[number];

export const WELLNESS_INPUT_METHODS = ["manual", "device", "both"] as const;
export type WellnessInputMethod = (typeof WELLNESS_INPUT_METHODS)[number];

/** Launch regions for region-specific public-health guidance (see #97). */
export const WELLNESS_REGIONS = ["us", "uk", "pt"] as const;
export type WellnessRegion = (typeof WELLNESS_REGIONS)[number];

/** The binary sex variable some published reference tables use. Not gender identity. */
export const WELLNESS_SEXES = ["female", "male"] as const;
export type WellnessSex = (typeof WELLNESS_SEXES)[number];

export const WELLNESS_ELIGIBILITY = ["adult", "under_18"] as const;
export type WellnessEligibility = (typeof WELLNESS_ELIGIBILITY)[number];

export const WELLNESS_SETUP_STATUSES = ["in_progress", "skipped", "completed"] as const;
export type WellnessSetupStatus = (typeof WELLNESS_SETUP_STATUSES)[number];

/** Purposes that need their own recorded consent before a value is stored. */
export const WELLNESS_CONSENT_PURPOSES = ["age_band", "sex"] as const;
export type WellnessConsentPurpose = (typeof WELLNESS_CONSENT_PURPOSES)[number];

/** Version of the purpose disclosures below; stored on every consent record. */
export const WELLNESS_CONSENT_VERSION = "2026-10-15";

export const ADULT_AGE_YEARS = 18;
export const MIN_BIRTH_YEAR = 1900;
const MAX_AGE_YEARS = 120;

/** All profile values are entered by the person in the app. */
export const WELLNESS_PROFILE_PROVENANCE = "self_reported" as const;

// ─── Answer schemas ────────────────────────────────────────────

const unknownAnswer = z.strictObject({ state: z.literal("unknown") });
const declinedAnswer = z.strictObject({ state: z.literal("declined") });
const notApplicableAnswer = z.strictObject({ state: z.literal("not_applicable") });
const justExploringAnswer = z.strictObject({ state: z.literal("just_exploring") });

function recorded<T extends z.ZodType>(value: T) {
  return z.strictObject({ state: z.literal("recorded"), value });
}

export const eligibilityAnswerSchema = z.discriminatedUnion("state", [
  unknownAnswer,
  declinedAnswer,
  recorded(z.enum(WELLNESS_ELIGIBILITY)),
]);

export const focusAnswerSchema = z.discriminatedUnion("state", [
  unknownAnswer,
  justExploringAnswer,
  recorded(
    z
      .array(z.enum(WELLNESS_FOCUS_AREAS))
      .min(1)
      .max(WELLNESS_FOCUS_AREAS.length)
      .refine((areas) => new Set(areas).size === areas.length, "Duplicate focus area"),
  ),
]);

export const inputMethodAnswerSchema = z.discriminatedUnion("state", [
  unknownAnswer,
  declinedAnswer,
  recorded(z.enum(WELLNESS_INPUT_METHODS)),
]);

export const regionAnswerSchema = z.discriminatedUnion("state", [
  unknownAnswer,
  declinedAnswer,
  recorded(z.enum(WELLNESS_REGIONS)),
]);

/** Static bounds only; the adult/age-range rule is relative to "now" (see apply). */
export const birthYearAnswerSchema = z.discriminatedUnion("state", [
  unknownAnswer,
  declinedAnswer,
  recorded(z.int().min(MIN_BIRTH_YEAR).max(2100)),
]);

export const sexAnswerSchema = z.discriminatedUnion("state", [
  unknownAnswer,
  declinedAnswer,
  notApplicableAnswer,
  recorded(z.enum(WELLNESS_SEXES)),
]);

export type EligibilityAnswer = z.infer<typeof eligibilityAnswerSchema>;
export type FocusAnswer = z.infer<typeof focusAnswerSchema>;
export type InputMethodAnswer = z.infer<typeof inputMethodAnswerSchema>;
export type RegionAnswer = z.infer<typeof regionAnswerSchema>;
export type BirthYearAnswer = z.infer<typeof birthYearAnswerSchema>;
export type SexAnswer = z.infer<typeof sexAnswerSchema>;

/** The answer fields, in the order setup presents them. */
export const WELLNESS_PROFILE_FIELDS = [
  "eligibility",
  "focus",
  "inputMethod",
  "region",
  "birthYear",
  "sex",
] as const;
export type WellnessProfileField = (typeof WELLNESS_PROFILE_FIELDS)[number];

export type WellnessProfileAnswers = {
  eligibility: EligibilityAnswer;
  focus: FocusAnswer;
  inputMethod: InputMethodAnswer;
  region: RegionAnswer;
  birthYear: BirthYearAnswer;
  sex: SexAnswer;
};

// ─── Snapshot (read + update output) ───────────────────────────

/** Latest consent record for one purpose; `null` when never asked. */
export const consentRecordSchema = z.strictObject({
  active: z.boolean(),
  version: z.string(),
  grantedAt: z.string(),
  withdrawnAt: z.string().nullable(),
});
export type WellnessConsentRecord = z.infer<typeof consentRecordSchema>;

export const wellnessProfileSnapshotSchema = z.strictObject({
  revision: z.int().nonnegative(),
  setupStatus: z.enum(WELLNESS_SETUP_STATUSES).nullable(),
  eligibility: eligibilityAnswerSchema,
  focus: focusAnswerSchema,
  inputMethod: inputMethodAnswerSchema,
  region: regionAnswerSchema,
  birthYear: birthYearAnswerSchema,
  sex: sexAnswerSchema,
  consents: z.strictObject({
    age_band: consentRecordSchema.nullable(),
    sex: consentRecordSchema.nullable(),
  }),
  updatedAt: z.string().nullable(),
});
export type WellnessProfileSnapshot = z.infer<typeof wellnessProfileSnapshotSchema>;

const UNKNOWN = Object.freeze({ state: "unknown" as const });

/** The state of a user who has never opened setup: nothing answered, nothing consented. */
export const EMPTY_WELLNESS_PROFILE: WellnessProfileSnapshot = Object.freeze({
  revision: 0,
  setupStatus: null,
  eligibility: UNKNOWN,
  focus: UNKNOWN,
  inputMethod: UNKNOWN,
  region: UNKNOWN,
  birthYear: UNKNOWN,
  sex: UNKNOWN,
  consents: Object.freeze({ age_band: null, sex: null }),
  updatedAt: null,
});

// ─── Update input ──────────────────────────────────────────────

export const consentActionSchema = z.enum(["grant", "withdraw"]);
export type WellnessConsentAction = z.infer<typeof consentActionSchema>;

/**
 * Strict partial update. Omitted keys are untouched; `{ state: "unknown" }`
 * clears. `expectedRevision` is the revision the client last saw.
 */
export const wellnessProfileUpdateInput = z.strictObject({
  expectedRevision: z.int().nonnegative(),
  setupStatus: z.enum(WELLNESS_SETUP_STATUSES).optional(),
  eligibility: eligibilityAnswerSchema.optional(),
  focus: focusAnswerSchema.optional(),
  inputMethod: inputMethodAnswerSchema.optional(),
  region: regionAnswerSchema.optional(),
  birthYear: birthYearAnswerSchema.optional(),
  sex: sexAnswerSchema.optional(),
  consents: z
    .strictObject({
      age_band: consentActionSchema.optional(),
      sex: consentActionSchema.optional(),
    })
    .optional(),
});
export type WellnessProfileUpdateInput = z.infer<typeof wellnessProfileUpdateInput>;

// ─── Update rules (shared by server and tests) ─────────────────

/** Value-free rejection reasons, returned in the error `data.reason`. */
export type WellnessProfileRejection =
  | "ADULT_CONFIRMATION_REQUIRED"
  | "CONSENT_REQUIRED"
  | "BIRTH_YEAR_UNDER_18"
  | "BIRTH_YEAR_OUT_OF_RANGE"
  | "CONSENT_AND_VALUE_CONFLICT";

export type WellnessProfileState = {
  setupStatus: WellnessSetupStatus | null;
  answers: WellnessProfileAnswers;
  activeConsents: Record<WellnessConsentPurpose, boolean>;
};

export type WellnessProfileApplyResult =
  | {
      ok: true;
      next: WellnessProfileState;
      /** Field names (and `setupStatus`) whose stored value changed. Never values. */
      changedFields: string[];
      consentChanges: { purpose: WellnessConsentPurpose; action: WellnessConsentAction }[];
    }
  | { ok: false; reason: WellnessProfileRejection; field: WellnessProfileField | "consents" };

/** The field each consent purpose gates. */
export const CONSENT_PURPOSE_FIELD: Record<WellnessConsentPurpose, "birthYear" | "sex"> = {
  age_band: "birthYear",
  sex: "sex",
};

export function answersEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(normalizeAnswer(a)) === JSON.stringify(normalizeAnswer(b));
}

function normalizeAnswer(answer: unknown): unknown {
  if (answer && typeof answer === "object" && "value" in answer) {
    const { state, value } = answer as { state: string; value: unknown };
    return { state, value: Array.isArray(value) ? [...value].sort() : value };
  }
  return answer;
}

/**
 * Applies a validated partial update to the current state.
 *
 * Effects beyond the requested keys are explicit and limited:
 * - Moving the adult answer away from `adult` clears a stored birth year and
 *   sex, because their only purposes are adult-only.
 * - Withdrawing a purpose's consent clears the value it covered.
 * Recording a birth year or sex in the same request that would immediately
 * clear it is rejected instead, so a request never "succeeds" silently.
 */
export function applyWellnessProfileUpdate(
  current: WellnessProfileState,
  input: WellnessProfileUpdateInput,
  now: Date,
): WellnessProfileApplyResult {
  const answers: WellnessProfileAnswers = { ...current.answers };
  for (const field of WELLNESS_PROFILE_FIELDS) {
    const next = input[field];
    if (next !== undefined) (answers as Record<string, unknown>)[field] = next;
  }

  const activeConsents = { ...current.activeConsents };
  const consentChanges: { purpose: WellnessConsentPurpose; action: WellnessConsentAction }[] = [];
  for (const purpose of WELLNESS_CONSENT_PURPOSES) {
    const action = input.consents?.[purpose];
    if (action === undefined) continue;
    const wantActive = action === "grant";
    if (activeConsents[purpose] !== wantActive) {
      activeConsents[purpose] = wantActive;
      consentChanges.push({ purpose, action });
    }
  }

  const adult = answers.eligibility.state === "recorded" && answers.eligibility.value === "adult";

  for (const purpose of WELLNESS_CONSENT_PURPOSES) {
    const field = CONSENT_PURPOSE_FIELD[purpose];
    if (answers[field].state !== "recorded") continue;
    const requestedNow = input[field]?.state === "recorded";
    if (!adult) {
      if (requestedNow) return { ok: false, reason: "ADULT_CONFIRMATION_REQUIRED", field };
      answers[field] = { state: "unknown" };
      continue;
    }
    if (!activeConsents[purpose]) {
      if (requestedNow) {
        const reason =
          input.consents?.[purpose] === "withdraw"
            ? "CONSENT_AND_VALUE_CONFLICT"
            : "CONSENT_REQUIRED";
        return { ok: false, reason, field };
      }
      answers[field] = { state: "unknown" };
    }
  }

  if (answers.birthYear.state === "recorded" && input.birthYear?.state === "recorded") {
    const age = now.getUTCFullYear() - answers.birthYear.value;
    // `age` is the age reached this calendar year; someone born in that year
    // may still be one year younger. Under 18 by year alone is never accepted:
    // a birth year is not a way to record a minor.
    if (age < 0 || age > MAX_AGE_YEARS) {
      return { ok: false, reason: "BIRTH_YEAR_OUT_OF_RANGE", field: "birthYear" };
    }
    if (age < ADULT_AGE_YEARS) {
      return { ok: false, reason: "BIRTH_YEAR_UNDER_18", field: "birthYear" };
    }
  }

  const changedFields: string[] = [];
  const setupStatus = input.setupStatus ?? current.setupStatus;
  if (setupStatus !== current.setupStatus) changedFields.push("setupStatus");
  for (const field of WELLNESS_PROFILE_FIELDS) {
    if (!answersEqual(answers[field], current.answers[field])) changedFields.push(field);
  }

  return {
    ok: true,
    next: { setupStatus, answers, activeConsents },
    changedFields,
    consentChanges,
  };
}

/** Extracts the comparable state from a snapshot. */
export function snapshotToState(snapshot: WellnessProfileSnapshot): WellnessProfileState {
  return {
    setupStatus: snapshot.setupStatus,
    answers: {
      eligibility: snapshot.eligibility,
      focus: snapshot.focus,
      inputMethod: snapshot.inputMethod,
      region: snapshot.region,
      birthYear: snapshot.birthYear,
      sex: snapshot.sex,
    },
    activeConsents: {
      age_band: snapshot.consents.age_band?.active === true,
      sex: snapshot.consents.sex?.active === true,
    },
  };
}

// ─── Inputs for dependent features (#95, #96, #97) ─────────────

export const WELLNESS_AGE_BANDS = ["18-29", "30-39", "40-49", "50-59", "60-69", "70+"] as const;
export type WellnessAgeBand = (typeof WELLNESS_AGE_BANDS)[number];

export type WellnessUnavailableReason =
  /** Never answered. */
  | "not_provided"
  | "declined"
  | "not_applicable"
  /** The person has not confirmed they are 18 or older (or said they are not). */
  | "adult_confirmation_required"
  /** The purpose consent is missing or withdrawn. */
  | "consent_required"
  /** Birth year alone cannot place the person in one band right now. */
  | "age_band_ambiguous";

export type WellnessAvailability<T> =
  | { available: true; value: T }
  | { available: false; reason: WellnessUnavailableReason };

export type WellnessProfileInputs = {
  /** `true` only for an explicit, recorded "18 or older" answer. */
  adultConfirmed: boolean;
  /** `unknown` covers never answered and declined. */
  eligibility: WellnessEligibility | "unknown";
  /** Age in whole years is one of `minAge`/`maxAge` (birthday unknown). */
  ageRange: WellnessAvailability<{ minAge: number; maxAge: number }>;
  ageBand: WellnessAvailability<WellnessAgeBand>;
  sex: WellnessAvailability<WellnessSex>;
  region: WellnessAvailability<WellnessRegion>;
  focus: WellnessAvailability<readonly WellnessFocusArea[]>;
  inputMethod: WellnessAvailability<WellnessInputMethod>;
};

function unavailableFor(answer: { state: string }): WellnessUnavailableReason {
  if (answer.state === "declined") return "declined";
  if (answer.state === "not_applicable") return "not_applicable";
  return "not_provided";
}

export function ageBandForAge(age: number): WellnessAgeBand | null {
  if (age < ADULT_AGE_YEARS) return null;
  if (age >= 70) return "70+";
  if (age < 30) return "18-29";
  return `${Math.floor(age / 10) * 10}-${Math.floor(age / 10) * 10 + 9}` as WellnessAgeBand;
}

/**
 * The profile inputs a dependent feature may use, each either available or
 * unavailable with a reason to explain. Adult-only inputs (age, sex) are
 * withheld unless the adult answer is recorded and the purpose consent is
 * active. Nothing is defaulted: a feature that needs an unavailable input must
 * stay unavailable and say why (see {@link unavailableExplanation}).
 */
export function deriveWellnessProfileInputs(
  snapshot: WellnessProfileSnapshot,
  asOf: Date,
): WellnessProfileInputs {
  const eligibility = snapshot.eligibility.state === "recorded" ? snapshot.eligibility.value : null;
  const adultConfirmed = eligibility === "adult";

  let ageRange: WellnessProfileInputs["ageRange"];
  let ageBand: WellnessProfileInputs["ageBand"];
  if (!adultConfirmed) {
    ageRange = ageBand = { available: false, reason: "adult_confirmation_required" };
  } else if (
    snapshot.consents.age_band?.active !== true &&
    snapshot.birthYear.state === "recorded"
  ) {
    ageRange = ageBand = { available: false, reason: "consent_required" };
  } else if (snapshot.birthYear.state !== "recorded") {
    ageRange = ageBand = { available: false, reason: unavailableFor(snapshot.birthYear) };
  } else {
    const maxAge = asOf.getUTCFullYear() - snapshot.birthYear.value;
    // The person confirmed they are an adult, so the lower bound is at least 18.
    const minAge = Math.max(maxAge - 1, ADULT_AGE_YEARS);
    ageRange = { available: true, value: { minAge, maxAge } };
    const low = ageBandForAge(minAge);
    const high = ageBandForAge(maxAge);
    ageBand =
      low && low === high
        ? { available: true, value: low }
        : { available: false, reason: "age_band_ambiguous" };
  }

  let sex: WellnessProfileInputs["sex"];
  if (!adultConfirmed) sex = { available: false, reason: "adult_confirmation_required" };
  else if (snapshot.sex.state !== "recorded")
    sex = { available: false, reason: unavailableFor(snapshot.sex) };
  else if (snapshot.consents.sex?.active !== true)
    sex = { available: false, reason: "consent_required" };
  else sex = { available: true, value: snapshot.sex.value };

  return {
    adultConfirmed,
    eligibility: eligibility ?? "unknown",
    ageRange,
    ageBand,
    sex,
    region:
      snapshot.region.state === "recorded"
        ? { available: true, value: snapshot.region.value }
        : { available: false, reason: unavailableFor(snapshot.region) },
    focus:
      snapshot.focus.state === "recorded"
        ? { available: true, value: snapshot.focus.value }
        : { available: false, reason: "not_provided" },
    inputMethod:
      snapshot.inputMethod.state === "recorded"
        ? { available: true, value: snapshot.inputMethod.value }
        : { available: false, reason: unavailableFor(snapshot.inputMethod) },
  };
}

// ─── Copy shared by web and native ─────────────────────────────

export const FOCUS_AREA_LABELS: Record<WellnessFocusArea, string> = {
  sleep_recovery: "Sleep and recovery",
  activity_fitness: "Activity and fitness",
  nutrition: "Nutrition",
  body_goals: "Body goals",
  wellbeing: "Wellbeing",
};

export const INPUT_METHOD_LABELS: Record<WellnessInputMethod, string> = {
  manual: "I'll enter things myself",
  device: "From a device or app",
  both: "Both",
};

export const REGION_LABELS: Record<WellnessRegion, string> = {
  us: "United States",
  uk: "United Kingdom",
  pt: "Portugal (EU)",
};

export const SEX_LABELS: Record<WellnessSex, string> = {
  female: "Female",
  male: "Male",
};

export const ELIGIBILITY_LABELS: Record<WellnessEligibility, string> = {
  adult: "Yes, I'm 18 or older",
  under_18: "No, I'm under 18",
};

export const DECLINE_LABEL = "Prefer not to say";
export const SEX_NOT_APPLICABLE_LABEL = "Neither fits me";
export const JUST_EXPLORING_LABEL = "Just exploring";

/** Where profile answers live and who can see them (same for every field). */
export const PROFILE_STORAGE_NOTE =
  "Saved to your own profile on this OpenValens server. Only you can see it — people you share a workspace with cannot. It is included in your data export and erased when you delete your account.";

export const PROFILE_INTRO =
  "Everything here is optional. Answer what is useful to you, skip the rest, and change it any time in Settings. Skipping never blocks the rest of the app.";

export const PROFILE_OFFLINE_NOTE =
  "Saving needs a connection. Changes you have not saved stay on this screen but are not stored anywhere yet.";

export type WellnessFieldCopy = {
  title: string;
  question: string;
  /** Why we ask: the named purpose. */
  purpose: string;
  /** Limits and what the answer does not mean. */
  limits: string;
};

export const WELLNESS_FIELD_COPY: Record<WellnessProfileField, WellnessFieldCopy> = {
  eligibility: {
    title: "Age check",
    question: "Are you 18 or older?",
    purpose:
      "OpenValens personalisation is designed for adults. Features that use age, sex or guideline ranges only turn on after you confirm you are 18 or older.",
    limits:
      "If you are under 18 or prefer not to say, you can still keep your own records; adult-only personalisation stays off. We never guess your age.",
  },
  focus: {
    title: "What brings you here",
    question: "Which areas do you want to focus on?",
    purpose:
      "Used to choose which of your records to show first. It is a preference, not a measurement, and does not set any target.",
    limits: "Pick any, none, or 'Just exploring'. You can change it at any time.",
  },
  inputMethod: {
    title: "How you'll add data",
    question: "How do you plan to add your data?",
    purpose:
      "Used to show the relevant ways to add records. Manual entry always works; a device is never required.",
    limits:
      "Choosing a device here does not connect anything or share any data. Connecting a device is a separate step with its own permissions.",
  },
  region: {
    title: "Region",
    question: "Where do you live?",
    purpose:
      "Some features show public-health guidance from authorities in your region. Without a region they show an explanation instead of a list.",
    limits: "Only the region is stored — never a location or address.",
  },
  birthYear: {
    title: "Birth year",
    question: "What year were you born?",
    purpose:
      "Lets features that show age-specific public-health guidance or reference ranges place you in a broad age band. Each of those features asks you to turn it on separately.",
    limits:
      "Year only — never your full date of birth. Your age is worked out as a range (for example 34–35). Requires your consent for this purpose, which you can withdraw at any time; withdrawing deletes the stored year.",
  },
  sex: {
    title: "Sex for reference tables",
    question: "Which sex should reference tables use for you?",
    purpose:
      "Some published guidelines and reference tables are split into female and male. Features that use them can match the right table. Each of those features asks you to turn it on separately.",
    limits:
      "This is not your gender identity and we never infer it. If neither option fits, or you prefer not to say, anything that needs it stays unavailable rather than guessing. Requires your consent for this purpose; withdrawing deletes the stored answer.",
  },
};

export const CONSENT_COPY: Record<WellnessConsentPurpose, string> = {
  age_band:
    "I agree that OpenValens may store my birth year and use it to place me in a broad age band for age-specific guidance and reference ranges.",
  sex: "I agree that OpenValens may store this answer and use it to choose sex-specific guidance and reference tables.",
};

const UNAVAILABLE_COPY: Record<WellnessUnavailableReason, string> = {
  not_provided: "You haven't added this yet.",
  declined: "You chose not to share this.",
  not_applicable: "You said neither option fits you.",
  adult_confirmation_required: "This is only available after you confirm you are 18 or older.",
  consent_required: "This needs your consent for this purpose.",
  age_band_ambiguous: "Your birth year falls on the edge of two age bands.",
};

/**
 * Plain-language explanation of why a dependent feature cannot use an input,
 * e.g. `unavailableExplanation("not_provided", "your region")`.
 */
export function unavailableExplanation(reason: WellnessUnavailableReason, needed?: string): string {
  const base = UNAVAILABLE_COPY[reason];
  return needed ? `${base} Add ${needed} in your profile to use this.` : base;
}

/** Human-readable summary of a stored answer, e.g. for the settings overview. */
export function describeAnswer(
  field: WellnessProfileField,
  answer: { state: string; value?: unknown },
): string {
  switch (answer.state) {
    case "unknown":
      return "Not answered";
    case "declined":
      return DECLINE_LABEL;
    case "not_applicable":
      return SEX_NOT_APPLICABLE_LABEL;
    case "just_exploring":
      return JUST_EXPLORING_LABEL;
  }
  const value = answer.value;
  switch (field) {
    case "eligibility":
      return ELIGIBILITY_LABELS[value as WellnessEligibility];
    case "focus":
      return (value as WellnessFocusArea[]).map((area) => FOCUS_AREA_LABELS[area]).join(", ");
    case "inputMethod":
      return INPUT_METHOD_LABELS[value as WellnessInputMethod];
    case "region":
      return REGION_LABELS[value as WellnessRegion];
    case "birthYear":
      return String(value);
    case "sex":
      return SEX_LABELS[value as WellnessSex];
  }
}
