import {
  goalStatusLabel,
  summarizeGoals,
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

function AddWorkoutForm({ onSaved }: { onSaved: () => void }) {
  const [type, setType] = useState<WorkoutType>("weights");
  const [date, setDate] = useState(todayIso);
  const [duration, setDuration] = useState("");
  const [notes, setNotes] = useState("");

  const save = useMutation(
    orpc.plans.workouts.upsertWorkout.mutationOptions({
      onSuccess: () => {
        setDuration("");
        setNotes("");
        setDate(todayIso());
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

  const save = useMutation(
    orpc.plans.goals.upsertGoal.mutationOptions({
      onSuccess: () => {
        setTitle("");
        setTargetDate("");
        setStatus("not_started");
        onSaved();
      },
    }),
  );

  const titleMissing = title.trim().length === 0;

  const submit = () => {
    if (titleMissing) return;
    save.mutate({
      title: title.trim(),
      // `upsertGoal` requires a category; goals created here default to
      // the general health category.
      category: "health",
      targetDate: targetDate.trim().length > 0 ? targetDate : null,
      status,
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
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button onClick={submit} disabled={titleMissing || save.isPending}>
          {save.isPending ? "Saving…" : "Save"}
        </Button>
        {save.isSuccess ? (
          <span className="text-sm text-success">Saved</span>
        ) : save.isError ? (
          <span className="text-sm text-destructive">Could not save.</span>
        ) : null}
      </div>
    </div>
  );
}

function WorkoutsPage() {
  const queryClient = useQueryClient();
  const workouts = useQuery(
    orpc.plans.workouts.listWorkouts.queryOptions({ input: { limit: 50 } }),
  );
  const goals = useQuery(orpc.plans.goals.listGoals.queryOptions({ input: {} }));

  const reloadWorkouts = () =>
    void queryClient.invalidateQueries({ queryKey: [["plans", "workouts", "listWorkouts"]] });
  const reloadGoals = () =>
    void queryClient.invalidateQueries({ queryKey: [["plans", "goals", "listGoals"]] });

  const workoutSummary = summarizeWorkouts(workouts.data ?? []);
  const goalSummary = summarizeGoals(goals.data ?? []);

  return (
    <div className="container mx-auto grid max-w-3xl gap-6 px-4 py-6">
      <h1 className="text-2xl font-semibold">Workouts</h1>

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
                <li key={workout.id} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{workoutTypeLabel(workout.type)}</div>
                    <div className="text-sm text-muted-foreground">
                      {workout.date}
                      {workout.notes ? ` · ${workout.notes}` : ""}
                    </div>
                  </div>
                  <div className="shrink-0 font-mono text-sm">
                    {workoutDurationLabel(workout.duration)}
                  </div>
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
                <li key={goal.id} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{goal.title}</div>
                    <div className="text-sm text-muted-foreground">
                      {goal.targetDate ? `Due ${goal.targetDate}` : "No due date"}
                    </div>
                  </div>
                  <div className="shrink-0 text-sm text-muted-foreground">
                    {goalStatusLabel(goal.status)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
