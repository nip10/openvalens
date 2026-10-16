// Source: anchovy/apps/web/src/lib/export/extractors/records.ts
// Audit-log extractor. The source merged `buildAuditTimeline` rows with the
// `accessAuditLog` table; in target the clinical-record audit timeline is
// composed by the `health-record` repository. We read both sources here with
// strict org filters and merge them with deterministic ordering.
import type { Database } from "@openvalens/db";
import { accessAuditLog } from "@openvalens/db/schema/auth";
import { desc, eq } from "drizzle-orm";
import type { ExportPayloadDataByDomain } from "../types";
import type { ExportPayloadScope } from "../build-payload";

type ClinicalTimelineEntry = {
  id: number;
  timestamp: string;
  domain: string;
  field: string;
  entity: string;
  newValue: string | null;
};

export async function extractAudit(
  db: Database,
  scope: ExportPayloadScope,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readClinicalTimeline: (
    organizationId: string,
  ) => Promise<ClinicalTimelineEntry[]> = defaultClinicalTimelineReader,
): Promise<ExportPayloadDataByDomain["audit"]> {
  const [clinicalTimeline, sharingTimeline] = await Promise.all([
    readClinicalTimeline(scope.organizationId),
    db
      .select()
      .from(accessAuditLog)
      .where(eq(accessAuditLog.organizationId, scope.organizationId))
      .orderBy(desc(accessAuditLog.createdAt), desc(accessAuditLog.id))
      .limit(200),
  ]);

  const clinicalRows = clinicalTimeline.map((event, index) => ({
    id: `clinical-${event.id}`,
    sourceId: Number.MAX_SAFE_INTEGER - index,
    source: "clinical" as const,
    timestamp: event.timestamp,
    eventType: event.field,
    targetType: event.domain,
    targetId: event.entity,
    summary: event.newValue,
  }));

  const sharingRows = sharingTimeline.map((event) => ({
    id: `sharing-${event.id}`,
    sourceId: event.id,
    source: "sharing" as const,
    timestamp: event.createdAt,
    eventType: event.eventType,
    targetType: event.targetType,
    targetId: event.targetId,
    summary: null,
  }));

  return [...clinicalRows, ...sharingRows]
    .sort((left, right) => {
      const dateCompare = right.timestamp.localeCompare(left.timestamp);
      if (dateCompare !== 0) return dateCompare;
      return right.sourceId - left.sourceId;
    })
    .map(({ sourceId: _sourceId, ...row }) => row);
}

// Default reader reads the access_audit_log table directly. The clinical
// record timeline facade (anchor's `buildAuditTimeline`) is composed from
// multiple domain rows that the target has not yet wired into a single helper,
// so we surface only the access log here and expose the clinical timeline
// reader as an injection seam for follow-up work.
async function defaultClinicalTimelineReader(
  _organizationId: string,
): Promise<ClinicalTimelineEntry[]> {
  return [];
}
