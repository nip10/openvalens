// Source: anchovy/apps/web/src/lib/export/types.ts
// JSON-safe payload types for the legacy CSV/PDF export pipeline. The schema
// version is fixed by the source route and must remain a literal string.
import type { ExportDomain } from "./domains";

export type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export type JsonObject = {
  [key: string]: JsonValue;
};

export type ExportDomainCollection = JsonObject[];

export type ExportDomainSummary = JsonObject;

export type ExportBloodRecord = {
  recordedAt: string | null;
  markerKey: string;
  markerName: string;
  value: number | string | null;
  unit: string | null;
  flag: string | null;
  /**
   * The lab's printed reference range exactly as stored (text form first,
   * otherwise the stored low/high bounds). Optional so CSV fixtures and the
   * fixed CSV header set stay unchanged; only the clinical PDF reads it.
   */
  referenceRange?: string | null;
  /** Facility recorded on the panel, used as row provenance in the PDF. */
  source?: string | null;
};

export type ExportBodySnapshot = {
  asOfDate: string | null;
  weightKg: number | null;
  bodyFatPct: number | null;
  leanMassKg: number | null;
  bmi: number | null;
};

export type ExportInsightsSnapshot = {
  asOfDate: string | null;
  insightCount: number;
  criticalCount: number;
  warningCount: number;
  recommendationTitles: string[];
};

export type ExportPayloadDataByDomain = {
  blood: ExportBloodRecord[];
  body: ExportBodySnapshot;
  medications: ExportDomainCollection;
  supplements: ExportDomainCollection;
  workouts: ExportDomainCollection;
  goals: ExportDomainCollection;
  familyHistory: ExportDomainCollection;
  calendar: ExportDomainCollection;
  insights: ExportInsightsSnapshot;
  imaging: ExportDomainCollection;
  cardiac: ExportDomainCollection;
  dexa: ExportDomainCollection;
  weight: ExportDomainCollection;
  audit: ExportDomainCollection;
};

export type ExportPayloadData = Partial<ExportPayloadDataByDomain>;

export type ExportPayloadDataFor<Domains extends readonly ExportDomain[]> = Partial<
  Pick<ExportPayloadDataByDomain, Domains[number]>
>;

export type ExportPayloadFor<Domains extends readonly ExportDomain[]> = {
  generatedAt: string;
  schemaVersion: string;
  selectedDomains: Domains[number][];
  data: ExportPayloadDataFor<Domains>;
};

export type ExportPayload = ExportPayloadFor<readonly ExportDomain[]>;
