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
import { createFileRoute } from "@tanstack/react-router";
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
  return (
    <Select value={value} onValueChange={(next) => onChange(String(next))}>
      <SelectTrigger id={id} aria-label={EFFORT_QUESTION}>
        <SelectValue>
          {value === NOT_SET ? "Not rated" : effortRatingLabel(Number(value))}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NOT_SET}>Not rated</SelectItem>
        {EFFORT_RATING_OPTIONS.map((rating) => (
          <SelectItem key={rating} value={String(rating)}>
            {effortRatingLabel(rating)}
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
        Rate
      </Button>
      {rate.isError ? <span className="text-xs text-destructive">Could not save.</span> : null}
    </form>
  );
}

function AddWorkoutForm({ onSaved }: { onSaved: () => void }) {
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
      exercises: [{ name: workoutTypeLabel(type), notes: null, sets: [{ reps: 1 }] }],
    });
  };

  return (
    <div className="grid gap-4 rounded-lg border border-border p-4 sm:grid-cols-2">
      <div className="grid gap-2">
        <Label className="text-sm font-medium">Type</Label>
        <Select
          value={type}
          onValueChange={(next) => {
            if (WORKOUT_TYPES.includes(next as WorkoutType)) setType(next as WorkoutType);
          }}
        >
          <SelectTrigger>
            <SelectValue>{workoutTypeLabel(type)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {WORKOUT_TYPES.map((value) => (
              <SelectItem key={value} value={value}>
                {workoutTypeLabel(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label className="text-sm font-medium">Date</Label>
        <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
      </div>
      <div className="grid gap-2">
        <Label className="text-sm font-medium">Duration (minutes)</Label>
        <Input
          inputMode="numeric"
          value={duration}
          onChange={(event) => setDuration(event.target.value)}
          placeholder="45"
        />
      </div>
      <div className="grid gap-2">
        <Label className="text-sm font-medium" htmlFor="workout-intensity">
          Intensity (optional)
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
            <SelectValue>{intensity ? INTENSITY_LABELS[intensity] : "Not set"}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NOT_SET}>Not set</SelectItem>
            {ACTIVITY_INTENSITIES.map((value) => (
              <SelectItem key={value} value={value}>
                {INTENSITY_LABELS[value]} — {INTENSITY_DESCRIPTIONS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label className="text-sm font-medium" htmlFor="workout-effort">
          Effort, 0–10 (optional)
        </Label>
        <EffortSelect id="workout-effort" value={effort} onChange={setEffort} />
        <span className="text-xs text-muted-foreground">
          {EFFORT_QUESTION} You can also add it later today.
        </span>
      </div>
      <div className="grid gap-2 sm:col-span-2">
        <Label className="text-sm font-medium">Notes</Label>
        <Textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="How did it go?"
        />
      </div>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button onClick={submit} disabled={dateMissing || durationInvalid || save.isPending}>
          {save.isPending ? "Saving…" : "Save"}
        </Button>
        {durationInvalid ? (
          <span className="text-sm text-destructive">Duration must be 1–1440 minutes.</span>
        ) : save.isSuccess ? (
          <span className="text-sm text-success">Saved</span>
        ) : save.isError ? (
          <span className="text-sm text-destructive">Could not save.</span>
        ) : null}
      </div>
    </div>
  );
}

function AddGoalForm({ onSaved }: { onSaved: () => void }) {
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
        <Label className="text-sm font-medium">Title</Label>
        <Input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Run a 5k"
        />
      </div>
      <div className="grid gap-2">
        <Label className="text-sm font-medium">Due date</Label>
        <Input
          type="date"
          value={targetDate}
          onChange={(event) => setTargetDate(event.target.value)}
        />
      </div>
      <div className="grid gap-2">
        <Label className="text-sm font-medium">Status</Label>
        <Select
          value={status}
          onValueChange={(next) => {
            if (GOAL_STATUSES.includes(next as GoalStatus)) setStatus(next as GoalStatus);
          }}
        >
          <SelectTrigger>
            <SelectValue>{goalStatusLabel(status)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {GOAL_STATUSES.map((value) => (
              <SelectItem key={value} value={value}>
                {goalStatusLabel(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label className="text-sm font-medium" htmlFor="goal-start-value">
          Starting value (optional)
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
          Target (optional)
        </Label>
        <Input
          id="goal-target-value"
          value={targetValue}
          onChange={(event) => setTargetValue(event.target.value)}
          placeholder="75 kg"
        />
      </div>
      <div className="grid gap-2">
        <Label className="text-sm font-medium">Progress means the value should</Label>
        <Select
          value={direction ?? ""}
          onValueChange={(next) => {
            if (GOAL_DIRECTION_OPTIONS.includes(next as GoalDirectionOption))
              setDirection(next as GoalDirectionOption);
          }}
        >
          <SelectTrigger>
            <SelectValue>{direction ? goalDirectionLabel(direction) : "Choose"}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {GOAL_DIRECTION_OPTIONS.map((value) => (
              <SelectItem key={value} value={value}>
                {goalDirectionLabel(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label className="text-sm font-medium">Priority</Label>
        <Select
          value={priority}
          onValueChange={(next) => {
            if (GOAL_PRIORITY_OPTIONS.includes(next as GoalPriorityOption))
              setPriority(next as GoalPriorityOption);
          }}
        >
          <SelectTrigger>
            <SelectValue>{goalPriorityLabel(priority)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {GOAL_PRIORITY_OPTIONS.map((value) => (
              <SelectItem key={value} value={value}>
                {goalPriorityLabel(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <Button onClick={submit} disabled={titleMissing || !measurement.ok || save.isPending}>
          {save.isPending ? "Saving…" : "Save"}
        </Button>
        {!measurement.ok ? (
          <span className="text-sm text-destructive" role="alert">
            {measurement.error}
          </span>
        ) : save.isSuccess ? (
          <span className="text-sm text-success">Saved</span>
        ) : save.isError ? (
          <span className="text-sm text-destructive">Could not save.</span>
        ) : null}
      </div>
    </div>
  );
}

/** Issue #95 — record today's value for a goal; the latest value becomes its current value. */
function LogGoalValue({ goalId, onSaved }: { goalId: number; onSaved: () => void }) {
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
        aria-label="Today's value"
        className="h-8 w-28"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Today"
        maxLength={80}
      />
      <Button type="submit" size="sm" variant="outline" disabled={!trimmed || log.isPending}>
        Log
      </Button>
      {log.isError ? <span className="text-xs text-destructive">Could not save.</span> : null}
    </form>
  );
}

function WorkoutsPage() {
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
      <h1 className="text-2xl font-semibold">Workouts</h1>

      {load.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : load.isError || !load.data ? (
        <p className="text-sm text-muted-foreground">
          Could not load weekly activity.{" "}
          <button className="underline" onClick={() => void load.refetch()}>
            Retry
          </button>
        </p>
      ) : (
        <ActivityLoadCard result={load.data} />
      )}

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Workouts</CardTitle>
          {workoutSummary.count > 0 ? (
            <span className="text-sm text-muted-foreground">
              {workoutSummary.count} session{workoutSummary.count === 1 ? "" : "s"} ·{" "}
              {workoutSummary.totalDurationLabel}
            </span>
          ) : null}
        </CardHeader>
        <CardContent className="grid gap-4">
          <AddWorkoutForm onSaved={reloadWorkouts} />

          {workouts.isPending ? (
            <Skeleton className="h-32 w-full" />
          ) : workouts.isError || !workouts.data ? (
            <p className="text-sm text-muted-foreground">
              Could not load workouts.{" "}
              <button className="underline" onClick={() => void workouts.refetch()}>
                Retry
              </button>
            </p>
          ) : workouts.data.length === 0 ? (
            <div className="py-6 text-center">
              <p className="font-medium">No workouts yet</p>
              <p className="text-sm text-muted-foreground">Add a session to start tracking.</p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {workouts.data.map((workout) => (
                <li
                  key={workout.id}
                  className="flex flex-wrap items-center justify-between gap-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{workoutTypeLabel(workout.type)}</div>
                    <div className="text-sm text-muted-foreground">
                      {workout.date}
                      {workout.notes ? ` · ${workout.notes}` : ""}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {sessionEffortText(workout)}
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
          <CardTitle>Goals</CardTitle>
          {goalSummary.total > 0 ? (
            <span className="text-sm text-muted-foreground">
              {goalSummary.open} open · {goalSummary.achieved} achieved
            </span>
          ) : null}
        </CardHeader>
        <CardContent className="grid gap-4">
          <AddGoalForm onSaved={reloadGoals} />

          {goals.isPending ? (
            <Skeleton className="h-32 w-full" />
          ) : goals.isError || !goals.data ? (
            <p className="text-sm text-muted-foreground">
              Could not load goals.{" "}
              <button className="underline" onClick={() => void goals.refetch()}>
                Retry
              </button>
            </p>
          ) : goals.data.length === 0 ? (
            <div className="py-6 text-center">
              <p className="font-medium">No goals yet</p>
              <p className="text-sm text-muted-foreground">Add a goal to start tracking.</p>
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
                      {goal.targetDate ? `Due ${goal.targetDate}` : "No due date"}
                      {goal.targetValue ? ` · Target ${goal.targetValue}` : ""}
                      {goal.currentValue ? ` · Now ${goal.currentValue}` : ""}
                    </div>
                  </div>
                  <div className="shrink-0 text-sm text-muted-foreground">
                    {goalStatusLabel(goal.status)}
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
