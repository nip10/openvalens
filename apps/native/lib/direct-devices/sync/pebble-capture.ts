import {
  directDeviceIdentity,
  type IngestDirectDeviceBatchInput,
} from "@openvalens/api/contracts/direct-device";

import { isPebbleCaptureIdentity, type PebbleIdentity } from "../pebble-types";
import {
  assembleSleepSessions,
  parseOverlaySessionData,
  parseSleepSessionData,
  parseStepsSessionData,
  stepsSamplesToRecords,
} from "../protocol/pebble";
import type { AuthorityTicket } from "../authority";
import type {
  DirectDeviceStore,
  PebbleInboxItem,
  PebbleProjectionManifestEntry,
} from "../persistence/store";

const idPrefix = (deviceId: string) => `dd-pebble:${deviceId}`;

function bytesFromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/.test(hex)) throw new Error("PEBBLE_INBOX_CORRUPT");
  return Uint8Array.from({ length: hex.length / 2 }, (_, index) =>
    Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16),
  );
}

function envelopes(
  ticket: AuthorityTicket,
  deviceId: string,
  identity: PebbleIdentity,
  type: "steps" | "heart_rate" | "sleep_session",
  records: readonly Record<string, unknown>[],
): IngestDirectDeviceBatchInput[] {
  const result: IngestDirectDeviceBatchInput[] = [];
  for (let offset = 0; offset < records.length; offset += 1000) {
    result.push({
      expectedContext: {
        userId: ticket.scope.userId,
        organizationId: ticket.scope.organizationId,
      },
      batch: {
        schemaVersion: 1,
        deviceId,
        deviceIdentity: directDeviceIdentity.parse(identity),
        provider: "direct_device",
        recordType: type,
        mode: "backfill",
        upserts: records.slice(offset, offset + 1000) as never,
        deletions: [],
        clientTimezone: "UTC",
      },
    });
  }
  return result;
}

/**
 * Parses one inbox item, or null when it can no longer be read (append-time
 * validation uses the same parsers, so this only happens if a parser became
 * stricter). An unreadable item is skipped, never allowed to wedge projection.
 */
function parseSteps(item: PebbleInboxItem) {
  try {
    const packet = parseStepsSessionData(bytesFromHex(item.rawHex), item.itemSize);
    return packet ? packet.flatMap((part) => part.samples) : null;
  } catch {
    return null;
  }
}

/** Settled sleep: nights ending this long before the newest sleep input are final. */
export const PEBBLE_SLEEP_SETTLE_MS = 14 * 24 * 60 * 60 * 1000;

function sleepRecords(items: readonly PebbleInboxItem[]) {
  const bounds = [];
  const overlays = [];
  /** Latest instant (ms) each item covers, for settling. */
  const itemEnds: { seq: number; endMs: number }[] = [];
  let unreadable = 0;
  for (const item of items) {
    let bytes: Uint8Array;
    try {
      bytes = bytesFromHex(item.rawHex);
    } catch {
      unreadable += 1;
      continue;
    }
    if (item.logTag === 83) {
      const parsed = parseSleepSessionData(bytes, item.itemSize);
      if (!parsed?.length) {
        unreadable += 1;
        continue;
      }
      bounds.push(...parsed);
      itemEnds.push({
        seq: item.seq,
        endMs: Math.max(...parsed.map((bound) => bound.bedTimeEnd)) * 1000,
      });
    } else if (item.logTag === 84) {
      const parsed = parseOverlaySessionData(bytes, item.itemSize);
      if (!parsed?.length) {
        unreadable += 1;
        continue;
      }
      overlays.push(...parsed);
      itemEnds.push({
        seq: item.seq,
        endMs:
          Math.max(...parsed.map((overlay) => overlay.timestampStart + overlay.durationSeconds)) *
          1000,
      });
    }
  }
  return { sessions: assembleSleepSessions(bounds, overlays), itemEnds, unreadable };
}

/** Manifest sentinel whose endTime is the settled horizon (sleep only). */
const settledSentinelId = (deviceId: string) => `${idPrefix(deviceId)}:sleep-settled`;

/** FNV-1a over the canonical session content; stable across re-projections. */
function contentHash(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${hash.toString(16).padStart(8, "0")}:${text.length}`;
}

type SleepWindow = Readonly<{ startTime: string; endTime: string }>;

/**
 * Reuses sleep record ids across re-projections. Old (published) and new
 * sessions are grouped by overlap; a group with at most one of each is safe to
 * upsert (reusing the old id). Merges, splits and disappearances cannot be
 * expressed by the upsert-only contract, so those groups are held: the old
 * manifest entries stay as published and the new sessions are not sent.
 * Holding is per group, so one ambiguous night never blocks later nights.
 */
function assignSleepIds(
  previous: readonly PebbleProjectionManifestEntry[],
  sessions: readonly (SleepWindow & Record<string, unknown>)[],
  deviceId: string,
): {
  manifest: PebbleProjectionManifestEntry[];
  publish: { index: number; recordId: string }[];
  held: number;
} {
  const overlap = (left: SleepWindow, right: SleepWindow) =>
    Date.parse(left.startTime) < Date.parse(right.endTime) &&
    Date.parse(right.startTime) < Date.parse(left.endTime);
  // Union-find over old entries [0, previous.length) and new sessions after them.
  const parent = Array.from({ length: previous.length + sessions.length }, (_, index) => index);
  const find = (node: number): number => {
    while (parent[node] !== node) node = parent[node] = parent[parent[node]!]!;
    return node;
  };
  previous.forEach((old, oldIndex) =>
    sessions.forEach((session, newIndex) => {
      if (overlap(old, session)) parent[find(oldIndex)] = find(previous.length + newIndex);
    }),
  );
  const groups = new Map<number, { olds: number[]; news: number[] }>();
  const group = (node: number) => {
    const root = find(node);
    let entry = groups.get(root);
    if (!entry) groups.set(root, (entry = { olds: [], news: [] }));
    return entry;
  };
  previous.forEach((_, index) => group(index).olds.push(index));
  sessions.forEach((_, index) => group(previous.length + index).news.push(index));

  const manifest: PebbleProjectionManifestEntry[] = [];
  const publish: { index: number; recordId: string }[] = [];
  const usedIds = new Set<string>();
  let held = 0;
  const pending: { recordId: string; index: number }[] = [];
  for (const { olds, news } of groups.values()) {
    if (olds.length <= 1 && news.length === 1) {
      const recordId =
        olds.length === 1
          ? previous[olds[0]!]!.recordId
          : `${idPrefix(deviceId)}:sleep:${Math.floor(Date.parse(sessions[news[0]!]!.startTime) / 1000)}`;
      pending.push({ recordId, index: news[0]! });
    } else {
      held += 1;
      for (const oldIndex of olds) {
        manifest.push(previous[oldIndex]!);
        usedIds.add(previous[oldIndex]!.recordId);
      }
    }
  }
  for (const { recordId, index } of pending) {
    // A fresh id colliding with a held entry would overwrite it: hold instead.
    if (usedIds.has(recordId)) {
      held += 1;
      continue;
    }
    usedIds.add(recordId);
    const session = sessions[index]!;
    const hash = contentHash(session);
    manifest.push({
      recordId,
      startTime: session.startTime,
      endTime: session.endTime,
      contentHash: hash,
    });
    // Unchanged since it was last published: nothing to resend.
    const old = previous.find((entry) => entry.recordId === recordId);
    if (old?.contentHash !== hash) publish.push({ index, recordId });
  }
  manifest.sort((left, right) => Date.parse(left.startTime) - Date.parse(right.startTime));
  publish.sort((left, right) => left.index - right.index);
  return { manifest, publish, held };
}

type MinuteRange = readonly [startMinute: number, endMinuteExclusive: number];

const coverageId = (deviceId: string, startMinute: number) =>
  `${idPrefix(deviceId)}:steps-coverage:${startMinute}`;

function coverageFromManifest(manifest: readonly PebbleProjectionManifestEntry[]): MinuteRange[] {
  return manifest
    .map((entry): MinuteRange => [
      Math.floor(Date.parse(entry.startTime) / 60_000),
      Math.floor(Date.parse(entry.endTime) / 60_000),
    ])
    .sort((left, right) => left[0] - right[0]);
}

function isCovered(ranges: readonly MinuteRange[], minute: number): boolean {
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const [start, end] = ranges[middle]!;
    if (minute < start) high = middle - 1;
    else if (minute >= end) low = middle + 1;
    else return true;
  }
  return false;
}

function mergeCoverage(ranges: readonly MinuteRange[], minutes: readonly number[]): MinuteRange[] {
  const all: MinuteRange[] = [
    ...ranges,
    ...minutes.map((minute): MinuteRange => [minute, minute + 1]),
  ];
  all.sort((left, right) => left[0] - right[0]);
  const merged: [number, number][] = [];
  for (const [start, end] of all) {
    const last = merged.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

function coverageManifest(
  deviceId: string,
  ranges: readonly MinuteRange[],
): PebbleProjectionManifestEntry[] {
  return ranges.map(([start, end]) => ({
    recordId: coverageId(deviceId, start),
    startTime: new Date(start * 60_000).toISOString(),
    endTime: new Date(end * 60_000).toISOString(),
  }));
}

export function projectPebbleCapture(args: {
  store: DirectDeviceStore;
  ticket: AuthorityTicket;
  deviceId: string;
  identity: PebbleIdentity;
}): Readonly<{
  activityItems: number;
  sleepSessions: number;
  /** Sleep groups that need reconciliation and were not published. */
  sleepHeld: number;
  /** Inbox items that could not be parsed and were skipped. */
  unreadableItems: number;
  activityThroughSeq: number;
  sleepThroughSeq: number;
}> {
  const { store, ticket, deviceId } = args;
  const identity = directDeviceIdentity.parse(args.identity);
  if (!isPebbleCaptureIdentity(identity)) throw new Error("DIRECT_DEVICE_IDENTITY_MISMATCH");
  const binding = store.getBinding(ticket, deviceId);
  if (
    !binding ||
    binding.family !== identity.family ||
    binding.modelId !== identity.modelId ||
    !binding.pebbleNativeId
  )
    throw new Error("PEBBLE_PEER_AUTHORITY_MISMATCH");
  const allItems = store.readPebbleItems(ticket, deviceId);
  let unreadableItems = 0;

  const activity = store.readPebbleProjection(ticket, deviceId, "activity");
  const activityItems = allItems
    .filter((item) => item.logTag === 81 && item.seq > activity.throughSeq)
    .slice(0, 16);
  const activityHighwater = activityItems.at(-1)?.seq ?? activity.throughSeq;
  if (activityItems.length) {
    // The server keeps the first count it saw for a minute and rejects a
    // different one, failing the whole envelope. Mirror that: the earliest
    // inbox item wins, and minutes already projected (the coverage manifest,
    // which outlives the compacted raw items) are never sent again.
    const coverage = coverageFromManifest(activity.manifest);
    const seenMinutes = new Set<number>();
    const parsedItems = activityItems.map(parseSteps);
    unreadableItems += parsedItems.filter((samples) => samples === null).length;
    // Unreadable step items are passed by the cursor (and compacted with it).
    const samples = parsedItems
      .flatMap((samples) => samples ?? [])
      .filter((sample) => {
        const minute = Math.floor(sample.timestamp / 60);
        if (seenMinutes.has(minute) || isCovered(coverage, minute)) return false;
        seenMinutes.add(minute);
        return true;
      });
    const records = stepsSamplesToRecords(samples);
    const stepRecords = records.steps.map((record) => ({
      ...record,
      externalRecordId: `${idPrefix(deviceId)}:steps:${Math.floor(Date.parse(record.startTime) / 60000)}`,
      sourceApp: null,
    }));
    const hrRecords =
      identity.modelId === "pebble_2_duo"
        ? []
        : records.heartRate.map((record) => ({
            type: "heart_rate" as const,
            externalRecordId: `${idPrefix(deviceId)}:hr:${Math.floor(Date.parse(record.time) / 1000)}`,
            sourceApp: null,
            startTime: record.time,
            endTime: new Date(Date.parse(record.time) + 1000).toISOString(),
            samples: [{ time: record.time, bpm: record.bpm }],
          }));
    const output = [
      ...envelopes(ticket, deviceId, identity, "steps", stepRecords),
      ...envelopes(ticket, deviceId, identity, "heart_rate", hrRecords),
    ];
    store.commitPebbleProjection(ticket, {
      deviceId,
      identity,
      kind: "activity",
      expectedRevision: activity.revision,
      throughSeq: activityHighwater,
      manifest: coverageManifest(deviceId, mergeCoverage(coverage, [...seenMinutes])),
      envelopes: output,
    });
  }

  const sleep = store.readPebbleProjection(ticket, deviceId, "sleep");
  const sleepItems = allItems.filter((item) => item.logTag === 83 || item.logTag === 84);
  const sleepHighwater = sleepItems.at(-1)?.seq ?? sleep.throughSeq;
  const { sessions: assembled, itemEnds, unreadable } = sleepRecords(sleepItems);
  // Unreadable sleep items are skipped and retained; they never block a night.
  unreadableItems += unreadable;
  // Nights ending before the settled horizon were published and their inputs
  // deleted; a late input for one would rebuild it without its old id and
  // publish a second, overlapping record. Such sessions are held instead.
  const settledId = settledSentinelId(deviceId);
  const previousSettledBefore = Math.max(
    0,
    ...sleep.manifest
      .filter((entry) => entry.recordId === settledId)
      .map((entry) => Date.parse(entry.endTime)),
  );
  const sessions = assembled.filter(
    (session) => Date.parse(session.endTime) >= previousSettledBefore,
  );
  const lateHeld = assembled.length - sessions.length;
  const assigned = assignSleepIds(
    sleep.manifest.filter((entry) => entry.recordId !== settledId),
    sessions,
    deviceId,
  );
  const { publish } = assigned;
  const held = assigned.held + lateHeld;
  // Settle old nights so sleep work and storage stay bounded: inputs that end
  // before the horizon and before every still-open night are deleted, and
  // settled manifest entries are dropped (their records stay published).
  const latestEnd = Math.max(0, ...itemEnds.map((item) => item.endMs));
  const horizon = latestEnd - PEBBLE_SLEEP_SETTLE_MS;
  const keepFrom = Math.min(
    horizon,
    ...sessions
      .filter((session) => Date.parse(session.endTime) >= horizon)
      .map((session) => Date.parse(session.startTime)),
  );
  const compactSleepSeqs = itemEnds
    .filter((item) => item.endMs < keepFrom && item.seq <= sleepHighwater)
    .map((item) => item.seq);
  const settledBefore = Math.max(previousSettledBefore, keepFrom);
  const manifest = [
    ...(settledBefore > 0
      ? [
          {
            recordId: settledId,
            startTime: new Date(0).toISOString(),
            endTime: new Date(settledBefore).toISOString(),
          },
        ]
      : []),
    ...assigned.manifest.filter((entry) => Date.parse(entry.endTime) >= settledBefore),
  ];
  const sleepUpserts = publish.map(({ index, recordId }) => ({
    ...sessions[index]!,
    externalRecordId: recordId,
    sourceApp: null,
  }));
  if (sleepHighwater > sleep.throughSeq || sleep.revision === 0) {
    store.commitPebbleProjection(ticket, {
      deviceId,
      identity,
      kind: "sleep",
      expectedRevision: sleep.revision,
      throughSeq: sleepHighwater,
      manifest,
      envelopes: envelopes(ticket, deviceId, identity, "sleep_session", sleepUpserts),
      compactSleepSeqs,
    });
  }
  return {
    activityItems: activityItems.length,
    sleepSessions: sessions.length,
    sleepHeld: held,
    unreadableItems,
    activityThroughSeq: activityHighwater,
    sleepThroughSeq: sleepHighwater,
  };
}
