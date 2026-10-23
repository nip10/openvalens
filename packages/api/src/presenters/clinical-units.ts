/**
 * Display-only conversion of lab concentration units (#67). The member picks
 * how concentrations are shown; the stored value and its reported unit never
 * change. Pure TypeScript, no imports — safe for the app bundle.
 *
 * Conversion happens only for analytes with a fixed molar factor, and only
 * when the stored unit is one of the pair. Anything else (an unknown analyte,
 * an unusual unit, HbA1c in %) is shown exactly as reported.
 */

export const LAB_UNIT_CHOICES = ["as_reported", "mg_dl", "mmol_l"] as const;
export type LabUnitChoice = (typeof LAB_UNIT_CHOICES)[number];

/** mg/dL per 1 mmol/L (or per 1 µmol/L for creatinine) for each convertible analyte. */
const MG_DL_PER_MOLAR: Readonly<Record<string, { factor: number; molar: "mmol/L" | "µmol/L" }>> =
  Object.freeze({
    // Glucose, 180.16 g/mol.
    glucose: { factor: 18.016, molar: "mmol/L" },
    // Cholesterol fractions, 386.65 g/mol.
    total_cholesterol: { factor: 38.67, molar: "mmol/L" },
    cholesterol: { factor: 38.67, molar: "mmol/L" },
    ldl: { factor: 38.67, molar: "mmol/L" },
    hdl: { factor: 38.67, molar: "mmol/L" },
    non_hdl: { factor: 38.67, molar: "mmol/L" },
    // Triglycerides as triolein, 885.7 g/mol.
    triglycerides: { factor: 88.57, molar: "mmol/L" },
    // Creatinine, 113.12 g/mol: 1 mg/dL = 88.42 µmol/L.
    creatinine: { factor: 1 / 88.42, molar: "µmol/L" },
  });

function analyteKey(code: string): string {
  return code.replace(/^blood_marker_/, "").toLowerCase();
}

function normalizeUnit(unit: string): string {
  const compact = unit.trim().replace(/\s+/g, "").toLowerCase();
  if (compact === "mg/dl") return "mg/dL";
  if (compact === "mmol/l") return "mmol/L";
  if (compact === "µmol/l" || compact === "umol/l" || compact === "μmol/l") return "µmol/L";
  return unit;
}

/**
 * The value and unit to show for one reading under the member's choice. Never
 * mutates its input; for anything not convertible it returns the reading as
 * reported.
 */
export function displayLabValue(
  marker: { code: string; unit: string | null },
  value: number,
  choice: LabUnitChoice,
): { value: number; unit: string | null; converted: boolean } {
  const reported = { value, unit: marker.unit, converted: false };
  if (choice === "as_reported" || marker.unit === null || !Number.isFinite(value)) return reported;
  const spec = MG_DL_PER_MOLAR[analyteKey(marker.code)];
  if (!spec) return reported;
  const unit = normalizeUnit(marker.unit);
  if (choice === "mg_dl" && unit === spec.molar)
    return { value: value * spec.factor, unit: "mg/dL", converted: true };
  if (choice === "mmol_l" && unit === "mg/dL")
    return { value: value / spec.factor, unit: spec.molar, converted: true };
  return reported;
}
