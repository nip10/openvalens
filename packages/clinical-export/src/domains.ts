// Source: anchovy/apps/web/src/lib/export/domains.ts
// Domain set, default selection and canonical ordering for the legacy CSV/PDF
// export pipeline. This module is pure: it never touches the database and never
// accepts caller-supplied values as authoritative.
export const EXPORT_DOMAINS = [
  "blood",
  "body",
  "medications",
  "supplements",
  "workouts",
  "goals",
  "familyHistory",
  "calendar",
  "insights",
  "imaging",
  "cardiac",
  "dexa",
  "weight",
  "audit",
] as const;

export type ExportDomain = (typeof EXPORT_DOMAINS)[number];

export const EXPORT_DOMAIN_ORDER: readonly ExportDomain[] = EXPORT_DOMAINS;

export const DEFAULT_EXPORT_DOMAINS: readonly ExportDomain[] = [
  "blood",
  "body",
  "medications",
  "supplements",
];

const EXPORT_DOMAIN_SET = new Set<ExportDomain>(EXPORT_DOMAINS);

export function isExportDomain(value: unknown): value is ExportDomain {
  return typeof value === "string" && EXPORT_DOMAIN_SET.has(value as ExportDomain);
}
