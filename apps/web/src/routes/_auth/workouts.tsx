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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@openvalens/ui/components/table";
import { Textarea } from "@openvalens/ui/components/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";

import { ActivityLoadCard } from "@/components/activity-load-panel";
import {
  Activity,
  Bike,
  BookOpen,
  Dumbbell,
  Footprints,
  type LucideIcon,
  Plus,
  Target,
  Trophy,
  Waves,
} from "lucide-react";

import {
  Details,
  EmptyState,
  ErrorState,
  InfoTip,
  Meter,
  Page,
  PageHeader,
  Section,
  StatusPill,
  type StatusTone,
  ToneIcon,
} from "@/components/page";
import { friendlyDate } from "@/utils/friendly";
import { orpc } from "@/utils/orpc";
import { ModuleHiddenNote } from "@/components/module-hidden-note";

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
        <span className="text-sm text-destructive">
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
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
      <div className="grid gap-2">
        <Label className="text-sm font-medium text-ink-3">
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
        <Label className="text-sm font-medium text-ink-3">
          <Trans>Date</Trans>
        </Label>
        <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
      </div>
      <div className="grid gap-2">
        <Label className="text-sm font-medium text-ink-3">
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
        <Label className="text-sm font-medium text-ink-3" htmlFor="workout-intensity">
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
                <span className="grid">
                  <span>{_(INTENSITY_LABELS[value])}</span>
                  <span className="text-sm text-ink-3">{_(INTENSITY_DESCRIPTIONS[value])}</span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label className="text-sm font-medium text-ink-3" htmlFor="workout-effort">
          <Trans>Effort, 0 to 10 (optional)</Trans>
        </Label>
        <EffortSelect id="workout-effort" value={effort} onChange={setEffort} />
        <span className="text-sm text-ink-3">
          <Trans>You can also add it later today.</Trans>
          <InfoTip>
            <p>{_(EFFORT_QUESTION)}</p>
          </InfoTip>
        </span>
      </div>
      <div className="grid gap-2 sm:col-span-2 lg:col-span-1">
        <Label className="text-sm font-medium text-ink-3">
          <Trans>Notes</Trans>
        </Label>
        <Textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder={t`How did it go?`}
        />
      </div>
      <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-1">
        <Button
          className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          onClick={submit}
          disabled={dateMissing || durationInvalid || save.isPending}
        >
          {save.isPending ? t`Saving…` : t`Save`}
        </Button>
        {durationInvalid ? (
          <span className="text-sm text-destructive">
            <Trans>Duration must be 1 to 1440 minutes.</Trans>
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
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
      <div className="grid gap-2 sm:col-span-2 lg:col-span-1">
        <Label className="text-sm font-medium text-ink-3">
          <Trans>Title</Trans>
        </Label>
        <Input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={t`Run a 5k`}
        />
      </div>
      <div className="grid gap-2">
        <Label className="text-sm font-medium text-ink-3">
          <Trans>Due date</Trans>
        </Label>
        <Input
          type="date"
          value={targetDate}
          onChange={(event) => setTargetDate(event.target.value)}
        />
      </div>
      <div className="grid gap-2">
        <Label className="text-sm font-medium text-ink-3">
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
        <Label className="text-sm font-medium text-ink-3" htmlFor="goal-start-value">
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
        <Label className="text-sm font-medium text-ink-3" htmlFor="goal-target-value">
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
        <Label className="text-sm font-medium text-ink-3">
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
        <Label className="text-sm font-medium text-ink-3">
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
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-1">
        <Button
          variant="outline"
          onClick={submit}
          disabled={titleMissing || !measurement.ok || save.isPending}
        >
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
        className="h-9 w-28"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={t`Today`}
        maxLength={80}
      />
      <Button type="submit" size="sm" variant="outline" disabled={!trimmed || log.isPending}>
        <Trans>Log</Trans>
      </Button>
      {log.isError ? (
        <span className="text-sm text-destructive">
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
  const today = todayIso();
  const recent = (workouts.data ?? []).slice(0, 6);

  return (
    <Page>
      <ModuleHiddenNote module="activity" />
      <PageHeader
        title={<Trans>Workouts</Trans>}
        actions={
          <Link
            to="/exercise-library"
            className="inline-flex h-9 items-center gap-2 rounded-full border border-border bg-card px-4 text-sm font-medium text-ink no-underline transition-colors duration-[var(--dur-short)] hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <BookOpen className="size-4" aria-hidden="true" />
            <Trans>Exercise library</Trans>
          </Link>
        }
      />

      {load.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2" aria-hidden="true">
          <Skeleton className="h-40 w-full rounded-3xl" />
          <Skeleton className="h-40 w-full rounded-3xl" />
        </div>
      ) : load.isError || !load.data ? (
        <ErrorState
          title={<Trans>Could not load weekly activity.</Trans>}
          action={
            <Button variant="outline" size="sm" onClick={() => void load.refetch()}>
              <Trans>Retry</Trans>
            </Button>
          }
        />
      ) : (
        <ActivityLoadCard result={load.data} />
      )}

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <Section
          icon={Dumbbell}
          tone="steps"
          title={<Trans>Session log</Trans>}
          description={
            workoutSummary.count > 0
              ? t`${plural(workoutSummary.count, { one: "# session", other: "# sessions" })}, ${workoutSummary.totalDurationLabel}`
              : undefined
          }
        >
          {workouts.isPending ? (
            <div className="grid gap-3 sm:grid-cols-2" aria-hidden="true">
              {["a", "b", "c", "d"].map((key) => (
                <Skeleton key={key} className="h-28 w-full rounded-3xl" />
              ))}
            </div>
          ) : workouts.isError || !workouts.data ? (
            <ErrorState
              title={<Trans>Could not load workouts.</Trans>}
              action={
                <Button variant="outline" size="sm" onClick={() => void workouts.refetch()}>
                  <Trans>Retry</Trans>
                </Button>
              }
            />
          ) : workouts.data.length === 0 ? (
            <EmptyState
              icon={Dumbbell}
              title={<Trans>No workouts yet</Trans>}
              description={<Trans>Add a session to start tracking.</Trans>}
            />
          ) : (
            <div className="grid gap-4">
              <ul className="grid gap-3 sm:grid-cols-2">
                {recent.map((workout) => {
                  const rating = workout.effortRating;
                  const canRate = rating === null && canRateEffortToday(workout.date, today);
                  return (
                    <li key={workout.id} className="sheet grid min-w-0 content-start gap-3 p-4">
                      <div className="flex items-start gap-3">
                        <ToneIcon icon={workoutIcon(workout.type)} tone="steps" />
                        <div className="grid min-w-0 flex-1 gap-0.5">
                          <span className="font-semibold break-words text-ink">
                            {_(workoutTypeLabel(workout.type))}
                          </span>
                          <span className="text-sm text-ink-3">
                            {friendlyDate(i18n, workout.date)}
                            {workout.intensity ? `, ${_(INTENSITY_LABELS[workout.intensity])}` : ""}
                          </span>
                        </div>
                        <span className="num shrink-0 rounded-full bg-steps-soft px-2.5 py-1 text-sm font-semibold text-ink">
                          <span className="sr-only">{t`Duration`}: </span>
                          {workoutDurationLabel(workout.duration)}
                        </span>
                      </div>
                      {workout.notes ? (
                        <p className="text-sm break-words text-ink-2">{workout.notes}</p>
                      ) : null}
                      {rating !== null ? (
                        <span>
                          <StatusPill tone="neutral">
                            <span className="sr-only">{t`Effort`}: </span>
                            {`${rating}/10`}
                          </StatusPill>
                        </span>
                      ) : canRate ? (
                        <RateEffort workoutId={workout.id} onSaved={reloadWorkouts} />
                      ) : (
                        <span>
                          <StatusPill tone="neutral">
                            <Trans>Not rated</Trans>
                          </StatusPill>
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
              <Details summary={<Trans>Full log</Trans>}>
                <div className="sheet min-w-0 px-2 pt-2 pb-1">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>
                          <Trans>Date</Trans>
                        </TableHead>
                        <TableHead>
                          <Trans>Type</Trans>
                        </TableHead>
                        <TableHead>
                          <Trans>Intensity</Trans>
                        </TableHead>
                        <TableHead className="num">
                          <Trans>Effort</Trans>
                        </TableHead>
                        <TableHead className="num">
                          <Trans>Effort points</Trans>
                        </TableHead>
                        <TableHead className="num">
                          <Trans>Duration</Trans>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {workouts.data.map((workout) => {
                        const rating = workout.effortRating;
                        const points =
                          rating !== null && workout.duration !== null && workout.duration > 0
                            ? rating * workout.duration
                            : null;
                        const canRate = rating === null && canRateEffortToday(workout.date, today);
                        return (
                          <TableRow key={workout.id} className="align-top">
                            <TableCell className="text-left whitespace-nowrap text-ink-3">
                              {friendlyDate(i18n, workout.date)}
                            </TableCell>
                            <TableCell className="min-w-40 whitespace-normal">
                              <span className="block font-medium text-ink">
                                {_(workoutTypeLabel(workout.type))}
                              </span>
                              {workout.notes ? (
                                <span className="block text-ink-3">{workout.notes}</span>
                              ) : null}
                            </TableCell>
                            <TableCell className="text-ink-2">
                              {workout.intensity ? (
                                _(INTENSITY_LABELS[workout.intensity])
                              ) : (
                                <span className="text-ink-3">
                                  <Trans>No intensity</Trans>
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="num">
                              {rating !== null ? (
                                `${rating}/10`
                              ) : canRate ? (
                                <div className="flex justify-end font-body">
                                  <RateEffort workoutId={workout.id} onSaved={reloadWorkouts} />
                                </div>
                              ) : (
                                <span className="font-body text-ink-3">
                                  <Trans>Not rated</Trans>
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="num">
                              {points !== null ? points.toLocaleString(i18n.locale) : "—"}
                            </TableCell>
                            <TableCell className="num">
                              {workoutDurationLabel(workout.duration)}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </Details>
            </div>
          )}
        </Section>

        <Section sheet icon={Plus} tone="steps" title={<Trans>Add a session</Trans>}>
          <AddWorkoutForm onSaved={reloadWorkouts} />
        </Section>
      </div>

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <Section
          icon={Target}
          tone="weight"
          title={<Trans>Goals</Trans>}
          description={
            goalSummary.total > 0 ? (
              <Trans>
                {goalSummary.open} open, {goalSummary.achieved} achieved
              </Trans>
            ) : undefined
          }
        >
          {goals.isPending ? (
            <div className="grid gap-3 sm:grid-cols-2" aria-hidden="true">
              {["a", "b"].map((key) => (
                <Skeleton key={key} className="h-32 w-full rounded-3xl" />
              ))}
            </div>
          ) : goals.isError || !goals.data ? (
            <ErrorState
              title={<Trans>Could not load goals.</Trans>}
              action={
                <Button variant="outline" size="sm" onClick={() => void goals.refetch()}>
                  <Trans>Retry</Trans>
                </Button>
              }
            />
          ) : goals.data.length === 0 ? (
            <EmptyState
              icon={Target}
              title={<Trans>No goals yet</Trans>}
              description={<Trans>Add a goal to start tracking.</Trans>}
            />
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {goals.data.map((goal) => {
                const progress = goalShare(goal.baselineValue, goal.currentValue, goal.targetValue);
                return (
                  <li key={goal.id} className="sheet grid min-w-0 content-start gap-3 p-4">
                    <div className="flex items-start gap-3">
                      <ToneIcon icon={Target} tone="weight" />
                      <div className="grid min-w-0 flex-1 gap-1">
                        <span className="font-semibold break-words text-ink">{goal.title}</span>
                        <span className="flex flex-wrap items-center gap-2 text-sm text-ink-3">
                          <StatusPill tone={goalTone(goal.status)}>
                            <span className="sr-only">{t`Status`}: </span>
                            {_(goalStatusLabel(goal.status))}
                          </StatusPill>
                          {goal.targetDate ? friendlyDate(i18n, goal.targetDate) : t`No due date`}
                        </span>
                      </div>
                      <span className="num shrink-0 rounded-full bg-weight-soft px-2.5 py-1 text-sm font-semibold text-ink">
                        <span className="sr-only">{t`Now`}: </span>
                        {goal.currentValue ?? "—"}
                        <span className="font-normal text-ink-3">
                          {" / "}
                          <span className="sr-only">{t`Target`}: </span>
                          {goal.targetValue ?? "—"}
                        </span>
                      </span>
                    </div>
                    {progress !== null ? <Meter value={progress} tone="weight" /> : null}
                    <LogGoalValue goalId={goal.id} onSaved={reloadGoals} />
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Section sheet icon={Plus} tone="weight" title={<Trans>Add a goal</Trans>}>
          <AddGoalForm onSaved={reloadGoals} />
        </Section>
      </div>
    </Page>
  );
}

const WORKOUT_ICONS: Record<string, LucideIcon> = {
  weights: Dumbbell,
  running: Footprints,
  cycling: Bike,
  swimming: Waves,
  tennis: Trophy,
};

function workoutIcon(type: string): LucideIcon {
  return WORKOUT_ICONS[type] ?? Activity;
}

function goalTone(status: string): StatusTone {
  if (status === "achieved") return "good";
  return "neutral";
}

/** How far a goal has come from its start toward its target, 0 to 1; null without three numbers. */
function goalShare(start: string | null, now: string | null, target: string | null): number | null {
  const a = Number.parseFloat(start ?? "");
  const b = Number.parseFloat(now ?? "");
  const c = Number.parseFloat(target ?? "");
  if (![a, b, c].every(Number.isFinite) || a === c) return null;
  return (b - a) / (c - a);
}
