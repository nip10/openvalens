import type { Database } from "@openvalens/db";
import { dataSource, metricDefinition, metricSample } from "@openvalens/db/schema/health-record";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";

import type { BloodPressureReading } from "./types";

/**
 * Blood pressure readings (#440). A reading is the systolic and diastolic
 * `metric_sample` rows that share one time and one source, plus the pulse a
 * monitor (or the manual form) wrote as `heart_rate` at the same time.
 *
 * A typed-in reading (no data source, stamped `ingestedByUserId`) never
 * replaces a device one. When it sits within `DUPLICATE_WINDOW_MS` of a device
 * reading it is flagged as a possible duplicate.
 */

export const BLOOD_PRESSURE_DUPLICATE_WINDOW_MS = 10 * 60_000;

const BP_CODES = ["blood_pressure_systolic", "blood_pressure_diastolic"] as const;

export type BloodPressureSampleRow = {
  code: string;
  sampledAt: Date;
  value: number | null;
  dataSourceId: number | null;
  source: string | null;
  metadataJson: unknown;
};

function isManual(row: Pick<BloodPressureSampleRow, "dataSourceId" | "metadataJson">): boolean {
  const metadata = row.metadataJson;
  return (
    row.dataSourceId === null &&
    !!metadata &&
    typeof metadata === "object" &&
    typeof (metadata as Record<string, unknown>).ingestedByUserId === "string"
  );
}

const keyOf = (row: Pick<BloodPressureSampleRow, "sampledAt" | "dataSourceId">) =>
  `${row.sampledAt.toISOString()}|${row.dataSourceId ?? "-"}`;

/** Pure: pairs sample rows into readings, newest first. Pure for unit tests. */
export function pairBloodPressureSamples(
  rows: readonly BloodPressureSampleRow[],
  limit = Number.POSITIVE_INFINITY,
): BloodPressureReading[] {
  const byKey = new Map<
    string,
    {
      sampledAt: Date;
      systolic: number | null;
      diastolic: number | null;
      pulse: number | null;
      source: string | null;
      manual: boolean;
    }
  >();
  for (const row of rows) {
    if (row.value === null) continue;
    const key = keyOf(row);
    const entry = byKey.get(key) ?? {
      sampledAt: row.sampledAt,
      systolic: null,
      diastolic: null,
      pulse: null,
      source: row.source,
      manual: isManual(row),
    };
    if (row.code === "blood_pressure_systolic") entry.systolic ??= row.value;
    else if (row.code === "blood_pressure_diastolic") entry.diastolic ??= row.value;
    else if (row.code === "heart_rate") entry.pulse ??= row.value;
    byKey.set(key, entry);
  }
  const readings = [...byKey.values()].filter(
    (entry): entry is typeof entry & { systolic: number; diastolic: number } =>
      entry.systolic !== null && entry.diastolic !== null,
  );
  const deviceTimes = readings.filter((r) => !r.manual).map((r) => r.sampledAt.getTime());
  return readings
    .sort((a, b) => b.sampledAt.getTime() - a.sampledAt.getTime())
    .slice(0, limit)
    .map((reading) => ({
      observedAt: reading.sampledAt.toISOString(),
      systolic: reading.systolic,
      diastolic: reading.diastolic,
      pulse: reading.pulse,
      source: reading.manual ? "manual" : reading.source,
      manual: reading.manual,
      possibleDuplicate:
        reading.manual &&
        deviceTimes.some(
          (time) =>
            Math.abs(time - reading.sampledAt.getTime()) <= BLOOD_PRESSURE_DUPLICATE_WINDOW_MS,
        ),
    }));
}

/** The most recent `limit` blood pressure readings for the org, newest first. */
export async function listRecentBloodPressureReadings(
  db: Database,
  organizationId: string,
  limit: number,
): Promise<BloodPressureReading[]> {
  const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
  const select = {
    code: metricDefinition.code,
    sampledAt: metricSample.sampledAt,
    value: metricSample.numericValue,
    dataSourceId: metricSample.dataSourceId,
    source: dataSource.sourceKey,
    metadataJson: metricSample.metadataJson,
  };
  const query = (codes: readonly string[], times?: Date[]) =>
    db
      .select(select)
      .from(metricSample)
      .innerJoin(
        metricDefinition,
        and(
          eq(metricDefinition.id, metricSample.metricDefinitionId),
          eq(metricDefinition.organizationId, metricSample.organizationId),
        ),
      )
      .leftJoin(dataSource, eq(dataSource.id, metricSample.dataSourceId))
      .where(
        and(
          eq(metricSample.organizationId, organizationId),
          isNull(metricSample.supersededAt),
          inArray(metricDefinition.code, [...codes]),
          times ? inArray(metricSample.sampledAt, times) : undefined,
        ),
      )
      .orderBy(desc(metricSample.sampledAt), desc(metricSample.id));

  // Two rows per reading, plus room for unpaired rows and nearby device readings.
  const pressure = await query(BP_CODES).limit(safeLimit * 4);
  const times = [...new Map(pressure.map((row) => [row.sampledAt.getTime(), row.sampledAt]))];
  const pulse = times.length
    ? await query(
        ["heart_rate"],
        times.map(([, at]) => at),
      )
    : [];
  return pairBloodPressureSamples([...pressure, ...pulse], safeLimit);
}
