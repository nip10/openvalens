// Issue #132 — the clinical PDF's content, as plain data. Everything the PDF
// says is decided here (copy, provenance, column labels, cell text) so it can
// be unit-tested without a PDF parser; `render-clinical-pdf.ts` only lays it
// out.
//
// Wording follows docs/research/reports/Legal and clinical gate decisions.md:
// the document describes what was recorded and where it came from. It never
// flags values (the stored HIGH/LOW flag is deliberately not rendered), never
// interprets a result and never claims clinical review or certification.
import type { ClinicalPdfDomain } from "./clinical-pdf-domains";
import { normalizeClinicalPdfDomains } from "./clinical-pdf-domains";
import type { ExportPayload, JsonObject, JsonValue } from "./types";

export const CLINICAL_PDF_VERSION = "clinical-pdf-v1";

/** Rows rendered per section; older rows are counted but not listed. */
export const CLINICAL_PDF_MAX_ROWS_PER_SECTION = 500;

/** Longest cell text drawn; longer stored text is cut with a visible marker. */
export const CLINICAL_PDF_MAX_CELL_CHARS = 1000;
const TRUNCATION_MARKER = " [shortened; full text in the CSV export]";

export const CLINICAL_PDF_TITLE = "Health record summary";

export const CLINICAL_PDF_DISCLAIMER = [
  "This document is a copy of information recorded in an OpenValens workspace, either entered by a person or imported from the sources named in each section.",
  "Values, units and reference ranges are reproduced as stored, without interpretation. Ranges are the lab's own printed ranges where one was recorded.",
  "OpenValens is a personal record-keeping and general-wellness app, not a medical device. This document is not an official medical record, has not been reviewed by a healthcare professional and is not medical advice. Check values against the original source documents.",
] as const;

export const CLINICAL_PDF_FOOTER_NOTE = "Copy of stored records. Not medical advice.";

export type ClinicalPdfColumn = {
  label: string;
  /** Relative width; the renderer scales the set to the page width. */
  weight: number;
};

export type ClinicalPdfSection = {
  domain: ClinicalPdfDomain;
  title: string;
  provenance: string;
  columns: ClinicalPdfColumn[];
  rows: string[][];
  /** Number of stored records, including any not listed. */
  totalCount: number;
  emptyText: string;
};

export type ClinicalPdfDocument = {
  title: string;
  generatedAt: string;
  generatedLabel: string;
  sectionsLabel: string;
  formatLabel: string;
  disclaimer: readonly string[];
  footerNote: string;
  sections: ClinicalPdfSection[];
  fileName: string;
};

type SectionSpec = {
  title: string;
  provenance: string;
  columns: ClinicalPdfColumn[];
  rows: (data: unknown) => string[][];
  emptyText?: string;
};

const SECTION_SPECS: Record<ClinicalPdfDomain, SectionSpec> = {
  blood: {
    title: "Blood tests",
    provenance:
      "Source: lab results entered or imported into this workspace. Date is the panel date. Result, unit and the lab's printed range are shown as stored; facility is shown where recorded.",
    columns: [
      { label: "Date", weight: 1.1 },
      { label: "Test", weight: 2 },
      { label: "Result", weight: 1 },
      { label: "Unit", weight: 0.9 },
      { label: "Lab range (as stored)", weight: 1.3 },
      { label: "Facility", weight: 1.4 },
    ],
    rows: (data) =>
      asRows(data).map((row) => [
        date(row.recordedAt),
        text(row.markerName ?? row.markerKey),
        value(row.value),
        text(row.unit),
        text(row.referenceRange),
        text(row.source),
      ]),
  },
  body: {
    title: "Body measurements (latest)",
    provenance:
      'Source: the most recent DEXA scan or weight check-in in this workspace. "As of" is the later of those two dates. BMI and lean mass come from the DEXA scan.',
    columns: [
      { label: "Measurement", weight: 2 },
      { label: "Value", weight: 1.5 },
      { label: "Unit", weight: 1 },
    ],
    rows: (data) => {
      if (!isObject(data)) return [];
      const rows: string[][] = [
        ["As of", date(data.asOfDate), ""],
        ["Weight", value(data.weightKg), "kg"],
        ["Body fat", value(data.bodyFatPct), "%"],
        ["Lean mass", value(data.leanMassKg), "kg"],
        ["BMI", value(data.bmi), "kg/m2"],
      ];
      // A snapshot with no stored measurement at all renders as empty.
      return rows.slice(1).some((row) => row[1] !== "") ? rows : [];
    },
  },
  medications: {
    title: "Medications",
    provenance:
      "Source: the medication list entered in this workspace, shown as entered. List entries carry no dates.",
    columns: [
      { label: "Name", weight: 2 },
      { label: "Dose", weight: 1.2 },
      { label: "Route", weight: 1 },
      { label: "Frequency", weight: 1.3 },
      { label: "Status", weight: 1 },
    ],
    rows: (data) =>
      asRows(data).map((row) => [
        text(row.name),
        text(row.dose),
        text(row.route),
        text(row.frequency),
        text(row.status),
      ]),
  },
  supplements: {
    title: "Supplements",
    provenance:
      "Source: the supplement schedule entered in this workspace, shown as entered. Schedule entries carry no dates.",
    columns: [
      { label: "Name", weight: 2 },
      { label: "Dose", weight: 1.1 },
      { label: "Form", weight: 1 },
      { label: "Quantity", weight: 0.9 },
      { label: "Time of day", weight: 1.1 },
      { label: "Frequency", weight: 1.1 },
      { label: "Status", weight: 0.9 },
    ],
    rows: (data) =>
      asRows(data).map((row) => [
        text(row.name),
        text(row.dose),
        text(row.form),
        value(row.quantity),
        text(row.timeOfDay),
        text(row.frequency),
        text(row.status),
      ]),
  },
  familyHistory: {
    title: "Family history",
    provenance:
      'Source: family history entered in this workspace, shown as entered. "Recorded on" is the date the entry was added.',
    columns: [
      { label: "Relation", weight: 1.2 },
      { label: "Condition (as entered)", weight: 2.4 },
      { label: "Age of onset", weight: 1 },
      { label: "Recorded on", weight: 1.1 },
    ],
    rows: (data) =>
      asRows(data).map((row) => [
        text(row.relation),
        text(row.condition),
        value(row.ageOfOnset),
        date(row.createdAt),
      ]),
  },
  imaging: {
    title: "Imaging studies",
    provenance:
      "Source: imaging reports entered or imported into this workspace. Date is the study date; the conclusion is quoted from the report as stored.",
    columns: [
      { label: "Date", weight: 1 },
      { label: "Study", weight: 1.2 },
      { label: "Body part", weight: 1.1 },
      { label: "Facility", weight: 1.3 },
      { label: "Report conclusion (as stored)", weight: 3 },
    ],
    rows: (data) =>
      asRows(data).map((row) => [
        date(row.date),
        text(row.type),
        text(row.bodyPart),
        text(row.facility),
        text(row.conclusion),
      ]),
  },
  cardiac: {
    title: "Cardiac exams",
    provenance:
      "Source: cardiac exam reports entered or imported into this workspace. Date is the exam date; the conclusion is quoted from the report as stored.",
    columns: [
      { label: "Date", weight: 1 },
      { label: "Exam", weight: 1.3 },
      { label: "Facility", weight: 1.4 },
      { label: "Report conclusion (as stored)", weight: 3.4 },
    ],
    rows: (data) =>
      asRows(data).map((row) => [
        date(row.date),
        text(row.type),
        text(row.facility),
        text(row.conclusion),
      ]),
  },
  dexa: {
    title: "DEXA scans",
    provenance:
      "Source: DEXA scan results entered or imported into this workspace. Date is the scan date; values are shown as stored.",
    columns: [
      { label: "Date", weight: 1 },
      { label: "Weight (kg)", weight: 1 },
      { label: "Body fat (%)", weight: 1 },
      { label: "Lean mass (kg)", weight: 1 },
      { label: "BMI (kg/m2)", weight: 1 },
    ],
    rows: (data) =>
      asRows(data).map((row) => [
        date(row.date),
        value(row.weightKg),
        value(row.bodyFatPct),
        value(row.leanMassKg),
        value(row.bmi),
      ]),
  },
  weight: {
    title: "Weight check-ins",
    provenance:
      "Source: weight check-ins entered in this workspace. Date is the check-in date; values are shown as stored.",
    columns: [
      { label: "Date", weight: 1 },
      { label: "Weight (kg)", weight: 1 },
      { label: "Body fat (%)", weight: 1 },
    ],
    rows: (data) =>
      asRows(data).map((row) => [date(row.date), value(row.weightKg), value(row.bodyFatPct)]),
  },
};

export function buildClinicalPdfDocument(payload: ExportPayload): ClinicalPdfDocument {
  const domains = normalizeClinicalPdfDomains(payload.selectedDomains);
  const sections = domains.map((domain) => buildSection(domain, payload.data[domain]));

  return {
    title: CLINICAL_PDF_TITLE,
    generatedAt: payload.generatedAt,
    generatedLabel: `Generated: ${formatTimestamp(payload.generatedAt)}`,
    sectionsLabel: `Sections: ${sections.map((section) => section.title).join(", ")}`,
    formatLabel: `Format: ${CLINICAL_PDF_VERSION} (data ${toPdfText(payload.schemaVersion)})`,
    disclaimer: CLINICAL_PDF_DISCLAIMER,
    footerNote: CLINICAL_PDF_FOOTER_NOTE,
    sections,
    fileName: `health-record-summary-${exportDate(payload.generatedAt)}.pdf`,
  };
}

function buildSection(domain: ClinicalPdfDomain, data: unknown): ClinicalPdfSection {
  const spec = SECTION_SPECS[domain];
  const rows = spec.rows(data);
  return {
    domain,
    title: spec.title,
    provenance: spec.provenance,
    columns: spec.columns,
    rows: rows.slice(0, CLINICAL_PDF_MAX_ROWS_PER_SECTION),
    totalCount: rows.length,
    emptyText: spec.emptyText ?? "No records stored.",
  };
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRows(data: unknown): JsonObject[] {
  return Array.isArray(data) ? data.filter(isObject) : [];
}

function text(input: JsonValue | undefined): string {
  if (input === null || input === undefined) return "";
  if (typeof input === "string") return clamp(toPdfText(input.trim()));
  if (typeof input === "number") return value(input);
  if (typeof input === "boolean") return input ? "Yes" : "No";
  return "";
}

function clamp(input: string): string {
  if (input.length <= CLINICAL_PDF_MAX_CELL_CHARS) return input;
  return `${input.slice(0, CLINICAL_PDF_MAX_CELL_CHARS).trimEnd()}${TRUNCATION_MARKER}`;
}

/**
 * Numbers are shown as stored, with binary floating-point noise removed (at
 * most three decimals); strings such as "< 3.1" pass through unchanged.
 */
function value(input: JsonValue | undefined): string {
  if (typeof input === "number") {
    if (!Number.isFinite(input)) return "";
    return String(Math.round(input * 1000) / 1000);
  }
  return text(input);
}

function date(input: JsonValue | undefined): string {
  if (typeof input !== "string") return "";
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(input);
  return match?.[1] ?? toPdfText(input);
}

function formatTimestamp(iso: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
  return match ? `${match[1]} ${match[2]} UTC` : toPdfText(iso);
}

function exportDate(generatedAt: string): string {
  return /^(\d{4}-\d{2}-\d{2})/.exec(generatedAt)?.[1] ?? "1970-01-01";
}

// Windows-1252 code points outside Latin-1 that the PDF standard fonts encode.
const WIN_ANSI_EXTRAS = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");

const REPLACEMENTS: Record<string, string> = {
  "≤": "<=",
  "≥": ">=",
  "≠": "!=",
  "−": "-",
  "‐": "-",
  "‑": "-",
  μ: "µ",
  "′": "'",
  "″": '"',
};

/**
 * Maps text onto the WinAnsi character set the built-in PDF fonts can draw.
 * Common symbols get ASCII equivalents, accents survive where Latin-1 has
 * them, control characters are dropped and anything else becomes "?" so a
 * value is never silently mis-rendered as a different glyph.
 */
export function toPdfText(input: string): string {
  let output = "";
  for (const character of input) {
    const replacement = REPLACEMENTS[character];
    if (replacement !== undefined) {
      output += replacement;
      continue;
    }
    const code = character.codePointAt(0) ?? 0;
    if (code === 0x09 || code === 0x0a || code === 0x0d) {
      output += " ";
    } else if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)) {
      output += character;
    } else if (WIN_ANSI_EXTRAS.has(character)) {
      output += character;
    } else if (code < 0x20 || (code >= 0x7f && code < 0xa0)) {
      continue;
    } else {
      const decomposed = character.normalize("NFKD").replace(/[̀-ͯ]/g, "");
      output += /^[\x20-\x7e]+$/.test(decomposed) ? decomposed : "?";
    }
  }
  return output;
}
