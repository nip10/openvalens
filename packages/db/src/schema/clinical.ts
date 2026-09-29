import {
  pgTable,
  text,
  integer,
  real,
  serial,
  index,
  uniqueIndex,
  foreignKey,
} from "drizzle-orm/pg-core";

import { orgId } from "./auth";

// ─── Blood Work ───────────────────────────────────────────────

export const bloodPanel = pgTable(
  "blood_panel",
  {
    id: serial("id").primaryKey(),
    organizationId: orgId(),
    date: text("date").notNull(), // ISO 8601
    context: text("context"), // "Routine", "Emergency", "Pre-operative", etc.
    facility: text("facility"),
    physician: text("physician"),
    sourceFile: text("source_file"), // path to markdown
    pdfPath: text("pdf_path"), // path to original PDF
    notes: text("notes"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    bloodPanelOrgIdx: index("blood_panel_organization_id_idx").on(table.organizationId),
    bloodPanelOrgIdUnique: uniqueIndex("blood_panel_org_id_key").on(table.organizationId, table.id),
    bloodPanelOrgDateIdx: index("blood_panel_organization_id_date_idx").on(
      table.organizationId,
      table.date,
    ),
  }),
);

export const bloodMarker = pgTable(
  "blood_marker",
  {
    id: serial("id").primaryKey(),
    organizationId: orgId(),
    panelId: integer("panel_id")
      .notNull()
      .references(() => bloodPanel.id),
    category: text("category").notNull(), // "Hematology", "Biochemistry", etc.
    subcategory: text("subcategory"), // "Red Blood Cells", "Liver Function", etc.
    testName: text("test_name").notNull(), // Display name
    testKey: text("test_key").notNull(), // Normalized key e.g. "hemoglobin"
    valueNumeric: real("value_numeric"), // null for "Negative", "Clear", etc.
    valueText: text("value_text"), // Raw value text e.g. "< 3.1", "Negative"
    unit: text("unit"),
    refRangeLow: real("ref_range_low"),
    refRangeHigh: real("ref_range_high"),
    refRangeText: text("ref_range_text"), // e.g. "< 0.30", "30–100"
    flag: text("flag"), // "HIGH", "LOW", "CRITICAL", null = normal
  },
  (table) => ({
    bloodMarkerOrgIdx: index("blood_marker_organization_id_idx").on(table.organizationId),
    bloodMarkerPanelFk: foreignKey({
      columns: [table.organizationId, table.panelId],
      foreignColumns: [bloodPanel.organizationId, bloodPanel.id],
      name: "blood_marker_org_panel_fk",
    }).onDelete("cascade"),
    bloodMarkerOrgPanelIdx: index("blood_marker_organization_id_panel_id_idx").on(
      table.organizationId,
      table.panelId,
    ),
    bloodMarkerOrgTestKeyIdx: index("blood_marker_organization_id_test_key_idx").on(
      table.organizationId,
      table.testKey,
    ),
    bloodMarkerOrgTestKeyPanelIdx: index("blood_marker_organization_id_test_key_panel_id_idx").on(
      table.organizationId,
      table.testKey,
      table.panelId,
    ),
  }),
);

export const optimalRange = pgTable("optimal_range", {
  id: serial("id").primaryKey(),
  testKey: text("test_key").notNull(),
  source: text("source").notNull(), // "Standard Lab", "Bryan Johnson", "Peter Attia"
  rangeLow: real("range_low"),
  rangeHigh: real("range_high"),
  classification: text("classification").notNull(), // "optimal", "acceptable", "standard"
  explanation: text("explanation"),
});

export const bloodMarkerInfo = pgTable("blood_marker_info", {
  id: serial("id").primaryKey(),
  testKey: text("test_key").notNull().unique(),
  displayName: text("display_name").notNull(),
  category: text("category").notNull(),
  description: text("description"),
  whyItMatters: text("why_it_matters"),
  higherMeans: text("higher_means"),
  lowerMeans: text("lower_means"),
  relatedMarkers: text("related_markers"), // JSON array of test_keys
});

// ─── Cardiac ──────────────────────────────────────────────────

export const cardiacExam = pgTable(
  "cardiac_exam",
  {
    id: serial("id").primaryKey(),
    organizationId: orgId(),
    date: text("date").notNull(),
    type: text("type").notNull(), // "echocardiogram", "ecg"
    facility: text("facility"),
    physician: text("physician"),
    reason: text("reason"),
    report: text("report"), // Full narrative
    conclusion: text("conclusion"),
    sourceFile: text("source_file"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    cardiacExamOrgIdx: index("cardiac_exam_organization_id_idx").on(table.organizationId),
    cardiacExamOrgIdUnique: uniqueIndex("cardiac_exam_org_id_key").on(
      table.organizationId,
      table.id,
    ),
    cardiacExamOrgDateIdx: index("cardiac_exam_organization_id_date_idx").on(
      table.organizationId,
      table.date,
    ),
  }),
);

export const cardiacMeasurement = pgTable(
  "cardiac_measurement",
  {
    id: serial("id").primaryKey(),
    organizationId: orgId(),
    examId: integer("exam_id")
      .notNull()
      .references(() => cardiacExam.id),
    name: text("name").notNull(),
    value: real("value"),
    valueText: text("value_text"),
    unit: text("unit"),
  },
  (table) => ({
    cardiacMeasurementOrgIdx: index("cardiac_measurement_organization_id_idx").on(
      table.organizationId,
    ),
    cardiacMeasurementExamFk: foreignKey({
      columns: [table.organizationId, table.examId],
      foreignColumns: [cardiacExam.organizationId, cardiacExam.id],
      name: "cardiac_measurement_org_exam_fk",
    }).onDelete("cascade"),
  }),
);

// ─── Imaging ──────────────────────────────────────────────────

export const imagingStudy = pgTable(
  "imaging_study",
  {
    id: serial("id").primaryKey(),
    organizationId: orgId(),
    date: text("date").notNull(),
    type: text("type").notNull(), // "CT", "MRI"
    bodyPart: text("body_part").notNull(),
    facility: text("facility"),
    physician: text("physician"),
    technique: text("technique"),
    findings: text("findings"),
    conclusion: text("conclusion"),
    sourceFile: text("source_file"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    imagingStudyOrgIdx: index("imaging_study_organization_id_idx").on(table.organizationId),
    imagingStudyOrgIdUnique: uniqueIndex("imaging_study_org_id_key").on(
      table.organizationId,
      table.id,
    ),
  }),
);

// ─── Consultations ────────────────────────────────────────────

export const consultation = pgTable(
  "consultation",
  {
    id: serial("id").primaryKey(),
    organizationId: orgId(),
    date: text("date").notNull(),
    type: text("type").notNull(), // "emergency", "surgery", "follow-up"
    facility: text("facility"),
    physician: text("physician"),
    diagnosis: text("diagnosis"),
    report: text("report"), // Full markdown content
    sourceFile: text("source_file"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    consultationOrgIdx: index("consultation_organization_id_idx").on(table.organizationId),
  }),
);

// ─── Family History ───────────────────────────────────────────

export const familyHistory = pgTable(
  "family_history",
  {
    id: serial("id").primaryKey(),
    organizationId: orgId(),
    relation: text("relation").notNull(), // "father", "mother", "sibling", "paternal_grandfather", etc.
    condition: text("condition").notNull(),
    ageOfOnset: integer("age_of_onset"),
    notes: text("notes"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    familyHistoryOrgIdx: index("family_history_organization_id_idx").on(table.organizationId),
  }),
);
