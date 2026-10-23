import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth";

// ─── Product display settings (Issue #58) ──────────────────────
//
// Installation-wide, singleton display preferences (units + locale) and a
// dedicated, value-free change audit. The service layer talks to these tables
// through raw SQL, so the table/column contract here is frozen.

/**
 * Singleton row (`id = 'instance'`) holding the effective product display
 * settings. `revision` is the optimistic-concurrency counter; it only ever
 * increases when a real value changes. Defaults are metric / en-US.
 */
export const productSettings = pgTable(
  "product_settings",
  {
    id: text("id").primaryKey(),
    units: text("units").notNull().default("metric"),
    locale: text("locale").notNull().default("en-US"),
    revision: integer("revision").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    productSettingsIdCheck: check("product_settings_id_check", sql`${table.id} = 'instance'`),
    productSettingsUnitsCheck: check(
      "product_settings_units_check",
      sql`${table.units} in ('metric', 'imperial')`,
    ),
    productSettingsLocaleCheck: check(
      "product_settings_locale_check",
      sql`${table.locale} in ('en-US', 'en-GB', 'en-CA', 'pt-PT')`,
    ),
    productSettingsRevisionCheck: check(
      "product_settings_revision_check",
      sql`${table.revision} >= 0`,
    ),
  }),
);

/**
 * Append-only product-settings change audit. Minimal by design: an actor, the
 * *names* of the keys that changed, the resulting revision and a timestamp.
 * It never stores a before/after value, an email, the submitted input, a reason
 * or any free-form metadata. The actor reference is `set null` on delete so the
 * durable record survives actor erasure without retaining a personal id.
 */
export const productSettingsAudit = pgTable(
  "product_settings_audit",
  {
    id: text("id").primaryKey(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),
    changedKeys: text("changed_keys").notNull(),
    revision: integer("revision").notNull(),
  },
  (table) => ({
    productSettingsAuditChangedKeysCheck: check(
      "product_settings_audit_changed_keys_check",
      sql`${table.changedKeys} in ('units', 'locale', 'units,locale')`,
    ),
    productSettingsAuditRevisionCheck: check(
      "product_settings_audit_revision_check",
      sql`${table.revision} >= 0`,
    ),
    productSettingsAuditOccurredAtIdx: index("product_settings_audit_occurred_at_idx").on(
      table.occurredAt,
    ),
    productSettingsAuditActorUserIdx: index("product_settings_audit_actor_user_id_idx").on(
      table.actorUserId,
    ),
  }),
);
