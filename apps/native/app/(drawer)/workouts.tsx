import { plural } from "@lingui/core/macro";
import { useLingui as useLinguiRuntime } from "@lingui/react";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  ACTIVITY_INTENSITIES,
  type ActivityIntensityOption,
  type ActivityLoadResult,
} from "@openvalens/api/activity-load-contract";
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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Spinner } from "heroui-native";
import { Link } from "expo-router";
import { useState } from "react";
import { Pressable, RefreshControl, Text, TextInput, View } from "react-native";

import { CardStack } from "@/components/list-row";
import { Container } from "@/components/container";
import { activityLoadScreen, toggleEffort, toggleIntensity } from "@/utils/activity-load-screen";
import { orpc } from "@/utils/orpc";
import { goalLogValue } from "@/utils/score-screen";
import { useThemeColor } from "@/utils/theme";

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

function Pill({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      className={`rounded-full border px-3 py-1.5 active:opacity-70 ${
        selected ? "border-primary bg-primary/15" : "border-border bg-card"
      }`}
    >
      <Text
        className={`text-sm ${selected ? "font-medium text-foreground" : "text-muted-foreground"}`}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** Issue #99 — 0–10 effort choices (CR-10); tapping the selected one clears it. */
function EffortPills({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (next: number | null) => void;
}) {
  return (
    <View className="flex-row flex-wrap gap-2" accessibilityLabel={EFFORT_QUESTION}>
      {EFFORT_RATING_OPTIONS.map((rating) => (
        <Pill
          key={rating}
          label={effortRatingLabel(rating)}
          selected={value === rating}
          onPress={() => onChange(toggleEffort(value, rating))}
        />
      ))}
    </View>
  );
}

/** Issue #99 — add a missing effort rating later the same day (same as web "Rate"). */
function RateEffort({ workoutId, onSaved }: { workoutId: number; onSaved: () => void }) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState<number | null>(null);
  const rate = useMutation(
    orpc.plans.workouts.rateEffort.mutationOptions({ onSuccess: () => onSaved() }),
  );
  if (!open)
    return (
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        className="min-h-11 justify-center"
      >
        <Text className="text-sm font-medium text-foreground underline">
          <Trans>Rate effort</Trans>
        </Text>
      </Pressable>
    );
  return (
    <View className="gap-2">
      <Text className="text-xs text-muted-foreground">{EFFORT_QUESTION}</Text>
      <EffortPills value={rating} onChange={setRating} />
      <View className="flex-row items-center gap-3">
        <Button
          size="sm"
          isDisabled={rating === null || rate.isPending}
          onPress={() => {
            if (rating !== null) rate.mutate({ id: workoutId, effortRating: rating });
          }}
        >
          {t`Save rating`}
        </Button>
        {rate.isError ? (
          <Text className="text-xs text-destructive">
            <Trans>Could not save.</Trans>
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** Issue #99 — weekly activity (same content as the web card). */
function ActivityLoadView({ result }: { result: ActivityLoadResult }) {
  const screen = activityLoadScreen(result);
  const [showMethod, setShowMethod] = useState(false);
  return (
    <CardStack>
      <Card variant="secondary" className="gap-3 p-4">
        <Text className="text-lg font-semibold text-foreground" accessibilityRole="header">
          {screen.title}
        </Text>
        <Text className="text-sm text-muted-foreground">{screen.intro}</Text>
        {screen.windowText ? (
          <Text className="text-xs text-muted-foreground">{screen.windowText}</Text>
        ) : null}
        {screen.withheldExplanation ? (
          <Text className="text-sm text-foreground">{screen.withheldExplanation}</Text>
        ) : null}
        {screen.numbers.map((number) => (
          <View key={number.key} className="gap-1 border-t border-border pt-2">
            <Text className="text-base font-medium text-foreground">{number.title}</Text>
            <View
              className="flex-row items-baseline gap-2"
              accessible
              accessibilityLabel={number.accessibilityLabel}
            >
              <Text className="font-mono text-3xl text-foreground">{number.valueText}</Text>
              {number.unitText ? (
                <Text className="text-sm text-muted-foreground">{number.unitText}</Text>
              ) : null}
            </View>
            {number.lines.map((line) => (
              <Text key={line} className="text-xs text-muted-foreground">
                {line}
              </Text>
            ))}
            {showMethod
              ? number.method.map((line) => (
                  <Text key={line} className="text-xs text-foreground">
                    {line}
                  </Text>
                ))
              : null}
          </View>
        ))}
        {screen.numbers.length > 0 ? (
          <Pressable
            onPress={() => setShowMethod((open) => !open)}
            accessibilityRole="button"
            accessibilityState={{ expanded: showMethod }}
            className="min-h-11 justify-center"
          >
            <Text className="font-medium text-foreground underline">
              <Trans>How this is calculated</Trans>
            </Text>
          </Pressable>
        ) : null}
        {screen.dayRows.length > 0 ? (
          <View className="gap-1 border-t border-border pt-2">
            <Text className="text-sm font-medium text-foreground">
              <Trans>Effort points by day</Trans>
            </Text>
            {screen.dayRows.map((row) => (
              <View
                key={row.key}
                className="flex-row justify-between"
                accessible
                accessibilityLabel={row.accessibilityLabel}
              >
                <Text className="text-xs text-foreground">{row.label}</Text>
                <Text className="font-mono text-xs text-foreground">{row.value}</Text>
              </View>
            ))}
          </View>
        ) : null}
        {screen.comparison ? (
          <View
            className="gap-1 border-t border-border pt-2"
            accessible
            accessibilityLabel={screen.comparison.accessibilityLabel}
          >
            <Text className="text-sm font-medium text-foreground">{screen.comparison.title}</Text>
            {screen.comparison.lines.map((line) => (
              <Text key={line} className="text-xs text-muted-foreground">
                {line}
              </Text>
            ))}
          </View>
        ) : null}
        {screen.context.map((line) => (
          <Text key={line} className="text-xs text-muted-foreground">
            {line}
          </Text>
        ))}
        {screen.footer.map((line) => (
          <Text key={line} className="text-xs text-muted-foreground">
            {line}
          </Text>
        ))}
      </Card>
    </CardStack>
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
  const [effort, setEffort] = useState<number | null>(null);

  const save = useMutation(
    orpc.plans.workouts.upsertWorkout.mutationOptions({
      onSuccess: () => {
        setDuration("");
        setNotes("");
        setDate(todayIso());
        setIntensity(null);
        setEffort(null);
        onSaved();
      },
    }),
  );

  const talkTest = ACTIVITY_INTENSITIES.map(
    (value) =>
      `${INTENSITY_LABELS[value].toLowerCase()} — ${INTENSITY_DESCRIPTIONS[value].toLowerCase()}`,
  ).join("; ");
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
      effortRating: effort,
      // `upsertWorkout` requires at least one exercise with one set; the
      // session header is what this form captures, so we seed a single
      // placeholder set the user can refine later.
      exercises: [{ name: workoutTypeRecordName(type), notes: null, sets: [{ reps: 1 }] }],
    });
  };

  return (
    <CardStack title={t`Add workout`}>
      <Card variant="secondary" className="gap-4 p-4">
        <View className="gap-2">
          <Text className="text-sm font-medium text-foreground">
            <Trans>Type</Trans>
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {WORKOUT_TYPES.map((value) => (
              <Pill
                key={value}
                label={_(workoutTypeLabel(value))}
                selected={value === type}
                onPress={() => setType(value)}
              />
            ))}
          </View>
        </View>
        <View className="flex-row gap-3">
          <View className="flex-1 gap-2">
            <Text className="text-sm font-medium text-foreground">
              <Trans>Date</Trans>
            </Text>
            <TextInput
              value={date}
              onChangeText={setDate}
              placeholder={t`YYYY-MM-DD`}
              className="min-h-11 rounded-lg border border-border bg-card px-3 text-base text-foreground"
              placeholderTextColor="#9ca3af"
            />
          </View>
          <View className="flex-1 gap-2">
            <Text className="text-sm font-medium text-foreground">
              <Trans>Duration (minutes)</Trans>
            </Text>
            <TextInput
              value={duration}
              onChangeText={setDuration}
              placeholder="45"
              keyboardType="numeric"
              className="min-h-11 rounded-lg border border-border bg-card px-3 text-base text-foreground"
              placeholderTextColor="#9ca3af"
            />
          </View>
        </View>
        <View className="gap-2">
          <Text className="text-sm font-medium text-foreground">
            <Trans>Intensity (optional)</Trans>
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {ACTIVITY_INTENSITIES.map((value) => (
              <Pill
                key={value}
                label={INTENSITY_LABELS[value]}
                selected={value === intensity}
                onPress={() => setIntensity(toggleIntensity(intensity, value))}
              />
            ))}
          </View>
          {intensity ? (
            <Text className="text-xs text-muted-foreground">
              {INTENSITY_DESCRIPTIONS[intensity]}
            </Text>
          ) : (
            <Text className="text-xs text-muted-foreground">{t`Talk test: ${talkTest}.`}</Text>
          )}
        </View>
        <View className="gap-2">
          <Text className="text-sm font-medium text-foreground">
            <Trans>Effort, 0–10 (optional)</Trans>
          </Text>
          <Text className="text-xs text-muted-foreground">
            {EFFORT_QUESTION} <Trans>You can also add it later today.</Trans>
          </Text>
          <EffortPills value={effort} onChange={setEffort} />
        </View>
        <View className="gap-2">
          <Text className="text-sm font-medium text-foreground">
            <Trans>Notes</Trans>
          </Text>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder={t`How did it go?`}
            multiline
            className="min-h-16 rounded-lg border border-border bg-card px-3 py-2 text-base text-foreground"
            placeholderTextColor="#9ca3af"
          />
        </View>
        <View className="flex-row items-center gap-3">
          <Button onPress={submit} isDisabled={dateMissing || durationInvalid || save.isPending}>
            {save.isPending ? t`Saving…` : t`Save`}
          </Button>
          {durationInvalid ? (
            <Text className="text-sm text-destructive">
              <Trans>Duration must be 1–1440 minutes.</Trans>
            </Text>
          ) : save.isSuccess ? (
            <Text className="text-sm text-success">
              <Trans>Saved</Trans>
            </Text>
          ) : save.isError ? (
            <Text className="text-sm text-destructive">
              <Trans>Could not save.</Trans>
            </Text>
          ) : null}
        </View>
      </Card>
    </CardStack>
  );
}

const INPUT_CLASS =
  "min-h-11 rounded-lg border border-border bg-card px-3 text-base text-foreground";

function AddGoalForm({ onSaved }: { onSaved: () => void }) {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  const [title, setTitle] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [status, setStatus] = useState<GoalStatus>("not_started");
  // Issue #95 — optional measurement so goal progress can be calculated (same as web).
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
    <CardStack title={t`Add goal`}>
      <Card variant="secondary" className="gap-4 p-4">
        <View className="gap-2">
          <Text className="text-sm font-medium text-foreground">
            <Trans>Title</Trans>
          </Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder={t`Run a 5k`}
            className={INPUT_CLASS}
            placeholderTextColor="#9ca3af"
          />
        </View>
        <View className="gap-2">
          <Text className="text-sm font-medium text-foreground">
            <Trans>Due date</Trans>
          </Text>
          <TextInput
            value={targetDate}
            onChangeText={setTargetDate}
            placeholder={t`YYYY-MM-DD`}
            className={INPUT_CLASS}
            placeholderTextColor="#9ca3af"
          />
        </View>
        <View className="gap-2">
          <Text className="text-sm font-medium text-foreground">
            <Trans>Status</Trans>
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {GOAL_STATUSES.map((value) => (
              <Pill
                key={value}
                label={_(goalStatusLabel(value))}
                selected={value === status}
                onPress={() => setStatus(value)}
              />
            ))}
          </View>
        </View>
        <View className="gap-2">
          <Text className="text-sm font-medium text-foreground">
            <Trans>Starting value (optional)</Trans>
          </Text>
          <TextInput
            value={startValue}
            onChangeText={setStartValue}
            placeholder="80 kg"
            accessibilityLabel={t`Starting value (optional)`}
            className={INPUT_CLASS}
            placeholderTextColor="#9ca3af"
          />
        </View>
        <View className="gap-2">
          <Text className="text-sm font-medium text-foreground">
            <Trans>Target (optional)</Trans>
          </Text>
          <TextInput
            value={targetValue}
            onChangeText={setTargetValue}
            placeholder="75 kg"
            accessibilityLabel={t`Target (optional)`}
            className={INPUT_CLASS}
            placeholderTextColor="#9ca3af"
          />
        </View>
        <View className="gap-2">
          <Text className="text-sm font-medium text-foreground">
            <Trans>Progress means the value should</Trans>
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {GOAL_DIRECTION_OPTIONS.map((value) => (
              <Pill
                key={value}
                label={_(goalDirectionLabel(value))}
                selected={value === direction}
                onPress={() => setDirection(value === direction ? null : value)}
              />
            ))}
          </View>
        </View>
        <View className="gap-2">
          <Text className="text-sm font-medium text-foreground">
            <Trans>Priority</Trans>
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {GOAL_PRIORITY_OPTIONS.map((value) => (
              <Pill
                key={value}
                label={_(goalPriorityLabel(value))}
                selected={value === priority}
                onPress={() => setPriority(value)}
              />
            ))}
          </View>
        </View>
        <View className="flex-row flex-wrap items-center gap-3">
          <Button onPress={submit} isDisabled={titleMissing || !measurement.ok || save.isPending}>
            {save.isPending ? t`Saving…` : t`Save`}
          </Button>
          {!measurement.ok ? (
            <Text className="text-sm text-destructive" accessibilityRole="alert">
              {_(measurement.error)}
            </Text>
          ) : save.isSuccess ? (
            <Text className="text-sm text-success">
              <Trans>Saved</Trans>
            </Text>
          ) : save.isError ? (
            <Text className="text-sm text-destructive">
              <Trans>Could not save.</Trans>
            </Text>
          ) : null}
        </View>
      </Card>
    </CardStack>
  );
}

/** Issue #95 — record today's value for a goal (same as web "Log"). */
function LogGoalValue({ goalId, onSaved }: { goalId: number; onSaved: () => void }) {
  const { t } = useLingui();
  const [text, setText] = useState("");
  const log = useMutation(
    orpc.plans.goals.upsertCheckin.mutationOptions({
      onSuccess: () => {
        setText("");
        onSaved();
      },
    }),
  );
  const value = goalLogValue(text);
  return (
    <View className="flex-row items-center gap-2">
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder={t`Today`}
        accessibilityLabel={t`Today's value`}
        maxLength={80}
        className="min-h-11 w-24 rounded-lg border border-border bg-card px-2 text-sm text-foreground"
        placeholderTextColor="#9ca3af"
      />
      <Button
        size="sm"
        variant="secondary"
        isDisabled={value === null || log.isPending}
        onPress={() => {
          if (value !== null) log.mutate({ goalId, date: todayIso(), value });
        }}
      >
        {t`Log`}
      </Button>
    </View>
  );
}

export default function WorkoutsScreen() {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  const queryClient = useQueryClient();
  const foreground = useThemeColor("foreground");

  const workouts = useQuery(
    orpc.plans.workouts.listWorkouts.queryOptions({ input: { limit: 50 } }),
  );
  const goals = useQuery(orpc.plans.goals.listGoals.queryOptions({ input: {} }));
  const load = useQuery(orpc.activity.weeklyLoad.queryOptions({ input: {} }));

  if (workouts.isPending || goals.isPending)
    return (
      <Container className="items-center justify-center" isScrollable={false}>
        <Spinner />
      </Container>
    );

  if (workouts.isError || !workouts.data || goals.isError || !goals.data)
    return (
      <Container className="items-center justify-center gap-3 p-6" isScrollable={false}>
        <Text className="text-base text-foreground">
          <Trans>Could not load workouts.</Trans>
        </Text>
        <Pressable
          onPress={() => {
            void workouts.refetch();
            void goals.refetch();
          }}
          className="min-h-11 justify-center px-4"
          accessibilityRole="button"
        >
          <Text className="font-medium text-foreground underline">
            <Trans>Retry</Trans>
          </Text>
        </Pressable>
      </Container>
    );

  const workoutSummary = summarizeWorkouts(workouts.data);
  const goalSummary = summarizeGoals(goals.data);

  const reloadWorkouts = () => {
    void workouts.refetch();
    void queryClient.invalidateQueries({
      queryKey: [["plans", "workouts", "listWorkouts"]],
    });
    void queryClient.invalidateQueries({ queryKey: orpc.activity.weeklyLoad.key() });
  };
  const reloadGoals = () => {
    void goals.refetch();
    void queryClient.invalidateQueries({ queryKey: [["plans", "goals", "listGoals"]] });
    void queryClient.invalidateQueries({ queryKey: orpc.score.key() });
  };

  return (
    <Container
      scrollViewProps={{
        refreshControl: (
          <RefreshControl
            refreshing={workouts.isRefetching || goals.isRefetching || load.isRefetching}
            onRefresh={() => {
              void workouts.refetch();
              void goals.refetch();
              void load.refetch();
            }}
            tintColor={foreground}
          />
        ),
      }}
    >
      <View className="gap-6 p-4">
        <View>
          <Text className="text-sm text-muted-foreground">
            <Trans>Workouts</Trans>
          </Text>
          <Text className="font-mono text-3xl text-foreground">
            <Trans>Sessions &amp; goals</Trans>
          </Text>
          <Link href="/exercise-library" asChild>
            <Pressable accessibilityRole="link" className="min-h-11 justify-center">
              <Text className="text-sm text-foreground underline">
                <Trans>Exercise library</Trans>
              </Text>
            </Pressable>
          </Link>
        </View>

        {load.isPending ? (
          <Spinner />
        ) : load.isError || !load.data ? (
          <Pressable
            onPress={() => void load.refetch()}
            className="min-h-11 justify-center"
            accessibilityRole="button"
          >
            <Text className="text-sm text-foreground">
              <Trans>
                Could not load weekly activity. <Text className="underline">Retry</Text>
              </Trans>
            </Text>
          </Pressable>
        ) : (
          <ActivityLoadView result={load.data} />
        )}

        <AddWorkoutForm onSaved={reloadWorkouts} />
        <CardStack title={t`Workouts`}>
          {workouts.data.length === 0 ? (
            <Card variant="secondary" className="items-center gap-1 p-8">
              <Text className="font-medium text-foreground">
                <Trans>No workouts yet</Trans>
              </Text>
              <Text className="text-center text-sm text-muted-foreground">
                <Trans>Add a session to start tracking.</Trans>
              </Text>
            </Card>
          ) : (
            <Card variant="secondary" className="p-0">
              {workouts.data.map((workout, index, arr) => (
                <View
                  key={workout.id}
                  className={`flex-row items-center justify-between gap-3 px-4 py-3 ${
                    index < arr.length - 1 ? "border-b border-border" : ""
                  }`}
                >
                  <View className="min-w-0 flex-1">
                    <Text className="text-base text-foreground">
                      {_(workoutTypeLabel(workout.type))}
                    </Text>
                    <Text className="text-xs text-muted-foreground">
                      {workout.date}
                      {workout.notes ? ` · ${workout.notes}` : ""}
                    </Text>
                    <Text className="text-xs text-muted-foreground">
                      {sessionEffortText(workout)}
                    </Text>
                    {workout.effortRating === null &&
                    canRateEffortToday(workout.date, todayIso()) ? (
                      <RateEffort workoutId={workout.id} onSaved={reloadWorkouts} />
                    ) : null}
                  </View>
                  <Text className="font-mono text-sm text-foreground">
                    {workoutDurationLabel(workout.duration)}
                  </Text>
                </View>
              ))}
            </Card>
          )}
          {workoutSummary.count > 0 ? (
            <Text className="text-xs text-muted-foreground">
              {t`${plural(workoutSummary.count, { one: "# session", other: "# sessions" })} · ${workoutSummary.totalDurationLabel}`}
            </Text>
          ) : null}
        </CardStack>

        <AddGoalForm onSaved={reloadGoals} />
        <CardStack title={t`Goals`}>
          {goals.data.length === 0 ? (
            <Card variant="secondary" className="items-center gap-1 p-8">
              <Text className="font-medium text-foreground">
                <Trans>No goals yet</Trans>
              </Text>
              <Text className="text-center text-sm text-muted-foreground">
                <Trans>Add a goal to start tracking.</Trans>
              </Text>
            </Card>
          ) : (
            <Card variant="secondary" className="p-0">
              {goals.data.map((goal, index, arr) => (
                <View
                  key={goal.id}
                  className={`flex-row items-center justify-between gap-3 px-4 py-3 ${
                    index < arr.length - 1 ? "border-b border-border" : ""
                  }`}
                >
                  <View className="min-w-0 flex-1">
                    <Text className="text-base text-foreground">{goal.title}</Text>
                    <Text className="text-xs text-muted-foreground">
                      {goal.targetDate ? t`Due ${goal.targetDate}` : t`No due date`}
                      {goal.targetValue ? ` · ${t`Target ${goal.targetValue}`}` : ""}
                      {goal.currentValue ? ` · ${t`Now ${goal.currentValue}`}` : ""}
                    </Text>
                    <Text className="text-xs text-muted-foreground">
                      {_(goalStatusLabel(goal.status))}
                    </Text>
                  </View>
                  <LogGoalValue goalId={goal.id} onSaved={reloadGoals} />
                </View>
              ))}
            </Card>
          )}
          {goalSummary.total > 0 ? (
            <Text className="text-xs text-muted-foreground">
              <Trans>
                {goalSummary.open} open · {goalSummary.achieved} achieved
              </Trans>
            </Text>
          ) : null}
        </CardStack>
      </View>
    </Container>
  );
}
