import { pgTable, text, integer, timestamp, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { user } from "./auth";

// ─── Instance admission (Issue #63) ───────────────────────────
//
// Installation-wide admission state and the grants that back one-time
// setup-token minting and instance-admin-issued account invitations.
//
// These tables are deliberately small and metadata-only: no health data, no
// organization scope. The service layer (packages/auth/src/admission) talks to
// them through raw SQL, so the table/column contract here is frozen.

/**
 * Singleton row (`id = 'instance'`) tracking whether the installation still
 * needs a one-time setup token (`pending`) or is open to instance-admin
 * invitations only (`invite_only`). `generation` fences a minted-but-unused
 * token; the hash/expiry pair is either both set or both unset.
 */
export const instanceAdmission = pgTable(
  "instance_admission",
  {
    id: text("id").primaryKey(),
    state: text("state").notNull(),
    generation: integer("generation").notNull().default(0),
    setupTokenHash: text("setup_token_hash"),
    setupExpiresAt: timestamp("setup_expires_at", { withTimezone: true, mode: "date" }),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
  },
  (table) => ({
    instanceAdmissionIdCheck: check("instance_admission_id_check", sql`${table.id} = 'instance'`),
    instanceAdmissionStateCheck: check(
      "instance_admission_state_check",
      sql`${table.state} in ('pending', 'invite_only')`,
    ),
    instanceAdmissionTokenPairCheck: check(
      "instance_admission_token_pair_check",
      sql`(${table.setupTokenHash} is null and ${table.setupExpiresAt} is null) or (${table.setupTokenHash} is not null and ${table.setupExpiresAt} is not null)`,
    ),
    instanceAdmissionInviteOnlyCheck: check(
      "instance_admission_invite_only_check",
      sql`${table.state} <> 'invite_only' or (${table.setupTokenHash} is null and ${table.setupExpiresAt} is null)`,
    ),
  }),
);

/**
 * One row per admission grant. `kind = 'setup'` rows are the single-use setup
 * reservation (fenced by `generation`); `kind = 'invitation'` rows are
 * instance-admin-issued invitations to a canonical email. Recipient identity is
 * `target_user_id` (once redeemed) and/or `canonical_email`.
 */
export const admissionGrant = pgTable(
  "admission_grant",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    generation: integer("generation"),
    canonicalEmail: text("canonical_email").notNull(),
    targetUserId: text("target_user_id").references(() => user.id, { onDelete: "cascade" }),
    inviterUserId: text("inviter_user_id").references(() => user.id, { onDelete: "cascade" }),
    invitationTokenHash: text("invitation_token_hash").unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    verificationCodeHash: text("verification_code_hash"),
    verificationExpiresAt: timestamp("verification_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    verificationAttempts: integer("verification_attempts").notNull().default(0),
    sendCount: integer("send_count").notNull().default(0),
    sendWindowStartedAt: timestamp("send_window_started_at", { withTimezone: true, mode: "date" }),
    consumedAt: timestamp("consumed_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    admissionGrantKindCheck: check(
      "admission_grant_kind_check",
      sql`${table.kind} in ('setup', 'invitation')`,
    ),
    admissionGrantSetupShapeCheck: check(
      "admission_grant_setup_shape_check",
      sql`${table.kind} <> 'setup' or (${table.generation} is not null and ${table.inviterUserId} is null and ${table.invitationTokenHash} is null)`,
    ),
    admissionGrantInvitationShapeCheck: check(
      "admission_grant_invitation_shape_check",
      sql`${table.kind} <> 'invitation' or (${table.generation} is null and ${table.inviterUserId} is not null and ${table.invitationTokenHash} is not null)`,
    ),
    admissionGrantVerificationPairCheck: check(
      "admission_grant_verification_pair_check",
      sql`(${table.verificationCodeHash} is null and ${table.verificationExpiresAt} is null) or (${table.verificationCodeHash} is not null and ${table.verificationExpiresAt} is not null)`,
    ),
    admissionGrantVerificationAttemptsCheck: check(
      "admission_grant_verification_attempts_check",
      sql`${table.verificationAttempts} >= 0 and ${table.verificationAttempts} <= 5`,
    ),
    admissionGrantSendCountCheck: check(
      "admission_grant_send_count_check",
      sql`${table.sendCount} >= 0 and ${table.sendCount} <= 3`,
    ),
    admissionGrantCanonicalEmailCheck: check(
      "admission_grant_canonical_email_check",
      sql`${table.canonicalEmail} = lower(${table.canonicalEmail})`,
    ),
    admissionGrantTargetUserIdx: index("admission_grant_target_user_id_idx").on(table.targetUserId),
    admissionGrantInviterUserIdx: index("admission_grant_inviter_user_id_idx").on(
      table.inviterUserId,
    ),
    admissionGrantCanonicalEmailIdx: index("admission_grant_canonical_email_idx").on(
      table.canonicalEmail,
    ),
    admissionGrantExpiresAtIdx: index("admission_grant_expires_at_idx").on(table.expiresAt),
    admissionGrantVerificationExpiresAtIdx: index("admission_grant_verification_expires_at_idx").on(
      table.verificationExpiresAt,
    ),
    // Exactly one unconsumed setup reservation per generation; consumed rows are
    // kept immutably (the partial predicate is on `kind`, not `consumed_at`).
    admissionGrantSetupGenerationUnique: uniqueIndex("admission_grant_setup_generation_key")
      .on(table.generation)
      .where(sql`${table.kind} = 'setup'`),
  }),
);

/**
 * Append-only global security events. Minimal by design: ids and an event type
 * only, never emails, token hashes, secrets or free-form metadata. User
 * references are `set null` on delete so the durable record survives erasure
 * without retaining personal identifiers.
 */
export const globalSecurityEvent = pgTable(
  "global_security_event",
  {
    id: text("id").primaryKey(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    eventType: text("event_type").notNull(),
    actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),
    targetUserId: text("target_user_id").references(() => user.id, { onDelete: "set null" }),
    grantId: text("grant_id"),
  },
  (table) => ({
    globalSecurityEventTypeCheck: check(
      "global_security_event_type_check",
      sql`${table.eventType} in ('setup_token_minted', 'setup_completed', 'admission_invitation_issued', 'admission_invitation_revoked', 'admission_completed', 'public_sign_up_completed')`,
    ),
    globalSecurityEventOccurredAtIdx: index("global_security_event_occurred_at_idx").on(
      table.occurredAt,
    ),
    globalSecurityEventActorUserIdx: index("global_security_event_actor_user_id_idx").on(
      table.actorUserId,
    ),
    globalSecurityEventTargetUserIdx: index("global_security_event_target_user_id_idx").on(
      table.targetUserId,
    ),
  }),
);

// ─── Public sign-up (Issue #294) ──────────────────────────────
//
// Cloud only (`DEPLOYMENT_MODE=cloud`). A sign-up request is a pending,
// single-use link sent to an email address; no `user` row exists until that
// link is used. Only the SHA-256 digest of the link token is stored.

/**
 * One row per public sign-up request. `user_id` is set (and `consumed_at`
 * stamped) when the link creates the account. The terms and privacy versions
 * the person ticked are captured here at request time and copied to
 * `legal_acceptance` when the account is created. Expired requests are pruned.
 */
export const signUpRequest = pgTable(
  "sign_up_request",
  {
    id: text("id").primaryKey(),
    canonicalEmail: text("canonical_email").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    locale: text("locale"),
    termsVersion: text("terms_version").notNull(),
    privacyVersion: text("privacy_version").notNull(),
    healthDataConsentVersion: text("health_data_consent_version"),
    healthDataConsentAcceptedAt: timestamp("health_data_consent_accepted_at", {
      withTimezone: true,
      mode: "date",
    }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true, mode: "date" }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true, mode: "date" }),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    signUpRequestCanonicalEmailCheck: check(
      "sign_up_request_canonical_email_check",
      sql`${table.canonicalEmail} = lower(${table.canonicalEmail})`,
    ),
    signUpRequestConsumedShapeCheck: check(
      "sign_up_request_consumed_shape_check",
      sql`${table.userId} is null or ${table.consumedAt} is not null`,
    ),
    signUpRequestCanonicalEmailIdx: index("sign_up_request_canonical_email_idx").on(
      table.canonicalEmail,
    ),
    signUpRequestExpiresAtIdx: index("sign_up_request_expires_at_idx").on(table.expiresAt),
    signUpRequestUserIdx: index("sign_up_request_user_id_idx").on(table.userId),
  }),
);

/**
 * Acceptance of a legal document (terms of service, privacy policy) by an
 * account, with the exact version and when it was accepted (#294, #300). One
 * row per user, document and version; accepting a later version adds a row.
 */
export const legalAcceptance = pgTable(
  "legal_acceptance",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    document: text("document").notNull(),
    version: text("version").notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true, mode: "date" }).notNull(),
    source: text("source").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    legalAcceptanceDocumentCheck: check(
      "legal_acceptance_document_check",
      sql`${table.document} in ('terms', 'privacy', 'health_data_consent')`,
    ),
    legalAcceptanceSourceCheck: check(
      "legal_acceptance_source_check",
      sql`${table.source} in ('sign_up', 're_consent')`,
    ),
    legalAcceptanceUserDocumentVersionUnique: uniqueIndex(
      "legal_acceptance_user_document_version_key",
    ).on(table.userId, table.document, table.version),
  }),
);
