import { eq, isNull, or, type AnyColumn, type SQL } from "drizzle-orm";

/**
 * The workout rule (#509) for member-private readings: a member sees their own
 * rows and legacy rows with no author, never another member's.
 *
 * `userId` is the reading member. With none (a job, an export with no
 * subject), only the unattributed legacy rows match.
 */
export function ownOrUnattributed(column: AnyColumn, userId: string | null | undefined): SQL {
  return userId ? (or(eq(column, userId), isNull(column)) as SQL) : isNull(column);
}

/**
 * Metric codes whose samples belong to the member who logged or synced them
 * (#509): weigh-ins, body composition and sleep. Their `metric_sample.user_id`
 * is set on write; every other metric stays workspace-wide (no author), like
 * the `health_event` types outside `MEMBER_PRIVATE_EVENT_TYPES`.
 */
export const MEMBER_PRIVATE_METRIC_CODES = [
  "weight",
  "body_fat",
  "muscle_mass",
  "bone_mass",
  "body_water",
  "sleep_duration",
] as const;

/** Whether a sample of this metric is attributed to its member (#509). */
export function isMemberPrivateMetric(code: string): boolean {
  return (MEMBER_PRIVATE_METRIC_CODES as readonly string[]).includes(code);
}

/**
 * `health_event` types that belong to the member whose device or connection
 * synced them: sleep nights (#509) and device workouts. Their
 * `health_event.user_id` is set on write from the connection's member; older
 * rows with no author stay shared with the workspace.
 */
export const MEMBER_PRIVATE_EVENT_TYPES = ["sleep_session", "workout"] as const;

/** Whether a `health_event` of this type is attributed to its member. */
export function isMemberPrivateEvent(eventType: string): boolean {
  return (MEMBER_PRIVATE_EVENT_TYPES as readonly string[]).includes(eventType);
}
