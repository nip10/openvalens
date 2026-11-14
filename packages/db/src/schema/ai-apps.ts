import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { member, orgId, user } from "./auth";

// ─── Connected AI apps (Issue #439) ─────────────────────────────
//
// A **grant** lets one AI app read one member's own records in one workspace,
// with a fixed scope list and the AI-app consent version the member agreed to
// (`mcp-v1`, separate from Coach AI consent). Personal API keys (now) and OAuth
// connections (M1b) share this one model: a personal key is a row in
// `ai_app_key` that points at its grant; an OAuth connection will point the
// Better Auth consent at its grant the same way. Revoking a grant, the owner
// turning "Members can connect AI apps" off, or the member leaving the
// workspace stops the next call.
//
// `ai_app_call` is the light usage record of each tool call: grant, tool,
// time, status and row count, never the arguments or the results. Rows older
// than 90 days are purged.

/** One member's permission for one AI app in one workspace. */
export const aiAppGrant = pgTable(
  "ai_app_grant",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** `personal_key` now; `oauth` when OAuth connections land (M1b). */
    kind: text("kind").notNull(),
    /** The member's name for a key, or the client's name for a connection. */
    label: text("label").notNull(),
    /** Sorted, de-duplicated scope strings; always holds `records:read`. */
    scopes: text("scopes").array().notNull(),
    /** AI-app consent text the member agreed to (`mcp-v1`). */
    consentVersion: text("consent_version").notNull(),
    consentedAt: timestamp("consented_at", { withTimezone: true, mode: "date" }).notNull(),
    /** Reserved for OAuth connections (M1b): the registered client id. */
    oauthClientId: text("oauth_client_id"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: "date" }),
    /** `null` means the grant never expires. */
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    /** `revoked` (by the member) or `expired` (recorded on the first call after expiry). */
    revokedReason: text("revoked_reason"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    aiAppGrantUserOrgIdx: index("ai_app_grant_user_id_organization_id_idx").on(
      table.userId,
      table.organizationId,
    ),
    aiAppGrantOrganizationIdx: index("ai_app_grant_organization_id_idx").on(table.organizationId),
    aiAppGrantMemberFk: foreignKey({
      columns: [table.organizationId, table.userId],
      foreignColumns: [member.organizationId, member.userId],
      name: "ai_app_grant_org_user_member_fk",
    }).onDelete("cascade"),
    aiAppGrantKindCheck: check(
      "ai_app_grant_kind_check",
      sql`${table.kind} in ('personal_key', 'oauth')`,
    ),
    aiAppGrantLabelCheck: check(
      "ai_app_grant_label_check",
      sql`length(${table.label}) between 1 and 80`,
    ),
    aiAppGrantScopesCheck: check(
      "ai_app_grant_scopes_check",
      sql`'records:read' = any(${table.scopes})`,
    ),
    aiAppGrantRevokedReasonCheck: check(
      "ai_app_grant_revoked_reason_check",
      sql`(${table.revokedAt} is null and ${table.revokedReason} is null) or (${table.revokedAt} is not null and ${table.revokedReason} in ('revoked', 'expired'))`,
    ),
  }),
);

/**
 * A personal API key: only the SHA-256 of the full `ov_…` key is stored, plus
 * a short display prefix. Exactly one key per `personal_key` grant.
 */
export const aiAppKey = pgTable(
  "ai_app_key",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    grantId: uuid("grant_id")
      .notNull()
      .references(() => aiAppGrant.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    keyHash: text("key_hash").notNull(),
    displayPrefix: text("display_prefix").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    aiAppKeyHashUnique: uniqueIndex("ai_app_key_key_hash_key").on(table.keyHash),
    aiAppKeyGrantUnique: uniqueIndex("ai_app_key_grant_id_key").on(table.grantId),
    aiAppKeyUserIdx: index("ai_app_key_user_id_idx").on(table.userId),
  }),
);

/**
 * One tool call through a grant, without its arguments or results. Purged
 * after 90 days; shown to the member as "Recent activity".
 */
export const aiAppCall = pgTable(
  "ai_app_call",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    grantId: uuid("grant_id")
      .notNull()
      .references(() => aiAppGrant.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Tool name (`labs`, `sleep.sessions`, …). */
    tool: text("tool").notNull(),
    /** `mcp` or `rest`. */
    transport: text("transport").notNull(),
    /** Value-free outcome code (`ok`, `invalid_input`, `insufficient_scope`, `error`, …). */
    status: text("status").notNull(),
    /** Records returned, when the tool reports a count. */
    rowCount: integer("row_count"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    aiAppCallGrantCreatedIdx: index("ai_app_call_grant_id_created_at_idx").on(
      table.grantId,
      table.createdAt,
    ),
    aiAppCallCreatedIdx: index("ai_app_call_created_at_idx").on(table.createdAt),
    aiAppCallUserIdx: index("ai_app_call_user_id_idx").on(table.userId),
    aiAppCallTransportCheck: check(
      "ai_app_call_transport_check",
      sql`${table.transport} in ('mcp', 'rest')`,
    ),
  }),
);

/**
 * Issue #439 (M2) — the receipt of one AI write call, keyed by the grant and
 * the call's mutation id. The same mechanism as the plain-water receipts
 * (#83): a retry with the same id and the same request replays the saved
 * outcome instead of writing again; the same id with a different request is
 * refused. `fingerprint` is a SHA-256 of the request, never the request
 * itself; `outcome` holds entry ids and statuses only, never values.
 *
 * `entry_count` counts against the grant's daily write limit from the moment
 * the call starts (`pending`), so a failed call still uses its share.
 */
export const aiAppWrite = pgTable(
  "ai_app_write",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    grantId: uuid("grant_id")
      .notNull()
      .references(() => aiAppGrant.id, { onDelete: "cascade" }),
    organizationId: orgId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** The caller's mutation id (1 to 64 characters). */
    mutationId: text("mutation_id").notNull(),
    tool: text("tool").notNull(),
    /** SHA-256 of the tool and its arguments; never the arguments. */
    fingerprint: text("fingerprint").notNull(),
    entryCount: integer("entry_count").notNull(),
    /** `pending` while the call runs (or after it failed), `done` once its outcome is saved. */
    status: text("status").notNull().default("pending"),
    /** Entry ids and per-entry statuses of a `done` call; no values. */
    outcome: jsonb("outcome"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
  },
  (table) => ({
    aiAppWriteMutationUnique: uniqueIndex("ai_app_write_grant_id_mutation_id_key").on(
      table.grantId,
      table.mutationId,
    ),
    aiAppWriteGrantCreatedIdx: index("ai_app_write_grant_id_created_at_idx").on(
      table.grantId,
      table.createdAt,
    ),
    aiAppWriteUserIdx: index("ai_app_write_user_id_idx").on(table.userId),
    aiAppWriteMutationIdCheck: check(
      "ai_app_write_mutation_id_check",
      sql`length(${table.mutationId}) between 1 and 64`,
    ),
    aiAppWriteStatusCheck: check(
      "ai_app_write_status_check",
      sql`${table.status} in ('pending', 'done')`,
    ),
    aiAppWriteEntryCountCheck: check(
      "ai_app_write_entry_count_check",
      sql`${table.entryCount} >= 0`,
    ),
  }),
);

/**
 * Issue #439 (M2) — one entry an AI app wrote, and its source tag: the grant
 * that wrote it (the app's name is the grant's label). The app may delete only
 * entries listed here under its own grant; "Delete everything this app wrote"
 * deletes them all. Revoking a grant keeps them.
 *
 * `target_ids` are the domain rows of the entry: one water entry or supplement
 * intake, or the metric samples of one reading (a blood pressure reading is
 * its systolic, diastolic and pulse samples). `possible_duplicate` is set
 * when a device reading of the same kind sat within ten minutes at write time;
 * nothing is merged or overwritten, and device data wins in daily totals.
 */
export const aiAppEntry = pgTable(
  "ai_app_entry",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    grantId: uuid("grant_id")
      .notNull()
      .references(() => aiAppGrant.id, { onDelete: "cascade" }),
    organizationId: orgId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    writeId: uuid("write_id")
      .notNull()
      .references(() => aiAppWrite.id, { onDelete: "cascade" }),
    /** Position of the entry in its call. */
    itemIndex: integer("item_index").notNull(),
    /** `water`, `weight`, `blood_pressure`, `supplement_intake`, … */
    kind: text("kind").notNull(),
    targetTable: text("target_table").notNull(),
    targetIds: integer("target_ids").array().notNull(),
    possibleDuplicate: boolean("possible_duplicate").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    aiAppEntryWriteItemUnique: uniqueIndex("ai_app_entry_write_id_item_index_key").on(
      table.writeId,
      table.itemIndex,
    ),
    aiAppEntryGrantCreatedIdx: index("ai_app_entry_grant_id_created_at_idx").on(
      table.grantId,
      table.createdAt,
    ),
    aiAppEntryUserIdx: index("ai_app_entry_user_id_idx").on(table.userId),
    aiAppEntryTargetIdx: index("ai_app_entry_organization_id_target_table_idx").on(
      table.organizationId,
      table.targetTable,
    ),
    aiAppEntryTargetTableCheck: check(
      "ai_app_entry_target_table_check",
      sql`${table.targetTable} in ('metric_sample', 'plain_water_entry', 'supplement_intake')`,
    ),
  }),
);
