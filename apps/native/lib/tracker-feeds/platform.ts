import type { TrackerFeed } from "@openvalens/trackers/feeds";
import { Platform } from "react-native";

import { mapEach, mapHealthConnectMindfulness, mapMindfulSession, mapStateOfMind } from "./map";
import type { FeedPage, FeedPlatform } from "./run";

/**
 * The phone side of tracker feeds (#452): read access and reads from Apple
 * Health and Health Connect. Read-only: nothing is written back. The native
 * modules are imported dynamically so each loads only on its platform.
 *
 * - HealthKit mindful sessions and State of Mind use anchored queries: the
 *   first read walks the whole history in pages, then only new samples come.
 *   Deleted samples are ignored; their entries stay until the member deletes
 *   them in OpenValens.
 * - State of Mind exists from iOS 18; the native query throws below that, so
 *   it is never called there.
 * - Health Connect mindfulness is an experimental API: the cursor is a time,
 *   re-read with an overlap (the server ignores repeats).
 */

export const HEALTHKIT_MINDFUL_TYPE = "HKCategoryTypeIdentifierMindfulSession" as const;
export const HEALTHKIT_STATE_OF_MIND_TYPE = "HKStateOfMindTypeIdentifier" as const;
const HEALTH_CONNECT_MINDFULNESS = "MindfulnessSession" as const;

const PAGE_SIZE = 500;
const DAY_MS = 86_400_000;
/** The first Health Connect read goes back as far as the main sync's backfill. */
const HEALTH_CONNECT_BACKFILL_DAYS = 30;
/** Later reads overlap the last one, for sessions written late. */
const HEALTH_CONNECT_OVERLAP_DAYS = 7;

/** The iOS major version (18 for 18.1), or null off iOS. */
export function iosMajorVersion(): number | null {
  if (Platform.OS !== "ios") return null;
  const major = Number.parseInt(String(Platform.Version), 10);
  return Number.isFinite(major) ? major : null;
}

function healthKitIdentifier(feed: TrackerFeed) {
  return feed === "healthkit_state_of_mind" ? HEALTHKIT_STATE_OF_MIND_TYPE : HEALTHKIT_MINDFUL_TYPE;
}

type AnchorToken = { anchor?: string };
type SinceToken = { since?: string };
function parse<T extends object>(token: string | null): T {
  if (!token) return {} as T;
  try {
    return JSON.parse(token) as T;
  } catch {
    return {} as T;
  }
}

async function healthConnect() {
  const hc = await import("react-native-health-connect");
  if ((await hc.getSdkStatus()) !== hc.SdkAvailabilityStatus.SDK_AVAILABLE) return null;
  await hc.initialize();
  return hc;
}

/** Whether this phone has the platform's health store at all. */
export async function feedStoreAvailable(): Promise<boolean> {
  try {
    if (Platform.OS === "ios") {
      const hk = await import("@kingstinct/react-native-healthkit");
      return hk.isHealthDataAvailable();
    }
    if (Platform.OS === "android") return (await healthConnect()) !== null;
  } catch {
    return false;
  }
  return false;
}

async function canRead(feed: TrackerFeed): Promise<boolean> {
  if (Platform.OS === "ios") {
    if (feed === "healthkit_state_of_mind" && (iosMajorVersion() ?? 0) < 18) return false;
    const hk = await import("@kingstinct/react-native-healthkit");
    if (!hk.isHealthDataAvailable()) return false;
    // HealthKit never says whether read access was granted, only whether the
    // person was asked. Denied types return no samples.
    const status = await hk.getRequestStatusForAuthorization({
      toRead: [healthKitIdentifier(feed)],
    });
    return status === hk.AuthorizationRequestStatus.unnecessary;
  }
  if (Platform.OS !== "android" || feed !== "health_connect_mindfulness") return false;
  const hc = await healthConnect();
  if (!hc) return false;
  const granted = await hc.getGrantedPermissions();
  return granted.some(
    (permission) =>
      permission.accessType === "read" &&
      (permission.recordType as string) === HEALTH_CONNECT_MINDFULNESS,
  );
}

/**
 * Shows the Apple Health / Health Connect sheet for this one feed. Called only
 * when the member links a tracker, never before. Resolves to whether the feed
 * can now be read.
 */
export async function requestFeedAccess(feed: TrackerFeed): Promise<boolean> {
  if (Platform.OS === "ios") {
    if (feed === "healthkit_state_of_mind" && (iosMajorVersion() ?? 0) < 18) return false;
    const hk = await import("@kingstinct/react-native-healthkit");
    if (!hk.isHealthDataAvailable()) return false;
    await hk.requestAuthorization({ toRead: [healthKitIdentifier(feed)] });
    return canRead(feed);
  }
  if (Platform.OS !== "android") return false;
  const hc = await healthConnect();
  if (!hc) return false;
  await hc.requestPermission([
    { accessType: "read", recordType: HEALTH_CONNECT_MINDFULNESS },
    { accessType: "read", recordType: "BackgroundAccessPermission" },
  ]);
  return canRead(feed);
}

async function readHealthKit(feed: TrackerFeed, cursor: string | null): Promise<FeedPage> {
  const hk = await import("@kingstinct/react-native-healthkit");
  const { anchor } = parse<AnchorToken>(cursor);
  const query = { limit: PAGE_SIZE, ...(anchor ? { anchor } : {}) };
  if (feed === "healthkit_state_of_mind") {
    const result = await hk.queryStateOfMindSamplesWithAnchor(query);
    return {
      entries: mapEach(result.samples, mapStateOfMind),
      cursor: JSON.stringify({ anchor: result.newAnchor } satisfies AnchorToken),
      hasMore: result.samples.length + result.deletedSamples.length >= PAGE_SIZE,
    };
  }
  const result = await hk.queryCategorySamplesWithAnchor(HEALTHKIT_MINDFUL_TYPE, query);
  return {
    entries: mapEach(result.samples, mapMindfulSession),
    cursor: JSON.stringify({ anchor: result.newAnchor } satisfies AnchorToken),
    hasMore: result.samples.length + result.deletedSamples.length >= PAGE_SIZE,
  };
}

async function readHealthConnect(cursor: string | null): Promise<FeedPage> {
  const hc = await healthConnect();
  if (!hc) throw new Error("Health Connect is not available.");
  const now = new Date();
  const { since } = parse<SinceToken>(cursor);
  const from = since
    ? new Date(new Date(since).getTime() - HEALTH_CONNECT_OVERLAP_DAYS * DAY_MS)
    : new Date(now.getTime() - HEALTH_CONNECT_BACKFILL_DAYS * DAY_MS);
  const records: Parameters<typeof mapHealthConnectMindfulness>[0][] = [];
  let pageToken: string | undefined;
  do {
    const page = await hc.readRecords(HEALTH_CONNECT_MINDFULNESS, {
      timeRangeFilter: {
        operator: "between",
        startTime: from.toISOString(),
        endTime: now.toISOString(),
      },
      ascendingOrder: true,
      ...(pageToken ? { pageToken } : {}),
    });
    records.push(...page.records);
    pageToken = page.pageToken;
  } while (pageToken);
  return {
    entries: mapEach(records, mapHealthConnectMindfulness),
    cursor: JSON.stringify({ since: now.toISOString() } satisfies SinceToken),
    hasMore: false,
  };
}

export const nativeFeedPlatform: FeedPlatform = {
  platform: Platform.OS === "android" ? "android" : "ios",
  iosMajorVersion: iosMajorVersion(),
  canRead,
  read(feed, cursor) {
    return feed === "health_connect_mindfulness"
      ? readHealthConnect(cursor)
      : readHealthKit(feed, cursor);
  },
};
