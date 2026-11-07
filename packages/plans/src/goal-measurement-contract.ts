import type { GoalDefinition } from "./goal-model";

type MeasurementContract = Pick<GoalDefinition, "source" | "metric" | "unit">;
type DefinitionRevision = { definition: unknown };

const normalizedUnit = (unit: string | null | undefined) => unit ?? null;

export function sameMeasurementContract(
  left: MeasurementContract,
  right: MeasurementContract,
): boolean {
  return (
    left.source === right.source &&
    left.metric === right.metric &&
    normalizedUnit(left.unit) === normalizedUnit(right.unit)
  );
}

/** Return only the newest contiguous run of revisions matching the current contract. */
export function latestMeasurementContractSuffix<T extends DefinitionRevision>(
  revisions: readonly T[],
  current: MeasurementContract,
): T[] {
  let first = revisions.length;
  for (let index = revisions.length - 1; index >= 0; index--) {
    const definition = revisions[index]?.definition;
    if (!isMeasurementContract(definition, current)) break;
    first = index;
  }
  return revisions.slice(first);
}

function isMeasurementContract(value: unknown, current: MeasurementContract): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const definition = value as Record<string, unknown>;
  return (
    definition.source === current.source &&
    definition.metric === current.metric &&
    normalizedUnit(typeof definition.unit === "string" ? definition.unit : null) ===
      normalizedUnit(current.unit)
  );
}
