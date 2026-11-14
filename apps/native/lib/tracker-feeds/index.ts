import type { TrackerFeed } from "@openvalens/trackers/feeds";
import { Platform } from "react-native";

import { nativeFeedPlatform } from "./platform";
import { runTrackerFeeds, type FeedRunSummary } from "./run";
import { asyncStorageFeedCursors, readFeedLastRun, recordFeedRun } from "./store";

import { readCloudAccess, writesPaused } from "@/lib/cloud-access";
import { client } from "@/utils/orpc";

/**
 * Tracker feeds from the phone (#452): HealthKit mindful sessions and
 * Health Connect mindfulness into a duration tracker, HealthKit State of Mind
 * (daily moods) into a 1-5 tracker. Links live on the server (one tracker per
 * feed); this module imports what the phone can read.
 *
 * Runs after the main health sync (foreground "Sync now" and the background
 * task), when a linked tracker opens, and right after linking.
 */
export { feedStoreAvailable, iosMajorVersion, requestFeedAccess } from "./platform";
export { feedCursorKey, type FeedResult, type FeedRunSummary, type FeedStatus } from "./run";
export { clearTrackerFeedState, forgetFeedCursor, readFeedLastRun } from "./store";

/** Opening the trackers again within this window does not import again. */
const THROTTLE_MS = 15 * 60_000;
const FOREGROUND_BUDGET = { maxPages: 40, windowMs: 45_000 };

let inFlight: Promise<FeedRunSummary | null> | null = null;

export type ImportTrackerFeedsOptions = {
  /** Skip the throttle (after linking, "Import now", "Sync now"). */
  force?: boolean;
  only?: { feed: TrackerFeed; trackerId: string };
  maxPages?: number;
  deadline?: number;
};

/**
 * One import run. Resolves to null when nothing ran: not a phone, throttled,
 * or the workspace's Cloud access has ended (#298). Never throws.
 */
export function importTrackerFeeds(
  options: ImportTrackerFeedsOptions = {},
): Promise<FeedRunSummary | null> {
  // A run for one link waits for a running full run, then runs on its own.
  if (inFlight && !options.only) return inFlight;
  const previous = inFlight ?? Promise.resolve(null);
  const next = previous
    .catch(() => null)
    .then(() => run(options))
    .catch(() => null)
    .finally(() => {
      if (inFlight === next) inFlight = null;
    });
  inFlight = next;
  return next;
}

async function run(options: ImportTrackerFeedsOptions): Promise<FeedRunSummary | null> {
  if (Platform.OS !== "ios" && Platform.OS !== "android") return null;
  if (!options.force) {
    const last = await readFeedLastRun();
    if (last && Date.now() - new Date(last.at).getTime() < THROTTLE_MS) return null;
  }
  if (writesPaused(await readCloudAccess())) return null;
  const startedAt = new Date();
  const summary = await runTrackerFeeds(
    {
      links: () => client.trackers.feeds(),
      platform: nativeFeedPlatform,
      cursors: asyncStorageFeedCursors,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      send: (input) => client.trackers.importFeed(input),
    },
    {
      maxPages: options.maxPages ?? FOREGROUND_BUDGET.maxPages,
      deadline: options.deadline ?? Date.now() + FOREGROUND_BUDGET.windowMs,
      ...(options.only ? { only: options.only } : {}),
    },
  );
  await recordFeedRun(startedAt, summary);
  return summary;
}
