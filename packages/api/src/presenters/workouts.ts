/**
 * Workouts / goals presentation shared by web and mobile. Pure TypeScript,
 * no imports — safe for the app bundle. Copy follows
 * docs/mobile/tone-of-voice.md: sentence case, activity types as recorded
 * ("Run", "Strength", "Swim"), real units.
 *
 * The workout type and goal status unions live in `@openvalens/plans`; we
 * accept the raw string here so this module stays dependency-free (the
 * presenters bundle must not pull in the DB layer).
 */

const WORKOUT_TYPE_LABELS: Record<string, string> = {
  weights: "Strength",
  running: "Run",
  cycling: "Cycling",
  swimming: "Swim",
  tennis: "Tennis",
  other: "Other",
};

const GOAL_STATUS_LABELS: Record<string, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  achieved: "Achieved",
  paused: "Paused",
  cancelled: "Cancelled",
  // Legacy / free-form aliases kept in the calendar/goal surface.
  open: "Open",
  closed: "Closed",
  archived: "Archived",
};

/** Fallback for values outside the closed enums: "some_value" -> "Some value". */
function sentenceCase(value: string): string {
  const spaced = value.replace(/[_-]+/g, " ").trim();
  if (spaced.length === 0) return "Other";
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/** "Strength" / "Run" / "Swim" — the activity type as recorded. */
export function workoutTypeLabel(value: string): string {
  return WORKOUT_TYPE_LABELS[value] ?? sentenceCase(value);
}

/** "1h 30m" / "45m" / "0m" / "—" when missing or invalid. */
export function workoutDurationLabel(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes) || minutes < 0) {
    return "—";
  }
  const total = Math.round(minutes);
  const hours = Math.floor(total / 60);
  const remainder = total % 60;
  if (hours > 0 && remainder > 0) return `${hours}h ${remainder}m`;
  if (hours > 0) return `${hours}h`;
  return `${remainder}m`;
}

/** "3 exercises" / "1 exercise" / "No exercises". */
export function workoutExerciseCountLabel(count: number): string {
  if (count <= 0) return "No exercises";
  return `${count} exercise${count === 1 ? "" : "s"}`;
}

export type WorkoutLike = {
  id: number;
  date: string;
  type: string;
  duration: number | null;
  notes: string | null;
};

export type WorkoutSummary = {
  count: number;
  totalMinutes: number;
  totalDurationLabel: string;
};

/** Aggregate a workout list for a card header stat. */
export function summarizeWorkouts(workouts: readonly WorkoutLike[]): WorkoutSummary {
  const totalMinutes = workouts.reduce((sum, workout) => sum + (workout.duration ?? 0), 0);
  return {
    count: workouts.length,
    totalMinutes,
    totalDurationLabel: workoutDurationLabel(totalMinutes),
  };
}

/** "Not started" / "In progress" / "Achieved" — sentence-case status. */
export function goalStatusLabel(value: string): string {
  return GOAL_STATUS_LABELS[value] ?? sentenceCase(value);
}

export type GoalLike = {
  id: number;
  title: string;
  status: string;
  targetDate: string | null;
};

export type GoalSummary = {
  total: number;
  open: number;
  achieved: number;
};

const CLOSED_GOAL_STATUSES = new Set(["achieved", "closed", "archived", "cancelled"]);

/** Open vs achieved counts for the goals card. */
export function summarizeGoals(goals: readonly GoalLike[]): GoalSummary {
  let open = 0;
  let achieved = 0;
  for (const goal of goals) {
    if (goal.status === "achieved") achieved += 1;
    if (!CLOSED_GOAL_STATUSES.has(goal.status)) open += 1;
  }
  return { total: goals.length, open, achieved };
}
