import { z } from "zod";

import { WELLNESS_REGIONS, type WellnessRegion } from "./wellness-profile-contract";

/**
 * Issue #97 — preventive care by region. Wire contract only (pure: no DB, no
 * domain packages) so web and native import it safely.
 *
 * What it is: the app *displays* what established public-health authorities
 * in the person's chosen region publish for people of their age and sex, as
 * short cited facts (population, interval, the authority's own grade) with a
 * deep link. It never diagnoses, computes a risk, reads a lab value, orders a
 * test or invents an interval. See `docs/preventive-care.md`.
 *
 * - Guideline items are versioned data (`preventive-care-pack.ts`), each with
 *   its source URL, statement date, retrieval date, source version, reviewer
 *   and expiry. `preventive-care-pack.test.ts` fails the build when any item
 *   lacks one of them.
 * - Filtering uses only region, the #98 age range (from birth year, with
 *   consent), the #98 sex for reference tables (with consent) and the
 *   person's own self-declarations. Nothing is inferred.
 * - Self-declared criteria are never pre-selected and can be answered
 *   "prefer not to say".
 * - Reminders are opt-in per item (a date the person sets) and go out only
 *   through the #92 push/email channels the person turned on.
 * - The evidence-check library is a separate, opt-in list. It never becomes
 *   a reminder and contains no doses.
 */

export const PREVENTIVE_CARE_ENGINE_VERSION = "preventive-care-0.1.0";

export const PREVENTIVE_REGIONS = WELLNESS_REGIONS;
export type PreventiveRegion = WellnessRegion;

/** Allowed sources (registry). NICE is link-only and not used in this pack. */
export const PREVENTIVE_AUTHORITIES = ["uspstf", "nhs_england", "dgs"] as const;
export type PreventiveAuthority = (typeof PREVENTIVE_AUTHORITIES)[number];

/** USPSTF letter grades, mirrored as published. */
export const USPSTF_GRADES = ["A", "B", "C", "D", "I"] as const;
export type UspstfGrade = (typeof USPSTF_GRADES)[number];

/** Organised programmes are policy decisions, not graded evidence: no letter is forced onto them. */
export const PROGRAMME_KINDS = [
  "nhs_screening_programme",
  "nhs_health_check",
  "sns_screening_programme",
] as const;
export type ProgrammeKind = (typeof PROGRAMME_KINDS)[number];

export const preventiveGradeSchema = z.discriminatedUnion("scale", [
  z.strictObject({ scale: z.literal("uspstf"), value: z.enum(USPSTF_GRADES) }),
  z.strictObject({ scale: z.literal("programme"), value: z.enum(PROGRAMME_KINDS) }),
]);
export type PreventiveGrade = z.infer<typeof preventiveGradeSchema>;

/**
 * How the app treats an item, derived only from the authority's own grade:
 * - `recommended`         USPSTF A/B — the person may set dates and reminders.
 * - `programme`           NHS/SNS organised programme — "expect your invitation".
 * - `individual_decision` USPSTF C — no countdown, decision-aid link, "decided: …".
 * - `evidence_uncertain`  USPSTF I — informational only.
 * - `not_recommended`     USPSTF D — informational only, labelled "not recommended".
 * There is no app-invented "critical" band.
 */
export const PREVENTIVE_BANDS = [
  "recommended",
  "programme",
  "individual_decision",
  "evidence_uncertain",
  "not_recommended",
] as const;
export type PreventiveBand = (typeof PREVENTIVE_BANDS)[number];

export function bandForGrade(grade: PreventiveGrade): PreventiveBand {
  if (grade.scale === "programme") return "programme";
  switch (grade.value) {
    case "A":
    case "B":
      return "recommended";
    case "C":
      return "individual_decision";
    case "I":
      return "evidence_uncertain";
    case "D":
      return "not_recommended";
  }
}

/** Bands for which a person may set a date and turn on a reminder. */
export const REMINDER_BANDS: readonly PreventiveBand[] = ["recommended", "programme"];
/** Bands for which the person may record "decided: yes / no / later". */
export const DECISION_BANDS: readonly PreventiveBand[] = ["individual_decision"];

// ─── self-declared criteria ────────────────────────────────────

/**
 * Extra criteria some items depend on. They are only ever *declared* by the
 * person, never inferred, and only asked when an item in their region needs
 * them. Each answer is optional and can be cleared.
 */
export const PREVENTIVE_CRITERIA = [
  "uspstf_lung_smoking_history",
  "ever_smoked",
  "nhs_health_check_listed_condition",
] as const;
export type PreventiveCriterion = (typeof PREVENTIVE_CRITERIA)[number];

export const DECLARATION_ANSWERS = ["yes", "no", "prefer_not_to_say"] as const;
export type DeclarationAnswer = (typeof DECLARATION_ANSWERS)[number];

// ─── rule pack (versioned data) ────────────────────────────────

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const preventiveItemSchema = z.strictObject({
  /** Stable id `<region>.<topic>`; history is keyed by it, so it never changes meaning. */
  id: z.string().regex(/^(us|uk|pt)\.[a-z0-9_]+$/),
  /** Bumped whenever any field below changes. */
  version: z.int().positive(),
  region: z.enum(PREVENTIVE_REGIONS),
  authority: z.enum(PREVENTIVE_AUTHORITIES),
  /** Short neutral label for the item, e.g. "Breast screening (mammogram)". */
  title: z.string().min(3).max(80),
  /** The authority's own page/statement title, e.g. "Breast Cancer: Screening". */
  statementTitle: z.string().min(3).max(160),
  /** Publication / release date of the statement, or the page's "last reviewed" date. */
  statementDate: isoDate,
  /** Deep link to the primary public source. */
  sourceUrl: z.url().startsWith("https://"),
  /** Exact source version cited, e.g. "Final Recommendation Statement, 30 April 2024". */
  sourceVersion: z.string().min(3).max(160),
  /** Date the source was fetched and compared with these fields. */
  retrievedOn: isoDate,
  grade: preventiveGradeSchema,
  population: z.strictObject({
    /** The authority's own sex field; `any` when the source does not split by sex. */
    sex: z.enum(["female", "male", "any"]),
    minAge: z.int().min(18).max(120),
    /** Inclusive; `null` = no upper limit in the source. */
    maxAge: z.int().min(18).max(120).nullable(),
    /** Self-declared criteria the source names; the item applies only when each is met. */
    criteria: z.array(
      z.strictObject({
        criterion: z.enum(PREVENTIVE_CRITERIA),
        /** The answer that meets the criterion. */
        meetsWhen: z.enum(["yes", "no"]),
      }),
    ),
  }),
  /** Short factual interval as published ("Every 2 years"), or null when none is stated. */
  intervalText: z.string().min(3).max(160).nullable(),
  /**
   * Months to *suggest* for the next date after a done date, only when the
   * source states one fixed interval. Never applied without the person
   * accepting it.
   */
  suggestMonths: z.int().positive().max(240).nullable(),
  /** `user_date` — the person sets dates; `expect_invitation` — the programme invites; `none`. */
  reminderMode: z.enum(["user_date", "expect_invitation", "none"]),
  /** Validated decision-aid inventory for individual-decision items. */
  decisionAidUrl: z.url().startsWith("https://").nullable(),
  /** Short factual note (scope, who runs it). Never copied guideline text. */
  note: z.string().max(240).nullable(),
  /** Who checked these fields against the source (fidelity, not clinical applicability). */
  reviewer: z.string().min(3).max(120),
  reviewedOn: isoDate,
  /** After this date the item is suppressed with a "being reviewed" notice. */
  reviewBy: isoDate,
});
export type PreventiveItem = z.infer<typeof preventiveItemSchema>;

export const preventiveCriterionSchema = z.strictObject({
  id: z.enum(PREVENTIVE_CRITERIA),
  /** Plain-language question. Neutral; never pre-answered. */
  question: z.string().min(10).max(200),
  /** Why it is asked and what happens to the answer. */
  purpose: z.string().min(10).max(300),
});
export type PreventiveCriterionDefinition = z.infer<typeof preventiveCriterionSchema>;

export const preventivePackSchema = z.strictObject({
  version: z.string().regex(/^\d{4}-\d{2}-\d{2}\.\d+$/),
  /** Maximum days between review and expiry (≤ 90, the issue's governance rule). */
  maxReviewDays: z.int().positive().max(90),
  criteria: z.array(preventiveCriterionSchema),
  items: z.array(preventiveItemSchema),
});
export type PreventivePack = z.infer<typeof preventivePackSchema>;

// ─── per-person state ──────────────────────────────────────────

/**
 * What the person recorded for one item:
 * - `none`              — nothing chosen.
 * - `expect_invitation` — programme items: wait for the health system's letter.
 * - `decided_yes|no|later` — individual-decision items. "Decided: no" is a
 *   legitimate end state and stops any reminder.
 */
export const ITEM_PLANS = [
  "none",
  "expect_invitation",
  "decided_yes",
  "decided_no",
  "decided_later",
] as const;
export type ItemPlan = (typeof ITEM_PLANS)[number];

export const itemStateSchema = z.strictObject({
  plan: z.enum(ITEM_PLANS),
  lastDoneOn: isoDate.nullable(),
  nextOn: isoDate.nullable(),
  remind: z.boolean(),
  updatedAt: z.string().nullable(),
});
export type ItemState = z.infer<typeof itemStateSchema>;

export const EMPTY_ITEM_STATE: ItemState = Object.freeze({
  plan: "none",
  lastDoneOn: null,
  nextOn: null,
  remind: false,
  updatedAt: null,
});

// ─── engine output ─────────────────────────────────────────────

/**
 * Whether an item matches the person, from their own inputs only:
 * - `applies`          — age, sex and every declared criterion match.
 * - `may_apply`        — age and sex match; a criterion is not answered "yes"/"no" yet.
 * - `age_edge`         — the birth year straddles the item's age limit.
 * - `needs_age`        — no usable age range (#98 explains why).
 * - `needs_sex`        — the item is sex-specific and no usable sex is recorded.
 * - `outside_age_or_sex` — hidden; listed under "not shown".
 * - `declared_not_met` — hidden; the person declared a criterion not met.
 */
export const APPLICABILITY = [
  "applies",
  "may_apply",
  "age_edge",
  "needs_age",
  "needs_sex",
  "outside_age_or_sex",
  "declared_not_met",
] as const;
export type Applicability = (typeof APPLICABILITY)[number];

export const HIDDEN_APPLICABILITY: readonly Applicability[] = [
  "outside_age_or_sex",
  "declared_not_met",
];

export const UNAVAILABLE_INPUT_REASONS = [
  "not_provided",
  "declined",
  "not_applicable",
  "adult_confirmation_required",
  "consent_required",
  "age_band_ambiguous",
] as const;

export const preventiveItemViewSchema = z.object({
  id: z.string(),
  version: z.int(),
  title: z.string(),
  statementTitle: z.string(),
  authority: z.enum(PREVENTIVE_AUTHORITIES),
  band: z.enum(PREVENTIVE_BANDS),
  grade: preventiveGradeSchema,
  statementDate: z.string(),
  sourceUrl: z.string(),
  sourceVersion: z.string(),
  retrievedOn: z.string(),
  reviewedOn: z.string(),
  reviewBy: z.string(),
  /** Past `reviewBy`: details and reminders are suppressed until re-reviewed. */
  beingReviewed: z.boolean(),
  applicability: z.enum(APPLICABILITY),
  population: preventiveItemSchema.shape.population,
  intervalText: z.string().nullable(),
  reminderMode: z.enum(["user_date", "expect_invitation", "none"]),
  decisionAidUrl: z.string().nullable(),
  note: z.string().nullable(),
  state: itemStateSchema,
  /** Done date + the source's single fixed interval, offered for the person to accept. */
  suggestedNextOn: z.string().nullable(),
  /** The person's own date has arrived (never shown as "overdue"; never for decision items). */
  dateReached: z.boolean(),
  canRemind: z.boolean(),
  canDecide: z.boolean(),
});
export type PreventiveItemView = z.infer<typeof preventiveItemViewSchema>;

export const PREVENTIVE_STATUSES = [
  "available",
  "no_region",
  "adult_confirmation_required",
  "owner_only",
] as const;
export type PreventiveStatus = (typeof PREVENTIVE_STATUSES)[number];

export const preventiveCareResultSchema = z.object({
  engineVersion: z.string(),
  packVersion: z.string(),
  asOf: z.string(),
  status: z.enum(PREVENTIVE_STATUSES),
  region: z.enum(PREVENTIVE_REGIONS).nullable(),
  /** Why age or sex could not be used (from #98); null when available. */
  ageUnavailable: z.enum(UNAVAILABLE_INPUT_REASONS).nullable(),
  sexUnavailable: z.enum(UNAVAILABLE_INPUT_REASONS).nullable(),
  items: z.array(preventiveItemViewSchema),
  /** Items in the region that do not match; listed by title so nothing is silently hidden. */
  notShown: z.array(
    z.object({ id: z.string(), title: z.string(), applicability: z.enum(APPLICABILITY) }),
  ),
  /** Criteria asked by items in this region, with the person's answer (never pre-filled). */
  criteria: z.array(
    z.object({
      id: z.enum(PREVENTIVE_CRITERIA),
      question: z.string(),
      purpose: z.string(),
      answer: z.enum(DECLARATION_ANSWERS).nullable(),
    }),
  ),
  libraryEnabled: z.boolean(),
  /** Workspace owner on a non-impersonated session. */
  canEdit: z.boolean(),
  /** In-app highlighting of reached dates (the `reminder:in_app` setting). */
  showDateReached: z.boolean(),
});
export type PreventiveCareResult = z.infer<typeof preventiveCareResultSchema>;

// ─── inputs ────────────────────────────────────────────────────

export const preventiveCareGetInput = z.strictObject({});

export const preventiveDeclareInput = z.strictObject({
  criterion: z.enum(PREVENTIVE_CRITERIA),
  /** `null` clears the answer (deletes the stored declaration). */
  answer: z.enum(DECLARATION_ANSWERS).nullable(),
});

export const preventiveItemUpdateInput = z.strictObject({
  itemId: z.string().min(4).max(80),
  plan: z.enum(ITEM_PLANS).optional(),
  lastDoneOn: isoDate.nullable().optional(),
  nextOn: isoDate.nullable().optional(),
  remind: z.boolean().optional(),
});
export type PreventiveItemUpdate = z.infer<typeof preventiveItemUpdateInput>;

export const preventiveSettingsUpdateInput = z.strictObject({
  libraryEnabled: z.boolean(),
});

export const preventiveSettingsOutput = z.object({ libraryEnabled: z.boolean() });

// ─── evidence-check library ────────────────────────────────────

/**
 * GRADE-style certainty, used for wording only ("will" / "probably" / "may" /
 * "very uncertain"). `not_graded` when the source is a guideline grade or a
 * consensus statement rather than a certainty rating.
 */
export const EVIDENCE_CERTAINTIES = ["high", "moderate", "low", "very_low", "not_graded"] as const;
export type EvidenceCertainty = (typeof EVIDENCE_CERTAINTIES)[number];

export const EVIDENCE_VERDICTS = [
  "guideline_backed",
  "clinician_decision",
  "may_help_slightly",
  "little_or_no_benefit",
  "evidence_uncertain",
  "not_recommended",
  "investigational",
] as const;
export type EvidenceVerdict = (typeof EVIDENCE_VERDICTS)[number];

export const EVIDENCE_SOURCE_KINDS = [
  "randomised_trial",
  "systematic_review",
  "guideline",
  "consensus_statement",
  "trial_report",
  "reference",
] as const;

/**
 * - `checked_on_retrieval` — the cited fields were compared with the source on `retrievedOn`.
 * - `from_research_brief`  — taken from the repo's reviewed research brief
 *   (docs/research/reports/Preventive care recommendation evidence.md);
 *   still needs a maintainer to compare with the source.
 */
export const EVIDENCE_VERIFICATION = ["checked_on_retrieval", "from_research_brief"] as const;

export const evidenceEntrySchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9_]+$/),
  version: z.int().positive(),
  title: z.string().min(3).max(80),
  verdict: z.enum(EVIDENCE_VERDICTS),
  certainty: z.enum(EVIDENCE_CERTAINTIES),
  /** Plain-language summary with GRADE wording. No doses, no influencer as authority. */
  summary: z.string().min(20).max(500),
  harms: z.string().max(300).nullable(),
  /** Who should take extra care, when a primary source says so. */
  cautions: z.string().max(300).nullable(),
  sources: z
    .array(
      z.strictObject({
        citation: z.string().min(10).max(240),
        url: z.url().startsWith("https://"),
        kind: z.enum(EVIDENCE_SOURCE_KINDS),
        verification: z.enum(EVIDENCE_VERIFICATION),
        retrievedOn: isoDate,
      }),
    )
    .min(1),
  reviewBy: isoDate,
});
export type EvidenceEntry = z.infer<typeof evidenceEntrySchema>;

export const evidenceLibrarySchema = z.strictObject({
  version: z.string().regex(/^\d{4}-\d{2}-\d{2}\.\d+$/),
  entries: z.array(evidenceEntrySchema),
});
export type EvidenceLibrary = z.infer<typeof evidenceLibrarySchema>;

export const evidenceLibraryResultSchema = z.object({
  enabled: z.boolean(),
  version: z.string(),
  entries: z.array(evidenceEntrySchema),
});
export type EvidenceLibraryResult = z.infer<typeof evidenceLibraryResultSchema>;

export const evidenceLibraryInput = z.strictObject({});

// ─── helpers (shared by server, web and native) ────────────────

/** YYYY-MM-DD + n calendar months, clamped to the month's last day (UTC). */
export function addMonths(date: string, months: number): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

export function isValidIsoDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}
