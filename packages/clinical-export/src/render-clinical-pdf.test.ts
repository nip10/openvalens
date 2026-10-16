import { describe, expect, test } from "bun:test";
import { extractText, getDocumentProxy, getMeta } from "unpdf";

import {
  buildClinicalPdfDocument,
  CLINICAL_PDF_MAX_CELL_CHARS,
  CLINICAL_PDF_MAX_ROWS_PER_SECTION,
  toPdfText,
} from "./clinical-pdf-document";
import { normalizeClinicalPdfDomains } from "./clinical-pdf-domains";
import { renderClinicalPdf } from "./render-clinical-pdf";
import type { ExportPayload } from "./types";

// Synthetic data only.
const GENERATED_AT = "2026-03-08T10:00:00.000Z";

function payload(overrides: Partial<ExportPayload> = {}): ExportPayload {
  return {
    generatedAt: GENERATED_AT,
    schemaVersion: "export-v1",
    selectedDomains: ["blood", "body", "medications", "imaging"],
    data: {
      blood: [
        {
          recordedAt: "2026-03-02",
          markerKey: "synthetic_marker_a",
          markerName: "Synthetic marker A",
          value: 5.4,
          unit: "mmol/L",
          flag: "HIGH",
          referenceRange: "3.9-5.5",
          source: "Example Lab North",
        },
        {
          recordedAt: "2026-03-02T08:15:00.000Z",
          markerKey: "synthetic_marker_b",
          markerName: "Synthetic marker B",
          value: "< 3.1",
          unit: "μg/L",
          flag: "LOW",
          referenceRange: "≤ 40",
          source: null,
        },
      ],
      body: {
        asOfDate: "2026-03-01",
        weightKg: 72.30000001,
        bodyFatPct: 18,
        leanMassKg: null,
        bmi: null,
      },
      medications: [
        {
          id: 1,
          name: "Synthetic medication",
          dose: "10 mg",
          route: "oral",
          protocol: null,
          frequency: "daily",
          status: "active",
          notes: "PRIVATE NOTE never rendered",
        },
      ],
      imaging: [],
    },
    ...overrides,
  };
}

async function parse(bytes: Uint8Array) {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { totalPages, text } = await extractText(pdf, { mergePages: true });
  const meta = await getMeta(pdf);
  return {
    totalPages,
    text: text.replace(/\s+/g, " "),
    info: meta.info as Record<string, unknown>,
  };
}

describe("renderClinicalPdf", () => {
  test("produces a parseable PDF with title, provenance, units and dates", async () => {
    const result = await renderClinicalPdf(payload());
    expect(result.contentType).toBe("application/pdf");
    expect(result.fileName).toBe("health-record-summary-2026-03-08.pdf");
    expect(new TextDecoder().decode(result.bytes.subarray(0, 5))).toBe("%PDF-");

    const { totalPages, text, info } = await parse(result.bytes);
    expect(totalPages).toBe(result.pageCount);
    expect(text).toContain("Health record summary");
    expect(text).toContain("Generated: 2026-03-08 10:00 UTC");
    expect(text).toContain(
      "Sections: Blood tests, Body measurements (latest), Medications, Imaging studies",
    );
    // Provenance: source, dates and units are stated.
    expect(text).toContain("Source: lab results entered or imported into this workspace");
    expect(text).toContain("Synthetic marker A");
    expect(text).toContain("2026-03-02");
    expect(text).toContain("mmol/L");
    expect(text).toContain("3.9-5.5");
    expect(text).toContain("Example Lab North");
    expect(text).toContain("< 3.1");
    // pdf.js normalizes the micro sign to Greek mu on extraction.
    expect(text).toMatch(/[µμ]g\/L/);
    expect(text).toContain("<= 40");
    expect(text).toContain("72.3");
    expect(text).not.toContain("72.30000001");
    expect(text).toContain("Synthetic medication");
    expect(text).toContain("No records stored.");
    expect(text).toContain("Page 1 of");
    // Metadata is fixed copy; it never carries record values.
    expect(info.Title).toBe("Health record summary");
    expect(JSON.stringify(info)).not.toContain("Synthetic");
  });

  test("states the disclaimer and makes no flag, diagnostic or certification claim", async () => {
    const { text } = await parse((await renderClinicalPdf(payload())).bytes);
    expect(text).toContain("About this document");
    expect(text).toContain("reproduced as stored, without interpretation");
    expect(text).toContain("not a medical device");
    expect(text).toContain("has not been reviewed by a healthcare professional");
    expect(text).toContain("Not medical advice.");
    // The stored HIGH/LOW flag is never rendered, nor free-text notes.
    expect(text).not.toMatch(/\bHIGH\b|\bLOW\b/);
    expect(text).not.toContain("PRIVATE NOTE");
    for (const banned of [
      /certif/i,
      /clinical-grade/i,
      /medical-grade/i,
      /clinically validated/i,
      /doctor-approved/i,
      /abnormal/i,
      /at risk/i,
      /\bdiagnos/i,
      /\bdetect/i,
    ]) {
      expect(text).not.toMatch(banned);
    }
  });

  test("ignores non-PDF domains even when they are present in the payload", async () => {
    const result = await renderClinicalPdf(
      payload({
        selectedDomains: ["blood", "insights", "audit"],
        data: {
          blood: [],
          insights: {
            asOfDate: null,
            insightCount: 3,
            criticalCount: 2,
            warningCount: 1,
            recommendationTitles: ["SYNTHETIC RECOMMENDATION"],
          },
          audit: [{ id: "x", eventType: "EXPORT_GENERATED" }],
        },
      }),
    );
    const { text } = await parse(result.bytes);
    expect(text).toContain("Blood tests");
    expect(text).not.toContain("SYNTHETIC RECOMMENDATION");
    expect(text).not.toContain("EXPORT_GENERATED");
  });

  test("paginates long sections and repeats the table header", async () => {
    const rows = Array.from({ length: 120 }, (_, index) => ({
      id: index,
      date: `2025-01-${String((index % 28) + 1).padStart(2, "0")}`,
      weightKg: 70 + index / 10,
      bodyFatPct: 20,
      notes: null,
    }));
    const result = await renderClinicalPdf(
      payload({ selectedDomains: ["weight"], data: { weight: rows } }),
    );
    expect(result.pageCount).toBeGreaterThan(1);
    const { text, totalPages } = await parse(result.bytes);
    expect(totalPages).toBe(result.pageCount);
    expect(text).toContain("Weight check-ins (continued)");
    expect(text).toContain(`Page ${result.pageCount} of ${result.pageCount}`);
  });
});

describe("buildClinicalPdfDocument", () => {
  test("caps rows per section and says how many are not listed", () => {
    const rows = Array.from({ length: CLINICAL_PDF_MAX_ROWS_PER_SECTION + 7 }, (_, index) => ({
      id: index,
      date: "2025-01-01",
      weightKg: 70,
      bodyFatPct: null,
      notes: null,
    }));
    const document = buildClinicalPdfDocument(
      payload({ selectedDomains: ["weight"], data: { weight: rows } }),
    );
    expect(document.sections[0]?.rows).toHaveLength(CLINICAL_PDF_MAX_ROWS_PER_SECTION);
    expect(document.sections[0]?.totalCount).toBe(CLINICAL_PDF_MAX_ROWS_PER_SECTION + 7);
  });

  test("shortens very long stored text with a visible marker", () => {
    const document = buildClinicalPdfDocument(
      payload({
        selectedDomains: ["cardiac"],
        data: {
          cardiac: [
            {
              id: 1,
              date: "2026-01-01",
              type: "Synthetic exam",
              facility: null,
              physician: "never rendered",
              conclusion: "x".repeat(CLINICAL_PDF_MAX_CELL_CHARS + 50),
              sourceFile: null,
            },
          ],
        },
      }),
    );
    const cell = document.sections[0]?.rows[0]?.[3] ?? "";
    expect(cell.startsWith("x".repeat(CLINICAL_PDF_MAX_CELL_CHARS))).toBe(true);
    expect(cell).toContain("[shortened; full text in the CSV export]");
    expect(JSON.stringify(document)).not.toContain("never rendered");
  });

  test("an empty body snapshot renders as no records", () => {
    const document = buildClinicalPdfDocument(
      payload({
        selectedDomains: ["body"],
        data: {
          body: { asOfDate: null, weightKg: null, bodyFatPct: null, leanMassKg: null, bmi: null },
        },
      }),
    );
    expect(document.sections[0]?.rows).toEqual([]);
  });
});

describe("toPdfText", () => {
  test("keeps Latin-1 and WinAnsi text, maps symbols and replaces the rest", () => {
    expect(toPdfText("Café – 5 µg")).toBe("Café – 5 µg");
    expect(toPdfText("≥ 1 ≤ 2 − 3")).toBe(">= 1 <= 2 - 3");
    expect(toPdfText("line\nbreak\tand\u0000nul")).toBe("line break andnul");
    expect(toPdfText("Łódź")).toBe("?ódz");
    expect(toPdfText("你好")).toBe("??");
  });
});

describe("normalizeClinicalPdfDomains", () => {
  test("dedupes, orders canonically and drops non-PDF domains", () => {
    expect(
      normalizeClinicalPdfDomains(["weight", "blood", "audit", "insights", "blood", "nope"]),
    ).toEqual(["blood", "weight"]);
  });
});
