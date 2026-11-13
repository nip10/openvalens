import { sql } from "drizzle-orm";
import { boolean, check, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth";

/**
 * Per-member interface language (#231), so server-sent email and push can use
 * it. Written by the apps when the member picks a language; a missing row
 * means English. Only shipped locales are accepted.
 *
 * The in-app "What's new" card (#446): the last release version whose card
 * the member dismissed, and whether they want the card at all. A row written
 * only for these keeps the default language, English.
 */
export const userPreference = pgTable(
  "user_preference",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    locale: text("locale").notNull(),
    whatsNewEnabled: boolean("whats_new_enabled").notNull().default(true),
    whatsNewDismissedVersion: text("whats_new_dismissed_version"),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    userPreferenceLocaleCheck: check(
      "user_preference_locale_check",
      sql`${table.locale} in ('en', 'pt-PT')`,
    ),
  }),
);
