import {
  pgTable,
  text,
  integer,
  serial,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { defineRelationsPart, sql } from "drizzle-orm";

// ─── Better Auth ───────────────────────────────────────────────

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  role: text("role").default("user"),
  banned: boolean("banned").default(false),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires", { withTimezone: true, mode: "date" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    activeOrganizationId: text("active_organization_id").references(() => organization.id, {
      onDelete: "set null",
    }),
    impersonatedBy: text("impersonated_by").references(() => user.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    sessionUserIdIdx: index("session_user_id_idx").on(table.userId),
    sessionImpersonatedByIdx: index("session_impersonated_by_idx").on(table.impersonatedBy),
    sessionActiveOrganizationIdIdx: index("session_active_organization_id_idx").on(
      table.activeOrganizationId,
    ),
  }),
);

export const organization = pgTable(
  "organization",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    logo: text("logo"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    organizationSlugUnique: uniqueIndex("organization_slug_key").on(table.slug),
  }),
);

export const member = pgTable(
  "member",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    memberOrganizationIdIdx: index("member_organization_id_idx").on(table.organizationId),
    memberUserIdIdx: index("member_user_id_idx").on(table.userId),
    memberOrganizationUserUnique: uniqueIndex("member_organization_id_user_id_key").on(
      table.organizationId,
      table.userId,
    ),
  }),
);

export const invitation = pgTable(
  "invitation",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role").notNull(),
    status: text("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    inviterId: text("inviter_id").references(() => user.id, { onDelete: "set null" }),
  },
  (table) => ({
    invitationOrganizationIdIdx: index("invitation_organization_id_idx").on(table.organizationId),
    invitationEmailIdx: index("invitation_email_idx").on(table.email),
    invitationStatusIdx: index("invitation_status_idx").on(table.status),
    invitationExpiresAtIdx: index("invitation_expires_at_idx").on(table.expiresAt),
    invitationInviterIdIdx: index("invitation_inviter_id_idx").on(table.inviterId),
  }),
);

export const organizationRole = pgTable(
  "organization_role",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    permission: jsonb("permission").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }),
  },
  (table) => ({
    organizationRoleOrganizationIdIdx: index("organization_role_organization_id_idx").on(
      table.organizationId,
    ),
    organizationRoleOrgRoleUnique: uniqueIndex("organization_role_organization_id_role_key").on(
      table.organizationId,
      table.role,
    ),
  }),
);

// ─── Access Sharing Workflows ─────────────────────────────────

export const accessRequest = pgTable(
  "access_request",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    requesterUserId: text("requester_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    targetDomain: text("target_domain").notNull(),
    requestedActions: jsonb("requested_actions").notNull(),
    reason: text("reason"),
    status: text("status").notNull().default("pending"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    resolvedAt: text("resolved_at"),
    resolvedByUserId: text("resolved_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
  },
  (table) => ({
    accessRequestOrganizationIdIdx: index("access_request_organization_id_idx").on(
      table.organizationId,
    ),
    accessRequestRequesterUserIdIdx: index("access_request_requester_user_id_idx").on(
      table.requesterUserId,
    ),
    accessRequestStatusIdx: index("access_request_status_idx").on(table.status),
    accessRequestCreatedAtIdx: index("access_request_created_at_idx").on(table.createdAt),
    accessRequestResolvedByUserIdIdx: index("access_request_resolved_by_user_id_idx").on(
      table.resolvedByUserId,
    ),
    accessRequestRequesterCreatedAtIdx: index("access_request_requester_user_id_created_at_idx").on(
      table.requesterUserId,
      table.createdAt,
    ),
    accessRequestOrganizationStatusIdx: index("access_request_organization_id_status_idx").on(
      table.organizationId,
      table.status,
    ),
  }),
);

export const accessRequestDecision = pgTable(
  "access_request_decision",
  {
    id: serial("id").primaryKey(),
    requestId: integer("request_id")
      .notNull()
      .references(() => accessRequest.id, { onDelete: "cascade" }),
    decision: text("decision").notNull(),
    byUserId: text("by_user_id").references(() => user.id, { onDelete: "set null" }),
    note: text("note"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    accessRequestDecisionRequestIdIdx: index("access_request_decision_request_id_idx").on(
      table.requestId,
    ),
    accessRequestDecisionByUserIdIdx: index("access_request_decision_by_user_id_idx").on(
      table.byUserId,
    ),
    accessRequestDecisionCreatedAtIdx: index("access_request_decision_created_at_idx").on(
      table.createdAt,
    ),
  }),
);

export const adminNotification = pgTable(
  "admin_notification",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    payloadJson: jsonb("payload_json"),
    isRead: boolean("is_read").notNull().default(false),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    readAt: text("read_at"),
  },
  (table) => ({
    adminNotificationOrganizationIdIdx: index("admin_notification_organization_id_idx").on(
      table.organizationId,
    ),
    adminNotificationTypeIdx: index("admin_notification_type_idx").on(table.type),
    adminNotificationIsReadIdx: index("admin_notification_is_read_idx").on(table.isRead),
    adminNotificationCreatedAtIdx: index("admin_notification_created_at_idx").on(table.createdAt),
    adminNotificationOrganizationIsReadIdx: index(
      "admin_notification_organization_id_is_read_idx",
    ).on(table.organizationId, table.isRead),
    adminNotificationOrgIsReadCreatedAtIdx: index(
      "admin_notification_organization_id_is_read_created_at_idx",
    ).on(table.organizationId, table.isRead, table.createdAt),
  }),
);

export const accessAuditLog = pgTable(
  "access_audit_log",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),
    eventType: text("event_type").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    beforeJson: jsonb("before_json"),
    afterJson: jsonb("after_json"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    accessAuditLogOrganizationIdIdx: index("access_audit_log_organization_id_idx").on(
      table.organizationId,
    ),
    accessAuditLogActorUserIdIdx: index("access_audit_log_actor_user_id_idx").on(table.actorUserId),
    accessAuditLogEventTypeIdx: index("access_audit_log_event_type_idx").on(table.eventType),
    accessAuditLogCreatedAtIdx: index("access_audit_log_created_at_idx").on(table.createdAt),
    accessAuditLogOrganizationCreatedAtIdx: index(
      "access_audit_log_organization_id_created_at_idx",
    ).on(table.organizationId, table.createdAt),
  }),
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    accountProviderAccountUnique: uniqueIndex("account_provider_id_account_id_key").on(
      table.providerId,
      table.accountId,
    ),
    accountUserIdIdx: index("account_user_id_idx").on(table.userId),
  }),
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    verificationIdentifierValueUnique: uniqueIndex("verification_identifier_value_key").on(
      table.identifier,
      table.value,
    ),
  }),
);

// ─── Org-scoped FK helper ─────────────────────────────────────
export const orgId = () =>
  text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" });

// ─── Onboarding ───────────────────────────────────────────────

export const onboardingState = pgTable(
  "onboarding_state",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    currentStep: text("current_step").notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true, mode: "date" }),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    onboardingStateOrganizationIdUnique: uniqueIndex("onboarding_state_organization_id_key").on(
      table.organizationId,
    ),
  }),
);

// ─── Per-user AI consent (Issue #123) ─────────────────────────

/**
 * One row per user recording whether that individual has personally granted
 * AI processing.
 *
 * Independent of the organization-level gate stored in
 * `organization.metadata.aiConsent` (Issue #13): both must pass before any AI
 * call runs, so a user's own decision is never overridden by an owner/admin
 * role. Metadata-only — no health values. `consent_version` records which
 * disclosure text was agreed to; `source` is an audit hint
 * (`'settings' | 'api' | 'migration'`).
 */
export const userAiConsent = pgTable(
  "user_ai_consent",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    granted: boolean("granted").notNull().default(false),
    grantedAt: timestamp("granted_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    consentVersion: text("consent_version").notNull().default("v1"),
    source: text("source"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userAiConsentUserIdUnique: uniqueIndex("user_ai_consent_user_id_key").on(table.userId),
    userAiConsentRevokedAfterGrantedCheck: check(
      "user_ai_consent_revoked_after_granted_check",
      sql`${table.revokedAt} is null or ${table.revokedAt} >= ${table.grantedAt}`,
    ),
  }),
);

// ─── Relations (Better Auth core) ─────────────────────────────
export const authRelations = defineRelationsPart({ user, session, account, verification }, (r) => ({
  user: {
    sessions: r.many.session({
      from: r.user.id,
      to: r.session.userId,
    }),
    accounts: r.many.account({
      from: r.user.id,
      to: r.account.userId,
    }),
  },
  session: {
    user: r.one.user({
      from: r.session.userId,
      to: r.user.id,
    }),
  },
  account: {
    user: r.one.user({
      from: r.account.userId,
      to: r.user.id,
    }),
  },
}));
