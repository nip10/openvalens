// Source: anchovy/apps/web/src/lib/export/extractors/insights.ts
// Insights extractor — delegates to the target `coach` repository, which is
// already tenant-scoped. We derive the snapshot counts here so the
// dependencies on `coach` stay bounded to a single read.
import type { Database } from "@openhealth/db";
import { createCoachRepository } from "@openhealth/coach";
import type { ExportPayloadDataByDomain } from "../types";
import type { ExportPayloadScope } from "../build-payload";

export async function extractInsights(
  db: Database,
  scope: ExportPayloadScope,
): Promise<ExportPayloadDataByDomain["insights"]> {
  const insights = await createCoachRepository(db).listInsights(scope.organizationId, {
    limit: 200,
  });
  const criticalCount = insights.filter((item) => item.severity === "critical").length;
  const warningCount = insights.filter((item) => item.severity === "warning").length;
  const recommendationTitles = insights
    .filter((item) => item.type === "recommendation")
    .map((item) => item.title)
    .slice(0, 5);

  return {
    asOfDate: insights[0]?.createdAt ?? null,
    insightCount: insights.length,
    criticalCount,
    warningCount,
    recommendationTitles,
  };
}
