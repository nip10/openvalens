import { expect, test } from "bun:test";
import { renderCsvExport } from "./render-csv";
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

test("renders stable headers for representative domains", () => {
  const payload = buildPayload({
    selectedDomains: ["blood", "supplements"],
    data: { blood: [], supplements: [] },
  });

  const files = renderCsvExport(payload);
  const byName = new Map(files.map((file) => [file.fileName, file.content]));

  expect(byName.get("health-export-blood-2026-03-02.csv")).toBe(
    '"recordedAt","markerKey","markerName","value","unit","flag"\n',
  );
  expect(byName.get("health-export-supplements-2026-03-02.csv")).toBe(
    '"id","scheduleId","name","dose","form","category","timeOfDay","quantity","frequency","status","notes"\n',
  );
});

test("renders null and undefined values as empty cells", () => {
  const payload = buildPayload({
    selectedDomains: ["medications"],
    data: {
      medications: [{ id: 10, name: null, dose: "5mg" }],
    },
  });

  const [file] = renderCsvExport(payload);
  expect(file?.content).toBe(
    '"id","name","dose","route","protocol","frequency","status","notes"\n"10","","5mg","","","","",""\n',
  );
});

test("escapes commas, quotes, and newlines", () => {
  const payload = buildPayload({
    selectedDomains: ["blood"],
    data: {
      blood: [
        {
          recordedAt: "2026-02-28",
          markerKey: "ast",
          markerName: 'AST, "GOT"\nNext line',
          value: "high,maybe",
          unit: "U/L",
          flag: "H",
        },
      ],
    },
  });

  const [file] = renderCsvExport(payload);
  expect(file?.content).toBe(
    '"recordedAt","markerKey","markerName","value","unit","flag"\n"2026-02-28","ast","AST, ""GOT""\nNext line","high,maybe","U/L","H"\n',
  );
});

test("neutralizes dangerous formula prefixes before quoting", () => {
  const payload = buildPayload({
    selectedDomains: ["blood"],
    data: {
      blood: [
        {
          recordedAt: "=SUM(A1:A2)",
          markerKey: "+cmd",
          markerName: "-1",
          value: "@foo",
          unit: "\tTabbed",
          flag: "\rCarriage",
        },
      ],
    },
  });

  const [file] = renderCsvExport(payload);
  expect(file?.content).toBe(
    '"recordedAt","markerKey","markerName","value","unit","flag"\n"\'=SUM(A1:A2)","\'+cmd","\'-1","\'@foo","\'\tTabbed","\'\rCarriage"\n',
  );
});

test("preserves normal values", () => {
  const payload = buildPayload({
    selectedDomains: ["weight"],
    data: {
      weight: [
        {
          id: 1,
          date: "2026-03-02",
          weightKg: 84.2,
          bodyFatPct: 26.5,
          notes: "steady progress",
        },
      ],
    },
  });

  const [file] = renderCsvExport(payload);
  expect(file?.content).toBe(
    '"id","date","weightKg","bodyFatPct","notes"\n"1","2026-03-02","84.2","26.5","steady progress"\n',
  );
});

test("renders header-only CSV for object domains when data is missing", () => {
  const payload = buildPayload({
    selectedDomains: ["insights"],
    data: {},
  });

  const [file] = renderCsvExport(payload);
  expect(file?.content).toBe(
    '"asOfDate","insightCount","criticalCount","warningCount","recommendationTitles"\n',
  );
});

test("produces one CSV file per domain with sanitized filename", () => {
  const payload = buildPayload({
    selectedDomains: ["familyHistory", "cardiac"],
    data: { familyHistory: [], cardiac: [] },
  });
  const names = renderCsvExport(payload).map((file) => file.fileName);
  expect(names).toEqual([
    "health-export-familyhistory-2026-03-02.csv",
    "health-export-cardiac-2026-03-02.csv",
  ]);
});
