import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth";

/**
 * Per-member interface language (#231), so server-sent email and push can use
 * it. Written by the apps when the member picks a language; a missing row
 * means English. Only shipped locales are accepted.
 */
export const userPreference = pgTable(
  "user_preference",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    locale: text("locale").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    userPreferenceLocaleCheck: check(
      "user_preference_locale_check",
      sql`${table.locale} in ('en', 'pt-PT')`,
    ),
  }),
);
