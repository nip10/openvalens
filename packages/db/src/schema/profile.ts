import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "./auth";

// ─── Wellness profile (Issue #98) ─────────────────────────────
//
// Optional, user-owned profile foundations. The row belongs to the person
// (`user_id`), not to a workspace: switching organization never changes it and
// no workspace role (owner, collaborator, viewer) grants access to it.
//
// Every answer is stored as a `<field>_state` plus a value column so "never
// answered" (state null), "declined", "not applicable" and a recorded value
// stay distinct. A value is present exactly when its state is `recorded`; the
// check constraints below make any other combination unrepresentable (each
// `recorded` branch tests `is not null` explicitly, because a CHECK that
// evaluates to NULL passes).

/**
 * One row per user. `revision` is the optimistic-concurrency counter and only
 * increases when a stored answer actually changes. No column here is required:
 * a missing row and a row of nulls both mean "nothing answered yet".
 */
export const wellnessProfile = pgTable(
  "wellness_profile",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull().default(0),
    /** `in_progress` | `skipped` | `completed`; null = setup never opened. */
    setupStatus: text("setup_status"),
    /** Self-declared adult policy answer: `recorded` value `adult` | `under_18`. */
    eligibilityState: text("eligibility_state"),
    eligibility: text("eligibility"),
    /** `recorded` (one or more areas) | `just_exploring`. */
    focusState: text("focus_state"),
    focusAreas: text("focus_areas").array(),
    /** `recorded` (`manual` | `device` | `both`) | `declined`. */
    inputMethodState: text("input_method_state"),
    inputMethod: text("input_method"),
    /** `recorded` (`us` | `uk` | `pt`) | `declined`. */
    regionState: text("region_state"),
    region: text("region"),
    /** `recorded` | `declined`. Year only — never a full date of birth. */
    birthYearState: text("birth_year_state"),
    birthYear: integer("birth_year"),
    /** `recorded` (`female` | `male`) | `declined` | `not_applicable`. */
    sexState: text("sex_state"),
    sex: text("sex"),
    /**
     * Onboarding stage 1: the modules the person switched on (`sleep`,
     * `activity`, …). `null` = never chosen, which means every module is on, so
     * nothing disappears for accounts that predate onboarding. An empty array
     * is a real choice (everything off). Hiding a module never deletes data.
     */
    enabledModules: text("enabled_modules").array(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    wellnessProfileRevisionCheck: check(
      "wellness_profile_revision_check",
      sql`${table.revision} >= 0`,
    ),
    wellnessProfileSetupStatusCheck: check(
      "wellness_profile_setup_status_check",
      sql`${table.setupStatus} is null or ${table.setupStatus} in ('in_progress', 'skipped', 'completed')`,
    ),
    wellnessProfileEligibilityCheck: check(
      "wellness_profile_eligibility_check",
      sql`(${table.eligibilityState} is null and ${table.eligibility} is null)
        or (${table.eligibilityState} = 'declined' and ${table.eligibility} is null)
        or (${table.eligibilityState} = 'recorded' and ${table.eligibility} is not null and ${table.eligibility} in ('adult', 'under_18'))`,
    ),
    wellnessProfileFocusCheck: check(
      "wellness_profile_focus_check",
      sql`(${table.focusState} is null and ${table.focusAreas} is null)
        or (${table.focusState} = 'just_exploring' and ${table.focusAreas} is null)
        or (${table.focusState} = 'recorded' and ${table.focusAreas} is not null and cardinality(${table.focusAreas}) between 1 and 5
          and ${table.focusAreas} <@ array['sleep_recovery', 'activity_fitness', 'nutrition', 'body_goals', 'wellbeing']::text[])`,
    ),
    wellnessProfileInputMethodCheck: check(
      "wellness_profile_input_method_check",
      sql`(${table.inputMethodState} is null and ${table.inputMethod} is null)
        or (${table.inputMethodState} = 'declined' and ${table.inputMethod} is null)
        or (${table.inputMethodState} = 'recorded' and ${table.inputMethod} is not null and ${table.inputMethod} in ('manual', 'device', 'both'))`,
    ),
    wellnessProfileRegionCheck: check(
      "wellness_profile_region_check",
      sql`(${table.regionState} is null and ${table.region} is null)
        or (${table.regionState} = 'declined' and ${table.region} is null)
        or (${table.regionState} = 'recorded' and ${table.region} is not null and ${table.region} in ('us', 'uk', 'pt'))`,
    ),
    wellnessProfileBirthYearCheck: check(
      "wellness_profile_birth_year_check",
      sql`(${table.birthYearState} is null and ${table.birthYear} is null)
        or (${table.birthYearState} = 'declined' and ${table.birthYear} is null)
        or (${table.birthYearState} = 'recorded' and ${table.birthYear} is not null and ${table.birthYear} between 1900 and 2100)`,
    ),
    wellnessProfileEnabledModulesCheck: check(
      "wellness_profile_enabled_modules_check",
      sql`${table.enabledModules} is null or ${table.enabledModules} <@ array['sleep', 'activity', 'heart', 'body', 'food', 'supplements', 'labs', 'cycle', 'coach', 'care']::text[]`,
    ),
    wellnessProfileSexCheck: check(
      "wellness_profile_sex_check",
      sql`(${table.sexState} is null and ${table.sex} is null)
        or (${table.sexState} in ('declined', 'not_applicable') and ${table.sex} is null)
        or (${table.sexState} = 'recorded' and ${table.sex} is not null and ${table.sex} in ('female', 'male'))`,
    ),
  }),
);

/**
 * Purpose-specific consent records for the profile fields that need one
 * (`age_band`, `sex`). Append-only history: granting inserts a row with the
 * disclosure version agreed to; withdrawing stamps `withdrawn_at` on the active
 * row. At most one active (not withdrawn) row exists per user and purpose.
 * Holds no profile values.
 */
export const wellnessProfileConsent = pgTable(
  "wellness_profile_consent",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    purpose: text("purpose").notNull(),
    version: text("version").notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true, mode: "date" }),
  },
  (table) => ({
    wellnessProfileConsentUserIdx: index("wellness_profile_consent_user_id_idx").on(table.userId),
    wellnessProfileConsentActiveUnique: uniqueIndex("wellness_profile_consent_active_key")
      .on(table.userId, table.purpose)
      .where(sql`${table.withdrawnAt} is null`),
    wellnessProfileConsentPurposeCheck: check(
      "wellness_profile_consent_purpose_check",
      sql`${table.purpose} in ('age_band', 'sex')`,
    ),
    wellnessProfileConsentWithdrawnCheck: check(
      "wellness_profile_consent_withdrawn_after_granted_check",
      sql`${table.withdrawnAt} is null or ${table.withdrawnAt} >= ${table.grantedAt}`,
    ),
  }),
);

// ─── Reference comparisons (Issue #96) ────────────────────────
//
// Per-metric opt-in for comparing the person's own values with published
// reference ranges. User-owned like the wellness profile it depends on (age
// band and sex): a workspace role never reaches it. A row exists exactly while
// the comparison is on; turning it off deletes the row. `reference_version` is
// the reference-data version whose sources and limits were shown when the
// person turned it on. Holds no health value.

export const referenceComparisonOptIn = pgTable(
  "reference_comparison_opt_in",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    metric: text("metric").notNull(),
    referenceVersion: text("reference_version").notNull(),
    enabledAt: timestamp("enabled_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    referenceComparisonOptInPk: primaryKey({ columns: [table.userId, table.metric] }),
    referenceComparisonOptInMetricCheck: check(
      "reference_comparison_opt_in_metric_check",
      sql`${table.metric} in ('resting_heart_rate', 'sleep_duration', 'active_minutes')`,
    ),
  }),
);
