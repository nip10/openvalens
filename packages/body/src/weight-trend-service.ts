import type { Database } from "@openvalens/db";

import { listCanonicalDailyWeightsBetween } from "./queries";
import { buildWeightTrend, weightTrendQueryStart, type WeightTrend } from "./weight-trend";

/** The member whose weights are read; both ids come from the server session. */
export type WeightTrendScope = { organizationId: string; userId: string };

/**
 * Provisional weight trend (Issue #87) for one member over an inclusive range
 * of local dates. Reads the existing canonical daily weights only; nothing is
 * written and no values are logged.
 */
export async function getWeightTrend(
  db: Pick<Database, "select">,
  scope: WeightTrendScope,
  range: { from: string; to: string },
): Promise<WeightTrend> {
  const lookbackStart = weightTrendQueryStart(range);
  const rows = await listCanonicalDailyWeightsBetween(db, scope, lookbackStart, range.to);
  return buildWeightTrend(rows, range);
}
