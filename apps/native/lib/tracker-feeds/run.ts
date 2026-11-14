import {
  feedSupportedOnIos,
  TRACKER_FEED_DEFINITIONS,
  TRACKER_FEED_LIMITS,
  type FeedEntry,
  type TrackerFeed,
  type TrackerFeedImportInput,
} from "@openvalens/trackers/feeds";

/**
 * One import run for the member's linked tracker feeds (#452). Pure: the
 * phone's health store, the cursors and the server are injected, so the
 * algorithm is unit-tested.
 *
 * Per linked feed this phone can read: read a page from the cursor, send it
 * in batches, and only then move the cursor. A failed send keeps the cursor,
 * so the next run re-reads the same records, which the server answers as
 * duplicates. The cursor is keyed by feed and tracker: linking another
 * tracker starts from the beginning of the history.
 */

export type FeedLink = { feed: TrackerFeed; trackerId: string; trackerArchived: boolean };

export type FeedPage = {
  entries: FeedEntry[];
  /** Where the next read starts (an opaque token). */
  cursor: string;
  hasMore: boolean;
};

export type FeedPlatform = {
  platform: "ios" | "android";
  iosMajorVersion: number | null;
  /** Whether this phone was asked (iOS) or granted (Android) read access. */
  canRead(feed: TrackerFeed): Promise<boolean>;
  read(feed: TrackerFeed, cursor: string | null): Promise<FeedPage>;
};

export type FeedCursorStore = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
};

export type FeedImportResult = { imported: number; duplicates: number; skipped: number };

export type FeedRunDeps = {
  links(): Promise<FeedLink[]>;
  platform: FeedPlatform;
  cursors: FeedCursorStore;
  timeZone: string;
  send(input: TrackerFeedImportInput): Promise<FeedImportResult>;
};

export type FeedRunOptions = {
  /** Upper bound on pages read per run (background runs are time-limited). */
  maxPages: number;
  /** Stop starting new work after this epoch ms. */
  deadline?: number;
  /** Only this link (right after linking, or "Import now"). */
  only?: { feed: TrackerFeed; trackerId: string };
};

export type FeedStatus =
  | "ok"
  | "needs_permission"
  | "unsupported"
  | "archived"
  | "not_linked"
  | "budget_exhausted"
  | "error";

export type FeedResult = {
  status: FeedStatus;
  trackerId: string;
  imported: number;
  duplicates: number;
  /** Stable code only; never a message. */
  errorCode?: string;
};

export type FeedRunSummary = {
  feeds: Partial<Record<TrackerFeed, FeedResult>>;
  fatalErrorCode?: string;
};

const FATAL_CODES = new Set(["UNAUTHENTICATED", "NO_MEMBERSHIP", "ACCESS_READ_ONLY"]);

export const feedCursorKey = (feed: TrackerFeed, trackerId: string) => `${feed}:${trackerId}`;

function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : "SEND_FAILED";
}

function batches(entries: readonly FeedEntry[], size = TRACKER_FEED_LIMITS.batchSize) {
  const out: FeedEntry[][] = [];
  for (let index = 0; index < entries.length; index += size)
    out.push(entries.slice(index, index + size));
  return out;
}

export async function runTrackerFeeds(
  deps: FeedRunDeps,
  options: FeedRunOptions,
): Promise<FeedRunSummary> {
  const summary: FeedRunSummary = { feeds: {} };
  let budget = options.maxPages;
  const outOfTime = () =>
    budget <= 0 || (options.deadline !== undefined && Date.now() >= options.deadline);

  const links = (await deps.links()).filter(
    (link) =>
      TRACKER_FEED_DEFINITIONS[link.feed].platform === deps.platform.platform &&
      (!options.only ||
        (options.only.feed === link.feed && options.only.trackerId === link.trackerId)),
  );

  for (const link of links) {
    const result: FeedResult = {
      status: "ok",
      trackerId: link.trackerId,
      imported: 0,
      duplicates: 0,
    };
    summary.feeds[link.feed] = result;
    if (!feedSupportedOnIos(link.feed, deps.platform.iosMajorVersion)) {
      result.status = "unsupported";
      continue;
    }
    if (link.trackerArchived) {
      result.status = "archived";
      continue;
    }
    if (!(await deps.platform.canRead(link.feed))) {
      result.status = "needs_permission";
      continue;
    }

    const key = feedCursorKey(link.feed, link.trackerId);
    let cursor = await deps.cursors.get(key);
    let stop = false;
    for (;;) {
      if (outOfTime()) {
        result.status = "budget_exhausted";
        break;
      }
      let page: FeedPage;
      try {
        page = await deps.platform.read(link.feed, cursor);
      } catch {
        result.status = "error";
        result.errorCode = "SOURCE_FAILED";
        break;
      }
      budget -= 1;
      let sent = true;
      for (const part of batches(page.entries)) {
        try {
          const response = await deps.send({
            feed: link.feed,
            trackerId: link.trackerId,
            timeZone: deps.timeZone,
            entries: part,
          });
          result.imported += response.imported;
          result.duplicates += response.duplicates;
        } catch (error) {
          sent = false;
          const code = errorCode(error);
          // The feed was unlinked or moved (or the tracker archived) elsewhere.
          if (code === "CONFLICT") result.status = "not_linked";
          else {
            result.status = "error";
            result.errorCode = code;
          }
          if (FATAL_CODES.has(code)) {
            summary.fatalErrorCode = code;
            stop = true;
          }
          break;
        }
      }
      if (!sent) break;
      cursor = page.cursor;
      await deps.cursors.set(key, cursor);
      if (!page.hasMore) break;
    }
    if (stop) break;
  }
  return summary;
}
