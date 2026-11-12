import type { SleepSessionInput } from "./types";

/**
 * Manual sleep sessions (#440). A member can type in a night (bedtime, wake
 * time, optional quality 1–5). It is stored as its own `sleep_session` event
 * whose payload carries `entryMode: "manual"`; it never overwrites or merges
 * into a device session.
 *
 * When a manual session overlaps any device session, the device data wins:
 * the manual one is left out of every total and shown as a possible duplicate.
 * Pure — no DB calls.
 */

export const MANUAL_SLEEP_ENTRY_MODE = "manual";
export const MANUAL_SLEEP_SOURCE_APP = "manual";

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_VALID_DURATION_MS = 10 * 60 * 1000;

/** Whether a `sleep_session` payload was typed in by the member. */
export function isManualSleepPayload(payload: unknown): boolean {
  return (
    !!payload &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    (payload as Record<string, unknown>).entryMode === MANUAL_SLEEP_ENTRY_MODE
  );
}

function window(session: SleepSessionInput): { start: number; end: number } | null {
  if (!session.end) return null;
  const start = new Date(session.start).getTime();
  const end = new Date(session.end).getTime();
  const duration = end - start;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (duration < MIN_VALID_DURATION_MS || duration > DAY_MS) return null;
  return { start, end };
}

/**
 * Ids of the manual sessions that overlap a device session (by any amount).
 * These are possible duplicates and never count in totals.
 */
export function manualSleepDuplicateIds(sessions: readonly SleepSessionInput[]): Set<string> {
  const device = sessions
    .filter((session) => !session.manual)
    .map(window)
    .filter((value): value is { start: number; end: number } => value !== null);
  const duplicates = new Set<string>();
  for (const session of sessions) {
    if (!session.manual) continue;
    const own = window(session);
    if (!own) continue;
    if (device.some((other) => own.start < other.end && other.start < own.end))
      duplicates.add(session.id);
  }
  return duplicates;
}

/** The sessions that count: every device session, and manual ones with no device overlap. */
export function countedSleepSessions<T extends SleepSessionInput>(sessions: readonly T[]): T[] {
  const duplicates = manualSleepDuplicateIds(sessions);
  return sessions.filter((session) => !duplicates.has(session.id));
}
