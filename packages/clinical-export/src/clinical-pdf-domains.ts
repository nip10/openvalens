// Issue #132 — domain set for the clinical PDF export. Pure and dependency-free
// (only the closed export enum), so the presenter can import it into the web
// and mobile bundles without pulling in the PDF library.
import { EXPORT_DOMAIN_ORDER, type ExportDomain } from "./domains";

/**
 * Domains the clinical PDF renders, in canonical export order. Only stored
 * records with a factual, source-attributable shape are included: `insights`
 * (generated counts and recommendations), `audit` (has its own permissioned
 * timeline) and the planning domains (`workouts`, `goals`, `calendar`) are not
 * clinical records and stay CSV-only.
 */
export const CLINICAL_PDF_DOMAINS = [
  "blood",
  "body",
  "medications",
  "supplements",
  "familyHistory",
  "imaging",
  "cardiac",
  "dexa",
  "weight",
] as const satisfies readonly ExportDomain[];

export type ClinicalPdfDomain = (typeof CLINICAL_PDF_DOMAINS)[number];

export const DEFAULT_CLINICAL_PDF_DOMAINS: readonly ClinicalPdfDomain[] = [
  "blood",
  "body",
  "medications",
  "supplements",
];

const CLINICAL_PDF_DOMAIN_SET = new Set<string>(CLINICAL_PDF_DOMAINS);

export function isClinicalPdfDomain(value: unknown): value is ClinicalPdfDomain {
  return typeof value === "string" && CLINICAL_PDF_DOMAIN_SET.has(value);
}

/** Dedupes and orders a domain list canonically, dropping non-PDF domains. */
export function normalizeClinicalPdfDomains(domains: readonly unknown[]): ClinicalPdfDomain[] {
  const selected = new Set(domains.filter(isClinicalPdfDomain));
  return EXPORT_DOMAIN_ORDER.filter((domain): domain is ClinicalPdfDomain =>
    selected.has(domain as ClinicalPdfDomain),
  );
}
