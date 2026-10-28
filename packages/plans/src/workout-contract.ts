/** Shared mutation contract for authenticated workout and routine writes. */
export type WorkoutMutationMetadata = {
  clientMutationId: string;
  expectedScope: string;
};

export type WorkoutOwnership = "mine" | "legacy";

export function workoutOwnership(
  userId: string | null,
  callerUserId: string,
): WorkoutOwnership | null {
  return userId === null ? "legacy" : userId === callerUserId ? "mine" : null;
}

export function expectedWorkoutScope(userId: string, organizationId: string): string {
  return `${userId}:${organizationId}`;
}
