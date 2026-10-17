/**
 * Data-rights registry (Issue #89). Classifies every table in the Drizzle
 * schema so export and delete can prove full coverage: `registry.test.ts`
 * fails when a table is added without a classification here.
 *
 * Ownership model: an organization is one person's health record; its
 * `owner` is that person. A subject is a user plus the organizations they
 * own. Keys are SQL table names.
 */

export type TableOwnership =
  /** Rows where `organization_id` is one of the subject's organizations. */
  | { kind: "organization" }
  /** The subject's own row in `user` / `organization` (matched by `id`). */
  | { kind: "self"; match: "user" | "organization" }
  /** Rows where `user_id` is the subject. */
  | { kind: "user" }
  /** Rows reachable only through a parent table; see `CHILD_QUERIES` in export.ts. */
  | { kind: "child"; parent: string }
  /**
   * Admission grants (#63) keyed by recipient, not by owner column: matched by
   * `target_user_id` or `canonical_email`. Never by inviter — see `rowFilter`.
   */
  | { kind: "admission" }
  /** Shared catalog, no personal data. Excluded. */
  | { kind: "reference"; reason: string }
  /** Short-lived or system rows with no lasting personal data. Excluded. */
  | { kind: "system"; reason: string }
  /** Renamed to `_quarantine_legacy_*` by migration 20261001200000; dropped after retention. */
  | { kind: "retired"; reason: string };

export type TableEntry = TableOwnership & {
  /** Columns never exported (credentials, token hashes). */
  redact?: readonly string[];
};

const organization = { kind: "organization" } as const;
const RETIRED =
  "Quarantined legacy mobile-sync table (migration 20261001200000); dropped after the retention window.";

export const DATA_RIGHTS_REGISTRY: Readonly<Record<string, TableEntry>> = Object.freeze({
  // Identity
  user: { kind: "self", match: "user" },
  organization: { kind: "self", match: "organization" },
  account: {
    kind: "user",
    redact: [
      "access_token",
      "refresh_token",
      "id_token",
      "access_token_expires_at",
      "refresh_token_expires_at",
      "password",
    ],
  },
  session: { kind: "user", redact: ["token"] },
  member: organization,
  invitation: organization,
  organization_role: organization,
  access_request: organization,
  access_request_decision: { kind: "child", parent: "access_request" },
  admin_notification: organization,
  access_audit_log: organization,
  onboarding_state: organization,
  verification: {
    kind: "system",
    reason: "Short-lived sign-in tokens that expire within minutes.",
  },

  // Body
  user_ai_consent: { kind: "user" },
  dexa_scan: organization,
  dexa_regional: organization,
  weight_event: organization,
  daily_weight: organization,
  daily_weight_override: organization,
  body_comp_event: organization,
  weight_checkin: organization,

  // Clinical
  blood_panel: organization,
  blood_marker: organization,
  cardiac_exam: organization,
  cardiac_measurement: organization,
  imaging_study: organization,
  consultation: organization,
  family_history: organization,
  optimal_range: { kind: "reference", reason: "Shared reference ranges, not user data." },
  blood_marker_info: { kind: "reference", reason: "Shared marker descriptions, not user data." },

  // Coach
  ai_feedback: organization,
  coach_profile: organization,
  insight: organization,
  chat_message: organization,
  coach_template: { kind: "reference", reason: "Shared coach presets, not user data." },

  // Health record and ingestion
  data_source: organization,
  metric_definition: organization,
  metric_source_preference: organization,
  ingestion_job: organization,
  ingestion_batch: organization,
  metric_sample: organization,
  health_event: organization,
  ingestion_error: organization,
  ingestion_raw_artifact: organization,
  provenance_link: organization,
  health_connect_sync: organization,
  health_connect_record: organization,
  ingestion_log: organization,
  provider_connection: organization,
  mobile_sync_session: { kind: "retired", reason: RETIRED },
  mobile_sync_session_chunk: { kind: "retired", reason: RETIRED },
  mobile_pairing_code: { kind: "retired", reason: RETIRED },
  mobile_pairing_rate_limit: { kind: "retired", reason: RETIRED },
  mobile_device_session: { kind: "retired", reason: RETIRED },

  // Nutrition (#74). Snapshots hold the subject's logged food/nutrient history.
  nutrition_food: organization,
  nutrition_food_snapshot: organization,
  nutrition_meal: organization,
  nutrition_meal_entry: organization,
  nutrition_goal: organization,
  // Meal diary (#77): day-complete markers, favourites and the offline replay ledger.
  nutrition_diary_day: organization,
  nutrition_favorite_food: organization,
  nutrition_diary_mutation: organization,
  // Energy estimate (#76): target proposals with the estimate they came from.
  nutrition_energy_proposal: organization,
  // Public food catalogs (#72): instance-wide FDC / Open Food Facts mirrors and
  // their import ledger; no tenant or personal columns.
  nutrition_catalog_release: {
    kind: "reference",
    reason: "Food catalog import ledger (artifact, license, attribution), not user data.",
  },
  nutrition_catalog_fdc_food: {
    kind: "reference",
    reason: "USDA FoodData Central mirror (CC0), not user data.",
  },
  nutrition_catalog_off_product: {
    kind: "reference",
    reason: "Open Food Facts mirror (ODbL), not user data.",
  },
  nutrition_catalog_off_overlay: {
    kind: "reference",
    reason: "Instance-level Open Food Facts corrections (ODbL), no author identity.",
  },

  // Integrations
  telegram_account: organization,
  telegram_connect_token: { kind: "organization", redact: ["token_hash"] },
  telegram_webhook_event: {
    kind: "system",
    reason: "Telegram update ids kept only to de-duplicate webhooks; no message content.",
  },
  daily_reminder: organization,

  // Object storage (#62). Metadata only (opaque key, content type, size,
  // checksum); the bytes are erased from the storage backend by the caller of
  // `deleteSubjectData` using the keys collected before the transaction.
  stored_object: organization,

  // Data rights
  erasure_ledger: {
    kind: "system",
    reason:
      "Erasure records (ids and row counts only) that must outlive deleted data so restores can be re-erased.",
  },

  // Instance admission (#63)
  instance_admission: {
    kind: "system",
    reason: "Singleton bootstrap row (admission state and generation) with no personal data.",
  },
  admission_grant: {
    kind: "admission",
    redact: ["invitation_token_hash", "verification_code_hash"],
  },
  global_security_event: {
    kind: "system",
    reason:
      "Minimal global security record (ids and event type only, no email); user references are nulled on delete.",
  },
  csp_violation_event: {
    kind: "system",
    reason:
      "Append-only CSP violation log (host/path-prefix/hashed policy only); the correlation id links to a request log line, never to a user row.",
  },

  // Product display settings (#58)
  product_settings: {
    kind: "system",
    reason:
      "Instance-wide singleton display preferences (units/locale) with no personal data, like instance_admission.",
  },
  product_settings_audit: {
    kind: "system",
    reason:
      "Value-free instance-wide settings audit (changed key names, revision, actor id); the actor reference is nulled on delete, so no lasting personal data remains.",
  },

  // Wellness profile (#98): user-owned, never organization-scoped. Consent rows
  // are the versioned per-purpose history and are exported with the profile.
  wellness_profile: { kind: "user" },
  wellness_profile_consent: { kind: "user" },
  // Reference comparisons (#96): the person's per-metric opt-ins; no values.
  reference_comparison_opt_in: { kind: "user" },

  // Insights (#92): the person's own feedback, delivery preferences, phones and
  // delivery history. Insights themselves are recomputed, never stored. Keyed
  // by `user_id` so a member's rows in someone else's workspace go with them.
  insight_preference: { kind: "user", redact: ["email_unsubscribe_token_hash"] },
  insight_feedback: { kind: "user" },
  insight_delivery: { kind: "user" },
  push_device: { kind: "user", redact: ["expo_push_token"] },

  // Preventive care (#97): the person's self-declared criteria, their own dates,
  // reminders and decisions per guideline item, and the library opt-in. The
  // guideline items are repo data, never stored.
  preventive_care_setting: { kind: "user" },
  preventive_care_declaration: { kind: "user" },
  preventive_care_item_state: { kind: "user" },

  // Plans
  supplement: { kind: "child", parent: "supplement_schedule" },
  supplement_schedule: organization,
  supplement_change: organization,
  medication: organization,
  goal: organization,
  goal_checkin: organization,
  workout: organization,
  workout_exercise: organization,
  workout_set: organization,
  weekly_review: organization,
  calendar_event: organization,
  scheduled_event: organization,
});

/** Tables whose rows belong to a subject and are exported. */
export function isExported(entry: TableEntry): boolean {
  return (
    entry.kind === "organization" ||
    entry.kind === "self" ||
    entry.kind === "user" ||
    entry.kind === "child" ||
    entry.kind === "admission"
  );
}
