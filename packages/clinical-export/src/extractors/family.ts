// Source: anchovy/apps/web/src/lib/export/extractors/family.ts
// Family-history extractor. Reads from the target `clinical` repository.
import type { Database } from "@openhealth/db";
import { createClinicalRepository } from "@openhealth/clinical";
import type { ExportPayloadDataByDomain } from "../types";
import type { ExportPayloadScope } from "../build-payload";

export async function extractFamilyHistory(
  db: Database,
  scope: ExportPayloadScope,
): Promise<ExportPayloadDataByDomain["familyHistory"]> {
  const rows = await createClinicalRepository(db).listFamilyHistory(scope.organizationId);
  return rows.map((row) => ({
    id: row.id,
    relation: row.relation,
    condition: row.condition,
    ageOfOnset: row.ageOfOnset,
    notes: row.notes,
    createdAt: row.createdAt,
  }));
}
