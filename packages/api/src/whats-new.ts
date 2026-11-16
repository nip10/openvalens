// The web and native type checks load this file through the router types, so
// the virtual module's declaration must travel with it; it has no runtime
// module to import.
// oxlint-disable-next-line typescript/triple-slash-reference
/// <reference path="./release-notes-module.d.ts" />
import type { Database } from "@openvalens/db";
import { userPreference } from "@openvalens/db/schema/preferences";
import type { Locale } from "@openvalens/i18n";
import { eq } from "drizzle-orm";
import bundledNotes, { history as bundledHistory } from "virtual:openvalens/release-notes";
import { z } from "zod";

/**
 * Issue #446 — the "What's new in X.Y" card on Today. The Highlights of the
 * version this server runs are compiled into its build (see
 * `release-notes-module.d.ts`), so a self-hosted instance on an older version
 * shows its own, older notes. Each member sees the card until they dismiss it
 * for that version, and can turn it off. The state lives in the member's
 * `user_preference` row.
 */

const blockSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("list"), items: z.array(z.string()) }),
  z.object({ kind: z.literal("paragraph"), text: z.string() }),
]);

export const releaseNotesSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  highlights: z.object({ en: z.array(blockSchema), "pt-PT": z.array(blockSchema).nullable() }),
  /** One short line per list item (the bold lead), for the web dialog. */
  headlines: z
    .object({ en: z.array(z.string()), "pt-PT": z.array(z.string()).nullable() })
    .optional(),
});
export type ReleaseNotes = z.infer<typeof releaseNotesSchema>;

export const whatsNewCardSchema = z.object({
  /** The full release version, `X.Y.Z`: what dismissing records. */
  version: z.string(),
  /** `X.Y`, for the title "What's new in X.Y". */
  shortVersion: z.string(),
  /** `YYYY-MM-DD` */
  date: z.string(),
  /** The language of `highlights`: pt-PT only when a translation exists. */
  locale: z.enum(["en", "pt-PT"]),
  highlights: z.array(blockSchema),
  /**
   * Up to three short lines for the asking app's platform, in `locale`: items
   * that name another platform ("Android: …") are left out. Empty when none
   * apply, so the web dialog stays closed.
   */
  headlines: z.array(z.string()),
  changelogUrl: z.string(),
});
export type WhatsNewCard = z.infer<typeof whatsNewCardSchema>;

export const whatsNewOutputSchema = z.object({
  enabled: z.boolean(),
  card: whatsNewCardSchema.nullable(),
});
export type WhatsNewOutput = z.infer<typeof whatsNewOutputSchema>;

export type WhatsNewState = { enabled: boolean; dismissedVersion: string | null };

export const WHATS_NEW_PLATFORMS = ["web", "ios", "android"] as const;
export type WhatsNewPlatform = (typeof WHATS_NEW_PLATFORMS)[number];

/** The most headlines the dialog shows. */
const HEADLINE_LIMIT = 3;

/** A headline that names one platform, such as "Android: …" or "iOS: …". */
const PLATFORM_PREFIX = /^(android|ios|iphone)\b/i;

function headlinePlatform(headline: string): WhatsNewPlatform | null {
  const match = PLATFORM_PREFIX.exec(headline)?.[1]?.toLowerCase();
  if (!match) return null;
  return match === "android" ? "android" : "ios";
}

/**
 * The headlines one platform shows: those for every platform plus its own.
 * Without a platform (an older app), all of them.
 */
export function platformHeadlines(
  headlines: readonly string[],
  platform: WhatsNewPlatform | undefined,
): string[] {
  const fitting = headlines.filter((headline) => {
    const only = headlinePlatform(headline);
    return platform === undefined || only === null || only === platform;
  });
  return fitting.slice(0, HEADLINE_LIMIT);
}

export const changelogEntrySchema = z.object({
  version: z.string(),
  /** `YYYY-MM-DD` */
  date: z.string(),
  /** The language of `highlights`: pt-PT only when a translation exists. */
  locale: z.enum(["en", "pt-PT"]),
  highlights: z.array(blockSchema),
});
export type ChangelogEntry = z.infer<typeof changelogEntrySchema>;

export const changelogOutputSchema = z.object({ entries: z.array(changelogEntrySchema) });

/** Every release this server knows, newest first, each in `locale` when translated. */
export function changelogEntries(
  history: readonly ReleaseNotes[],
  locale: Locale,
): ChangelogEntry[] {
  return history.map((notes) => {
    const translated = locale === "pt-PT" ? notes.highlights["pt-PT"] : null;
    return {
      version: notes.version,
      date: notes.date,
      locale: translated ? "pt-PT" : "en",
      highlights: translated ?? notes.highlights.en,
    };
  });
}

/** The releases bundled into this server, newest first; empty when they do not parse. */
export function serverReleaseHistory(): ReleaseNotes[] {
  const parsed = z.array(releaseNotesSchema).safeParse(bundledHistory ?? []);
  return parsed.success ? parsed.data : [];
}

const CHANGELOG_URL = "https://openvalens.com/changelog";

/** This server's notes; null when its version has none or they do not parse. */
export function serverReleaseNotes(): ReleaseNotes | null {
  const parsed = releaseNotesSchema.safeParse(bundledNotes);
  return parsed.success ? parsed.data : null;
}

/** The card to show, or null: no notes, turned off, or dismissed for this version. */
export function pickWhatsNewCard(
  notes: ReleaseNotes | null,
  state: WhatsNewState,
  locale: Locale,
  platform?: WhatsNewPlatform,
): WhatsNewCard | null {
  if (!notes || !state.enabled || state.dismissedVersion === notes.version) return null;
  const translated = locale === "pt-PT" ? notes.highlights["pt-PT"] : null;
  const highlights = translated ?? notes.highlights.en;
  if (highlights.length === 0) return null;
  const headlines = (translated ? notes.headlines?.["pt-PT"] : notes.headlines?.en) ?? [];
  return {
    version: notes.version,
    shortVersion: notes.version.split(".").slice(0, 2).join("."),
    date: notes.date,
    locale: translated ? "pt-PT" : "en",
    highlights,
    headlines: platformHeadlines(headlines, platform),
    changelogUrl: `${CHANGELOG_URL}#v${notes.version}`,
  };
}

export async function readWhatsNewState(
  db: Pick<Database, "select">,
  userId: string,
): Promise<WhatsNewState & { locale: string | null }> {
  const [row] = await db
    .select({
      locale: userPreference.locale,
      enabled: userPreference.whatsNewEnabled,
      dismissedVersion: userPreference.whatsNewDismissedVersion,
    })
    .from(userPreference)
    .where(eq(userPreference.userId, userId));
  return row ?? { locale: null, enabled: true, dismissedVersion: null };
}

/**
 * Updates the card state, creating the member's preference row when it does
 * not exist yet. A new row gets the default language, English, as a missing
 * row already means; the apps keep the language in sync on their own.
 */
export async function writeWhatsNewState(
  db: Pick<Database, "insert">,
  userId: string,
  patch: Partial<WhatsNewState>,
): Promise<void> {
  const set = {
    ...(patch.enabled === undefined ? {} : { whatsNewEnabled: patch.enabled }),
    ...(patch.dismissedVersion === undefined
      ? {}
      : { whatsNewDismissedVersion: patch.dismissedVersion }),
    updatedAt: new Date(),
  };
  await db
    .insert(userPreference)
    .values({ userId, locale: "en", ...set })
    .onConflictDoUpdate({ target: userPreference.userId, set });
}
