import type { I18n } from "@lingui/core";
import type { Database } from "@openvalens/db";
import { user } from "@openvalens/db/schema/auth";
import { userPreference } from "@openvalens/db/schema/preferences";
import { eq, sql } from "drizzle-orm";

import { createAppI18n } from "./index";
import { isLocale, SOURCE_LOCALE, type Locale } from "./locales";

/**
 * The member's interface language on the server (#231), for email, push and
 * Telegram. A missing preference, an unknown member or an unsupported value
 * means English. Rendering uses the same catalogs and review-state fallbacks
 * as the apps.
 *
 * Lives here, below `@openvalens/auth`, `@openvalens/email` and
 * `@openvalens/telegram`, so every server package that sends a message can
 * use it. Server-only: the apps never import this module.
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

/**
 * The language of the account that owns `email`, or `null` when no account
 * has that address. An account without a saved choice is English.
 */
export async function findLocaleForEmail(
  db: Pick<Database, "select">,
  email: string,
): Promise<Locale | null> {
  const [row] = await db
    .select({ locale: userPreference.locale })
    .from(user)
    .leftJoin(userPreference, eq(userPreference.userId, user.id))
    .where(sql`lower(${user.email}) = lower(${email})`)
    .limit(1);
  if (!row) return null;
  return isLocale(row.locale) ? row.locale : SOURCE_LOCALE;
}

/** For mail addressed by email (magic links, invitations to existing accounts). */
export async function readLocaleForEmail(
  db: Pick<Database, "select">,
  email: string,
): Promise<Locale> {
  return (await findLocaleForEmail(db, email)) ?? SOURCE_LOCALE;
}

/**
 * English when the lookup fails, so a database hiccup never stops a sign-in
 * link or a reminder from going out.
 */
export async function localeOrEnglish(lookup: Promise<Locale>): Promise<Locale> {
  try {
    return await lookup;
  } catch {
    return SOURCE_LOCALE;
  }
}

/**
 * How a sender finds the recipient's language. Injected so delivery code can
 * be unit-tested with fakes; {@link databaseMessageLocales} is the real one.
 */
export type MessageLocales = {
  /** The language of the account with this address, or `null` when there is none. */
  forEmail(email: string): Promise<Locale | null>;
  /** A member's language (English when unset). */
  forUser(userId: string): Promise<Locale>;
};

export function databaseMessageLocales(db: Database): MessageLocales {
  return {
    forEmail: (email) => findLocaleForEmail(db, email),
    forUser: (userId) => readUserLocale(db, userId),
  };
}

/** The language of the account with this address; English when there is none or on error. */
export function localeForEmail(locales: MessageLocales, email: string): Promise<Locale> {
  return localeOrEnglish(locales.forEmail(email).then((locale) => locale ?? SOURCE_LOCALE));
}

/**
 * For an invitation: the recipient's language when they already have an
 * account, otherwise the inviter's (they likely share one). English on error.
 */
export function localeForInvitee(
  locales: MessageLocales,
  email: string,
  inviterUserId: string | null | undefined,
): Promise<Locale> {
  return localeOrEnglish(
    locales.forEmail(email).then(async (locale) => {
      if (locale) return locale;
      return inviterUserId ? locales.forUser(inviterUserId) : SOURCE_LOCALE;
    }),
  );
}
