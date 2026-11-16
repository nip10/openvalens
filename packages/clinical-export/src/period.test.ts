import { describe, expect, test } from "bun:test";

import { applyExportPeriod } from "./period";
import { renderPdfExport } from "./render-pdf";
import type { ExportPayload } from "./types";

/** exports#4 — synthetic rows only. */
function payload(): ExportPayload {
  return {
    generatedAt: "2026-11-16T10:00:00.000Z",
    schemaVersion: "export-v1",
    selectedDomains: ["blood", "medications", "weight", "audit"],
    data: {
      blood: [
        {
          recordedAt: "2026-10-02",
          markerKey: "a",
          markerName: "Marker A",
          value: 1,
          unit: null,
          flag: null,
        },
        {
          recordedAt: "2025-01-10",
          markerKey: "b",
          markerName: "Marker B",
          value: 2,
          unit: null,
          flag: null,
        },
        {
          recordedAt: null,
          markerKey: "c",
          markerName: "Marker C",
          value: 3,
          unit: null,
          flag: null,
        },
      ],
      medications: [{ id: 1, name: "Synthetic med", status: "active" }],
      weight: [
        { id: 1, date: "2026-11-01", weightKg: 70 },
        { id: 2, date: "2026-12-01", weightKg: 71 },
      ],
      audit: [{ id: "x", timestamp: "2026-09-30T23:00:00.000Z", eventType: "READ" }],
    },
  };
}

describe("applyExportPeriod", () => {
  test("all time leaves the payload as it is", () => {
    const input = payload();
    expect(applyExportPeriod(input, undefined)).toBe(input);
    expect(applyExportPeriod(input, { from: null, to: null })).toBe(input);
  });

  test("dated rows outside the period go; undated rows and current lists stay", () => {
    const out = applyExportPeriod(payload(), { from: "2026-10-01", to: "2026-11-30" });
    expect(out.data.blood?.map((row) => row.markerKey)).toEqual(["a", "c"]);
    expect(out.data.weight?.map((row) => row.id)).toEqual([1]);
    // A timestamp counts by its date.
    expect(out.data.audit).toEqual([]);
    expect(out.data.medications).toHaveLength(1);
    expect(out.period).toEqual({ from: "2026-10-01", to: "2026-11-30" });
  });

  test("an open end keeps everything on that side", () => {
    const from = applyExportPeriod(payload(), { from: "2026-10-01", to: null });
    expect(from.data.weight?.map((row) => row.id)).toEqual([1, 2]);
    const to = applyExportPeriod(payload(), { from: null, to: "2025-12-31" });
    expect(to.data.blood?.map((row) => row.markerKey)).toEqual(["b", "c"]);
  });

  test("the printable page says which period it covers", () => {
    const html = renderPdfExport(
      applyExportPeriod(payload(), { from: "2026-10-01", to: "2026-11-30" }),
    ).html;
    expect(html).toContain("<strong>Period:</strong> 2026-10-01 to 2026-11-30");
    expect(renderPdfExport(payload()).html).not.toContain("Period:");
    expect(
      renderPdfExport(applyExportPeriod(payload(), { from: "2026-10-01", to: null })).html,
    ).toContain("From 2026-10-01");
  });
});
