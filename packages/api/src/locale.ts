import type { I18n } from "@lingui/core";
import type { Database } from "@openvalens/db";
import { user } from "@openvalens/db/schema/auth";
import { userPreference } from "@openvalens/db/schema/preferences";
import { createAppI18n, isLocale, SOURCE_LOCALE, type Locale } from "@openvalens/i18n";
import { eq, sql } from "drizzle-orm";

/**
 * The member's interface language on the server (#231), for email and push.
 * A missing preference, an unknown member or an unsupported value means
 * English. Rendering uses the same catalogs and review-state fallbacks as the
 * apps.
 */

const instances = new Map<Locale, I18n>();

/** A shared Lingui instance for one locale (read-only use: never re-activate it). */
export function serverI18n(locale: Locale): I18n {
  let i18n = instances.get(locale);
  if (!i18n) {
    i18n = createAppI18n(locale);
    instances.set(locale, i18n);
  }
  return i18n;
}

export async function readUserLocale(
  db: Pick<Database, "select">,
  userId: string,
): Promise<Locale> {
  const [row] = await db
    .select({ locale: userPreference.locale })
    .from(userPreference)
    .where(eq(userPreference.userId, userId));
  return isLocale(row?.locale) ? row.locale : SOURCE_LOCALE;
}

/** For mail addressed by email (magic links, invitations to existing accounts). */
export async function readLocaleForEmail(
  db: Pick<Database, "select">,
  email: string,
): Promise<Locale> {
  const [row] = await db
    .select({ locale: userPreference.locale })
    .from(userPreference)
    .innerJoin(user, eq(user.id, userPreference.userId))
    .where(sql`lower(${user.email}) = lower(${email})`);
  return isLocale(row?.locale) ? row.locale : SOURCE_LOCALE;
}

export async function writeUserLocale(db: Database, userId: string, locale: Locale): Promise<void> {
  await db
    .insert(userPreference)
    .values({ userId, locale, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: userPreference.userId,
      set: { locale, updatedAt: new Date() },
    });
}
