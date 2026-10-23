import type { Database } from "@openvalens/db";
import { userPreference } from "@openvalens/db/schema/preferences";
import type { Locale } from "@openvalens/i18n";

/**
 * The member's interface language on the server (#231), for email and push.
 * The readers and the shared Lingui instances live in
 * `@openvalens/i18n/server` so auth, email and Telegram can use them too.
 */
export {
  databaseMessageLocales,
  findLocaleForEmail,
  localeForEmail,
  localeForInvitee,
  localeOrEnglish,
  readLocaleForEmail,
  readUserLocale,
  serverI18n,
  type MessageLocales,
} from "@openvalens/i18n/server";

export async function writeUserLocale(db: Database, userId: string, locale: Locale): Promise<void> {
  await db
    .insert(userPreference)
    .values({ userId, locale, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: userPreference.userId,
      set: { locale, updatedAt: new Date() },
    });
}
