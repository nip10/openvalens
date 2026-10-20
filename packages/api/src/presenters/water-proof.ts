/** Client-safe validation for persisted water reconciliation proof metadata. */
const DEFINITELY_REJECTED_CODES = new Set([
  "BAD_REQUEST",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "PRECONDITION_FAILED",
]);

export function hasValidWaterConflictReceipt(
  conflict: unknown,
  marker: unknown,
  operationTargetId?: unknown,
): boolean {
  if (marker !== "CONFLICT" || !conflict || typeof conflict !== "object") return false;
  const receipt = conflict as Record<string, unknown>;
  return (
    Number.isSafeInteger(receipt.id) &&
    (receipt.id as number) > 0 &&
    Number.isSafeInteger(receipt.revision) &&
    (receipt.revision as number) > 0 &&
    (receipt.quantityMl === null ||
      (typeof receipt.quantityMl === "number" &&
        Number.isFinite(receipt.quantityMl) &&
        receipt.quantityMl > 0 &&
        receipt.quantityMl < 10_000_000)) &&
    typeof receipt.deleted === "boolean" &&
    (operationTargetId === undefined || receipt.id === operationTargetId)
  );
}

export function hasAuthoritativeWaterNonApplication(item: {
  conflict?: unknown;
  lastErrorCode?: unknown;
  attempts?: unknown;
  operationTargetId?: unknown;
}): boolean {
  if (hasValidWaterConflictReceipt(item.conflict, item.lastErrorCode, item.operationTargetId))
    return true;
  return (
    item.conflict === null &&
    item.attempts === 1 &&
    typeof item.lastErrorCode === "string" &&
    DEFINITELY_REJECTED_CODES.has(item.lastErrorCode)
  );
}
