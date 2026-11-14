import {
  moodFromValenceClassification,
  sessionDurationSeconds,
  STATE_OF_MIND_KIND,
  type FeedEntry,
} from "@openvalens/trackers/feeds";

/**
 * Phone records → tracker entries (#452). Pure (no native imports) so it
 * runs under `bun test`. Each entry keeps the platform record id, which the
 * server's unique index uses to make a re-import a no-op.
 */

/** A `HKCategoryTypeIdentifierMindfulSession` sample. */
export type MindfulSampleLike = {
  uuid: string;
  startDate: Date | string;
  endDate: Date | string;
};

/** An `HKStateOfMind` sample (iOS 18+). */
export type StateOfMindSampleLike = {
  uuid: string;
  startDate: Date | string;
  /** `HKStateOfMind.Kind`: 1 momentary emotion, 2 daily mood. */
  kind: number;
  /** `HKStateOfMind.ValenceClassification`, 1 (very unpleasant) to 7 (very pleasant). */
  valenceClassification: number;
};

/** A Health Connect `MindfulnessSessionRecord`. */
export type HealthConnectMindfulnessLike = {
  startTime: string;
  endTime: string;
  metadata?: { id?: string };
};

function iso(value: Date | string): string | null {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

/** A mindful session as a duration entry: its length in seconds, at its start. */
export function mapMindfulSession(sample: MindfulSampleLike): FeedEntry | null {
  const value = sessionDurationSeconds(sample.startDate, sample.endDate);
  const loggedAt = iso(sample.startDate);
  if (!sample.uuid || value === null || !loggedAt) return null;
  return { sourceRecordId: sample.uuid, value, loggedAt };
}

/**
 * A daily mood as a 1-5 entry, through the fixed table in
 * `@openvalens/trackers/feeds`. Momentary emotions are not imported.
 */
export function mapStateOfMind(sample: StateOfMindSampleLike): FeedEntry | null {
  if (sample.kind !== STATE_OF_MIND_KIND.dailyMood) return null;
  const value = moodFromValenceClassification(sample.valenceClassification);
  const loggedAt = iso(sample.startDate);
  if (!sample.uuid || value === null || !loggedAt) return null;
  return { sourceRecordId: sample.uuid, value, loggedAt };
}

/** A Health Connect mindfulness session as a duration entry. */
export function mapHealthConnectMindfulness(
  record: HealthConnectMindfulnessLike,
): FeedEntry | null {
  const id = record.metadata?.id;
  const value = sessionDurationSeconds(record.startTime, record.endTime);
  const loggedAt = iso(record.startTime);
  if (!id || value === null || !loggedAt) return null;
  return { sourceRecordId: id, value, loggedAt };
}

export function mapEach<T>(items: readonly T[], map: (item: T) => FeedEntry | null): FeedEntry[] {
  const out: FeedEntry[] = [];
  for (const item of items) {
    const entry = map(item);
    if (entry) out.push(entry);
  }
  return out;
}
