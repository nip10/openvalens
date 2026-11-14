import AsyncStorage from "@react-native-async-storage/async-storage";

import type { FeedCursorStore, FeedRunSummary } from "./run";

/**
 * Tracker-feed cursors (#452) hold HealthKit anchors and Health Connect
 * timestamps only, no health data, so AsyncStorage is enough (as for the
 * main sync's cursors).
 */
const CURSOR_PREFIX = "openvalens.tracker-feeds.cursor.";
const LAST_RUN_KEY = "openvalens.tracker-feeds.last-run";

export const asyncStorageFeedCursors: FeedCursorStore = {
  async get(key) {
    return AsyncStorage.getItem(CURSOR_PREFIX + key);
  },
  async set(key, value) {
    await AsyncStorage.setItem(CURSOR_PREFIX + key, value);
  },
};

export async function forgetFeedCursor(key: string): Promise<void> {
  await AsyncStorage.removeItem(CURSOR_PREFIX + key);
}

export type FeedLastRun = { at: string; summary: FeedRunSummary };

export async function readFeedLastRun(): Promise<FeedLastRun | null> {
  try {
    const raw = await AsyncStorage.getItem(LAST_RUN_KEY);
    return raw ? (JSON.parse(raw) as FeedLastRun) : null;
  } catch {
    return null;
  }
}

export async function recordFeedRun(at: Date, summary: FeedRunSummary): Promise<void> {
  const previous = await readFeedLastRun();
  await AsyncStorage.setItem(
    LAST_RUN_KEY,
    JSON.stringify({
      at: at.toISOString(),
      // A run for one link keeps the other links' last results.
      summary: { ...summary, feeds: { ...previous?.summary.feeds, ...summary.feeds } },
    } satisfies FeedLastRun),
  );
}

/** Sign-out: the next account on this phone starts from scratch. */
export async function clearTrackerFeedState(): Promise<void> {
  const keys = (await AsyncStorage.getAllKeys()).filter(
    (key) => key.startsWith(CURSOR_PREFIX) || key === LAST_RUN_KEY,
  );
  if (keys.length) await AsyncStorage.multiRemove(keys);
}
