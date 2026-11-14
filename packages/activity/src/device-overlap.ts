import type { Database } from "@openvalens/db";
import { ownOrUnattributed } from "@openvalens/db/member-private";
import { healthEvent } from "@openvalens/db/schema/health-record";
import { and, eq, gte, isNull, lt, sql } from "drizzle-orm";

/**
 * Device data wins (#439, M2). A workout an AI app logs is a manual session:
 * it never replaces or merges into a device workout. An AI workout has a day
 * and an optional duration but no time of day, so it is a possible duplicate
 * when a device or imported workout of the same member starts on the same
 * local day and, when both durations are known, lasts about as long: within
 * 15 minutes or a quarter of the longer one, whichever is more. With a
 * duration missing on either side, the same day is enough. The workout type
 * is not compared, as platform workout types do not map one to one onto the
 * app's.
 */
export const WORKOUT_DURATION_TOLERANCE_MINUTES = 15;
export const WORKOUT_DURATION_TOLERANCE_RATIO = 0.25;

const DAY_MS = 86_400_000;

/** Whether two workout durations (minutes) are close enough to be one session. */
export function similarWorkoutDuration(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return true;
  const tolerance = Math.max(
    WORKOUT_DURATION_TOLERANCE_MINUTES,
    Math.max(a, b) * WORKOUT_DURATION_TOLERANCE_RATIO,
  );
  return Math.abs(a - b) <= tolerance;
}

/** The calendar day of an instant in a time zone, falling back to UTC for an unknown zone. */
export function workoutLocalDate(instant: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(instant);
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    return instant.toISOString().slice(0, 10);
  }
}

/** A device workout's minutes from its start and `endAt`; implausible or missing is unknown. */
export function deviceWorkoutMinutes(start: Date, endAt: string | null): number | null {
  const end = endAt ? Date.parse(endAt) : Number.NaN;
  const minutes = Math.round((end - start.getTime()) / 60_000);
  return Number.isFinite(minutes) && minutes > 0 && minutes <= 1440 ? minutes : null;
}

/**
 * Whether a device or imported workout (`health_event` of type `workout`, not
 * superseded, not a manual entry) of the member, or a legacy one with no
 * author, matches a session on `date` (YYYY-MM-DD in `timeZone`) lasting
 * `durationMinutes`.
 */
export async function overlapsDeviceWorkout(
  db: Database,
  input: {
    organizationId: string;
    userId: string;
    date: string;
    timeZone: string;
    durationMinutes: number | null;
  },
): Promise<boolean> {
  // A day either side covers every UTC offset; the local day is checked below.
  const day = Date.parse(`${input.date}T00:00:00.000Z`);
  const rows = await db
    .select({
      eventAt: healthEvent.eventAt,
      endAt: sql<string | null>`${healthEvent.payloadJson} ->> 'endAt'`,
    })
    .from(healthEvent)
    .where(
      and(
        eq(healthEvent.organizationId, input.organizationId),
        ownOrUnattributed(healthEvent.userId, input.userId),
        eq(healthEvent.eventType, "workout"),
        isNull(healthEvent.supersededAt),
        sql`coalesce(${healthEvent.payloadJson} ->> 'entryMode', '') <> 'manual'`,
        gte(healthEvent.eventAt, new Date(day - DAY_MS)),
        lt(healthEvent.eventAt, new Date(day + 2 * DAY_MS)),
      ),
    );
  return rows.some(
    (row) =>
      workoutLocalDate(row.eventAt, input.timeZone) === input.date &&
      similarWorkoutDuration(input.durationMinutes, deviceWorkoutMinutes(row.eventAt, row.endAt)),
  );
}
