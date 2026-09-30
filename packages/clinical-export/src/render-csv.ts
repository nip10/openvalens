// Source: anchovy/apps/web/src/lib/export/render-csv.ts
// CSV renderer for the legacy export pipeline. Mirrors the source's per-domain
// header order, CSV escaping (`"` doubling) and formula-prefix neutralization
// (= + - @ tab CR). One CSV file per requested domain, named
// `health-export-{domain}-{YYYY-MM-DD}.csv`.
import type { ExportDomain } from "./domains";
import type { ExportPayload, ExportPayloadDataByDomain } from "./types";

type CsvDomainSchema<Domain extends ExportDomain, Row extends Record<string, unknown>> = {
  headers: readonly (keyof Row & string)[];
  rows: (data: ExportPayloadDataByDomain[Domain] | undefined) => Row[];
};

type BloodCsvRow = {
  recordedAt: unknown;
  markerKey: unknown;
  markerName: unknown;
  value: unknown;
  unit: unknown;
  flag: unknown;
};

type BodyCsvRow = {
  asOfDate: unknown;
  weightKg: unknown;
  bodyFatPct: unknown;
  leanMassKg: unknown;
  bmi: unknown;
};

type MedicationsCsvRow = {
  id: unknown;
  name: unknown;
  dose: unknown;
  route: unknown;
  protocol: unknown;
  frequency: unknown;
  status: unknown;
  notes: unknown;
};

type SupplementsCsvRow = {
  id: unknown;
  scheduleId: unknown;
  name: unknown;
  dose: unknown;
  form: unknown;
  category: unknown;
  timeOfDay: unknown;
  quantity: unknown;
  frequency: unknown;
  status: unknown;
  notes: unknown;
};

type WorkoutsCsvRow = {
  id: unknown;
  date: unknown;
  type: unknown;
  duration: unknown;
  exercises: unknown;
  notes: unknown;
};

type GoalsCsvRow = {
  id: unknown;
  title: unknown;
  category: unknown;
  horizon: unknown;
  status: unknown;
  currentValue: unknown;
  targetValue: unknown;
  targetDate: unknown;
  notes: unknown;
  checkins: unknown;
};

type FamilyHistoryCsvRow = {
  id: unknown;
  relation: unknown;
  condition: unknown;
  ageOfOnset: unknown;
  notes: unknown;
  createdAt: unknown;
};

type CalendarCsvRow = {
  id: unknown;
  kind: unknown;
  date: unknown;
  type: unknown;
  category: unknown;
  title: unknown;
  referenceTable: unknown;
  referenceId: unknown;
  frequency: unknown;
  interval: unknown;
  endDate: unknown;
  notes: unknown;
};

type InsightsCsvRow = {
  asOfDate: unknown;
  insightCount: unknown;
  criticalCount: unknown;
  warningCount: unknown;
  recommendationTitles: unknown;
};

type ImagingCsvRow = {
  id: unknown;
  date: unknown;
  type: unknown;
  bodyPart: unknown;
  facility: unknown;
  physician: unknown;
  conclusion: unknown;
  sourceFile: unknown;
};

type CardiacCsvRow = {
  id: unknown;
  date: unknown;
  type: unknown;
  facility: unknown;
  physician: unknown;
  conclusion: unknown;
  sourceFile: unknown;
};

type DexaCsvRow = {
  id: unknown;
  date: unknown;
  weightKg: unknown;
  bodyFatPct: unknown;
  leanMassKg: unknown;
  bmi: unknown;
  rmr: unknown;
  sourceFile: unknown;
};

type WeightCsvRow = {
  id: unknown;
  date: unknown;
  weightKg: unknown;
  bodyFatPct: unknown;
  notes: unknown;
};

type AuditCsvRow = {
  id: unknown;
  source: unknown;
  timestamp: unknown;
  eventType: unknown;
  targetType: unknown;
  targetId: unknown;
  summary: unknown;
};

type CsvSchemaByDomain = {
  blood: CsvDomainSchema<"blood", BloodCsvRow>;
  body: CsvDomainSchema<"body", BodyCsvRow>;
  medications: CsvDomainSchema<"medications", MedicationsCsvRow>;
  supplements: CsvDomainSchema<"supplements", SupplementsCsvRow>;
  workouts: CsvDomainSchema<"workouts", WorkoutsCsvRow>;
  goals: CsvDomainSchema<"goals", GoalsCsvRow>;
  familyHistory: CsvDomainSchema<"familyHistory", FamilyHistoryCsvRow>;
  calendar: CsvDomainSchema<"calendar", CalendarCsvRow>;
  insights: CsvDomainSchema<"insights", InsightsCsvRow>;
  imaging: CsvDomainSchema<"imaging", ImagingCsvRow>;
  cardiac: CsvDomainSchema<"cardiac", CardiacCsvRow>;
  dexa: CsvDomainSchema<"dexa", DexaCsvRow>;
  weight: CsvDomainSchema<"weight", WeightCsvRow>;
  audit: CsvDomainSchema<"audit", AuditCsvRow>;
};

export type CsvExportFile = {
  fileName: string;
  content: string;
};

const SCHEMA_BLOOD: CsvSchemaByDomain["blood"] = {
  headers: ["recordedAt", "markerKey", "markerName", "value", "unit", "flag"],
  rows: (data) =>
    (data ?? []).map((row) => ({
      recordedAt: row.recordedAt,
      markerKey: row.markerKey,
      markerName: row.markerName,
      value: row.value,
      unit: row.unit,
      flag: row.flag,
    })),
};

const SCHEMA_BODY: CsvSchemaByDomain["body"] = {
  headers: ["asOfDate", "weightKg", "bodyFatPct", "leanMassKg", "bmi"],
  rows: (data) =>
    data
      ? [
          {
            asOfDate: data.asOfDate,
            weightKg: data.weightKg,
            bodyFatPct: data.bodyFatPct,
            leanMassKg: data.leanMassKg,
            bmi: data.bmi,
          },
        ]
      : [],
};

const SCHEMA_MEDICATIONS: CsvSchemaByDomain["medications"] = {
  headers: ["id", "name", "dose", "route", "protocol", "frequency", "status", "notes"],
  rows: (data) =>
    (data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      dose: row.dose,
      route: row.route,
      protocol: row.protocol,
      frequency: row.frequency,
      status: row.status,
      notes: row.notes,
    })),
};

const SCHEMA_SUPPLEMENTS: CsvSchemaByDomain["supplements"] = {
  headers: [
    "id",
    "scheduleId",
    "name",
    "dose",
    "form",
    "category",
    "timeOfDay",
    "quantity",
    "frequency",
    "status",
    "notes",
  ],
  rows: (data) =>
    (data ?? []).map((row) => ({
      id: row.id,
      scheduleId: row.scheduleId,
      name: row.name,
      dose: row.dose,
      form: row.form,
      category: row.category,
      timeOfDay: row.timeOfDay,
      quantity: row.quantity,
      frequency: row.frequency,
      status: row.status,
      notes: row.notes,
    })),
};

const SCHEMA_WORKOUTS: CsvSchemaByDomain["workouts"] = {
  headers: ["id", "date", "type", "duration", "exercises", "notes"],
  rows: (data) =>
    (data ?? []).map((row) => ({
      id: row.id,
      date: row.date,
      type: row.type,
      duration: row.duration,
      exercises: row.exercises,
      notes: row.notes,
    })),
};

const SCHEMA_GOALS: CsvSchemaByDomain["goals"] = {
  headers: [
    "id",
    "title",
    "category",
    "horizon",
    "status",
    "currentValue",
    "targetValue",
    "targetDate",
    "notes",
    "checkins",
  ],
  rows: (data) =>
    (data ?? []).map((row) => ({
      id: row.id,
      title: row.title,
      category: row.category,
      horizon: row.horizon,
      status: row.status,
      currentValue: row.currentValue,
      targetValue: row.targetValue,
      targetDate: row.targetDate,
      notes: row.notes,
      checkins: row.checkins,
    })),
};

const SCHEMA_FAMILY_HISTORY: CsvSchemaByDomain["familyHistory"] = {
  headers: ["id", "relation", "condition", "ageOfOnset", "notes", "createdAt"],
  rows: (data) =>
    (data ?? []).map((row) => ({
      id: row.id,
      relation: row.relation,
      condition: row.condition,
      ageOfOnset: row.ageOfOnset,
      notes: row.notes,
      createdAt: row.createdAt,
    })),
};

const SCHEMA_CALENDAR: CsvSchemaByDomain["calendar"] = {
  headers: [
    "id",
    "kind",
    "date",
    "type",
    "category",
    "title",
    "referenceTable",
    "referenceId",
    "frequency",
    "interval",
    "endDate",
    "notes",
  ],
  rows: (data) =>
    (data ?? []).map((row) => ({
      id: row.id,
      kind: row.kind,
      date: row.date,
      type: row.type,
      category: row.category,
      title: row.title,
      referenceTable: row.referenceTable,
      referenceId: row.referenceId,
      frequency: row.frequency,
      interval: row.interval,
      endDate: row.endDate,
      notes: row.notes,
    })),
};

const SCHEMA_INSIGHTS: CsvSchemaByDomain["insights"] = {
  headers: ["asOfDate", "insightCount", "criticalCount", "warningCount", "recommendationTitles"],
  rows: (data) =>
    data
      ? [
          {
            asOfDate: data.asOfDate,
            insightCount: data.insightCount,
            criticalCount: data.criticalCount,
            warningCount: data.warningCount,
            recommendationTitles: data.recommendationTitles,
          },
        ]
      : [],
};

const SCHEMA_IMAGING: CsvSchemaByDomain["imaging"] = {
  headers: ["id", "date", "type", "bodyPart", "facility", "physician", "conclusion", "sourceFile"],
  rows: (data) =>
    (data ?? []).map((row) => ({
      id: row.id,
      date: row.date,
      type: row.type,
      bodyPart: row.bodyPart,
      facility: row.facility,
      physician: row.physician,
      conclusion: row.conclusion,
      sourceFile: row.sourceFile,
    })),
};

const SCHEMA_CARDIAC: CsvSchemaByDomain["cardiac"] = {
  headers: ["id", "date", "type", "facility", "physician", "conclusion", "sourceFile"],
  rows: (data) =>
    (data ?? []).map((row) => ({
      id: row.id,
      date: row.date,
      type: row.type,
      facility: row.facility,
      physician: row.physician,
      conclusion: row.conclusion,
      sourceFile: row.sourceFile,
    })),
};

const SCHEMA_DEXA: CsvSchemaByDomain["dexa"] = {
  headers: ["id", "date", "weightKg", "bodyFatPct", "leanMassKg", "bmi", "rmr", "sourceFile"],
  rows: (data) =>
    (data ?? []).map((row) => ({
      id: row.id,
      date: row.date,
      weightKg: row.weightKg,
      bodyFatPct: row.bodyFatPct,
      leanMassKg: row.leanMassKg,
      bmi: row.bmi,
      rmr: row.rmr,
      sourceFile: row.sourceFile,
    })),
};

const SCHEMA_WEIGHT: CsvSchemaByDomain["weight"] = {
  headers: ["id", "date", "weightKg", "bodyFatPct", "notes"],
  rows: (data) =>
    (data ?? []).map((row) => ({
      id: row.id,
      date: row.date,
      weightKg: row.weightKg,
      bodyFatPct: row.bodyFatPct,
      notes: row.notes,
    })),
};

const SCHEMA_AUDIT: CsvSchemaByDomain["audit"] = {
  headers: ["id", "source", "timestamp", "eventType", "targetType", "targetId", "summary"],
  rows: (data) =>
    (data ?? []).map((row) => ({
      id: row.id,
      source: row.source,
      timestamp: row.timestamp,
      eventType: row.eventType,
      targetType: row.targetType,
      targetId: row.targetId,
      summary: row.summary,
    })),
};

export function renderCsvExport(payload: ExportPayload): CsvExportFile[] {
  const exportDate = getExportDate(payload.generatedAt);
  return payload.selectedDomains.map((domain) => renderDomainCsv(payload, domain, exportDate));
}

function renderDomainCsv<Domain extends ExportDomain>(
  payload: ExportPayload,
  domain: Domain,
  exportDate: string,
): CsvExportFile {
  const content = renderCsvForDomain(payload.data, domain);
  return {
    fileName: `health-export-${sanitizeToken(domain)}-${exportDate}.csv`,
    content,
  };
}

function renderCsvForDomain(
  data: ExportPayloadDataByDomain | ExportPayload["data"],
  domain: ExportDomain,
): string {
  switch (domain) {
    case "blood":
      return renderCsv(SCHEMA_BLOOD.headers, SCHEMA_BLOOD.rows(data.blood));
    case "body":
      return renderCsv(SCHEMA_BODY.headers, SCHEMA_BODY.rows(data.body));
    case "medications":
      return renderCsv(SCHEMA_MEDICATIONS.headers, SCHEMA_MEDICATIONS.rows(data.medications));
    case "supplements":
      return renderCsv(SCHEMA_SUPPLEMENTS.headers, SCHEMA_SUPPLEMENTS.rows(data.supplements));
    case "workouts":
      return renderCsv(SCHEMA_WORKOUTS.headers, SCHEMA_WORKOUTS.rows(data.workouts));
    case "goals":
      return renderCsv(SCHEMA_GOALS.headers, SCHEMA_GOALS.rows(data.goals));
    case "familyHistory":
      return renderCsv(
        SCHEMA_FAMILY_HISTORY.headers,
        SCHEMA_FAMILY_HISTORY.rows(data.familyHistory),
      );
    case "calendar":
      return renderCsv(SCHEMA_CALENDAR.headers, SCHEMA_CALENDAR.rows(data.calendar));
    case "insights":
      return renderCsv(SCHEMA_INSIGHTS.headers, SCHEMA_INSIGHTS.rows(data.insights));
    case "imaging":
      return renderCsv(SCHEMA_IMAGING.headers, SCHEMA_IMAGING.rows(data.imaging));
    case "cardiac":
      return renderCsv(SCHEMA_CARDIAC.headers, SCHEMA_CARDIAC.rows(data.cardiac));
    case "dexa":
      return renderCsv(SCHEMA_DEXA.headers, SCHEMA_DEXA.rows(data.dexa));
    case "weight":
      return renderCsv(SCHEMA_WEIGHT.headers, SCHEMA_WEIGHT.rows(data.weight));
    case "audit":
      return renderCsv(SCHEMA_AUDIT.headers, SCHEMA_AUDIT.rows(data.audit));
  }
}

function renderCsv<Row extends Record<string, unknown>>(
  headers: readonly (keyof Row & string)[],
  rows: Row[],
): string {
  const headerLine = headers.map(escapeCsvCell).join(",");
  const lines = [headerLine];
  for (const row of rows) {
    const line = headers.map((header) => escapeCsvCell(row[header])).join(",");
    lines.push(line);
  }
  return `${lines.join("\n")}\n`;
}

function escapeCsvCell(value: unknown): string {
  const normalized = normalizeCellValue(value);
  const escaped = neutralizeCsvFormula(normalized).replaceAll('"', '""');
  return `"${escaped}"`;
}

function neutralizeCsvFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function normalizeCellValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  try {
    const serialized = JSON.stringify(value);
    return serialized ?? "";
  } catch {
    return "";
  }
}

function getExportDate(generatedAt: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(generatedAt);
  return match?.[1] ?? "1970-01-01";
}

function sanitizeToken(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
