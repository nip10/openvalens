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

export type PrivateMeasurementSubject = {
  userId: string;
  organizationId: string;
};

export function privateMeasurementQueryKeys(subject: PrivateMeasurementSubject) {
  const scope = [subject.organizationId, subject.userId] as const;
  return {
    preference: ["privateBody", "preference", ...scope] as const,
    list: ["privateBody", "list", ...scope] as const,
  };
}

export function makePrivateMeasurementPayload(input: {
  kind: PrivateMeasurementKind;
  unit: string;
  value: string;
  measuredAtLocal: string;
}) {
  const value = Number(input.value);
  const measuredAt = new Date(input.measuredAtLocal);
  const localParts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(input.measuredAtLocal);
  const validLocalTime = Boolean(
    localParts &&
    Number.isFinite(measuredAt.getTime()) &&
    measuredAt.getFullYear() === Number(localParts[1]) &&
    measuredAt.getMonth() + 1 === Number(localParts[2]) &&
    measuredAt.getDate() === Number(localParts[3]) &&
    measuredAt.getHours() === Number(localParts[4]) &&
    measuredAt.getMinutes() === Number(localParts[5]),
  );
  if (
    !Number.isFinite(value) ||
    value <= 0 ||
    !validLocalTime ||
    !(unitsForMeasurement(input.kind) as readonly string[]).includes(input.unit)
  ) {
    return null;
  }
  return {
    kind: input.kind,
    unit: input.unit as "kg" | "lb" | "cm" | "in",
    value,
    measuredAt: measuredAt.toISOString(),
  };
}

export function nextKindDraft(kind: PrivateMeasurementKind) {
  return { kind, unit: kind === "weight" ? "kg" : "cm", value: "" } as const;
}

export function nextUnitDraft(unit: string) {
  return { unit, value: "" } as const;
}

export function privateMeasurementAccessState(input: {
  identityKnown: boolean;
  preferenceStatus: "pending" | "error" | "success";
  enabled?: boolean;
}): "identity-pending" | "preference-error" | "disabled" | "enabled" {
  if (!input.identityKnown || input.preferenceStatus === "pending") return "identity-pending";
  if (input.preferenceStatus === "error") return "preference-error";
  return input.enabled === true ? "enabled" : "disabled";
}

export function privateMeasurementHistoryState(input: {
  status: "pending" | "error" | "success";
  count?: number;
}): "loading" | "error" | "empty" | "ready" {
  if (input.status === "pending") return "loading";
  if (input.status === "error") return "error";
  return (input.count ?? 0) === 0 ? "empty" : "ready";
}

export function shouldShowPrivateMeasurementDeleteError(input: {
  rowId: string;
  failedRowId: string | null;
  isError: boolean;
}): boolean {
  return input.isError && input.rowId === input.failedRowId;
}
