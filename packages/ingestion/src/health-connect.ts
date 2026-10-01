/**
 * Health Connect → canonical write intents, ported from anchovy
 * `providers/health-connect.ts` (`adaptHealthConnectCanonicalRecords`),
 * `health-record/timestamps.ts` and `health-record/event-intervals.ts`.
 * Pure. Records that fail validation are skipped, as in the source.
 */
const ISO_UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

export function isCanonicalUtcTimestamp(value: string): boolean {
  return !Number.isNaN(new Date(value).getTime()) && ISO_UTC_TIMESTAMP_PATTERN.test(value);
}

export type SleepStageInterval = { stage: string; start: string; end: string };

export type CanonicalMetricWriteIntent = {
  kind: "metric_sample";
  canonicalType: "weight" | "steps" | "heart_rate" | "body_fat" | "active_calories" | "distance";
  sampledAt: string;
  /** Interval end for interval metrics (steps, calories, distance); stored in metadata. */
  endAt?: string;
  /** Source revision; part of the dedupe key on the mobile path only. */
  lastModifiedAt?: string;
  value: number;
  unit: string;
  externalId: string | null;
  sourceApp: string | null;
  rawRecord: Record<string, unknown>;
};

export type CanonicalHealthEventWriteIntent = {
  kind: "health_event";
  canonicalType: "sleep_session" | "workout";
  eventAt: string;
  endAt: string | null;
  title: string | null;
  sourceEventId: string | null;
  sourceApp: string | null;
  rawRecord: Record<string, unknown>;
  payloadJson?: { sleepStageIntervals?: SleepStageInterval[]; activity?: string };
  /** Source revision; part of the dedupe key on the mobile path only. */
  lastModifiedAt?: string;
};

export type CanonicalWriteIntent = CanonicalMetricWriteIntent | CanonicalHealthEventWriteIntent;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function optionalString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function utcTimestamp(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && isCanonicalUtcTimestamp(value)) return value;
  }
  return null;
}

function finiteNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function heartRateValue(record: Record<string, unknown>): number | null {
  const direct = finiteNumber(record, "value") ?? finiteNumber(record, "heartRate");
  if (direct !== null) return direct;
  const samples = record.samples;
  if (!Array.isArray(samples) || samples.length === 0 || !isRecord(samples[0])) return null;
  const bpm = samples[0].bpm;
  return typeof bpm === "number" && Number.isFinite(bpm) ? bpm : null;
}

export function normalizeSleepStageIntervals(intervals: unknown[]): SleepStageInterval[] {
  const normalized: SleepStageInterval[] = [];
  for (const interval of intervals) {
    if (!isRecord(interval)) continue;
    const stage =
      typeof interval.stage === "string" && interval.stage.length > 0 ? interval.stage : null;
    const start = utcTimestamp(interval, "start", "startTime");
    const end = utcTimestamp(interval, "end", "endTime");
    if (!stage || !start || !end) continue;
    if (new Date(end).getTime() <= new Date(start).getTime()) continue;
    normalized.push({ stage, start, end });
  }
  return normalized;
}

function sleepStagePayload(record: Record<string, unknown>) {
  if (!Array.isArray(record.stages)) return undefined;
  const sleepStageIntervals = normalizeSleepStageIntervals(record.stages);
  return sleepStageIntervals.length === 0 ? undefined : { sleepStageIntervals };
}

export function adaptHealthConnectCanonicalRecords(records: unknown[]): CanonicalWriteIntent[] {
  const intents: CanonicalWriteIntent[] = [];
  for (const candidate of records) {
    if (!isRecord(candidate)) continue;
    const type = optionalString(candidate, "type") ?? optionalString(candidate, "metric");
    if (!type) continue;
    const startTime = utcTimestamp(candidate, "startTime");
    if (!startTime) continue;
    const endTimeRaw = candidate.endTime;
    const endTime = endTimeRaw == null ? null : utcTimestamp(candidate, "endTime");
    if (endTimeRaw !== undefined && endTimeRaw !== null && endTime === null) continue;
    const sourceApp = optionalString(candidate, "sourceApp");
    const externalId = optionalString(candidate, "externalRecordId");
    const metric = (
      canonicalType: CanonicalMetricWriteIntent["canonicalType"],
      value: number | null,
      unit: string,
    ) => {
      if (value !== null)
        intents.push({
          kind: "metric_sample",
          canonicalType,
          sampledAt: startTime,
          value,
          unit,
          externalId,
          sourceApp,
          rawRecord: candidate,
        });
    };
    if (type === "weight")
      metric(
        "weight",
        finiteNumber(candidate, "weightKg") ?? finiteNumber(candidate, "value"),
        "kg",
      );
    else if (type === "steps")
      metric(
        "steps",
        finiteNumber(candidate, "count") ?? finiteNumber(candidate, "value"),
        "count",
      );
    else if (type === "heart_rate" || type === "heartRate")
      metric("heart_rate", heartRateValue(candidate), "bpm");
    else if (type === "sleep_session" || type === "workout")
      intents.push({
        kind: "health_event",
        canonicalType: type,
        eventAt: startTime,
        endAt: endTime,
        title: optionalString(candidate, "title"),
        sourceEventId: externalId,
        sourceApp,
        rawRecord: candidate,
        ...(type === "sleep_session" ? { payloadJson: sleepStagePayload(candidate) } : {}),
      });
  }
  return intents;
}

/** Ported `isMobileIngestionEnvelope` / `parseMobileIngestionEnvelope`. */
export const MOBILE_INGESTION_PROVIDERS = ["health_connect", "apple_health"] as const;

export function parseMobileIngestionEnvelope(
  payload: unknown,
): { provider: (typeof MOBILE_INGESTION_PROVIDERS)[number]; records: unknown[] } | null {
  if (!isRecord(payload)) return null;
  const { provider, records } = payload;
  if (
    typeof provider !== "string" ||
    !(MOBILE_INGESTION_PROVIDERS as readonly string[]).includes(provider)
  )
    return null;
  if (!Array.isArray(records)) return null;
  return { provider: provider as (typeof MOBILE_INGESTION_PROVIDERS)[number], records };
}
