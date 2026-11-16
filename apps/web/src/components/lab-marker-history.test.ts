import { describe, expect, mock, test } from "bun:test";

// Loading the real `orpc` reads the server URL from `@/env`; the root test run
// has no web env unless an earlier file set one up.
mock.module("@/env", () => ({ ENV: { VITE_SERVER_URL: "https://health.example/" } }));

const { labHistoryRows } = await import("./lab-marker-history");

describe("labHistoryRows", () => {
  const marker = { code: "blood_marker_glucose", unit: "mg/dL" };

  test("each reading against the range printed with it", () => {
    const rows = labHistoryRows(
      marker,
      [
        {
          sampledAt: "2026-01-10T08:00:00.000Z",
          value: 105,
          referenceRange: { low: 70, high: 99, text: null, unit: "mg/dL" },
        },
        {
          sampledAt: "2026-06-10T08:00:00.000Z",
          value: 92,
          referenceRange: { low: 70, high: 99, text: "70–99", unit: "mg/dL" },
        },
        { sampledAt: "2026-09-10T08:00:00.000Z", value: 60, referenceRange: null },
      ],
      "as_reported",
    );
    expect(rows.map((row) => [row.value, row.position])).toEqual([
      [105, "above"],
      [92, "within"],
      [60, null],
    ]);
    expect(rows[1]?.range).toMatchObject({ kind: "between", low: "70", high: "99" });
  });

  test("converts with the member's unit choice", () => {
    const [row] = labHistoryRows(
      marker,
      [
        {
          sampledAt: "2026-06-10T08:00:00.000Z",
          value: 90.08,
          referenceRange: { low: 70, high: 99, text: null, unit: "mg/dL" },
        },
      ],
      "mmol_l",
    );
    expect(row?.unit).toBe("mmol/L");
    expect(row?.value).toBeCloseTo(5, 1);
    expect(row?.position).toBe("within");
  });
});
