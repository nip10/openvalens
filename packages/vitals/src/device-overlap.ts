import type { Database } from "@openvalens/db";
import { metricDefinition, metricSample } from "@openvalens/db/schema/health-record";
import { and, eq, gte, inArray, isNotNull, isNull, lte, sql, type SQL } from "drizzle-orm";

import { BLOOD_PRESSURE_DUPLICATE_WINDOW_MS } from "./blood-pressure";

/**
 * Device data wins (#439, M2). A reading an AI app wrote for the member is a
 * manual entry: it never replaces or merges into a device reading. When a
 * device reading of the same metric sits within this window it is a possible
 * duplicate (the same rule as a typed-in blood pressure reading), and it is
 * left out of the daily totals so the device reading counts.
 */
export const MANUAL_DUPLICATE_WINDOW_MS = BLOOD_PRESSURE_DUPLICATE_WINDOW_MS;

/** Whether a device (data-source) sample of one of these metrics sits within the window of `at`. */
export async function hasDeviceReadingNear(
  db: Database,
  input: { organizationId: string; codes: readonly string[]; at: Date; windowMs?: number },
): Promise<boolean> {
  const windowMs = input.windowMs ?? MANUAL_DUPLICATE_WINDOW_MS;
  const rows = await db
    .select({ id: metricSample.id })
    .from(metricSample)
    .innerJoin(
      metricDefinition,
      and(
        eq(metricDefinition.id, metricSample.metricDefinitionId),
        eq(metricDefinition.organizationId, metricSample.organizationId),
      ),
    )
    .where(
      and(
        eq(metricSample.organizationId, input.organizationId),
        inArray(metricDefinition.code, [...input.codes]),
        isNotNull(metricSample.dataSourceId),
        isNull(metricSample.supersededAt),
        gte(metricSample.sampledAt, new Date(input.at.getTime() - windowMs)),
        lte(metricSample.sampledAt, new Date(input.at.getTime() + windowMs)),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * SQL condition, for a query over `metric_sample`, that is true for a sample
 * that counts in daily totals: anything except an AI-written sample with a
 * device sample of the same metric within the window.
 */
export function countsInDailyTotals(): SQL {
  const seconds = Math.round(MANUAL_DUPLICATE_WINDOW_MS / 1000);
  return sql`not (
    ${metricSample.metadataJson} ? 'aiApp'
    and exists (
      select 1 from "metric_sample" as "device_sample"
      where "device_sample"."organization_id" = ${metricSample.organizationId}
        and "device_sample"."metric_definition_id" = ${metricSample.metricDefinitionId}
        and "device_sample"."data_source_id" is not null
        and "device_sample"."superseded_at" is null
        and "device_sample"."sampled_at" between ${metricSample.sampledAt} - make_interval(secs => ${seconds})
          and ${metricSample.sampledAt} + make_interval(secs => ${seconds})
    )
  )`;
}
