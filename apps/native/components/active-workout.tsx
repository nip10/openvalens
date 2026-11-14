import { msg, plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { Button } from "heroui-native";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ListOrdered,
  MoreHorizontal,
  Plus,
  Trash2,
} from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
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
import { useRouter } from "expo-router";
import { progressionWhy } from "@openvalens/api/presenters/workout-progression";
import { parseDecimal } from "@openvalens/i18n/numbers";

import { Sheet } from "@/components/bloom";
import { DateField } from "@/components/date-field";
import { ExerciseThumbnail } from "@/components/exercise-thumbnail";
import { DISPLAY_MAX_FONT_SCALE } from "@/components/font-scale";
import { WorkoutExerciseHistory } from "@/components/workout-history";
import { WorkoutExerciseTools } from "@/components/workout-exercise-tools";
import { WorkoutOverviewSheet, type OverviewItem } from "@/components/workout-overview-sheet";
import {
  exerciseProgress,
  formatClock,
  initialExerciseId,
  moveItem,
  prefillForNewSet,
  resolveCurrentIndex,
  routineTarget,
  setTotals,
  targetParts,
  type PreviousSet,
} from "@/lib/workouts/active";
import {
  addDraftSet,
  newDraftExercise,
  validateWorkoutDraft,
  weightFromKg,
  weightToKg,
  type DraftExercise,
  type WorkoutDraft,
} from "@/lib/workouts/model";
import type { WorkoutRestTimer } from "@/lib/workouts/rest-timer";
import type { useWorkoutSession } from "@/lib/workouts/sync";
import { orpc } from "@/utils/orpc";
import { exercisePickTestId } from "@/lib/exercises/detail";
import { useThemeColor } from "@/utils/theme";

const input =
  "min-h-11 rounded-xl border border-rule-2 bg-paper-2 px-3 font-sans text-base text-ink";
const cell = "h-12 rounded-xl bg-paper-2 px-1 text-center font-sans text-lg font-semibold text-ink";

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

function localDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const exerciseKey = (exercise: Pick<DraftExercise, "exerciseId" | "name">) =>
  exercise.exerciseId ? `id:${exercise.exerciseId}` : `name:${exercise.name}`;

function displayWeight(kg: number, units: "metric" | "imperial") {
  return String(Number(weightFromKg(kg, units).toFixed(1)));
}

/** One row of the logging table: SET · PREVIOUS · KG · REPS · ✓ (RPE when shown). */
function SetRow({
  set,
  index,
  units,
  previous,
  showRpe,
  onChange,
  onDelete,
  onDone,
}: {
  set: { id: string; weightKg: number | null; reps: string; rpe: string; done: boolean };
  index: number;
  units: "metric" | "imperial";
  previous: PreviousSet | null;
  showRpe: boolean;
  onChange: (next: typeof set) => void;
  onDelete: () => void;
  onDone: (done: boolean) => void;
}) {
  const { t, i18n } = useLingui();
  const signalInk = useThemeColor("signal-ink");
  const muted = useThemeColor("ink-3");
  const [weightText, setWeightText] = useState(
    set.weightKg == null ? "" : displayWeight(set.weightKg, units),
  );
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setWeightText(set.weightKg == null ? "" : displayWeight(set.weightKg, units));
  }, [set.weightKg, units, focused]);
  const unit = units === "metric" ? t`kilograms` : t`pounds`;
  const previousText = previous
    ? `${previous.weightKg == null ? "—" : displayWeight(previous.weightKg, units)} × ${previous.reps ?? "—"}`
    : "—";
  return (
    <View
      className={`min-h-16 flex-row items-center gap-2 rounded-2xl px-1 ${set.done ? "bg-paper-3" : ""}`}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t`Delete set ${index + 1}`}
        onLongPress={onDelete}
        onPress={() =>
          Alert.alert(t`Delete set ${index + 1}?`, undefined, [
            { text: t`Cancel`, style: "cancel" },
            { text: t`Delete`, style: "destructive", onPress: onDelete },
          ])
        }
        className="h-11 w-9 items-center justify-center"
      >
        <Text className="num font-display text-lg font-semibold text-ink">{index + 1}</Text>
      </Pressable>
      <Text
        accessibilityLabel={previous ? t`Previous: ${previousText}` : t`No previous set`}
        numberOfLines={1}
        className="num min-w-0 flex-[1.2] font-sans text-sm text-ink-3"
      >
        {previousText}
      </Text>
      <TextInput
        testID={`set-weight-${index + 1}`}
        accessibilityLabel={t`Set ${index + 1} weight in ${unit}`}
        keyboardType="decimal-pad"
        value={weightText}
        selectTextOnFocus
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChangeText={(v) => {
          setWeightText(v);
          if (!v.trim()) onChange({ ...set, weightKg: null });
          else {
            // The shared parser with the member's locale (#455): "82,5" and
            // "82.5" are 82.5; "1,250" is refused in English, not read as 1.25.
            const weight = parseDecimal(v, i18n.locale);
            if (weight !== null && weight >= 0)
              onChange({ ...set, weightKg: weightToKg(weight, units) });
          }
        }}
        placeholder={i18n._(
          units === "metric"
            ? msg({ message: "kg", context: "unit" })
            : msg({ message: "lb", context: "unit" }),
        )}
        className={`${cell} min-w-0 flex-1`}
      />
      <TextInput
        testID={`set-reps-${index + 1}`}
        accessibilityLabel={t`Set ${index + 1} reps`}
        keyboardType="number-pad"
        value={set.reps}
        selectTextOnFocus
        onChangeText={(reps) => onChange({ ...set, reps })}
        placeholder={t`Reps`}
        className={`${cell} min-w-0 flex-1`}
      />
      {showRpe ? (
        <TextInput
          testID={`set-rpe-${index + 1}`}
          accessibilityLabel={t`Set ${index + 1} RPE (optional)`}
          keyboardType="decimal-pad"
          value={set.rpe}
          onChangeText={(rpe) => onChange({ ...set, rpe })}
          placeholder="RPE"
          className={`${cell} w-14`}
        />
      ) : null}
      <Pressable
        testID={`set-done-${index + 1}`}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: set.done }}
        accessibilityLabel={t`Set ${index + 1} done`}
        onPress={() => onDone(!set.done)}
        className={`h-12 w-12 items-center justify-center rounded-2xl ${
          set.done ? "bg-signal" : "border-2 border-rule-2 bg-sheet"
        }`}
      >
        <Check size={22} strokeWidth={2.6} color={set.done ? signalInk : muted} />
      </Pressable>
    </View>
  );
}

/**
 * Issue #401 — the active workout, one exercise per screen (Liftosaur) with
 * a Hevy-style logging table: progress strip with prev/next, the current
 * exercise with its thumbnail and target, SET · PREVIOUS · KG · REPS · ✓,
 * a rest timer that starts on tick, "Next: …", and the full-workout
 * overview sheet. Drafts, the outbox and the rest timer are unchanged.
 */
export function ActiveWorkout({
  draft,
  session,
  rest,
  units,
  onMinimize,
}: {
  draft: WorkoutDraft;
  session: ReturnType<typeof useWorkoutSession>;
  rest: WorkoutRestTimer;
  units: "metric" | "imperial";
  onMinimize: () => void;
}) {
  const { t, i18n } = useLingui();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const placeholder = useThemeColor("ink-3");
  const ink = useThemeColor("ink");
  const signal = useThemeColor("signal");
  const signalInk = useThemeColor("signal-ink");
  const destructive = useThemeColor("destructive");
  const [now, setNow] = useState(Date.now());
  const [currentId, setCurrentId] = useState<string | null>(() =>
    initialExerciseId(draft.exercises),
  );
  const [overview, setOverview] = useState(false);
  const [picker, setPicker] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const scroll = useRef<ScrollView>(null);
  const [menu, setMenu] = useState(false);
  const [panel, setPanel] = useState<"history" | "rest" | null>(null);
  const [rpeFor, setRpeFor] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [muscleId, setMuscleId] = useState("");
  const [equipmentId, setEquipmentId] = useState("");
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  // The finish form opens at the end of the list, often below the fold, so
  // Finish brings it (and its Save button) into view.
  useEffect(() => {
    if (!finishing) return;
    const frame = requestAnimationFrame(() => scroll.current?.scrollToEnd?.({ animated: true }));
    return () => cancelAnimationFrame(frame);
  }, [finishing]);

  const filters = useQuery(orpc.exerciseCatalog.filters.queryOptions({ input: {} }));
  const catalog = useQuery(
    orpc.exerciseCatalog.search.queryOptions({
      input: {
        query: search.trim() || undefined,
        language: i18n.locale || "en",
        limit: 20,
        muscleExternalId: muscleId || undefined,
        equipmentExternalId: equipmentId || undefined,
      },
    }),
  );
  const lastPerformanceOptions = orpc.plans.workouts.lastPerformance.queryOptions({
    input: {
      exerciseIds: [
        ...new Set(draft.exercises.flatMap((e) => (e.exerciseId ? [e.exerciseId] : []))),
      ],
      names: [...new Set(draft.exercises.filter((e) => e.exerciseId == null).map((e) => e.name))],
      onOrBeforeDate: draft.date,
      excludeWorkoutId: draft.workoutId,
    },
  });
  const lastPerformance = useQuery({
    ...lastPerformanceOptions,
    queryKey: [...lastPerformanceOptions.queryKey, { scope: session.scope }],
    enabled: Boolean(session.scope),
  });
  const previousSets = (exercise: DraftExercise): PreviousSet[] | undefined => {
    const row = lastPerformance.data?.items?.find((item) =>
      exercise.exerciseId != null
        ? "exerciseId" in item.ref && item.ref.exerciseId === exercise.exerciseId
        : "name" in item.ref &&
          item.ref.name.trim().toLocaleLowerCase() === exercise.name.trim().toLocaleLowerCase(),
    );
    return row?.performance?.exercises[0]?.sets;
  };

  const isEditing = draft.mode === "edit" || draft.workoutId != null;
  const elapsedSeconds = Math.max(0, Math.floor((now - Date.parse(draft.startedAt)) / 1000));
  const elapsed = Math.floor(elapsedSeconds / 60);
  const finishDuration = draft.duration ?? Math.max(1, elapsed);
  const update = (next: WorkoutDraft): boolean => {
    const saved = session.saveDraft(next);
    if (!saved)
      Alert.alert(t`Could not save workout`, t`This change was not saved. Please try again.`);
    return saved;
  };
  const exercises = draft.exercises;
  const currentIndex = resolveCurrentIndex(exercises, currentId);
  const current = currentIndex >= 0 ? exercises[currentIndex] : undefined;
  const progress = exerciseProgress(exercises, currentIndex);
  const totals = setTotals(exercises);
  const doneSets = exercises.reduce((n, e) => n + e.sets.filter((s) => s.done).length, 0);
  const title = draft.routineSnapshot?.name ?? (isEditing ? t`Edit session` : t`Workout`);
  const weightUnit = i18n._(
    units === "metric"
      ? msg({ message: "kg", context: "unit" })
      : msg({ message: "lb", context: "unit" }),
  );
  const targetText = (exercise: DraftExercise) => {
    const parts = targetParts(exercise, routineTarget(draft, exercise));
    if (!parts) return null;
    const base = parts.reps ? `${parts.sets} × ${parts.reps}` : `${parts.sets} ×`;
    return parts.weightKg == null
      ? base
      : `${base} @ ${displayWeight(parts.weightKg, units)} ${weightUnit}`;
  };
  const replaceExercise = (index: number, next: DraftExercise) =>
    update({ ...draft, exercises: exercises.map((x, i) => (i === index ? next : x)) });
  const goTo = (index: number) => {
    const target = exercises[index];
    if (!target) return;
    setCurrentId(target.id);
    setMenu(false);
    setPanel(null);
  };
  const addExercise = (exercise: DraftExercise) => {
    if (!update({ ...draft, exercises: [...exercises, exercise] })) return;
    setCurrentId(exercise.id);
    setPicker(false);
    setSearch("");
    setName("");
  };
  const removeCurrent = () => {
    if (!current) return;
    Alert.alert(t`Remove ${current.name}?`, t`Its sets in this workout are removed too.`, [
      { text: t`Cancel`, style: "cancel" },
      {
        text: t`Remove`,
        style: "destructive",
        onPress: () => {
          const next = exercises.filter((_, i) => i !== currentIndex);
          if (update({ ...draft, exercises: next }))
            setCurrentId(next[Math.min(currentIndex, next.length - 1)]?.id ?? null);
          setMenu(false);
        },
      },
    ]);
  };
  const discard = () =>
    Alert.alert(t`Discard workout?`, t`This active workout will be deleted.`, [
      { text: t`Cancel`, style: "cancel" },
      { text: t`Discard`, style: "destructive", onPress: () => session.discardDraft() },
    ]);

  const target = current ? routineTarget(draft, current) : undefined;
  const why =
    target &&
    target.suggestion &&
    typeof target.suggestion === "object" &&
    "reason" in target.suggestion
      ? i18n._(progressionWhy(target.suggestion, target, units))
      : null;
  const next = currentIndex >= 0 ? exercises[currentIndex + 1] : undefined;
  const restTotal = rest.exerciseKey ? rest.restSeconds(rest.exerciseKey) : 0;
  const validation = validateWorkoutDraft({
    ...draft,
    duration: draft.duration == null && isEditing ? null : Number(finishDuration),
  });

  const overviewItems: OverviewItem[] = exercises.map((exercise, index) => ({
    id: exercise.id,
    exerciseId: exercise.exerciseId,
    name: exercise.name,
    target: targetText(exercise),
    progress: progress[index]!,
  }));

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onMinimize}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1 bg-paper"
        style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
      >
        {/* Header: minimise · name and timer · overview · Finish */}
        <View className="flex-row items-center gap-1 px-2 pb-2 pt-3">
          <Pressable
            testID="workout-minimize"
            accessibilityRole="button"
            accessibilityLabel={t`Minimize workout`}
            onPress={onMinimize}
            className="h-11 w-11 items-center justify-center"
          >
            <ChevronDown size={22} color={ink} />
          </Pressable>
          <View className="flex-1">
            <Text
              numberOfLines={1}
              className="font-display text-xl font-semibold text-ink"
              maxFontSizeMultiplier={DISPLAY_MAX_FONT_SCALE}
            >
              {title}
            </Text>
            {isEditing ? null : (
              <Text accessibilityRole="timer" className="num font-sans text-sm text-ink-2">
                {t`${formatClock(elapsedSeconds)} elapsed`}
              </Text>
            )}
          </View>
          <Pressable
            testID="workout-overview-open"
            accessibilityRole="button"
            accessibilityLabel={t`Show all exercises in this workout`}
            onPress={() => setOverview(true)}
            className="h-11 w-11 items-center justify-center rounded-full border border-rule-2 bg-sheet"
          >
            <ListOrdered size={20} color={ink} />
          </Pressable>
          <Pressable
            testID="workout-finish"
            accessibilityRole="button"
            accessibilityLabel={t`Finish workout`}
            onPress={() => setFinishing(true)}
            className="min-h-11 justify-center rounded-full bg-signal px-5"
          >
            <Text className="font-sans text-base font-semibold" style={{ color: signalInk }}>
              {isEditing ? t`Save` : t`Finish`}
            </Text>
          </Pressable>
        </View>

        {/* Progress strip with prev / next */}
        {exercises.length > 0 ? (
          <View className="flex-row items-center gap-2 pl-1 pr-2">
            <Pressable
              testID="workout-prev"
              accessibilityRole="button"
              accessibilityLabel={
                currentIndex > 0
                  ? t`Previous exercise: ${exercises[currentIndex - 1]!.name}`
                  : t`Previous exercise`
              }
              accessibilityState={{ disabled: currentIndex <= 0 }}
              disabled={currentIndex <= 0}
              onPress={() => goTo(currentIndex - 1)}
              className={`h-11 w-11 items-center justify-center ${currentIndex <= 0 ? "opacity-40" : ""}`}
            >
              <ChevronLeft size={22} color={ink} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t`Exercise ${currentIndex + 1} of ${exercises.length}. Show all exercises`}
              onPress={() => setOverview(true)}
              className="min-h-11 flex-1 flex-row items-center gap-1.5"
            >
              {progress.map((item, index) => (
                <View
                  key={exercises[index]!.id}
                  className={`h-1.5 flex-1 rounded-full ${
                    item.state === "current"
                      ? "bg-signal"
                      : item.state === "done"
                        ? "bg-ink-2"
                        : "bg-rule-2"
                  }`}
                />
              ))}
            </Pressable>
            <Text className="num min-w-11 text-center font-sans text-sm font-semibold text-ink-2">
              {t`${currentIndex + 1} of ${exercises.length}`}
            </Text>
            <Pressable
              testID="workout-next"
              accessibilityRole="button"
              accessibilityLabel={next ? t`Next exercise: ${next.name}` : t`Next exercise`}
              accessibilityState={{ disabled: !next }}
              disabled={!next}
              onPress={() => goTo(currentIndex + 1)}
              className={`h-11 w-11 items-center justify-center ${next ? "" : "opacity-40"}`}
            >
              <ChevronRight size={22} color={ink} />
            </Pressable>
          </View>
        ) : null}

        <ScrollView
          ref={scroll}
          keyboardShouldPersistTaps="handled"
          contentContainerClassName="gap-4 px-4 pb-6 pt-3"
        >
          <Text testID="workout-summary" className="font-sans text-sm text-ink-3">
            {t`${plural(exercises.length, { one: "# exercise", other: "# exercises" })}`},{" "}
            {t`${plural(doneSets, { one: "# set done", other: "# sets done" })}`}
          </Text>

          {!current ? (
            <Sheet className="items-center gap-3">
              <Text className="font-display text-xl text-ink">
                <Trans>No exercises yet</Trans>
              </Text>
              <Text className="text-center font-sans text-sm text-ink-2">
                <Trans>Add the first exercise to start logging sets.</Trans>
              </Text>
              <Button testID="workout-add-exercise" onPress={() => setPicker(true)}>
                <Button.Label>{t`Add exercise`}</Button.Label>
              </Button>
            </Sheet>
          ) : (
            <>
              {/* Current exercise */}
              <View className="flex-row items-center gap-3">
                {current.exerciseId ? (
                  <Pressable
                    testID="workout-exercise-detail"
                    accessibilityRole="link"
                    accessibilityLabel={t`${current.name} details`}
                    onPress={() => {
                      // The workout is a modal: tuck it away, then open the exercise page.
                      onMinimize();
                      router.push(`/exercise/${current.exerciseId}`);
                    }}
                  >
                    <ExerciseThumbnail exerciseId={current.exerciseId} size={76} />
                  </Pressable>
                ) : (
                  <ExerciseThumbnail exerciseId={current.exerciseId} size={76} />
                )}
                <View className="flex-1 gap-1">
                  <Text
                    accessibilityRole="header"
                    className="font-display text-2xl font-semibold text-ink"
                    maxFontSizeMultiplier={DISPLAY_MAX_FONT_SCALE}
                  >
                    {current.name}
                  </Text>
                  {targetText(current) ? (
                    <Text className="num font-sans text-base font-semibold text-ink">
                      {targetText(current)}
                    </Text>
                  ) : null}
                  {why ? <Text className="font-sans text-sm text-ink-2">{why}</Text> : null}
                </View>
                <Pressable
                  testID="workout-exercise-menu"
                  accessibilityRole="button"
                  accessibilityLabel={t`${current.name} options`}
                  accessibilityState={{ expanded: menu }}
                  onPress={() => setMenu(!menu)}
                  className="h-11 w-11 items-center justify-center"
                >
                  <MoreHorizontal size={22} color={ink} />
                </Pressable>
              </View>
              {menu ? (
                <Sheet className="gap-1 p-2">
                  {(
                    [
                      ["history", t`Exercise history`],
                      ["rest", t`Rest timer and alerts`],
                    ] as const
                  ).map(([key, label]) => (
                    <Pressable
                      key={key}
                      accessibilityRole="button"
                      accessibilityState={{ selected: panel === key }}
                      onPress={() => {
                        setPanel(panel === key ? null : key);
                        setMenu(false);
                      }}
                      className="min-h-11 justify-center px-3"
                    >
                      <Text className="font-sans text-base text-ink">{label}</Text>
                    </Pressable>
                  ))}
                  <Pressable
                    accessibilityRole="switch"
                    accessibilityState={{ checked: Boolean(rpeFor[current.id]) }}
                    onPress={() => {
                      setRpeFor({ ...rpeFor, [current.id]: !rpeFor[current.id] });
                      setMenu(false);
                    }}
                    className="min-h-11 justify-center px-3"
                  >
                    <Text className="font-sans text-base text-ink">
                      {rpeFor[current.id] ? t`Hide RPE` : t`Record RPE`}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={removeCurrent}
                    className="min-h-11 flex-row items-center gap-2 px-3"
                  >
                    <Trash2 size={16} color={destructive} />
                    <Text className="font-sans text-base text-destructive">
                      <Trans>Remove exercise</Trans>
                    </Text>
                  </Pressable>
                </Sheet>
              ) : null}
              {panel === "history" ? (
                <WorkoutExerciseHistory
                  exercise={
                    current.exerciseId ? { exerciseId: current.exerciseId } : { name: current.name }
                  }
                />
              ) : null}
              {panel === "rest" ? (
                <WorkoutExerciseTools
                  exerciseKey={exerciseKey(current)}
                  suggestion={target?.suggestion}
                  prescription={target}
                  units={units}
                  rest={rest}
                  fallbackSeconds={target?.restSeconds ?? 90}
                />
              ) : null}

              {/* Logging table */}
              <Sheet className="gap-1 px-3 py-3">
                <View className="flex-row items-center gap-2 px-1" accessibilityElementsHidden>
                  <Text className="w-9 text-center font-sans text-xs font-semibold text-ink-3">
                    <Trans>Set</Trans>
                  </Text>
                  <Text className="flex-[1.2] font-sans text-xs font-semibold text-ink-3">
                    <Trans>Previous</Trans>
                  </Text>
                  <Text className="flex-1 text-center font-sans text-xs font-semibold text-ink-3">
                    {weightUnit}
                  </Text>
                  <Text className="flex-1 text-center font-sans text-xs font-semibold text-ink-3">
                    <Trans>Reps</Trans>
                  </Text>
                  {rpeFor[current.id] ? (
                    <Text className="w-14 text-center font-sans text-xs font-semibold text-ink-3">
                      RPE
                    </Text>
                  ) : null}
                  <Text className="w-12 text-center font-sans text-xs font-semibold text-ink-3">
                    <Trans>Done</Trans>
                  </Text>
                </View>
                {current.sets.map((set, si) => (
                  <SetRow
                    key={set.id}
                    set={set}
                    index={si}
                    units={units}
                    previous={previousSets(current)?.[si] ?? null}
                    showRpe={Boolean(rpeFor[current.id])}
                    onChange={(value) =>
                      replaceExercise(currentIndex, {
                        ...current,
                        sets: current.sets.map((s, j) => (j === si ? value : s)),
                      })
                    }
                    onDelete={() =>
                      replaceExercise(currentIndex, {
                        ...current,
                        sets: current.sets.filter((_, j) => j !== si),
                      })
                    }
                    onDone={(done) => {
                      const saved = replaceExercise(currentIndex, {
                        ...current,
                        sets: current.sets.map((s, j) => (j === si ? { ...s, done } : s)),
                      });
                      // Ticking a set starts the rest timer (today's live workouts only).
                      if (
                        saved &&
                        done &&
                        !set.done &&
                        !isEditing &&
                        draft.date === localDate(new Date())
                      ) {
                        const key = exerciseKey(current);
                        void rest.start(key, rest.restSeconds(key, target?.restSeconds));
                      }
                    }}
                  />
                ))}
                <Pressable
                  testID="workout-add-set"
                  accessibilityRole="button"
                  onPress={() =>
                    replaceExercise(
                      currentIndex,
                      addDraftSet(
                        current,
                        undefined,
                        prefillForNewSet(current, previousSets(current), target),
                      ),
                    )
                  }
                  className="min-h-12 flex-row items-center gap-2 px-1"
                >
                  <Plus size={16} color={signal} />
                  <Text className="font-sans text-base font-semibold text-signal">
                    <Trans>Add set</Trans>
                  </Text>
                </Pressable>
              </Sheet>

              {/* Rest timer */}
              {rest.active ? (
                <View testID="workout-rest" className="gap-2.5 rounded-3xl bg-ink py-3 pl-5 pr-3">
                  <View className="flex-row items-center justify-between gap-2">
                    <Text
                      accessibilityRole="timer"
                      className="num flex-1 font-sans text-base text-paper"
                    >
                      {t`Rest ${formatClock(rest.remainingSeconds)} of ${formatClock(restTotal)}`}
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t`Add 30 seconds of rest`}
                      onPress={() => void rest.adjust(30)}
                      className="min-h-11 justify-center rounded-full bg-ink-2 px-4"
                    >
                      <Text className="font-sans text-sm text-paper">{t`+30 s`}</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t`Skip rest`}
                      onPress={() => void rest.skip()}
                      className="min-h-11 justify-center rounded-full bg-ink-2 px-4"
                    >
                      <Text className="font-sans text-sm text-paper">
                        <Trans>Skip</Trans>
                      </Text>
                    </Pressable>
                  </View>
                  <View className="h-1.5 overflow-hidden rounded-full bg-ink-2">
                    <View
                      className="h-full bg-paper"
                      style={{
                        width: `${Math.max(0, Math.min(100, (rest.remainingSeconds / Math.max(1, restTotal)) * 100))}%`,
                      }}
                    />
                  </View>
                </View>
              ) : null}

              {/* Next */}
              {next ? (
                <Pressable
                  testID="workout-next-card"
                  accessibilityRole="button"
                  accessibilityLabel={t`Next: ${next.name}`}
                  onPress={() => goTo(currentIndex + 1)}
                  className="min-h-16 flex-row items-center justify-between rounded-2xl border border-rule-2 bg-sheet px-4"
                >
                  <View className="flex-1 gap-0.5">
                    <Text className="font-sans text-xs font-semibold text-ink-3">
                      <Trans>Next</Trans>
                    </Text>
                    <Text numberOfLines={1} className="font-sans text-base font-semibold text-ink">
                      {targetText(next) ? `${next.name} · ${targetText(next)}` : next.name}
                    </Text>
                  </View>
                  <ChevronRight size={20} color={ink} />
                </Pressable>
              ) : null}
            </>
          )}

          {session.error ? (
            <Text accessibilityRole="alert" className="font-sans text-sm text-destructive">
              <Trans>Could not save workout changes. Please try again.</Trans>
            </Text>
          ) : null}

          {finishing ? (
            <Sheet className="gap-3">
              <Text className="font-display text-xl text-ink">
                <Trans>Finish workout</Trans>
              </Text>
              <TextInput
                accessibilityLabel={t`Duration in minutes`}
                keyboardType="number-pad"
                value={draft.duration == null && isEditing ? "" : String(finishDuration)}
                onChangeText={(v) => update({ ...draft, duration: v.trim() ? Number(v) : null })}
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
                    className="min-h-11 justify-center rounded-full border border-rule px-3"
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
                    className="min-h-11 justify-center rounded-full border border-rule px-3"
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
              {exercises.some((e) => e.sets.some((s) => !s.done)) ? (
                <Text className="font-sans text-sm text-ink-2">
                  <Trans>Unfinished sets will not be saved.</Trans>
                </Text>
              ) : null}
              {validation ? (
                <Text accessibilityRole="alert" className="font-sans text-sm text-destructive">
                  {validation === "INVALID_DURATION"
                    ? t`Duration must be between 1 and 1440 minutes.`
                    : validation === "INVALID_REPS"
                      ? t`Enter a whole number of reps for each completed set.`
                      : validation === "INVALID_EFFORT"
                        ? t`Effort must be a whole number from 0 to 10.`
                        : t`Check the workout details and try again.`}
                </Text>
              ) : null}
              <View className="flex-row gap-2">
                <Button
                  testID="workout-save"
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
        </ScrollView>

        <WorkoutOverviewSheet
          visible={overview}
          title={t`This workout`}
          items={overviewItems}
          setsDone={totals.done}
          setsPlanned={totals.planned}
          onClose={() => setOverview(false)}
          onJump={(id) => {
            setCurrentId(id);
            setOverview(false);
            setMenu(false);
            setPanel(null);
          }}
          onMove={(from, to) => update({ ...draft, exercises: moveItem(exercises, from, to) })}
          onAddExercise={() => {
            setOverview(false);
            setPicker(true);
          }}
          footer={
            <View className="gap-3 pb-6 pt-3">
              <DateField
                label={t`Workout date`}
                value={draft.date}
                onChange={(date) => date && update({ ...draft, date })}
              />
              {session.items.length > 0 ? (
                <Text className="font-sans text-sm text-ink-2">
                  {t`${plural(session.items.length, { one: "# change waiting to sync", other: "# changes waiting to sync" })}`}
                </Text>
              ) : null}
              <Button
                testID="workout-discard"
                variant="outline"
                onPress={() => {
                  setOverview(false);
                  discard();
                }}
              >
                <Button.Label>{t`Discard workout`}</Button.Label>
              </Button>
            </View>
          }
        />

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
            {(filters.data?.muscles ?? []).length > 0 ? (
              <View className="flex-row flex-wrap gap-2">
                {(filters.data?.muscles ?? []).slice(0, 12).map((x) => (
                  <Pressable
                    key={x.externalId}
                    accessibilityRole="button"
                    accessibilityState={{ selected: muscleId === x.externalId }}
                    onPress={() => setMuscleId(muscleId === x.externalId ? "" : x.externalId)}
                    className="min-h-11 justify-center rounded-full border border-rule px-3"
                  >
                    <Text>{x.name}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            {(filters.data?.equipment ?? []).length > 0 ? (
              <View className="flex-row flex-wrap gap-2">
                {(filters.data?.equipment ?? []).slice(0, 12).map((x) => (
                  <Pressable
                    key={x.externalId}
                    accessibilityRole="button"
                    accessibilityState={{ selected: equipmentId === x.externalId }}
                    onPress={() => setEquipmentId(equipmentId === x.externalId ? "" : x.externalId)}
                    className="min-h-11 justify-center rounded-full border border-rule px-3"
                  >
                    <Text>{x.name}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            {(catalog.data ?? []).map((item) => (
              <Pressable
                key={item.id}
                testID={exercisePickTestId(item)}
                accessibilityRole="button"
                onPress={() => addExercise(newDraftExercise(item.name, item.id))}
                className="min-h-14 flex-row items-center gap-3 border-b border-rule"
              >
                <ExerciseThumbnail exerciseId={item.id} media={item.media} size={40} />
                <Text className="flex-1 font-sans text-base text-ink">{item.name}</Text>
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
                if (name.trim()) addExercise(newDraftExercise(name.trim()));
              }}
            >
              <Button.Label>{t`Add custom exercise`}</Button.Label>
            </Button>
            <Button variant="outline" onPress={() => setPicker(false)}>
              <Button.Label>{t`Cancel`}</Button.Label>
            </Button>
          </ScrollView>
        </Modal>
      </KeyboardAvoidingView>
    </Modal>
  );
}
