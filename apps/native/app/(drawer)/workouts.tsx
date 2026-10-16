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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Spinner } from "heroui-native";
import { useState } from "react";
import { Pressable, RefreshControl, Text, TextInput, View } from "react-native";

import { CardStack } from "@/components/list-row";
import { Container } from "@/components/container";
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
    <CardStack title="Add workout">
      <Card variant="secondary" className="gap-4 p-4">
        <View className="gap-2">
          <Text className="text-sm font-medium text-foreground">Type</Text>
          <View className="flex-row flex-wrap gap-2">
            {WORKOUT_TYPES.map((value) => (
              <Pill
                key={value}
                label={workoutTypeLabel(value)}
                selected={value === type}
                onPress={() => setType(value)}
              />
            ))}
          </View>
        </View>
        <View className="flex-row gap-3">
          <View className="flex-1 gap-2">
            <Text className="text-sm font-medium text-foreground">Date</Text>
            <TextInput
              value={date}
              onChangeText={setDate}
              placeholder="YYYY-MM-DD"
              className="min-h-11 rounded-lg border border-border bg-card px-3 text-base text-foreground"
              placeholderTextColor="#9ca3af"
            />
          </View>
          <View className="flex-1 gap-2">
            <Text className="text-sm font-medium text-foreground">Duration (minutes)</Text>
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
          <Text className="text-sm font-medium text-foreground">Notes</Text>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder="How did it go?"
            multiline
            className="min-h-16 rounded-lg border border-border bg-card px-3 py-2 text-base text-foreground"
            placeholderTextColor="#9ca3af"
          />
        </View>
        <View className="flex-row items-center gap-3">
          <Button onPress={submit} isDisabled={dateMissing || durationInvalid || save.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
          {durationInvalid ? (
            <Text className="text-sm text-destructive">Duration must be 1–1440 minutes.</Text>
          ) : save.isSuccess ? (
            <Text className="text-sm text-success">Saved</Text>
          ) : save.isError ? (
            <Text className="text-sm text-destructive">Could not save.</Text>
          ) : null}
        </View>
      </Card>
    </CardStack>
  );
}

const INPUT_CLASS =
  "min-h-11 rounded-lg border border-border bg-card px-3 text-base text-foreground";

function AddGoalForm({ onSaved }: { onSaved: () => void }) {
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
    <CardStack title="Add goal">
      <Card variant="secondary" className="gap-4 p-4">
        <View className="gap-2">
          <Text className="text-sm font-medium text-foreground">Title</Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="Run a 5k"
            className={INPUT_CLASS}
            placeholderTextColor="#9ca3af"
          />
        </View>
        <View className="gap-2">
          <Text className="text-sm font-medium text-foreground">Due date</Text>
          <TextInput
            value={targetDate}
            onChangeText={setTargetDate}
            placeholder="YYYY-MM-DD"
            className={INPUT_CLASS}
            placeholderTextColor="#9ca3af"
          />
        </View>
        <View className="gap-2">
          <Text className="text-sm font-medium text-foreground">Status</Text>
          <View className="flex-row flex-wrap gap-2">
            {GOAL_STATUSES.map((value) => (
              <Pill
                key={value}
                label={goalStatusLabel(value)}
                selected={value === status}
                onPress={() => setStatus(value)}
              />
            ))}
          </View>
        </View>
        <View className="gap-2">
          <Text className="text-sm font-medium text-foreground">Starting value (optional)</Text>
          <TextInput
            value={startValue}
            onChangeText={setStartValue}
            placeholder="80 kg"
            accessibilityLabel="Starting value (optional)"
            className={INPUT_CLASS}
            placeholderTextColor="#9ca3af"
          />
        </View>
        <View className="gap-2">
          <Text className="text-sm font-medium text-foreground">Target (optional)</Text>
          <TextInput
            value={targetValue}
            onChangeText={setTargetValue}
            placeholder="75 kg"
            accessibilityLabel="Target (optional)"
            className={INPUT_CLASS}
            placeholderTextColor="#9ca3af"
          />
        </View>
        <View className="gap-2">
          <Text className="text-sm font-medium text-foreground">
            Progress means the value should
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {GOAL_DIRECTION_OPTIONS.map((value) => (
              <Pill
                key={value}
                label={goalDirectionLabel(value)}
                selected={value === direction}
                onPress={() => setDirection(value === direction ? null : value)}
              />
            ))}
          </View>
        </View>
        <View className="gap-2">
          <Text className="text-sm font-medium text-foreground">Priority</Text>
          <View className="flex-row flex-wrap gap-2">
            {GOAL_PRIORITY_OPTIONS.map((value) => (
              <Pill
                key={value}
                label={goalPriorityLabel(value)}
                selected={value === priority}
                onPress={() => setPriority(value)}
              />
            ))}
          </View>
        </View>
        <View className="flex-row flex-wrap items-center gap-3">
          <Button onPress={submit} isDisabled={titleMissing || !measurement.ok || save.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
          {!measurement.ok ? (
            <Text className="text-sm text-destructive" accessibilityRole="alert">
              {measurement.error}
            </Text>
          ) : save.isSuccess ? (
            <Text className="text-sm text-success">Saved</Text>
          ) : save.isError ? (
            <Text className="text-sm text-destructive">Could not save.</Text>
          ) : null}
        </View>
      </Card>
    </CardStack>
  );
}

/** Issue #95 — record today's value for a goal (same as web "Log"). */
function LogGoalValue({ goalId, onSaved }: { goalId: number; onSaved: () => void }) {
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
        placeholder="Today"
        accessibilityLabel="Today's value"
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
        Log
      </Button>
    </View>
  );
}

export default function WorkoutsScreen() {
  const queryClient = useQueryClient();
  const foreground = useThemeColor("foreground");

  const workouts = useQuery(
    orpc.plans.workouts.listWorkouts.queryOptions({ input: { limit: 50 } }),
  );
  const goals = useQuery(orpc.plans.goals.listGoals.queryOptions({ input: {} }));

  if (workouts.isPending || goals.isPending)
    return (
      <Container className="items-center justify-center" isScrollable={false}>
        <Spinner />
      </Container>
    );

  if (workouts.isError || !workouts.data || goals.isError || !goals.data)
    return (
      <Container className="items-center justify-center gap-3 p-6" isScrollable={false}>
        <Text className="text-base text-foreground">Could not load workouts.</Text>
        <Pressable
          onPress={() => {
            void workouts.refetch();
            void goals.refetch();
          }}
          className="min-h-11 justify-center px-4"
          accessibilityRole="button"
        >
          <Text className="font-medium text-foreground underline">Retry</Text>
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
            refreshing={workouts.isRefetching || goals.isRefetching}
            onRefresh={() => {
              void workouts.refetch();
              void goals.refetch();
            }}
            tintColor={foreground}
          />
        ),
      }}
    >
      <View className="gap-6 p-4">
        <View>
          <Text className="text-sm text-muted-foreground">Workouts</Text>
          <Text className="font-mono text-3xl text-foreground">Sessions &amp; goals</Text>
        </View>

        <AddWorkoutForm onSaved={reloadWorkouts} />
        <CardStack title="Workouts">
          {workouts.data.length === 0 ? (
            <Card variant="secondary" className="items-center gap-1 p-8">
              <Text className="font-medium text-foreground">No workouts yet</Text>
              <Text className="text-center text-sm text-muted-foreground">
                Add a session to start tracking.
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
                      {workoutTypeLabel(workout.type)}
                    </Text>
                    <Text className="text-xs text-muted-foreground">
                      {workout.date}
                      {workout.notes ? ` · ${workout.notes}` : ""}
                    </Text>
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
              {workoutSummary.count} session{workoutSummary.count === 1 ? "" : "s"} ·{" "}
              {workoutSummary.totalDurationLabel}
            </Text>
          ) : null}
        </CardStack>

        <AddGoalForm onSaved={reloadGoals} />
        <CardStack title="Goals">
          {goals.data.length === 0 ? (
            <Card variant="secondary" className="items-center gap-1 p-8">
              <Text className="font-medium text-foreground">No goals yet</Text>
              <Text className="text-center text-sm text-muted-foreground">
                Add a goal to start tracking.
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
                      {goal.targetDate ? `Due ${goal.targetDate}` : "No due date"}
                      {goal.targetValue ? ` · Target ${goal.targetValue}` : ""}
                      {goal.currentValue ? ` · Now ${goal.currentValue}` : ""}
                    </Text>
                    <Text className="text-xs text-muted-foreground">
                      {goalStatusLabel(goal.status)}
                    </Text>
                  </View>
                  <LogGoalValue goalId={goal.id} onSaved={reloadGoals} />
                </View>
              ))}
            </Card>
          )}
          {goalSummary.total > 0 ? (
            <Text className="text-xs text-muted-foreground">
              {goalSummary.open} open · {goalSummary.achieved} achieved
            </Text>
          ) : null}
        </CardStack>
      </View>
    </Container>
  );
}
