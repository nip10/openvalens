/**
 * Clinical records — public type surface (Issue #24).
 *
 * Mirrors the openhealth tables in `packages/db/src/schema/clinical.ts`:
 *
 * - `bloodPanel`           + `bloodMarker`            + `optimalRange`
 *   + `bloodMarkerInfo`     — blood work.
 * - `cardiacExam`           + `cardiacMeasurement`    — cardiac.
 * - `imagingStudy`                                      — imaging.
 * - `consultation`                                     — clinical visits.
 * - `familyHistory`                                    — family history.
 *
 * No PHI is included in the type surface — `report`, `findings`,
 * `diagnosis`, `notes` round-trip as opaque strings the caller owns.
 * Logs never carry them.
 *
 * DEXA scans already live in `@openhealth/body` (Issue #21). This package
 * intentionally does **not** duplicate that surface.
 */

export type OutOfRangeFlag = "HIGH" | "LOW" | "CRITICAL" | null;

export type BloodPanel = {
  id: number;
  organizationId: string;
  date: string;
  context: string | null;
  facility: string | null;
  physician: string | null;
  sourceFile: string | null;
  pdfPath: string | null;
  notes: string | null;
  createdAt: string;
};

export type BloodMarker = {
  id: number;
  organizationId: string;
  panelId: number;
  category: string;
  subcategory: string | null;
  testName: string;
  testKey: string;
  valueNumeric: number | null;
  valueText: string | null;
  unit: string | null;
  refRangeLow: number | null;
  refRangeHigh: number | null;
  refRangeText: string | null;
  flag: string | null;
};

/**
 * Marker + computed out-of-range flag + optional marker info reference.
 * The flag is recomputed against the optimal range from `optimalRange`
 * (`classification = "optimal"`) so the API exposes a stable shape that
 * the future UI can render without recomputing client-side.
 */
export type BloodMarkerWithContext = BloodMarker & {
  outOfRangeFlag: OutOfRangeFlag;
  /** True when the stored `flag` column is `HIGH`/`LOW`/`CRITICAL`. */
  flaggedBySource: boolean;
};

export type OptimalRange = {
  id: number;
  testKey: string;
  source: string;
  rangeLow: number | null;
  rangeHigh: number | null;
  classification: "optimal" | "acceptable" | "standard";
  explanation: string | null;
};

export type BloodMarkerInfo = {
  id: number;
  testKey: string;
  displayName: string;
  category: string;
  description: string | null;
  whyItMatters: string | null;
  higherMeans: string | null;
  lowerMeans: string | null;
  relatedMarkers: string | null;
};

export type BloodPanelWithContext = {
  panel: BloodPanel;
  markers: BloodMarkerWithContext[];
  markerInfos: BloodMarkerInfo[];
  outOfRangeCount: number;
};

export type CardiacExam = {
  id: number;
  organizationId: string;
  date: string;
  type: string;
  facility: string | null;
  physician: string | null;
  reason: string | null;
  report: string | null;
  conclusion: string | null;
  sourceFile: string | null;
  createdAt: string;
};

export type CardiacMeasurement = {
  id: number;
  organizationId: string;
  examId: number;
  name: string;
  value: number | null;
  valueText: string | null;
  unit: string | null;
};

export type CardiacExamWithContext = {
  exam: CardiacExam;
  measurements: CardiacMeasurement[];
};

export type ImagingStudy = {
  id: number;
  organizationId: string;
  date: string;
  type: string;
  bodyPart: string;
  facility: string | null;
  physician: string | null;
  technique: string | null;
  findings: string | null;
  conclusion: string | null;
  sourceFile: string | null;
  createdAt: string;
};

export type Consultation = {
  id: number;
  organizationId: string;
  date: string;
  type: string;
  facility: string | null;
  physician: string | null;
  diagnosis: string | null;
  report: string | null;
  sourceFile: string | null;
  createdAt: string;
};

export type FamilyHistoryEntry = {
  id: number;
  organizationId: string;
  relation: string;
  condition: string;
  ageOfOnset: number | null;
  notes: string | null;
  createdAt: string;
};

/**
 * Family-history entries grouped by relation. Stable order on relation
 * (alphabetical) so callers can render directly.
 */
export type FamilyHistoryByRelation = {
  relation: string;
  entries: FamilyHistoryEntry[];
};

export type MarkerChange = {
  current: number;
  previous: number;
  previousDate: string | null;
  diff: number;
  pct: number | null;
};

export type MarkerComparison = {
  testKey: string;
  testName: string;
  value1: number | null;
  value2: number | null;
  unit: string;
  change: number | null;
  changePct: number | null;
};
