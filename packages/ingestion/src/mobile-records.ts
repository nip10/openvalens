import {
  normalizeSleepStageIntervals,
  type CanonicalMetricWriteIntent,
  type CanonicalWriteIntent,
} from "./health-connect";

/**
 * Typed records sent by the mobile app through `mobile.ingestBatch`
 * (docs/architecture/mobile-sync-decision.md). The Zod contract in
 * `@openhealth/api/contracts/mobile-ingest` validates the wire shape and is
 * checked against these types; this package stays free of Zod.
 * Timestamps are canonical UTC ISO strings.
 */
type MobileRecordBase = {
  /** Health Connect `metadata.id` or HealthKit sample UUID. */
  externalRecordId: string;
  /** Health Connect `metadata.lastModifiedTime`. */
  lastModifiedAt?: string;
  /** Health Connect `dataOrigin` or HealthKit `sourceRevision.bundleId`. */
  sourceApp: string | null;
  sourceDevice?: { type?: string; model?: string };
};

type Interval = { startTime: string; endTime: string };

export type MobileHealthRecord = MobileRecordBase &
  (
    | { type: "weight"; startTime: string; valueKg: number }
    | { type: "body_fat"; startTime: string; percent: number }
    | ({ type: "steps"; count: number } & Interval)
    | ({ type: "heart_rate"; samples: { time: string; bpm: number }[] } & Interval)
    | ({ type: "active_calories"; kcal: number } & Interval)
    | ({ type: "distance"; meters: number } & Interval)
    | ({
        type: "sleep_session";
        stages?: { stage: string; startTime: string; endTime: string }[];
      } & Interval)
    | ({ type: "workout"; activity: string; title: string | null } & Interval)
  );

export type MobileHealthRecordType = MobileHealthRecord["type"];

/**
 * Mobile records → canonical write intents. Unlike the legacy envelope
 * adapter, input is already validated, so every record yields intents.
 * Heart-rate records fan out to one sample per reading, each carrying only
 * its own reading as the raw record (not the whole series).
 */
export function adaptMobileHealthRecords(records: MobileHealthRecord[]): CanonicalWriteIntent[] {
  const intents: CanonicalWriteIntent[] = [];
  for (const record of records) {
    const common = {
      externalId: record.externalRecordId,
      sourceApp: record.sourceApp,
      ...(record.lastModifiedAt ? { lastModifiedAt: record.lastModifiedAt } : {}),
    };
    const metric = (
      canonicalType: CanonicalMetricWriteIntent["canonicalType"],
      value: number,
      unit: string,
      endAt?: string,
    ) =>
      intents.push({
        kind: "metric_sample",
        canonicalType,
        sampledAt: record.startTime,
        ...(endAt ? { endAt } : {}),
        value,
        unit,
        rawRecord: record,
        ...common,
      });

    switch (record.type) {
      case "weight":
        metric("weight", record.valueKg, "kg");
        break;
      case "body_fat":
        metric("body_fat", record.percent, "%");
        break;
      case "steps":
        metric("steps", record.count, "count", record.endTime);
        break;
      case "active_calories":
        metric("active_calories", record.kcal, "kcal", record.endTime);
        break;
      case "distance":
        metric("distance", record.meters, "m", record.endTime);
        break;
      case "heart_rate":
        for (const sample of record.samples)
          intents.push({
            kind: "metric_sample",
            canonicalType: "heart_rate",
            sampledAt: sample.time,
            value: sample.bpm,
            unit: "bpm",
            rawRecord: { externalRecordId: record.externalRecordId, ...sample },
            ...common,
          });
        break;
      case "sleep_session": {
        const sleepStageIntervals = normalizeSleepStageIntervals(record.stages ?? []);
        intents.push({
          kind: "health_event",
          canonicalType: "sleep_session",
          eventAt: record.startTime,
          endAt: record.endTime,
          title: null,
          sourceEventId: record.externalRecordId,
          sourceApp: record.sourceApp,
          rawRecord: record,
          ...(sleepStageIntervals.length ? { payloadJson: { sleepStageIntervals } } : {}),
          ...(record.lastModifiedAt ? { lastModifiedAt: record.lastModifiedAt } : {}),
        });
        break;
      }
      case "workout":
        intents.push({
          kind: "health_event",
          canonicalType: "workout",
          eventAt: record.startTime,
          endAt: record.endTime,
          title: record.title,
          sourceEventId: record.externalRecordId,
          sourceApp: record.sourceApp,
          rawRecord: record,
          payloadJson: { activity: record.activity },
          ...(record.lastModifiedAt ? { lastModifiedAt: record.lastModifiedAt } : {}),
        });
        break;
    }
  }
  return intents;
}
