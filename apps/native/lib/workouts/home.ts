/**
 * Issue #402 — pure helpers for the Training home: which routine is next,
 * when it was last done, a time estimate, the week summary and the session
 * card headline. No React or native imports.
 */

export type HomeRoutine = {
  id: number;
  name: string;
  exercises: Array<{ name: string; targetSets: number; restSeconds: number }>;
};

export type HomeWorkout = {
  id: number;
  date: string;
  type: string;
  duration: number | null;
  routineId?: number | null;
  routineSnapshot?: { name?: string } | null;
  exercises: Array<{
    name: string;
    sets: Array<{ reps: number | null; weightKg?: number | null }>;
  }>;
  prs?: unknown[];
};

const byDateDesc = (a: HomeWorkout, b: HomeWorkout) => b.date.localeCompare(a.date) || b.id - a.id;

/**
 * The next routine in order: the one after the routine done most recently,
 * wrapping round; the first routine when none has been done yet.
 */
export function nextRoutine<R extends HomeRoutine>(
  routines: readonly R[],
  workouts: readonly HomeWorkout[],
): R | null {
  if (routines.length === 0) return null;
  const ids = new Set(routines.map((routine) => routine.id));
  const last = [...workouts]
    .sort(byDateDesc)
    .find((w) => w.routineId != null && ids.has(w.routineId));
  if (!last) return routines[0]!;
  const index = routines.findIndex((routine) => routine.id === last.routineId);
  return routines[(index + 1) % routines.length]!;
}

/** The date the routine was last done, or null. */
export function lastDone(routineId: number, workouts: readonly HomeWorkout[]): string | null {
  return [...workouts].sort(byDateDesc).find((w) => w.routineId === routineId)?.date ?? null;
}

/** Whole days between two `YYYY-MM-DD` dates (calendar days, no time zone drift). */
export function daysBetween(from: string, to: string): number {
  const day = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  return Math.round((day(to) - day(from)) / 86_400_000);
}

/**
 * Rough minutes for a routine: about 45 s of work per set plus its rest,
 * rounded to 5 minutes. Shown as "about", never as a promise.
 */
export function estimateMinutes(routine: HomeRoutine): number {
  const seconds = routine.exercises.reduce(
    (sum, exercise) => sum + exercise.targetSets * (45 + Math.max(0, exercise.restSeconds)),
    0,
  );
  return Math.max(5, Math.round(seconds / 300) * 5);
}

export function workoutVolumeKg(workout: Pick<HomeWorkout, "exercises">): number {
  return workout.exercises.reduce(
    (total, exercise) =>
      total + exercise.sets.reduce((sum, set) => sum + (set.weightKg ?? 0) * (set.reps ?? 0), 0),
    0,
  );
}

/** Monday of the week that contains `today` (ISO week). */
export function weekStart(today: string): string {
  const date = new Date(`${today}T00:00:00Z`);
  const offset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
  return date.toISOString().slice(0, 10);
}

export function weekSummary(
  workouts: readonly HomeWorkout[],
  today: string,
): { sessions: number; minutes: number; volumeKg: number } {
  const start = weekStart(today);
  const inWeek = workouts.filter((w) => w.date >= start && w.date <= today);
  return {
    sessions: inWeek.length,
    minutes: inWeek.reduce((sum, w) => sum + (w.duration ?? 0), 0),
    volumeKg: inWeek.reduce((sum, w) => sum + workoutVolumeKg(w), 0),
  };
}

/** "3 × Back squat" lines for a session card: the first exercises with set counts. */
export function sessionLines(
  workout: Pick<HomeWorkout, "exercises">,
  max = 3,
): { lines: Array<{ sets: number; name: string }>; more: number } {
  const lines = workout.exercises
    .slice(0, max)
    .map((exercise) => ({ sets: exercise.sets.length, name: exercise.name }));
  return { lines, more: Math.max(0, workout.exercises.length - max) };
}

/** Routine name for sessions started from a routine; null otherwise (the caller labels the type). */
export function sessionTitle(workout: Pick<HomeWorkout, "routineSnapshot">): string | null {
  const name = workout.routineSnapshot?.name?.trim();
  return name ? name : null;
}
