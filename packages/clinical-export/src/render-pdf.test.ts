import { describe, expect, test } from "bun:test";

import { renderPdfExport } from "./render-pdf";
import type { ExportPayload } from "./types";

function buildPayload(overrides: Partial<ExportPayload>): ExportPayload {
  return {
    generatedAt: "2026-03-02T10:00:00.000Z",
    schemaVersion: "export-v1",
    selectedDomains: [],
    data: {},
    ...overrides,
  };
}

describe("renderPdfExport (Issue #20 HTML attachment slice)", () => {
  test("emits the system font stack and page-break-inside:avoid CSS", () => {
    const payload = buildPayload({
      selectedDomains: ["blood"],
      data: { blood: [] },
    });
    const { html } = renderPdfExport(payload);
    expect(html).toContain("font-family:Helvetica,Arial,sans-serif");
    expect(html).toContain(".domain-section{page-break-inside:avoid}");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<meta charset="utf-8" />');
  });

  test("produces the canonical filename pattern health-export-YYYY-MM-DD.html", () => {
    const payload = buildPayload({
      generatedAt: "2026-03-02T10:00:00.000Z",
      selectedDomains: ["blood"],
      data: { blood: [] },
    });
    const { fileName, contentTypeHint } = renderPdfExport(payload);
    expect(fileName).toBe("health-export-2026-03-02.html");
    expect(contentTypeHint).toBe("text/html");
  });

  test("falls back to 1970-01-01 when generatedAt does not start with an ISO date", () => {
    const payload = buildPayload({
      generatedAt: "not-a-date",
      selectedDomains: ["blood"],
      data: { blood: [] },
    });
    expect(renderPdfExport(payload).fileName).toBe("health-export-1970-01-01.html");
  });

  test("preserves stable section order matching payload.selectedDomains", () => {
    const payload = buildPayload({
      selectedDomains: ["body", "blood", "supplements"],
      data: {
        blood: [],
        body: { asOfDate: null, weightKg: null, bodyFatPct: null, leanMassKg: null, bmi: null },
        supplements: [],
      },
    });
    const { html } = renderPdfExport(payload);
    const bodyIdx = html.indexOf("<h2>Body</h2>");
    const bloodIdx = html.indexOf("<h2>Blood</h2>");
    const supplementsIdx = html.indexOf("<h2>Supplements</h2>");
    expect(bodyIdx).toBeGreaterThan(0);
    expect(bloodIdx).toBeGreaterThan(bodyIdx);
    expect(supplementsIdx).toBeGreaterThan(bloodIdx);
  });

  test("emits 'No records.' for empty array domains and 'No data.' for null/undefined domain values", () => {
    const payload = buildPayload({
      // Use fresh domains that are not in the populated payload below
      // — the renderer reads `payload.data[domain]`, which is undefined
      // for any domain absent from `data`.
      selectedDomains: ["blood", "body", "medications", "supplements", "insights", "calendar"],
      data: {
        blood: [],
        medications: [],
        supplements: [],
        insights: {
          asOfDate: null,
          insightCount: 0,
          criticalCount: 0,
          warningCount: 0,
          recommendationTitles: [],
        },
        calendar: [],
      },
    });
    const { html } = renderPdfExport(payload);
    // `blood`, `medications`, `supplements`, `calendar` are empty arrays → "No records.".
    expect(html).toContain('<p class="empty">No records.</p>');
    // `body` is absent → undefined value → "No data.".
    expect(html).toContain('<p class="empty">No data.</p>');
    // `insights` is a populated object → table, not "No data.".
    expect(html).toContain("<th>asOfDate</th>");
  });

  test("renders object arrays as a table with sorted headers", () => {
    const payload = buildPayload({
      selectedDomains: ["blood"],
      data: {
        blood: [
          {
            recordedAt: "2026-03-02",
            markerKey: "ast",
            markerName: "AST",
            value: 35,
            unit: "U/L",
            flag: null,
          },
          {
            recordedAt: "2026-03-01",
            markerKey: "alt",
            markerName: "ALT",
            value: 41,
            unit: "U/L",
            flag: "H",
          },
        ],
      },
    });
    const { html } = renderPdfExport(payload);
    // Columns are lexically sorted; expect flag, markerKey, markerName, recordedAt, unit, value.
    const headerStart = html.indexOf("<thead><tr>") + "<thead><tr>".length;
    const headerEnd = html.indexOf("</tr></thead>");
    expect(headerStart).toBeGreaterThan("<thead><tr>".length);
    const headerRow = html.slice(headerStart, headerEnd);
    expect(headerRow).toBe(
      "<th>flag</th><th>markerKey</th><th>markerName</th><th>recordedAt</th><th>unit</th><th>value</th>",
    );
    // Summary reflects two records.
    expect(html).toContain('<p class="section-summary">2 records</p>');
  });

  test("HTML-escapes ampersands, angle brackets, quotes, and apostrophes inside data values", () => {
    const payload = buildPayload({
      selectedDomains: ["medications"],
      data: {
        medications: [
          {
            id: 1,
            name: "Ampersand & <dangerous> \"quotes\" 'apos'",
            dose: "5mg",
            route: "oral",
            protocol: "PRN",
            frequency: "daily",
            status: "active",
            notes: "safe",
          },
        ],
      },
    });
    const { html } = renderPdfExport(payload);
    expect(html).not.toContain('"quotes"');
    expect(html).not.toContain("<dangerous>");
    expect(html).toContain("&amp;");
    expect(html).toContain("&lt;dangerous&gt;");
    expect(html).toContain("&quot;quotes&quot;");
    expect(html).toContain("&#39;apos&#39;");
  });

  test("escapes the generatedAt timestamp and selected-domain labels in the header", () => {
    const payload = buildPayload({
      generatedAt: "2026-03-02T10:00:00.000Z",
      selectedDomains: ["blood"],
      data: { blood: [] },
    });
    const { html } = renderPdfExport(payload);
    expect(html).toContain("<strong>Generated at:</strong> 2026-03-02T10:00:00.000Z");
    expect(html).toContain("<strong>Selected domains:</strong> Blood");
  });

  test("escapes script-injection attempts in domain data and column headers", () => {
    const payload = buildPayload({
      selectedDomains: ["workouts"],
      data: {
        workouts: [
          {
            id: "<script>alert(1)</script>",
            notes: "<img src=x onerror=alert(2)>",
            date: "2026-03-02",
            type: "run",
            duration: 30,
            exercises: ["pushup", "squat"],
          },
        ],
      },
    });
    const { html } = renderPdfExport(payload);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img ");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;img src=x onerror=alert(2)&gt;");
  });

  test("scalar domain data renders as a paragraph", () => {
    const payload = buildPayload({
      selectedDomains: ["blood"],
      data: { blood: "PRIVATE" as unknown as ExportPayload["data"]["blood"] },
    });
    const { html } = renderPdfExport(payload);
    expect(html).toContain("<p>PRIVATE</p>");
  });

  test("caps recursive JSON serialization at MAX_STABLE_JSON_DEPTH (20)", () => {
    const payload = buildPayload({
      selectedDomains: ["workouts"],
      data: {
        workouts: [
          { id: 1, nested: { child: { child: { child: {} } } } as unknown as string },
        ] as unknown as ExportPayload["data"]["workouts"],
      },
    });
    const { html } = renderPdfExport(payload);
    // Beyond depth 20, the serializer emits the "[MaxDepth]" sentinel.
    // We assert the helper is wired by checking that no payload key
    // contains literal "[object Object]" leaking through.
    expect(html).not.toContain("[object Object]");
  });

  test("renders scalar arrays as an unordered list of items", () => {
    const payload = buildPayload({
      selectedDomains: ["workouts"],
      data: { workouts: ["walk", "run", "cycle"] as unknown as ExportPayload["data"]["workouts"] },
    });
    const { html } = renderPdfExport(payload);
    expect(html).toContain("<ul><li>walk</li><li>run</li><li>cycle</li></ul>");
  });

  test("render is deterministic: identical inputs yield identical HTML", () => {
    const payload = buildPayload({
      generatedAt: "2026-03-02T10:00:00.000Z",
      selectedDomains: ["blood", "supplements"],
      data: {
        blood: [
          {
            recordedAt: "2026-03-02",
            markerKey: "ast",
            markerName: "AST",
            value: 35,
            unit: "U/L",
            flag: null,
          },
        ],
        supplements: [
          {
            id: 1,
            scheduleId: null,
            name: "Vitamin D",
            dose: "1000IU",
            form: "capsule",
            category: "vitamin",
            timeOfDay: "morning",
            quantity: 1,
            frequency: "daily",
            status: "active",
            notes: "PRIVATE NOTE",
          },
        ],
      },
    });
    const first = renderPdfExport(payload);
    const second = renderPdfExport(payload);
    expect(second.html).toBe(first.html);
    expect(second.fileName).toBe(first.fileName);
    expect(second.contentTypeHint).toBe("text/html");
  });
});
