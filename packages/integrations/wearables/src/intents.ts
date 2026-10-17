import type {
  CanonicalHealthEventWriteIntent,
  CanonicalMetricWriteIntent,
} from "@openvalens/ingestion";

import type { WearableProviderId } from "./adapter";

/**
 * Builders for the canonical write intents a cloud adapter returns (#60).
 *
 * External ids are `<provider>-<kind>-<vendor id>[-<metric>]`, unique per
 * stored row, so a re-fetched record replaces its own previous version and a
 * vendor `*.deleted` event can find every row of one record by prefix. The
 * raw record keeps only the mapped fields, never the whole vendor payload.
 */

export function recordId(provider: WearableProviderId, kind: string, vendorId: string): string {
  return `${provider}-${kind}-${vendorId}`;
}

export function metricIntent(
  provider: WearableProviderId,
  input: {
    externalId: string;
    canonicalType: CanonicalMetricWriteIntent["canonicalType"];
    sampledAt: string;
    endAt?: string;
    value: number;
    unit: string;
    lastModifiedAt?: string | null;
    detail?: Record<string, string>;
  },
): CanonicalMetricWriteIntent {
  return {
    kind: "metric_sample",
    canonicalType: input.canonicalType,
    sampledAt: input.sampledAt,
    ...(input.endAt ? { endAt: input.endAt } : {}),
    ...(input.lastModifiedAt ? { lastModifiedAt: input.lastModifiedAt } : {}),
    value: input.value,
    unit: input.unit,
    externalId: input.externalId,
    sourceApp: provider,
    rawRecord: {
      provider,
      externalId: input.externalId,
      sampledAt: input.sampledAt,
      value: input.value,
      unit: input.unit,
    },
    ...(input.detail ? { detail: input.detail } : {}),
  };
}

export function sleepIntent(
  provider: WearableProviderId,
  input: {
    externalId: string;
    start: string;
    end: string;
    /** Value-free device class the sleep summary's source preference reads (`ring`, `wearable`, …). */
    sourceDevice: string;
    lastModifiedAt?: string | null;
  },
): CanonicalHealthEventWriteIntent {
  return {
    kind: "health_event",
    canonicalType: "sleep_session",
    eventAt: input.start,
    endAt: input.end,
    title: null,
    sourceEventId: input.externalId,
    sourceApp: provider,
    rawRecord: { provider, externalId: input.externalId, start: input.start, end: input.end },
    payloadJson: { sourceDevice: input.sourceDevice },
    ...(input.lastModifiedAt ? { lastModifiedAt: input.lastModifiedAt } : {}),
  };
}

/** Daily total stored as one interval sample over the UTC day `YYYY-MM-DD`. */
export function dayInterval(day: string): { sampledAt: string; endAt: string } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const start = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) return null;
  return {
    sampledAt: start.toISOString(),
    endAt: new Date(start.getTime() + 86_400_000).toISOString(),
  };
}

/** Records whose time falls inside the sync window (vendors that ignore range filters). */
export function inWindow(iso: string, window: { from: Date; to: Date }): boolean {
  const time = new Date(iso).getTime();
  return time >= window.from.getTime() - 86_400_000 && time <= window.to.getTime();
}
