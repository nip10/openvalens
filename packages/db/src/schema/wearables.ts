import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { member, orgId, user } from "./auth";
import { providerConnection } from "./ingestion";

// ─── Cloud wearables (Issue #60) ───────────────────────────────
//
// Phone-first: HealthKit / Health Connect stay the main path and need no
// vendor account. These tables exist only for the optional cloud adapters
// (Oura, Whoop, Polar, Withings, Google Health) that a self-hoster enables
// with their own developer app.
//
// Ingested rows go through the normal pipeline (`provider_connection` →
// `data_source` → `metric_sample` / `health_event` with provenance). This
// file holds only the OAuth credential and sync state per connection, and
// the short-lived OAuth `state` values. Tokens are AES-256-GCM ciphertext
// bound to their row (see `@openvalens/wearables` token crypto); a raw token
// never touches the database or a log.

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
};

/**
 * One person's link to one cloud wearable vendor inside a workspace.
 *
 * - `active`: tokens present, synced by webhook hint or polling.
 * - `reconnect_needed`: the vendor refused the refresh token (for example a
 *   Google Testing-mode token after 7 days). Data stays; the sync cursor is
 *   kept so reconnecting backfills the gap.
 * - `quarantined`: the vendor told us access was revoked upstream. Tokens are
 *   gone; the rows it sent wait for the person to keep or delete them.
 *
 * `token_version` increments on every token write so a refresh can detect a
 * concurrent rotation (Oura refresh tokens are single use).
 */
export const wearableConnection = pgTable(
  "wearable_connection",
  {
    id: serial("id").primaryKey(),
    organizationId: orgId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    providerConnectionId: integer("provider_connection_id").notNull(),
    provider: text("provider").notNull(),
    status: text("status").notNull().default("active"),
    accessTokenCiphertext: text("access_token_ciphertext"),
    refreshTokenCiphertext: text("refresh_token_ciphertext"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    scope: text("scope"),
    tokenVersion: integer("token_version").notNull().default(0),
    /** Records up to this instant have been fetched; the next sync re-reads a short overlap. */
    syncedThrough: timestamp("synced_through", { withTimezone: true, mode: "date" }),
    /** Set by a webhook hint or "sync now"; cleared when a sync starts. */
    syncRequestedAt: timestamp("sync_requested_at", { withTimezone: true, mode: "date" }),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true, mode: "date" }),
    /** Fixed value-free code (`reauthorization_required`, `rate_limited`, …). */
    lastErrorCode: text("last_error_code"),
    quarantinedAt: timestamp("quarantined_at", { withTimezone: true, mode: "date" }),
    ...timestamps,
  },
  (table) => ({
    wearableConnectionProviderConnectionUnique: uniqueIndex(
      "wearable_connection_provider_connection_id_key",
    ).on(table.providerConnectionId),
    wearableConnectionOrgUserProviderUnique: uniqueIndex(
      "wearable_connection_org_user_provider_key",
    ).on(table.organizationId, table.userId, table.provider),
    wearableConnectionStatusIdx: index("wearable_connection_status_idx").on(
      table.status,
      table.syncRequestedAt,
    ),
    wearableConnectionProviderConnectionFk: foreignKey({
      columns: [table.organizationId, table.providerConnectionId],
      foreignColumns: [providerConnection.organizationId, providerConnection.id],
      name: "wearable_connection_org_provider_connection_fk",
    }).onDelete("cascade"),
    wearableConnectionMemberFk: foreignKey({
      columns: [table.organizationId, table.userId],
      foreignColumns: [member.organizationId, member.userId],
      name: "wearable_connection_org_user_member_fk",
    }).onDelete("cascade"),
    wearableConnectionStatusCheck: check(
      "wearable_connection_status_check",
      sql`${table.status} in ('active', 'reconnect_needed', 'quarantined')`,
    ),
  }),
);

/**
 * OAuth `state` for one authorization attempt: only its SHA-256 is stored,
 * single use, 10-minute expiry, bound to the person and workspace that
 * started it.
 */
export const wearableOauthState = pgTable(
  "wearable_oauth_state",
  {
    stateHash: text("state_hash").primaryKey(),
    organizationId: orgId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    wearableOauthStateExpiresAtIdx: index("wearable_oauth_state_expires_at_idx").on(
      table.expiresAt,
    ),
    wearableOauthStateMemberFk: foreignKey({
      columns: [table.organizationId, table.userId],
      foreignColumns: [member.organizationId, member.userId],
      name: "wearable_oauth_state_org_user_member_fk",
    }).onDelete("cascade"),
  }),
);
