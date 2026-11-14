import { z } from "zod";

import { isTimeZone, TRACKER_LIMITS, type TrackerType } from "./model";

/**
 * Phone feeds for custom trackers (Issue #452): the pure model, safe for the
 * app bundles.
 *
 * A member links one tracker per feed from the tracker's settings on their
 * phone. The phone reads the feed from Apple Health or Health Connect and
 * imports it; nothing is ever written back. The link is stored on the server
 * (`custom_tracker_feed`), so every phone of the member knows it, and the
 * server refuses an import into a tracker the feed is no longer linked to.
 * Unlinking stops imports and keeps the entries already imported.
 *
 * Imported entries carry `source` and the platform record id
 * (`source_record_id`); the partial unique index on those makes a re-import a
 * no-op, never a duplicate.
 */

export const TRACKER_FEEDS = [
  "healthkit_mindful_sessions",
  "health_connect_mindfulness",
  "healthkit_state_of_mind",
] as const;
export type TrackerFeed = (typeof TRACKER_FEEDS)[number];

/** `custom_tracker_entry.source` values for imported entries. */
export type TrackerEntrySource = "healthkit" | "health_connect";

export type TrackerFeedDefinition = {
  feed: TrackerFeed;
  platform: "ios" | "android";
  /** The entry `source` the import writes. */
  source: TrackerEntrySource;
  /** The tracker type the feed fills: meditation minutes or a 1-5 mood. */
  trackerType: Extract<TrackerType, "duration" | "scale">;
  /** The tracker template a member would usually link it to. */
  template: "meditation" | "mood";
  /** The lowest iOS major version that has the data type. */
  minIosVersion?: number;
  /** Health Connect's mindfulness API is experimental and may change. */
  experimental: boolean;
};

export const TRACKER_FEED_DEFINITIONS: Readonly<Record<TrackerFeed, TrackerFeedDefinition>> =
  Object.freeze({
    healthkit_mindful_sessions: {
      feed: "healthkit_mindful_sessions",
      platform: "ios",
      source: "healthkit",
      trackerType: "duration",
      template: "meditation",
      experimental: false,
    },
    health_connect_mindfulness: {
      feed: "health_connect_mindfulness",
      platform: "android",
      source: "health_connect",
      trackerType: "duration",
      template: "meditation",
      experimental: true,
    },
    healthkit_state_of_mind: {
      feed: "healthkit_state_of_mind",
      platform: "ios",
      source: "healthkit",
      trackerType: "scale",
      template: "mood",
      minIosVersion: 18,
      experimental: false,
    },
  });

/** Whether a feed can fill a tracker of this type. */
export function feedFitsTracker(feed: TrackerFeed, type: TrackerType): boolean {
  return TRACKER_FEED_DEFINITIONS[feed].trackerType === type;
}

/** The feeds a phone on this platform can offer for a tracker of this type. */
export function feedsFor(platform: "ios" | "android", type: TrackerType): TrackerFeed[] {
  return TRACKER_FEEDS.filter(
    (feed) => TRACKER_FEED_DEFINITIONS[feed].platform === platform && feedFitsTracker(feed, type),
  );
}

/** Whether this iOS major version has the feed's data type (always true off iOS). */
export function feedSupportedOnIos(feed: TrackerFeed, iosMajorVersion: number | null): boolean {
  const min = TRACKER_FEED_DEFINITIONS[feed].minIosVersion;
  if (min === undefined) return true;
  return iosMajorVersion !== null && iosMajorVersion >= min;
}

// ─── State of Mind → 1-5 mood ─────────────────────────────────

/**
 * Apple's seven-level valence classification (`HKStateOfMind.ValenceClassification`
 * raw values) mapped onto the 1-5 mood scale. The table is fixed and shown
 * to the member on the link screen; it is never hidden or tuned.
 */
export const STATE_OF_MIND_CLASSIFICATIONS = [
  { classification: 1, key: "very_unpleasant", mood: 1 },
  { classification: 2, key: "unpleasant", mood: 2 },
  { classification: 3, key: "slightly_unpleasant", mood: 2 },
  { classification: 4, key: "neutral", mood: 3 },
  { classification: 5, key: "slightly_pleasant", mood: 4 },
  { classification: 6, key: "pleasant", mood: 4 },
  { classification: 7, key: "very_pleasant", mood: 5 },
] as const;
export type StateOfMindClassificationKey = (typeof STATE_OF_MIND_CLASSIFICATIONS)[number]["key"];

/** `HKStateOfMind.Kind` raw values. Only daily moods are imported. */
export const STATE_OF_MIND_KIND = Object.freeze({ momentaryEmotion: 1, dailyMood: 2 });

/** The 1-5 mood for a valence classification, or null for an unknown value. */
export function moodFromValenceClassification(classification: number): number | null {
  return (
    STATE_OF_MIND_CLASSIFICATIONS.find((row) => row.classification === classification)?.mood ?? null
  );
}

// ─── Sessions → duration ──────────────────────────────────────

/**
 * A mindful session's length in whole seconds, rounded to the nearest
 * second. Null when it is not a usable duration entry: unreadable times, an
 * end before (or within half a second of) the start, or longer than one
 * duration entry may be (24 hours).
 */
export function sessionDurationSeconds(start: Date | string, end: Date | string): number | null {
  const from = new Date(start).getTime();
  const to = new Date(end).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  const seconds = Math.round((to - from) / 1000);
  if (seconds <= 0 || seconds > TRACKER_LIMITS.maxDurationSeconds) return null;
  return seconds;
}

// ─── Import entries and input schemas ─────────────────────────

/** One entry read from the phone, ready to import. */
export type FeedEntry = {
  /** The HealthKit sample UUID or Health Connect record id. */
  sourceRecordId: string;
  /** Seconds for a duration tracker; 1-5 for a mood. */
  value: number;
  /** When it happened: the session's start, or the State of Mind's date. */
  loggedAt: string;
};

export const TRACKER_FEED_LIMITS = Object.freeze({
  /** Entries per import call. */
  batchSize: 200,
  sourceRecordIdLength: 200,
});

const timeZone = z.string().min(1).max(64).refine(isTimeZone, { message: "Unknown time zone." });

export const trackerFeedLinkInput = z.strictObject({
  trackerId: z.uuid(),
  feed: z.enum(TRACKER_FEEDS),
});
export type TrackerFeedLinkInput = z.infer<typeof trackerFeedLinkInput>;

export const trackerFeedUnlinkInput = z.strictObject({
  feed: z.enum(TRACKER_FEEDS),
  /** Only unlink when the feed still fills this tracker. */
  trackerId: z.uuid().optional(),
});
export type TrackerFeedUnlinkInput = z.infer<typeof trackerFeedUnlinkInput>;

export const trackerFeedImportInput = z.strictObject({
  feed: z.enum(TRACKER_FEEDS),
  trackerId: z.uuid(),
  timeZone,
  entries: z
    .array(
      z.strictObject({
        sourceRecordId: z.string().min(1).max(TRACKER_FEED_LIMITS.sourceRecordIdLength),
        value: z.number(),
        loggedAt: z.iso.datetime({ offset: true }),
      }),
    )
    .min(1)
    .max(TRACKER_FEED_LIMITS.batchSize),
});
export type TrackerFeedImportInput = z.infer<typeof trackerFeedImportInput>;
