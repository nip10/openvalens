import { useLingui as useLinguiRuntime } from "@lingui/react";
import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ActivityIntensityOption } from "@openvalens/api/activity-load-contract";
import { ACTIVITY_INTENSITIES } from "@openvalens/api/activity-load-contract";
import {
  canRateEffortToday,
  EFFORT_QUESTION,
  EFFORT_RATING_OPTIONS,
  effortRatingLabel,
  INTENSITY_DESCRIPTIONS,
  INTENSITY_LABELS,
  sessionEffortText,
} from "@openvalens/api/presenters/activity-load";
import {
  GOAL_DIRECTION_OPTIONS,
  GOAL_PRIORITY_OPTIONS,
  goalDirectionLabel,
  goalMeasurementFields,
  goalPriorityLabel,
  goalStatusLabel,
  summarizeGoals,
  type GoalDirectionOption,
  type GoalPriorityOption,
  summarizeWorkouts,
  workoutDurationLabel,
  workoutTypeLabel,
  workoutTypeRecordName,
} from "@openvalens/api/presenters/workouts";
import { Button } from "@openvalens/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@openvalens/ui/components/card";
import { Input } from "@openvalens/ui/components/input";
import { Label } from "@openvalens/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@openvalens/ui/components/select";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { Textarea } from "@openvalens/ui/components/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";

import { ActivityLoadCard } from "@/components/activity-load-panel";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/workouts")({
  component: WorkoutsPage,
});

const WORKOUT_TYPES = ["weights", "running", "cycling", "swimming", "tennis", "other"] as const;
type WorkoutType = (typeof WORKOUT_TYPES)[number];

const GOAL_STATUSES = ["not_started", "in_progress", "achieved", "paused", "cancelled"] as const;
type GoalStatus = (typeof GOAL_STATUSES)[number];

const MAX_DURATION_MINUTES = 1440;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Whole minutes in [1, 1440], or null when blank/invalid. */
function parseDurationMinutes(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > MAX_DURATION_MINUTES) return null;
  return parsed;
}

/** "" = not set; the select's value round-trips as a string. */
const NOT_SET = "none";

function parseEffort(value: string): number | null {
  const parsed = Number(value);
  return value !== NOT_SET && Number.isInteger(parsed) && parsed >= 0 && parsed <= 10
    ? parsed
    : null;
}

function EffortSelect({
  value,
  onChange,
  id,
}: {
  value: string;
  onChange: (next: string) => void;
  id?: string;
}) {
  const { t, i18n } = useLingui();
  return (
    <Select value={value} onValueChange={(next) => onChange(String(next))}>
      <SelectTrigger id={id} aria-label={i18n._(EFFORT_QUESTION)}>
        <SelectValue>
          {value === NOT_SET ? t`Not rated` : effortRatingLabel(Number(value), i18n)}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NOT_SET}>
          <Trans>Not rated</Trans>
        </SelectItem>
        {EFFORT_RATING_OPTIONS.map((rating) => (
          <SelectItem key={rating} value={String(rating)}>
            {effortRatingLabel(rating, i18n)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Issue #99 — add a missing effort rating later the same day. */
function RateEffort({ workoutId, onSaved }: { workoutId: number; onSaved: () => void }) {
  const [value, setValue] = useState(NOT_SET);
  const rate = useMutation(
    orpc.plans.workouts.rateEffort.mutationOptions({ onSuccess: () => onSaved() }),
  );
  const rating = parseEffort(value);
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (rating !== null) rate.mutate({ id: workoutId, effortRating: rating });
      }}
    >
      <EffortSelect value={value} onChange={setValue} />
      <Button
        type="submit"
        size="sm"
        variant="outline"
        disabled={rating === null || rate.isPending}
      >
        <Trans>Rate</Trans>
      </Button>
      {rate.isError ? (
        <span className="text-xs text-destructive">
          <Trans>Could not save.</Trans>
        </span>
      ) : null}
    </form>
  );
}

function AddWorkoutForm({ onSaved }: { onSaved: () => void }) {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  const [type, setType] = useState<WorkoutType>("weights");
  const [date, setDate] = useState(todayIso);
  const [duration, setDuration] = useState("");
  const [notes, setNotes] = useState("");
  // Issue #99 — both optional; left unset they are shown as missing, never guessed.
  const [intensity, setIntensity] = useState<ActivityIntensityOption | null>(null);
  const [effort, setEffort] = useState(NOT_SET);

  const save = useMutation(
    orpc.plans.workouts.upsertWorkout.mutationOptions({
      onSuccess: () => {
        setDuration("");
        setNotes("");
        setDate(todayIso());
        setIntensity(null);
        setEffort(NOT_SET);
        onSaved();
      },
    }),
  );

  const parsedDuration = parseDurationMinutes(duration);
  const durationInvalid = duration.trim().length > 0 && parsedDuration === null;
  const dateMissing = date.trim().length === 0;

  const submit = () => {
    if (dateMissing || durationInvalid) return;
    save.mutate({
      date,
      type,
      duration: parsedDuration,
      notes: notes.trim().length > 0 ? notes.trim() : null,
      intensity,
      effortRating: parseEffort(effort),
      // `upsertWorkout` requires at least one exercise with one set; the
      // session header is what this form captures, so we seed a single
      // placeholder set the user can refine later.
      exercises: [{ name: workoutTypeRecordName(type), notes: null, sets: [{ reps: 1 }] }],
    });
  };

  return (
    <div className="grid gap-4 rounded-lg border border-border p-4 sm:grid-cols-2">
      <div className="grid gap-2">
        <Label className="text-sm font-medium">
          <Trans>Type</Trans>
        </Label>
        <Select
          value={type}
          onValueChange={(next) => {
            if (WORKOUT_TYPES.includes(next as WorkoutType)) setType(next as WorkoutType);
          }}
        >
          <SelectTrigger>
            <SelectValue>{_(workoutTypeLabel(type))}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {WORKOUT_TYPES.map((value) => (
              <SelectItem key={value} value={value}>
                {_(workoutTypeLabel(value))}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label className="text-sm font-medium">
          <Trans>Date</Trans>
        </Label>
        <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
      </div>
      <div className="grid gap-2">
        <Label className="text-sm font-medium">
          <Trans>Duration (minutes)</Trans>
        </Label>
        <Input
          inputMode="numeric"
          value={duration}
          onChange={(event) => setDuration(event.target.value)}
          placeholder="45"
        />
      </div>
      <div className="grid gap-2">
        <Label className="text-sm font-medium" htmlFor="workout-intensity">
          <Trans>Intensity (optional)</Trans>
        </Label>
        <Select
          value={intensity ?? NOT_SET}
          onValueChange={(next) => {
            const value = String(next);
            setIntensity(
              ACTIVITY_INTENSITIES.includes(value as ActivityIntensityOption)
                ? (value as ActivityIntensityOption)
                : null,
            );
          }}
        >
          <SelectTrigger id="workout-intensity">
            <SelectValue>{intensity ? _(INTENSITY_LABELS[intensity]) : t`Not set`}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NOT_SET}>
              <Trans>Not set</Trans>
            </SelectItem>
            {ACTIVITY_INTENSITIES.map((value) => (
              <SelectItem key={value} value={value}>
                {_(INTENSITY_LABELS[value])} — {_(INTENSITY_DESCRIPTIONS[value])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label className="text-sm font-medium" htmlFor="workout-effort">
          <Trans>Effort, 0–10 (optional)</Trans>
        </Label>
        <EffortSelect id="workout-effort" value={effort} onChange={setEffort} />
        <span className="text-xs text-muted-foreground">
          {_(EFFORT_QUESTION)} <Trans>You can also add it later today.</Trans>
        </span>
      </div>
      <div className="grid gap-2 sm:col-span-2">
        <Label className="text-sm font-medium">
          <Trans>Notes</Trans>
        </Label>
        <Textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder={t`How did it go?`}
        />
      </div>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button onClick={submit} disabled={dateMissing || durationInvalid || save.isPending}>
          {save.isPending ? t`Saving…` : t`Save`}
        </Button>
        {durationInvalid ? (
          <span className="text-sm text-destructive">
            <Trans>Duration must be 1–1440 minutes.</Trans>
          </span>
        ) : save.isSuccess ? (
          <span className="text-sm text-success">
            <Trans>Saved</Trans>
          </span>
        ) : save.isError ? (
          <span className="text-sm text-destructive">
            <Trans>Could not save.</Trans>
          </span>
        ) : null}
      </div>
    </div>
  );
}

function AddGoalForm({ onSaved }: { onSaved: () => void }) {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  const [title, setTitle] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [status, setStatus] = useState<GoalStatus>("not_started");
  // Issue #95 — optional measurement so goal progress can be calculated.
  const [startValue, setStartValue] = useState("");
  const [targetValue, setTargetValue] = useState("");
  const [direction, setDirection] = useState<GoalDirectionOption | null>(null);
  const [priority, setPriority] = useState<GoalPriorityOption>("normal");

  const save = useMutation(
    orpc.plans.goals.upsertGoal.mutationOptions({
      onSuccess: () => {
        setTitle("");
        setTargetDate("");
        setStatus("not_started");
        setStartValue("");
        setTargetValue("");
        setDirection(null);
        setPriority("normal");
        onSaved();
      },
    }),
  );

  const titleMissing = title.trim().length === 0;
  const measurement = goalMeasurementFields({ startValue, targetValue, direction, priority });

  const submit = () => {
    if (titleMissing || !measurement.ok) return;
    save.mutate({
      title: title.trim(),
      // `upsertGoal` requires a category; goals created here default to
      // the general health category.
      category: "health",
      targetDate: targetDate.trim().length > 0 ? targetDate : null,
      status,
      ...measurement.fields,
    });
  };

  return (
    <div className="grid gap-4 rounded-lg border border-border p-4 sm:grid-cols-2">
      <div className="grid gap-2 sm:col-span-2">
        <Label className="text-sm font-medium">
          <Trans>Title</Trans>
        </Label>
        <Input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={t`Run a 5k`}
        />
      </div>
      <div className="grid gap-2">
        <Label className="text-sm font-medium">
          <Trans>Due date</Trans>
        </Label>
        <Input
          type="date"
          value={targetDate}
          onChange={(event) => setTargetDate(event.target.value)}
        />
      </div>
      <div className="grid gap-2">
        <Label className="text-sm font-medium">
          <Trans>Status</Trans>
        </Label>
        <Select
          value={status}
          onValueChange={(next) => {
            if (GOAL_STATUSES.includes(next as GoalStatus)) setStatus(next as GoalStatus);
          }}
        >
          <SelectTrigger>
            <SelectValue>{_(goalStatusLabel(status))}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {GOAL_STATUSES.map((value) => (
              <SelectItem key={value} value={value}>
                {_(goalStatusLabel(value))}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label className="text-sm font-medium" htmlFor="goal-start-value">
          <Trans>Starting value (optional)</Trans>
        </Label>
        <Input
          id="goal-start-value"
          value={startValue}
          onChange={(event) => setStartValue(event.target.value)}
          placeholder="80 kg"
        />
      </div>
      <div className="grid gap-2">
        <Label className="text-sm font-medium" htmlFor="goal-target-value">
          <Trans>Target (optional)</Trans>
        </Label>
        <Input
          id="goal-target-value"
          value={targetValue}
          onChange={(event) => setTargetValue(event.target.value)}
          placeholder="75 kg"
        />
      </div>
      <div className="grid gap-2">
        <Label className="text-sm font-medium">
          <Trans>Progress means the value should</Trans>
        </Label>
        <Select
          value={direction ?? ""}
          onValueChange={(next) => {
            if (GOAL_DIRECTION_OPTIONS.includes(next as GoalDirectionOption))
              setDirection(next as GoalDirectionOption);
          }}
        >
          <SelectTrigger>
            <SelectValue>{direction ? _(goalDirectionLabel(direction)) : t`Choose`}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {GOAL_DIRECTION_OPTIONS.map((value) => (
              <SelectItem key={value} value={value}>
                {_(goalDirectionLabel(value))}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label className="text-sm font-medium">
          <Trans>Priority</Trans>
        </Label>
        <Select
          value={priority}
          onValueChange={(next) => {
            if (GOAL_PRIORITY_OPTIONS.includes(next as GoalPriorityOption))
              setPriority(next as GoalPriorityOption);
          }}
        >
          <SelectTrigger>
            <SelectValue>{_(goalPriorityLabel(priority))}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {GOAL_PRIORITY_OPTIONS.map((value) => (
              <SelectItem key={value} value={value}>
                {_(goalPriorityLabel(value))}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <Button onClick={submit} disabled={titleMissing || !measurement.ok || save.isPending}>
          {save.isPending ? t`Saving…` : t`Save`}
        </Button>
        {!measurement.ok ? (
          <span className="text-sm text-destructive" role="alert">
            {_(measurement.error)}
          </span>
        ) : save.isSuccess ? (
          <span className="text-sm text-success">
            <Trans>Saved</Trans>
          </span>
        ) : save.isError ? (
          <span className="text-sm text-destructive">
            <Trans>Could not save.</Trans>
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** Issue #95 — record today's value for a goal; the latest value becomes its current value. */
function LogGoalValue({ goalId, onSaved }: { goalId: number; onSaved: () => void }) {
  const { t } = useLingui();
  const [value, setValue] = useState("");
  const log = useMutation(
    orpc.plans.goals.upsertCheckin.mutationOptions({
      onSuccess: () => {
        setValue("");
        onSaved();
      },
    }),
  );
  const trimmed = value.trim();
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmed.length === 0) return;
        log.mutate({ goalId, date: todayIso(), value: trimmed });
      }}
    >
      <Input
        aria-label={t`Today's value`}
        className="h-8 w-28"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={t`Today`}
        maxLength={80}
      />
      <Button type="submit" size="sm" variant="outline" disabled={!trimmed || log.isPending}>
        <Trans>Log</Trans>
      </Button>
      {log.isError ? (
        <span className="text-xs text-destructive">
          <Trans>Could not save.</Trans>
        </span>
      ) : null}
    </form>
  );
}

function WorkoutsPage() {
  const { t, i18n } = useLingui();
  const { _ } = useLinguiRuntime();
  const queryClient = useQueryClient();
  const workouts = useQuery(
    orpc.plans.workouts.listWorkouts.queryOptions({ input: { limit: 50 } }),
  );
  const goals = useQuery(orpc.plans.goals.listGoals.queryOptions({ input: {} }));
  const load = useQuery({
    ...orpc.activity.weeklyLoad.queryOptions({ input: {} }),
    staleTime: 60_000,
  });

  const reloadWorkouts = () => {
    void queryClient.invalidateQueries({ queryKey: [["plans", "workouts", "listWorkouts"]] });
    void queryClient.invalidateQueries({ queryKey: orpc.activity.weeklyLoad.key() });
  };
  const reloadGoals = () => {
    void queryClient.invalidateQueries({ queryKey: [["plans", "goals", "listGoals"]] });
    void queryClient.invalidateQueries({ queryKey: orpc.score.key() });
  };

  const workoutSummary = summarizeWorkouts(workouts.data ?? []);
  const goalSummary = summarizeGoals(goals.data ?? []);

  return (
    <div className="container mx-auto grid max-w-3xl gap-6 px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">
          <Trans>Workouts</Trans>
        </h1>
        <Link to="/exercise-library" className="text-sm underline">
          <Trans>Exercise library</Trans>
        </Link>
      </div>

      {load.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : load.isError || !load.data ? (
        <p className="text-sm text-muted-foreground">
          <Trans>Could not load weekly activity.</Trans>{" "}
          <button className="underline" onClick={() => void load.refetch()}>
            <Trans>Retry</Trans>
          </button>
        </p>
      ) : (
        <ActivityLoadCard result={load.data} />
      )}

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>
            <Trans>Workouts</Trans>
          </CardTitle>
          {workoutSummary.count > 0 ? (
            <span className="text-sm text-muted-foreground">
              {t`${plural(workoutSummary.count, { one: "# session", other: "# sessions" })} · ${workoutSummary.totalDurationLabel}`}
            </span>
          ) : null}
        </CardHeader>
        <CardContent className="grid gap-4">
          <AddWorkoutForm onSaved={reloadWorkouts} />

          {workouts.isPending ? (
            <Skeleton className="h-32 w-full" />
          ) : workouts.isError || !workouts.data ? (
            <p className="text-sm text-muted-foreground">
              <Trans>Could not load workouts.</Trans>{" "}
              <button className="underline" onClick={() => void workouts.refetch()}>
                <Trans>Retry</Trans>
              </button>
            </p>
          ) : workouts.data.length === 0 ? (
            <div className="py-6 text-center">
              <p className="font-medium">
                <Trans>No workouts yet</Trans>
              </p>
              <p className="text-sm text-muted-foreground">
                <Trans>Add a session to start tracking.</Trans>
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {workouts.data.map((workout) => (
                <li
                  key={workout.id}
                  className="flex flex-wrap items-center justify-between gap-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{_(workoutTypeLabel(workout.type))}</div>
                    <div className="text-sm text-muted-foreground">
                      {workout.date}
                      {workout.notes ? ` · ${workout.notes}` : ""}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {sessionEffortText(workout, i18n)}
                    </div>
                  </div>
                  <div className="shrink-0 font-mono text-sm">
                    {workoutDurationLabel(workout.duration)}
                  </div>
                  {workout.effortRating === null && canRateEffortToday(workout.date, todayIso()) ? (
                    <RateEffort workoutId={workout.id} onSaved={reloadWorkouts} />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>
            <Trans>Goals</Trans>
          </CardTitle>
          {goalSummary.total > 0 ? (
            <span className="text-sm text-muted-foreground">
              <Trans>
                {goalSummary.open} open · {goalSummary.achieved} achieved
              </Trans>
            </span>
          ) : null}
        </CardHeader>
        <CardContent className="grid gap-4">
          <AddGoalForm onSaved={reloadGoals} />

          {goals.isPending ? (
            <Skeleton className="h-32 w-full" />
          ) : goals.isError || !goals.data ? (
            <p className="text-sm text-muted-foreground">
              <Trans>Could not load goals.</Trans>{" "}
              <button className="underline" onClick={() => void goals.refetch()}>
                <Trans>Retry</Trans>
              </button>
            </p>
          ) : goals.data.length === 0 ? (
            <div className="py-6 text-center">
              <p className="font-medium">
                <Trans>No goals yet</Trans>
              </p>
              <p className="text-sm text-muted-foreground">
                <Trans>Add a goal to start tracking.</Trans>
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {goals.data.map((goal) => (
                <li
                  key={goal.id}
                  className="flex flex-wrap items-center justify-between gap-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{goal.title}</div>
                    <div className="text-sm text-muted-foreground">
                      {goal.targetDate ? t`Due ${goal.targetDate}` : t`No due date`}
                      {goal.targetValue ? ` · ${t`Target ${goal.targetValue}`}` : ""}
                      {goal.currentValue ? ` · ${t`Now ${goal.currentValue}`}` : ""}
                    </div>
                  </div>
                  <div className="shrink-0 text-sm text-muted-foreground">
                    {_(goalStatusLabel(goal.status))}
                  </div>
                  <LogGoalValue goalId={goal.id} onSaved={reloadGoals} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
