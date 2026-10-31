import { plural } from "@lingui/core/macro";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "heroui-native";
import { Check, Plus, Trash2, ChevronUp, ChevronDown } from "lucide-react-native";
import { useEffect, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useWorkoutSession } from "@/lib/workouts/sync";
import {
  addDraftSet,
  createWorkoutDraft,
  newDraftExercise,
  weightFromKg,
  weightToKg,
  workoutSummary,
  validateWorkoutDraft,
} from "@/lib/workouts/model";
import { client, orpc } from "@/utils/orpc";
import { useQuery } from "@tanstack/react-query";
import { useThemeColor } from "@/utils/theme";
import { Section, Sheet } from "@/components/bloom";
import { useWorkoutRestTimer } from "@/lib/workouts/rest-timer";
import { WorkoutRoutineStart } from "@/components/workout-routines";
import { WorkoutExerciseHistory } from "@/components/workout-history";
import type { WorkoutQueueItem } from "@/lib/workouts/sync";
import { WorkoutExerciseTools } from "@/components/workout-exercise-tools";
import { DateField } from "@/components/date-field";

const input =
  "min-h-11 rounded-xl border border-rule-2 bg-paper-2 px-3 font-sans text-base text-ink";

const TYPES = ["weights", "running", "cycling", "swimming", "tennis", "other"] as const;
const TYPE_LABELS = {
  weights: <Trans>Weights</Trans>,
  running: <Trans>Running</Trans>,
  cycling: <Trans>Cycling</Trans>,
  swimming: <Trans>Swimming</Trans>,
  tennis: <Trans>Tennis</Trans>,
  other: <Trans>Other</Trans>,
};
const INTENSITY_LABELS = {
  light: <Trans context="intensity">Light</Trans>,
  moderate: <Trans context="intensity">Moderate</Trans>,
  vigorous: <Trans context="intensity">Vigorous</Trans>,
};

function queuedWorkoutCounts(item: WorkoutQueueItem) {
  if (!("date" in item.payload)) return { exercises: 0, sets: 0 };
  return {
    exercises: item.payload.exercises.length,
    sets: item.payload.exercises.reduce((n, e) => n + e.sets.length, 0),
  };
}

/**
 * One queued change. A blocked change was definitively rejected (conflict or invalid), so retrying
 * cannot succeed: it can be reopened against the latest server version or discarded.
 */
function QueuedWorkoutItem({
  item,
  session,
  canRepair,
}: {
  item: WorkoutQueueItem;
  session: ReturnType<typeof useWorkoutSession>;
  canRepair: boolean;
}) {
  const { t } = useLingui();
  const [busy, setBusy] = useState(false);
  const counts = queuedWorkoutCounts(item);
  const repairable = item.operation === "update" && "workout" in item.payload;
  const discard = () => {
    Alert.alert(t`Discard this change?`, t`The change will not be saved to your history.`, [
      { text: t`Cancel`, style: "cancel" },
      {
        text: t`Discard`,
        style: "destructive",
        onPress: () => {
          if (session.discardBlocked(item.id)) return;
          Alert.alert(
            t`Discard later changes too?`,
            t`Changes queued after this one depend on it and will also be discarded.`,
            [
              { text: t`Cancel`, style: "cancel" },
              {
                text: t`Discard all`,
                style: "destructive",
                onPress: () => {
                  if (!session.discardBlocked(item.id, true))
                    Alert.alert(t`Could not discard`, t`A dependent change is already syncing.`);
                },
              },
            ],
          );
        },
      },
    ]);
  };
  const repair = async () => {
    if (!("workout" in item.payload)) return;
    setBusy(true);
    try {
      const latest = await client.plans.workouts.getWorkout({ id: item.payload.id });
      if (!latest) {
        Alert.alert(
          t`Session no longer exists`,
          t`This session was deleted elsewhere. Discard the change to clear it.`,
        );
        return;
      }
      if (!session.repairAsDraft(item.id, latest.version))
        Alert.alert(t`Could not reopen`, t`Save or discard your active workout first.`);
    } catch {
      Alert.alert(t`Could not load the latest version`, t`Check your connection and try again.`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet className="gap-2">
      <Text className="font-sans font-semibold text-ink">
        {item.state === "pending"
          ? t`Waiting to sync`
          : item.state === "blocked"
            ? t`Needs attention`
            : t`Sync failed`}
      </Text>
      <Text className="font-sans text-sm text-ink-2">
        {t`${plural(counts.exercises, { one: "# exercise", other: "# exercises" })}`},{" "}
        {t`${plural(counts.sets, { one: "# set", other: "# sets" })}`}
      </Text>
      {item.state === "failed" ? (
        <Button size="sm" variant="outline" onPress={() => session.retry(item.id)}>
          <Button.Label>{t`Retry sync`}</Button.Label>
        </Button>
      ) : null}
      {item.state === "blocked" ? (
        <View className="gap-2">
          <Text className="font-sans text-sm text-ink-2">
            <Trans>This change conflicts with the saved session and was not applied.</Trans>
          </Text>
          {repairable && canRepair ? (
            <Button size="sm" variant="outline" isDisabled={busy} onPress={() => void repair()}>
              <Button.Label>{t`Review against latest`}</Button.Label>
            </Button>
          ) : null}
          <Button size="sm" variant="outline" onPress={discard}>
            <Button.Label>{t`Discard change`}</Button.Label>
          </Button>
        </View>
      ) : null}
    </Sheet>
  );
}

function localDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function SetRow({
  set,
  index,
  units,
  label,
  onChange,
  onDelete,
  onDone,
}: {
  set: { id: string; weightKg: number | null; reps: string; rpe: string; done: boolean };
  index: number;
  units: "metric" | "imperial";
  label: string;
  onChange: (next: typeof set) => void;
  onDelete: () => void;
  onDone: (done: boolean) => void;
}) {
  const { t, i18n } = useLingui();
  const [weightText, setWeightText] = useState(
    set.weightKg == null ? "" : String(weightFromKg(set.weightKg, units)),
  );
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused)
      setWeightText(
        set.weightKg == null ? "" : String(Number(weightFromKg(set.weightKg, units).toFixed(1))),
      );
  }, [set.weightKg, units, focused]);
  return (
    <View className="flex-row items-center gap-2">
      <Text className="w-8 text-ink-3">{index + 1}</Text>
      <TextInput
        testID={`set-weight-${index + 1}`}
        accessibilityLabel={label}
        keyboardType="decimal-pad"
        value={weightText}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
        }}
        onChangeText={(v) => {
          setWeightText(v);
          if (!v.trim()) onChange({ ...set, weightKg: null });
          else if (/^\d*[.,]?\d*$/.test(v) && v !== "." && v !== ",")
            onChange({ ...set, weightKg: weightToKg(Number(v.replace(",", ".")), units) });
        }}
        placeholder={i18n._(
          units === "metric"
            ? msg({ message: "kg", context: "unit" })
            : msg({ message: "lb", context: "unit" }),
        )}
        className={`${input} min-w-0 flex-1`}
      />
      <TextInput
        testID={`set-reps-${index + 1}`}
        accessibilityLabel={t`Reps`}
        keyboardType="number-pad"
        value={set.reps}
        onChangeText={(reps) => onChange({ ...set, reps })}
        placeholder={t`Reps`}
        className={`${input} w-16 px-2`}
      />
      <TextInput
        accessibilityLabel={t`RPE (optional)`}
        keyboardType="decimal-pad"
        value={set.rpe}
        onChangeText={(rpe) => onChange({ ...set, rpe })}
        placeholder="RPE"
        className={`${input} w-16 px-2`}
      />
      <Pressable
        testID={`set-done-${index + 1}`}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: set.done }}
        accessibilityLabel={label}
        onPress={() => onDone(!set.done)}
        className="min-h-11 min-w-11 items-center justify-center rounded-xl border border-rule-2"
      >
        {set.done ? <Check size={18} /> : null}
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={t`Delete set`} onPress={onDelete}>
        <Trash2 size={16} />
      </Pressable>
    </View>
  );
}

export function WorkoutSession() {
  const { t } = useLingui();
  const session = useWorkoutSession();
  const rest = useWorkoutRestTimer(session.scope);
  const [now, setNow] = useState(Date.now());
  const [picker, setPicker] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [minimized, setMinimized] = useState(false);
  const [showHistory, setShowHistory] = useState<string | null>(null);
  const placeholder = useThemeColor("ink-3");
  const insets = useSafeAreaInsets();
  const productSettings = useQuery(orpc.adminSettings.productSettings.queryOptions({ input: {} }));
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const draft = session.draft;
  const units: "metric" | "imperial" =
    productSettings.data?.units === "imperial" ? "imperial" : "metric";
  const [muscleId, setMuscleId] = useState("");
  const [equipmentId, setEquipmentId] = useState("");
  const filters = useQuery(orpc.exerciseCatalog.filters.queryOptions({ input: {} }));
  const searchParams = {
    query: search.trim() || undefined,
    language: "en",
    limit: 20,
    muscleExternalId: muscleId || undefined,
    equipmentExternalId: equipmentId || undefined,
  };
  const catalog = useQuery(orpc.exerciseCatalog.search.queryOptions({ input: searchParams }));
  const lastPerformanceOptions = orpc.plans.workouts.lastPerformance.queryOptions({
    input: {
      exerciseIds: [
        ...new Set((draft?.exercises ?? []).flatMap((e) => (e.exerciseId ? [e.exerciseId] : []))),
      ],
      names: [
        ...new Set((draft?.exercises ?? []).filter((e) => e.exerciseId == null).map((e) => e.name)),
      ],
      onOrBeforeDate: draft?.date,
      excludeWorkoutId: draft?.workoutId,
    },
  });
  const lastPerformance = useQuery({
    ...lastPerformanceOptions,
    queryKey: [...lastPerformanceOptions.queryKey, { scope: session.scope }],
    enabled: Boolean(session.scope && draft),
  });
  const isEditing = draft?.mode === "edit" || draft?.workoutId != null;
  const elapsed = draft ? Math.max(0, Math.floor((now - Date.parse(draft.startedAt)) / 60000)) : 0;
  const finishDuration = draft?.duration ?? Math.max(1, elapsed);
  const update = (next: NonNullable<typeof draft>): boolean => {
    const saved = session.saveDraft(next);
    if (!saved)
      Alert.alert(t`Could not save workout`, t`This change was not saved. Please try again.`);
    return saved;
  };
  const summary = draft ? workoutSummary(draft.exercises) : null;
  useEffect(() => {
    setPicker(false);
    setFinishing(false);
    setSearch("");
    setName("");
    setMuscleId("");
    setEquipmentId("");
    setMinimized(false);
  }, [session.scope]);
  return (
    <Section icon={Plus} tone="steps" title={t`Workout session`}>
      {!draft ? (
        <View className="gap-3">
          <Text className="font-sans text-sm text-ink-3">
            <Trans>Start a workout and log each set as you go.</Trans>
          </Text>
          <Button onPress={() => session.saveDraft(createWorkoutDraft())}>
            <Button.Label>{t`Start workout`}</Button.Label>
          </Button>
          <WorkoutRoutineStart onStart={(next) => session.saveDraft(next)} />
          {session.items.map((item) => (
            <QueuedWorkoutItem key={item.id} item={item} session={session} canRepair />
          ))}
        </View>
      ) : minimized ? (
        <Button onPress={() => setMinimized(false)}>
          <Button.Label>{t`Resume workout`}</Button.Label>
        </Button>
      ) : (
        <Modal
          visible={!minimized}
          animationType="slide"
          presentationStyle="fullScreen"
          onRequestClose={() => setPicker(false)}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            className="flex-1"
            style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
          >
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerClassName="gap-4 bg-paper px-5 py-5"
            >
              <View className="flex-row items-center justify-between">
                <Text
                  accessibilityRole="timer"
                  className="font-display text-2xl font-semibold text-ink"
                >
                  {isEditing
                    ? t`Edit session`
                    : `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`}
                </Text>
                <Text className="font-sans text-sm text-ink-3">
                  {t`${plural(summary?.exerciseCount ?? 0, { one: "# exercise", other: "# exercises" })}`}
                  ,{" "}
                  {t`${plural(summary?.setCount ?? 0, { one: "# set done", other: "# sets done" })}`}
                </Text>
              </View>
              <Button variant="outline" onPress={() => setMinimized(true)}>
                <Button.Label>{t`Minimize workout`}</Button.Label>
              </Button>
              <DateField
                label={t`Workout date`}
                value={draft.date}
                onChange={(date) => date && update({ ...draft, date })}
              />
              {rest.active ? (
                <Sheet className="gap-2 border border-rule-2 bg-paper-2">
                  <View className="h-2 overflow-hidden rounded-full bg-rule">
                    <View
                      className="h-full bg-ink"
                      style={{
                        width: `${Math.max(0, Math.min(100, (rest.remainingSeconds / Math.max(1, rest.restSeconds(rest.exerciseKey ?? ""))) * 100))}%`,
                      }}
                    />
                  </View>
                  <Text
                    accessibilityRole="timer"
                    className="font-display text-xl text-ink"
                  >{`${Math.floor(rest.remainingSeconds / 60)}:${String(rest.remainingSeconds % 60).padStart(2, "0")}`}</Text>
                  <View className="flex-row gap-2">
                    <Button size="sm" variant="outline" onPress={() => void rest.adjust(15)}>
                      <Button.Label>{t`+15 sec`}</Button.Label>
                    </Button>
                    <Button size="sm" variant="outline" onPress={() => void rest.adjust(-15)}>
                      <Button.Label>{t`−15 sec`}</Button.Label>
                    </Button>
                    <Button size="sm" variant="secondary" onPress={() => void rest.skip()}>
                      <Button.Label>{t`Skip rest`}</Button.Label>
                    </Button>
                  </View>
                </Sheet>
              ) : null}
              {draft.exercises.map((exercise, ei) => (
                <Sheet key={exercise.id} className="gap-3">
                  <View className="flex-row items-center justify-between">
                    <Text className="flex-1 font-display text-lg font-semibold text-ink">
                      {exercise.name}
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t`Remove ${exercise.name}`}
                      onPress={() =>
                        update({ ...draft, exercises: draft.exercises.filter((_, i) => i !== ei) })
                      }
                    >
                      <Trash2 size={18} />
                    </Pressable>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() =>
                      setShowHistory(
                        exercise.exerciseId ? `id:${exercise.exerciseId}` : `name:${exercise.name}`,
                      )
                    }
                  >
                    <Text className="text-ink-2">{t`View exercise history`}</Text>
                  </Pressable>
                  {showHistory ===
                  (exercise.exerciseId ? `id:${exercise.exerciseId}` : `name:${exercise.name}`) ? (
                    <WorkoutExerciseHistory
                      exercise={
                        exercise.exerciseId
                          ? { exerciseId: exercise.exerciseId }
                          : { name: exercise.name }
                      }
                    />
                  ) : null}
                  {(() => {
                    const snapshots = draft.routineSnapshot?.exercises ?? [];
                    const routineKey = exercise.routineExerciseKey;
                    const candidates = routineKey
                      ? snapshots.filter((item) => item.key === routineKey)
                      : [];
                    const target = candidates.length === 1 ? candidates[0] : undefined;
                    return (
                      <WorkoutExerciseTools
                        exerciseKey={
                          exercise.exerciseId
                            ? `id:${exercise.exerciseId}`
                            : `name:${exercise.name}`
                        }
                        suggestion={target?.suggestion}
                        prescription={target}
                        units={units}
                        rest={rest}
                        fallbackSeconds={target?.restSeconds ?? 90}
                      />
                    );
                  })()}
                  {exercise.sets.map((set, si) => (
                    <SetRow
                      key={set.id}
                      set={set}
                      index={si}
                      units={units}
                      label={t`Set ${si + 1}, ${set.weightKg == null ? t`no weight` : `${Number(weightFromKg(set.weightKg, units).toFixed(1))} ${units === "metric" ? t`kilograms` : t`pounds`}`}, ${set.reps ? t`${set.reps} reps` : t`no reps`}, ${set.done ? t`done` : t`not done`}`}
                      onChange={(next) =>
                        update({
                          ...draft,
                          exercises: draft.exercises.map((x, i) =>
                            i === ei
                              ? { ...x, sets: x.sets.map((s, j) => (j === si ? next : s)) }
                              : x,
                          ),
                        })
                      }
                      onDelete={() =>
                        update({
                          ...draft,
                          exercises: draft.exercises.map((x, i) =>
                            i === ei ? { ...x, sets: x.sets.filter((_, j) => j !== si) } : x,
                          ),
                        })
                      }
                      onDone={(done) => {
                        const next = { ...set, done };
                        if (
                          update({
                            ...draft,
                            exercises: draft.exercises.map((x, i) =>
                              i === ei
                                ? { ...x, sets: x.sets.map((s, j) => (j === si ? next : s)) }
                                : x,
                            ),
                          }) &&
                          done &&
                          !set.done &&
                          !isEditing &&
                          draft.date === localDate(new Date())
                        ) {
                          const key = exercise.exerciseId
                            ? `id:${exercise.exerciseId}`
                            : `name:${exercise.name}`;
                          const routine = draft.routineSnapshot?.exercises.find(
                            (item) => item.key === exercise.routineExerciseKey,
                          );
                          void rest.start(key, rest.restSeconds(key, routine?.restSeconds));
                        }
                      }}
                    />
                  ))}
                  {exercise.sets.map((set, si) => {
                    const row = lastPerformance.data?.items?.find((item) =>
                      exercise.exerciseId != null
                        ? "exerciseId" in item.ref && item.ref.exerciseId === exercise.exerciseId
                        : "name" in item.ref &&
                          item.ref.name.trim().toLocaleLowerCase() ===
                            exercise.name.trim().toLocaleLowerCase(),
                    );
                    const previous = row?.performance?.exercises[0]?.sets[si];
                    if (!previous) return null;
                    return (
                      <View
                        key={`previous-${set.id}`}
                        className="flex-row items-center justify-between"
                      >
                        <Text className="text-ink-2">{t`Last: ${previous.weightKg == null ? t`no weight` : `${Number(weightFromKg(previous.weightKg, units).toFixed(1))} ${units === "metric" ? t`kg` : t`lb`}`} × ${previous.reps ?? "—"}`}</Text>
                        <Button
                          size="sm"
                          variant="outline"
                          onPress={() =>
                            update({
                              ...draft,
                              exercises: draft.exercises.map((x, i) =>
                                i === ei
                                  ? {
                                      ...x,
                                      sets: x.sets.map((s, j) =>
                                        j === si
                                          ? {
                                              ...s,
                                              weightKg: previous.weightKg,
                                              reps:
                                                previous.reps == null ? "" : String(previous.reps),
                                            }
                                          : s,
                                      ),
                                    }
                                  : x,
                              ),
                            })
                          }
                        >
                          <Button.Label>{t`Use last`}</Button.Label>
                        </Button>
                      </View>
                    );
                  })}
                  <View className="flex-row gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onPress={() =>
                        update({
                          ...draft,
                          exercises: draft.exercises.map((x, i) => (i === ei ? addDraftSet(x) : x)),
                        })
                      }
                    >
                      <Button.Label>{t`Add set`}</Button.Label>
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      isDisabled={ei === 0}
                      accessibilityLabel={t`Move ${exercise.name} up`}
                      onPress={() => {
                        const xs = [...draft.exercises];
                        [xs[ei - 1], xs[ei]] = [xs[ei], xs[ei - 1]];
                        update({ ...draft, exercises: xs });
                      }}
                    >
                      <Button.Label>
                        <ChevronUp size={14} />
                      </Button.Label>
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      isDisabled={ei === draft.exercises.length - 1}
                      accessibilityLabel={t`Move ${exercise.name} down`}
                      onPress={() => {
                        const xs = [...draft.exercises];
                        [xs[ei + 1], xs[ei]] = [xs[ei], xs[ei + 1]];
                        update({ ...draft, exercises: xs });
                      }}
                    >
                      <Button.Label>
                        <ChevronDown size={14} />
                      </Button.Label>
                    </Button>
                  </View>
                </Sheet>
              ))}
              <Button variant="secondary" onPress={() => setPicker(true)}>
                <Button.Label>{t`Add exercise`}</Button.Label>
              </Button>
              {session.error ? (
                <Text accessibilityRole="alert" className="font-sans text-sm text-destructive">
                  <Trans>Could not save workout changes. Please try again.</Trans>
                </Text>
              ) : null}
              {session.items.map((item) => (
                <QueuedWorkoutItem key={item.id} item={item} session={session} canRepair={false} />
              ))}
              <Button onPress={() => setFinishing(true)}>
                <Button.Label>{t`Finish workout`}</Button.Label>
              </Button>
              <Button
                variant="outline"
                onPress={() =>
                  Alert.alert(t`Discard workout?`, t`This active workout will be deleted.`, [
                    { text: t`Cancel`, style: "cancel" },
                    {
                      text: t`Discard`,
                      style: "destructive",
                      onPress: () => session.discardDraft(),
                    },
                  ])
                }
              >
                <Button.Label>{t`Discard workout`}</Button.Label>
              </Button>
              {finishing ? (
                <Sheet className="gap-3">
                  <Text className="font-display text-xl text-ink">
                    <Trans>Finish workout</Trans>
                  </Text>
                  <TextInput
                    accessibilityLabel={t`Duration in minutes`}
                    keyboardType="number-pad"
                    value={draft.duration == null && isEditing ? "" : String(finishDuration)}
                    onChangeText={(v) =>
                      update({ ...draft, duration: v.trim() ? Number(v) : null })
                    }
                    className={input}
                  />
                  <Text className="font-sans text-sm text-ink-2">
                    <Trans>Workout type</Trans>
                  </Text>
                  <View className="flex-row flex-wrap gap-2">
                    {TYPES.map((type) => (
                      <Pressable
                        key={type}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: draft.type === type }}
                        onPress={() => update({ ...draft, type })}
                        className="rounded-full border border-rule px-3 py-2"
                      >
                        <Text>{TYPE_LABELS[type]}</Text>
                      </Pressable>
                    ))}
                  </View>
                  <Text className="font-sans text-sm text-ink-2">
                    <Trans>Intensity</Trans>
                  </Text>
                  <View className="flex-row gap-2">
                    {(["light", "moderate", "vigorous"] as const).map((value) => (
                      <Pressable
                        key={value}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: draft.intensity === value }}
                        onPress={() =>
                          update({ ...draft, intensity: draft.intensity === value ? null : value })
                        }
                        className="rounded-full border border-rule px-3 py-2"
                      >
                        <Text>{INTENSITY_LABELS[value]}</Text>
                      </Pressable>
                    ))}
                  </View>
                  <TextInput
                    accessibilityLabel={t`Effort rating from 0 to 10`}
                    keyboardType="number-pad"
                    value={draft.effortRating == null ? "" : String(draft.effortRating)}
                    onChangeText={(v) =>
                      update({ ...draft, effortRating: v.trim() ? Number(v) : null })
                    }
                    placeholder={t`Effort (0–10, optional)`}
                    className={input}
                  />
                  <TextInput
                    accessibilityLabel={t`Notes`}
                    value={draft.notes}
                    onChangeText={(v) => update({ ...draft, notes: v })}
                    placeholder={t`Notes`}
                    className={input}
                  />
                  {draft.exercises.some((e) => e.sets.some((s) => !s.done)) ? (
                    <Text className="font-sans text-sm text-ink-2">
                      <Trans>Unfinished sets will not be saved.</Trans>
                    </Text>
                  ) : null}
                  {validateWorkoutDraft({
                    ...draft,
                    duration: draft.duration == null && isEditing ? null : Number(finishDuration),
                  }) ? (
                    <Text accessibilityRole="alert" className="font-sans text-sm text-destructive">
                      {validateWorkoutDraft({
                        ...draft,
                        duration:
                          draft.duration == null && isEditing ? null : Number(finishDuration),
                      }) === "INVALID_DURATION"
                        ? t`Duration must be between 1 and 1440 minutes.`
                        : validateWorkoutDraft({
                              ...draft,
                              duration:
                                draft.duration == null && isEditing ? null : Number(finishDuration),
                            }) === "INVALID_REPS"
                          ? t`Enter a whole number of reps for each completed set.`
                          : validateWorkoutDraft({
                                ...draft,
                                duration:
                                  draft.duration == null && isEditing
                                    ? null
                                    : Number(finishDuration),
                              }) === "INVALID_EFFORT"
                            ? t`Effort must be a whole number from 0 to 10.`
                            : t`Check the workout details and try again.`}
                    </Text>
                  ) : null}
                  <View className="flex-row gap-2">
                    <Button
                      onPress={() => {
                        const duration =
                          draft.duration == null && isEditing ? null : Number(finishDuration);
                        if (
                          (duration == null ||
                            (Number.isInteger(duration) && duration >= 1 && duration <= 1440)) &&
                          !validateWorkoutDraft({ ...draft, duration }) &&
                          session.finish({ ...draft, duration })
                        )
                          setFinishing(false);
                      }}
                    >
                      <Button.Label>{isEditing ? t`Save changes` : t`Save workout`}</Button.Label>
                    </Button>
                    <Button variant="outline" onPress={() => setFinishing(false)}>
                      <Button.Label>{t`Cancel`}</Button.Label>
                    </Button>
                  </View>
                </Sheet>
              ) : null}
              <Modal
                visible={picker}
                animationType="slide"
                presentationStyle="formSheet"
                onRequestClose={() => setPicker(false)}
              >
                <ScrollView
                  keyboardShouldPersistTaps="handled"
                  contentContainerClassName="gap-3 bg-paper p-5"
                  style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
                >
                  <Text className="font-display text-xl text-ink">
                    <Trans>Add an exercise</Trans>
                  </Text>
                  <TextInput
                    autoFocus
                    value={search}
                    onChangeText={setSearch}
                    placeholder={t`Search exercises`}
                    placeholderTextColor={placeholder}
                    className={input}
                  />
                  <View className="flex-row flex-wrap gap-2">
                    {(filters.data?.muscles ?? []).slice(0, 12).map((x) => (
                      <Pressable
                        key={x.externalId}
                        accessibilityRole="button"
                        accessibilityState={{ selected: muscleId === x.externalId }}
                        onPress={() => setMuscleId(muscleId === x.externalId ? "" : x.externalId)}
                        className="rounded-full border border-rule px-3 py-2"
                      >
                        <Text>{x.name}</Text>
                      </Pressable>
                    ))}
                  </View>
                  <View className="flex-row flex-wrap gap-2">
                    {(filters.data?.equipment ?? []).slice(0, 12).map((x) => (
                      <Pressable
                        key={x.externalId}
                        accessibilityRole="button"
                        accessibilityState={{ selected: equipmentId === x.externalId }}
                        onPress={() =>
                          setEquipmentId(equipmentId === x.externalId ? "" : x.externalId)
                        }
                        className="rounded-full border border-rule px-3 py-2"
                      >
                        <Text>{x.name}</Text>
                      </Pressable>
                    ))}
                  </View>
                  {(catalog.data ?? []).map((item) => (
                    <Pressable
                      key={item.id}
                      accessibilityRole="button"
                      onPress={() => {
                        if (
                          !update({
                            ...draft,
                            exercises: [...draft.exercises, newDraftExercise(item.name, item.id)],
                          })
                        )
                          return;
                        setPicker(false);
                        setSearch("");
                      }}
                      className="min-h-12 justify-center border-b border-rule"
                    >
                      <Text className="font-sans text-base text-ink">{item.name}</Text>
                    </Pressable>
                  ))}
                  <TextInput
                    value={name}
                    onChangeText={setName}
                    placeholder={t`Or enter an exercise name`}
                    placeholderTextColor={placeholder}
                    className={input}
                  />
                  <Button
                    onPress={() => {
                      if (name.trim()) {
                        if (
                          !update({
                            ...draft,
                            exercises: [...draft.exercises, newDraftExercise(name.trim())],
                          })
                        )
                          return;
                        setName("");
                        setPicker(false);
                      }
                    }}
                  >
                    <Button.Label>{t`Add custom exercise`}</Button.Label>
                  </Button>
                  <Button variant="outline" onPress={() => setPicker(false)}>
                    <Button.Label>{t`Cancel`}</Button.Label>
                  </Button>
                </ScrollView>
              </Modal>
            </ScrollView>
          </KeyboardAvoidingView>
        </Modal>
      )}
    </Section>
  );
}
