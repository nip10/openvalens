import { createHash } from "node:crypto";

/** Stable SHA-256 over JSON payloads; callers normalize before invoking. */
export function workoutOperationFingerprint(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/** Advisory lock namespace shared by workout/routine mutation receipts. */
export function workoutOperationLockKey(
  organizationId: string,
  userId: string,
  mutationId: string,
): string {
  return `workout-operation:${organizationId}:${userId}:${mutationId.toLowerCase()}`;
}
