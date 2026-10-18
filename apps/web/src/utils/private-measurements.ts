export const PRIVATE_MEASUREMENT_KINDS = [
  "weight",
  "waist",
  "hip",
  "neck",
  "chest",
  "upper_arm",
  "thigh",
] as const;

export type PrivateMeasurementKind = (typeof PRIVATE_MEASUREMENT_KINDS)[number];

export const PRIVATE_MEASUREMENT_LABELS: Record<PrivateMeasurementKind, string> = {
  weight: "Weight",
  waist: "Waist",
  hip: "Hip",
  neck: "Neck",
  chest: "Chest",
  upper_arm: "Upper arm",
  thigh: "Thigh",
};

export function unitsForMeasurement(kind: PrivateMeasurementKind): readonly [string, string] {
  return kind === "weight" ? ["kg", "lb"] : ["cm", "in"];
}

/** Hide by default unless the preference is positively confirmed as disabled. */
export function mayShowStoredMeasurementValue(hideNumbers: boolean | undefined): boolean {
  return hideNumbers === false;
}
