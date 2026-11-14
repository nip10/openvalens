import { describe, expect, test } from "bun:test";
import type { FeedEntry, TrackerFeed, TrackerFeedImportInput } from "@openvalens/trackers/feeds";

import {
  feedCursorKey,
  runTrackerFeeds,
  type FeedLink,
  type FeedPage,
  type FeedRunDeps,
} from "./run";

const TRACKER = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";

function sessions(prefix: string, count: number): FeedEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    sourceRecordId: `${prefix}-${index}`,
    value: 600,
    loggedAt: "2026-11-10T07:00:00.000Z",
  }));
}

/**
 * A server that behaves like the partial unique index on
 * (tracker, source, source_record_id): a repeat is a duplicate, not a row.
 */
function fakeServer(options: { failOnce?: string; linked?: () => FeedLink[] } = {}) {
  const rows = new Map<string, FeedEntry>();
  const calls: TrackerFeedImportInput[] = [];
  let fail = options.failOnce;
  return {
    rows,
    calls,
    async send(input: TrackerFeedImportInput) {
      calls.push(input);
      if (fail) {
        const code = fail;
        fail = undefined;
        throw Object.assign(new Error(code), { code });
      }
      const linked = options.linked?.();
      if (
        linked &&
        !linked.some((link) => link.feed === input.feed && link.trackerId === input.trackerId)
      )
        throw Object.assign(new Error("CONFLICT"), { code: "CONFLICT" });
      let imported = 0;
      let duplicates = 0;
      for (const entry of input.entries) {
        const source = input.feed.startsWith("health_connect") ? "health_connect" : "healthkit";
        const key = `${input.trackerId}:${source}:${entry.sourceRecordId}`;
        if (rows.has(key)) duplicates += 1;
        else {
          rows.set(key, entry);
          imported += 1;
        }
      }
      return { imported, duplicates, skipped: 0 };
    },
  };
}

/** A phone whose store holds `records`, read in pages of `pageSize` from an index cursor. */
function fakePlatform(
  records: Partial<Record<TrackerFeed, FeedEntry[]>>,
  options: {
    platform?: "ios" | "android";
    iosMajorVersion?: number | null;
    canRead?: boolean;
    pageSize?: number;
    failRead?: boolean;
  } = {},
) {
  const reads: { feed: TrackerFeed; cursor: string | null }[] = [];
  return {
    reads,
    platform: options.platform ?? "ios",
    iosMajorVersion: options.iosMajorVersion === undefined ? 18 : options.iosMajorVersion,
    async canRead() {
      return options.canRead ?? true;
    },
    async read(feed: TrackerFeed, cursor: string | null): Promise<FeedPage> {
      reads.push({ feed, cursor });
      if (options.failRead) throw new Error("HealthKit unavailable");
      const all = records[feed] ?? [];
      const start = cursor ? Number(cursor) : 0;
      const size = options.pageSize ?? 1000;
      const entries = all.slice(start, start + size);
      return {
        entries,
        cursor: String(start + entries.length),
        hasMore: start + entries.length < all.length,
      };
    },
  };
}

function memoryCursors() {
  const store = new Map<string, string>();
  return {
    store,
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async set(key: string, value: string) {
      store.set(key, value);
    },
  };
}

function deps(
  overrides: Partial<FeedRunDeps> & Pick<FeedRunDeps, "platform" | "send">,
  links: FeedLink[] = [
    { feed: "healthkit_mindful_sessions", trackerId: TRACKER, trackerArchived: false },
  ],
): FeedRunDeps {
  return {
    links: async () => links,
    cursors: memoryCursors(),
    timeZone: "Europe/Lisbon",
    ...overrides,
  };
}

describe("tracker feed import runs (#452)", () => {
  test("imports every page in batches of at most 200 and moves the cursor after each page", async () => {
    const server = fakeServer();
    const cursors = memoryCursors();
    const platform = fakePlatform(
      { healthkit_mindful_sessions: sessions("HK", 450) },
      { pageSize: 300 },
    );
    const summary = await runTrackerFeeds(deps({ platform, cursors, send: server.send }), {
      maxPages: 10,
    });
    expect(summary.feeds.healthkit_mindful_sessions).toEqual({
      status: "ok",
      trackerId: TRACKER,
      imported: 450,
      duplicates: 0,
    });
    expect(server.calls.map((call) => call.entries.length)).toEqual([200, 100, 150]);
    expect(server.calls[0]).toMatchObject({
      feed: "healthkit_mindful_sessions",
      trackerId: TRACKER,
      timeZone: "Europe/Lisbon",
    });
    expect(cursors.store.get(feedCursorKey("healthkit_mindful_sessions", TRACKER))).toBe("450");
  });

  test("re-importing after a cursor reset never duplicates", async () => {
    const server = fakeServer();
    const platform = fakePlatform({ healthkit_mindful_sessions: sessions("HK", 30) });
    await runTrackerFeeds(deps({ platform, send: server.send }), { maxPages: 10 });
    expect(server.rows.size).toBe(30);

    // A reinstall or sign-out drops the cursors: the next run re-reads everything.
    const again = await runTrackerFeeds(
      deps({ platform, cursors: memoryCursors(), send: server.send }),
      { maxPages: 10 },
    );
    expect(server.rows.size).toBe(30);
    expect(again.feeds.healthkit_mindful_sessions).toMatchObject({ imported: 0, duplicates: 30 });
  });

  test("a failed send keeps the cursor, and the retry imports without duplicates", async () => {
    const server = fakeServer({ failOnce: "INTERNAL_SERVER_ERROR" });
    const cursors = memoryCursors();
    const platform = fakePlatform({ healthkit_mindful_sessions: sessions("HK", 5) });
    const first = await runTrackerFeeds(deps({ platform, cursors, send: server.send }), {
      maxPages: 10,
    });
    expect(first.feeds.healthkit_mindful_sessions).toMatchObject({
      status: "error",
      errorCode: "INTERNAL_SERVER_ERROR",
    });
    expect(cursors.store.size).toBe(0);
    const second = await runTrackerFeeds(deps({ platform, cursors, send: server.send }), {
      maxPages: 10,
    });
    expect(second.feeds.healthkit_mindful_sessions).toMatchObject({ status: "ok", imported: 5 });
    expect(server.rows.size).toBe(5);
  });

  test("a feed linked to another tracker starts from the beginning for that tracker", async () => {
    const server = fakeServer();
    const cursors = memoryCursors();
    const platform = fakePlatform({ healthkit_mindful_sessions: sessions("HK", 3) });
    await runTrackerFeeds(deps({ platform, cursors, send: server.send }), { maxPages: 10 });
    const moved = await runTrackerFeeds(
      deps({ platform, cursors, send: server.send }, [
        { feed: "healthkit_mindful_sessions", trackerId: OTHER, trackerArchived: false },
      ]),
      { maxPages: 10 },
    );
    expect(moved.feeds.healthkit_mindful_sessions).toMatchObject({ trackerId: OTHER, imported: 3 });
    expect(server.rows.size).toBe(6);
  });

  test("an unlinked feed stops at the server's refusal and keeps its cursor", async () => {
    const server = fakeServer({ linked: () => [] });
    const cursors = memoryCursors();
    const platform = fakePlatform({ healthkit_mindful_sessions: sessions("HK", 3) });
    const summary = await runTrackerFeeds(deps({ platform, cursors, send: server.send }), {
      maxPages: 10,
    });
    expect(summary.feeds.healthkit_mindful_sessions?.status).toBe("not_linked");
    expect(server.rows.size).toBe(0);
    expect(cursors.store.size).toBe(0);
  });

  test("reads only this phone's feeds, and only those it may read", async () => {
    const links: FeedLink[] = [
      { feed: "healthkit_mindful_sessions", trackerId: TRACKER, trackerArchived: false },
      { feed: "health_connect_mindfulness", trackerId: TRACKER, trackerArchived: false },
      { feed: "healthkit_state_of_mind", trackerId: OTHER, trackerArchived: false },
    ];
    const server = fakeServer();
    const android = fakePlatform(
      { health_connect_mindfulness: sessions("hc", 2) },
      { platform: "android", iosMajorVersion: null },
    );
    const summary = await runTrackerFeeds(deps({ platform: android, send: server.send }, links), {
      maxPages: 10,
    });
    expect(Object.keys(summary.feeds)).toEqual(["health_connect_mindfulness"]);
    expect(android.reads.map((read) => read.feed)).toEqual(["health_connect_mindfulness"]);

    // A second phone that was never asked for access imports nothing.
    const unasked = fakePlatform(
      { healthkit_mindful_sessions: sessions("HK", 2) },
      {
        canRead: false,
      },
    );
    const blocked = await runTrackerFeeds(deps({ platform: unasked, send: server.send }, links), {
      maxPages: 10,
    });
    expect(blocked.feeds.healthkit_mindful_sessions?.status).toBe("needs_permission");
    expect(unasked.reads).toEqual([]);
  });

  test("State of Mind is not read below iOS 18; archived trackers are not read", async () => {
    const server = fakeServer();
    const ios17 = fakePlatform(
      { healthkit_state_of_mind: sessions("SOM", 2) },
      {
        iosMajorVersion: 17,
      },
    );
    const summary = await runTrackerFeeds(
      deps({ platform: ios17, send: server.send }, [
        { feed: "healthkit_state_of_mind", trackerId: OTHER, trackerArchived: false },
        { feed: "healthkit_mindful_sessions", trackerId: TRACKER, trackerArchived: true },
      ]),
      { maxPages: 10 },
    );
    expect(summary.feeds.healthkit_state_of_mind?.status).toBe("unsupported");
    expect(summary.feeds.healthkit_mindful_sessions?.status).toBe("archived");
    expect(ios17.reads).toEqual([]);
  });

  test("stops at the page budget and resumes from the cursor next run", async () => {
    const server = fakeServer();
    const cursors = memoryCursors();
    const platform = fakePlatform(
      { healthkit_mindful_sessions: sessions("HK", 30) },
      { pageSize: 10 },
    );
    const first = await runTrackerFeeds(deps({ platform, cursors, send: server.send }), {
      maxPages: 2,
    });
    expect(first.feeds.healthkit_mindful_sessions?.status).toBe("budget_exhausted");
    expect(server.rows.size).toBe(20);
    await runTrackerFeeds(deps({ platform, cursors, send: server.send }), { maxPages: 10 });
    expect(server.rows.size).toBe(30);
    expect(platform.reads.map((read) => read.cursor)).toEqual([null, "10", "20"]);
  });

  test("a read failure is reported as SOURCE_FAILED and sends nothing", async () => {
    const server = fakeServer();
    const platform = fakePlatform({}, { failRead: true });
    const summary = await runTrackerFeeds(deps({ platform, send: server.send }), { maxPages: 10 });
    expect(summary.feeds.healthkit_mindful_sessions).toMatchObject({
      status: "error",
      errorCode: "SOURCE_FAILED",
    });
    expect(server.calls).toEqual([]);
  });

  test("`only` runs a single link", async () => {
    const server = fakeServer();
    const platform = fakePlatform({
      healthkit_mindful_sessions: sessions("HK", 1),
      healthkit_state_of_mind: sessions("SOM", 1),
    });
    const summary = await runTrackerFeeds(
      deps({ platform, send: server.send }, [
        { feed: "healthkit_mindful_sessions", trackerId: TRACKER, trackerArchived: false },
        { feed: "healthkit_state_of_mind", trackerId: OTHER, trackerArchived: false },
      ]),
      { maxPages: 10, only: { feed: "healthkit_state_of_mind", trackerId: OTHER } },
    );
    expect(Object.keys(summary.feeds)).toEqual(["healthkit_state_of_mind"]);
  });
});
