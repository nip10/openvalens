import type { MobileHealthRecordInput } from "@openhealth/api/contracts/mobile-ingest";

export type BatchLimits = { maxRecords: number; maxBytes: number };

/** Server limits: 1000 upserts per batch, 5000 samples per heart-rate record. */
export const DEFAULT_BATCH_LIMITS: BatchLimits = { maxRecords: 1000, maxBytes: 900_000 };
const MAX_HEART_RATE_SAMPLES = 5000;

type Deletion = { externalRecordId: string };
export type BatchParts = { upserts: MobileHealthRecordInput[]; deletions: Deletion[] };

/** Heart-rate records over the sample cap become several records with the same id. */
function splitOversizedRecords(records: MobileHealthRecordInput[]): MobileHealthRecordInput[] {
  return records.flatMap((record) => {
    if (record.type !== "heart_rate" || record.samples.length <= MAX_HEART_RATE_SAMPLES)
      return [record];
    const parts: MobileHealthRecordInput[] = [];
    for (let i = 0; i < record.samples.length; i += MAX_HEART_RATE_SAMPLES) {
      const samples = record.samples.slice(i, i + MAX_HEART_RATE_SAMPLES);
      parts.push({
        ...record,
        startTime: samples[0]!.time,
        endTime: samples.at(-1)!.time,
        samples,
      });
    }
    return parts;
  });
}

/**
 * Deterministic split: the same input always yields the same batches, so a
 * retry after a failure produces byte-identical batches the server
 * recognizes as duplicates.
 */
export function splitIntoBatches(
  upserts: MobileHealthRecordInput[],
  deletions: Deletion[],
  limits: BatchLimits = DEFAULT_BATCH_LIMITS,
): BatchParts[] {
  const batches: BatchParts[] = [];
  let current: BatchParts = { upserts: [], deletions: [] };
  let count = 0;
  let bytes = 0;
  const push = (size: number) => {
    if (count > 0 && (count + 1 > limits.maxRecords || bytes + size > limits.maxBytes)) {
      batches.push(current);
      current = { upserts: [], deletions: [] };
      count = 0;
      bytes = 0;
    }
    count += 1;
    bytes += size;
  };
  for (const record of splitOversizedRecords(upserts)) {
    push(JSON.stringify(record).length);
    current.upserts.push(record);
  }
  for (const deletion of deletions) {
    push(JSON.stringify(deletion).length);
    current.deletions.push(deletion);
  }
  if (count > 0) batches.push(current);
  return batches;
}
