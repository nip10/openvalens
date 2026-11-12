/**
 * Projects stored Fossil activity files into upload envelopes (issue #429).
 *
 * Each CRC-verified file was committed to SQLite before the watch was told to
 * delete it. Projection parses it, keeps the earliest value for every minute
 * (the server rejects a different count for a minute it already has), skips
 * minutes already published (the coverage ranges outlive the files), and then
 * in one transaction inserts the envelopes, advances coverage and removes the
 * file. A file that no longer parses is kept as "unreadable", never dropped.
 */

import {
  directDeviceIdentity,
  type DirectDeviceIdentity,
  type IngestDirectDeviceBatchInput,
} from "@openvalens/api/contracts/direct-device";

import type { AuthorityTicket } from "../authority";
import type { DirectDeviceStore } from "../persistence/store";
import { parseFossilActivityFile, type FossilActivitySample } from "../protocol/fossil-hr";

type Range = readonly [number, number];

const idPrefix = (deviceId: string) => `dd-fossil:${deviceId}`;

function bytesFromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/.test(hex)) throw new Error("FOSSIL_FILE_CORRUPT");
  return Uint8Array.from({ length: hex.length / 2 }, (_, index) =>
    Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16),
  );
}

function covered(ranges: readonly Range[], minute: number): boolean {
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

function merge(ranges: readonly Range[], minutes: Iterable<number>): Range[] {
  const all: Range[] = [...ranges, ...[...minutes].map((minute): Range => [minute, minute + 1])];
  all.sort((left, right) => left[0] - right[0]);
  const merged: [number, number][] = [];
  for (const [start, end] of all) {
    const last = merged.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

function batches(
  ticket: AuthorityTicket,
  deviceId: string,
  identity: DirectDeviceIdentity,
  recordType: "steps" | "heart_rate",
  records: readonly Record<string, unknown>[],
): IngestDirectDeviceBatchInput[] {
  const result: IngestDirectDeviceBatchInput[] = [];
  for (let offset = 0; offset < records.length; offset += 1000)
    result.push({
      expectedContext: { userId: ticket.scope.userId, organizationId: ticket.scope.organizationId },
      batch: {
        schemaVersion: 1,
        deviceId,
        deviceIdentity: directDeviceIdentity.parse(identity),
        provider: "direct_device",
        recordType,
        mode: "backfill",
        upserts: records.slice(offset, offset + 1000) as never,
        deletions: [],
        clientTimezone: "UTC",
      },
    });
  return result;
}

/** Heart rate is published only for a reading taken while the watch was worn. */
const hasHeartRate = (sample: FossilActivitySample) =>
  sample.wear === "wearing" && sample.heartRate >= 25 && sample.heartRate <= 240;

/** Samples from a watch whose clock was never set (e.g. 1970) are not published. */
const EARLIEST_PLAUSIBLE_MINUTE = Date.UTC(2015, 0, 1) / 60_000;

export function projectFossilFiles(args: {
  store: DirectDeviceStore;
  ticket: AuthorityTicket;
  deviceId: string;
  identity: DirectDeviceIdentity;
  now?: () => number;
}): Readonly<{ projectedFiles: number; unreadableFiles: number; minutes: number }> {
  // A day of tolerance for clock skew; anything later is not a real minute yet.
  const latestPlausibleMinute = Math.floor(((args.now ?? Date.now)() + 86_400_000) / 60_000);
  const { store, ticket, deviceId } = args;
  const identity = directDeviceIdentity.parse(args.identity);
  if (identity.family !== "fossil_hr") throw new Error("DIRECT_DEVICE_IDENTITY_MISMATCH");
  let projectedFiles = 0;
  let unreadableFiles = 0;
  let minutes = 0;
  for (const file of store.readFossilFiles(ticket, deviceId)) {
    if (file.state !== "stored") continue;
    const coverage = store.readFossilCoverage(ticket, deviceId);
    let samples: readonly FossilActivitySample[];
    try {
      samples = parseFossilActivityFile(bytesFromHex(file.rawHex)).samples;
    } catch {
      store.commitFossilProjection(ticket, {
        deviceId,
        identity,
        fileSeq: file.seq,
        outcome: "unreadable",
        expectedRevision: coverage.revision,
        ranges: coverage.ranges,
        envelopes: [],
      });
      unreadableFiles += 1;
      continue;
    }
    const byMinute = new Map<number, FossilActivitySample>();
    // Minutes ahead of this phone's clock are not published yet, but the file
    // is kept (the watch has already deleted its copy) until they are due.
    let deferred = false;
    for (const sample of samples) {
      const minute = Math.floor(sample.timestamp / 60);
      if (!Number.isSafeInteger(minute) || minute < EARLIEST_PLAUSIBLE_MINUTE) continue;
      if (minute > latestPlausibleMinute) {
        deferred = true;
        continue;
      }
      if (byMinute.has(minute) || covered(coverage.ranges, minute)) continue;
      byMinute.set(minute, sample);
    }
    const ordered = [...byMinute.entries()].sort((left, right) => left[0] - right[0]);
    // Chunks keep each commit under the capture size limit; coverage makes a
    // retried chunk skip what an earlier chunk already published.
    let revision = coverage.revision;
    let ranges: readonly Range[] = coverage.ranges;
    for (let offset = 0; offset < Math.max(ordered.length, 1); offset += FOSSIL_CHUNK_MINUTES) {
      const chunk = ordered.slice(offset, offset + FOSSIL_CHUNK_MINUTES);
      const last = offset + FOSSIL_CHUNK_MINUTES >= ordered.length && !deferred;
      // A deferred file with nothing new due yet needs no commit.
      if (!last && chunk.length === 0) break;
      ranges = merge(
        ranges,
        chunk.map(([minute]) => minute),
      );
      store.commitFossilProjection(ticket, {
        deviceId,
        identity,
        fileSeq: file.seq,
        outcome: last ? "projected" : "partial",
        expectedRevision: revision,
        ranges,
        envelopes: envelopesFor(ticket, deviceId, identity, chunk),
      });
      revision += 1;
    }
    projectedFiles += 1;
    minutes += ordered.length;
  }
  return { projectedFiles, unreadableFiles, minutes };
}

/** Minutes per projection commit: ~2 records each, well under 4 MB. */
export const FOSSIL_CHUNK_MINUTES = 5_000;

function envelopesFor(
  ticket: AuthorityTicket,
  deviceId: string,
  identity: DirectDeviceIdentity,
  ordered: readonly (readonly [number, FossilActivitySample])[],
): IngestDirectDeviceBatchInput[] {
  const steps = ordered.map(([minute, sample]) => ({
    type: "steps" as const,
    externalRecordId: `${idPrefix(deviceId)}:steps:${minute}`,
    sourceApp: null,
    startTime: new Date(minute * 60_000).toISOString(),
    endTime: new Date((minute + 1) * 60_000).toISOString(),
    count: sample.steps,
  }));
  const heartRate = ordered
    .filter(([, sample]) => hasHeartRate(sample))
    .map(([minute, sample]) => {
      const time = new Date(minute * 60_000).toISOString();
      return {
        type: "heart_rate" as const,
        externalRecordId: `${idPrefix(deviceId)}:hr:${minute}`,
        sourceApp: null,
        startTime: time,
        endTime: new Date(minute * 60_000 + 1000).toISOString(),
        samples: [{ time, bpm: sample.heartRate }],
      };
    });
  return [
    ...batches(ticket, deviceId, identity, "steps", steps),
    ...batches(ticket, deviceId, identity, "heart_rate", heartRate),
  ];
}
