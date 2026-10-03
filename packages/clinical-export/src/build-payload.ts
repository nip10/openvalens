// Source: anchovy/apps/web/src/lib/export/build-payload.ts
// Builds the legacy CSV/PDF export payload by running the registered extractors
// for the requested domains in canonical order. The schema version is fixed by
// the source route and must remain a literal string.
import type { Database } from "@openvalens/db";
import { EXPORT_DOMAIN_ORDER, type ExportDomain } from "./domains";
import type { ExportPayloadDataByDomain, ExportPayloadDataFor, ExportPayloadFor } from "./types";
import {
  extractBlood,
  extractBody,
  extractCardiac,
  extractDexa,
  extractImaging,
  extractMedications,
  extractSupplements,
  extractWeight,
} from "./extractors/clinical";
import { extractWorkouts } from "./extractors/activity";
import { extractCalendar } from "./extractors/calendar";
import { extractFamilyHistory } from "./extractors/family";
import { extractGoals } from "./extractors/goals";
import { extractInsights } from "./extractors/insights";
import { extractAudit } from "./extractors/records";

export const EXPORT_SCHEMA_VERSION = "export-v1";

export type ExportPayloadScope = {
  organizationId: string;
};

export type DomainExtractor<Domain extends ExportDomain> = (
  db: Database,
  scope: ExportPayloadScope,
) => Promise<ExportPayloadDataByDomain[Domain]>;

export type ExportDomainExtractors = {
  [Domain in ExportDomain]: DomainExtractor<Domain>;
};

const DOMAIN_EXTRACTORS: ExportDomainExtractors = {
  blood: extractBlood,
  body: extractBody,
  medications: extractMedications,
  supplements: extractSupplements,
  workouts: extractWorkouts,
  goals: extractGoals,
  familyHistory: extractFamilyHistory,
  calendar: extractCalendar,
  insights: extractInsights,
  imaging: extractImaging,
  cardiac: extractCardiac,
  dexa: extractDexa,
  weight: extractWeight,
  audit: extractAudit,
};

export type BuildExportPayloadOptions = {
  extractors?: Partial<ExportDomainExtractors>;
  now?: () => Date;
};

function normalizeDomainOrder<Domains extends readonly ExportDomain[]>(
  domains: Domains,
): Domains[number][] {
  const orderIndex = new Map(EXPORT_DOMAIN_ORDER.map((domain, index) => [domain, index] as const));
  const deduped = Array.from(new Set(domains));
  return deduped.sort((left, right) => (orderIndex.get(left) ?? 0) - (orderIndex.get(right) ?? 0));
}

function assignDomainData<Domains extends readonly ExportDomain[], Domain extends Domains[number]>(
  data: ExportPayloadDataFor<Domains>,
  domain: Domain,
  value: ExportPayloadDataByDomain[Domain],
): void {
  data[domain] = value;
}

export async function buildExportPayload<Domains extends readonly ExportDomain[]>(
  db: Database,
  domains: Domains,
  scope: ExportPayloadScope,
  options: BuildExportPayloadOptions = {},
): Promise<ExportPayloadFor<Domains>> {
  const selectedDomains = normalizeDomainOrder(domains);
  const data: ExportPayloadDataFor<Domains> = {};
  const extractors = { ...DOMAIN_EXTRACTORS, ...options.extractors };
  const now = options.now ?? (() => new Date());

  for (const domain of selectedDomains) {
    const extractor = extractors[domain] as DomainExtractor<typeof domain>;
    const value = await extractor(db, scope);
    assignDomainData(data, domain, value);
  }

  return {
    generatedAt: now().toISOString(),
    schemaVersion: EXPORT_SCHEMA_VERSION,
    selectedDomains,
    data,
  };
}
