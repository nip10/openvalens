import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { Button } from "heroui-native";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react-native";
import { useState } from "react";
import {
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

import { DraggableRow } from "@/components/draggable-row";
import { ExerciseThumbnail } from "@/components/exercise-thumbnail";
import { moveItem } from "@/lib/workouts/active";
import { weightFromKg, weightToKg, type RoutineExerciseSnapshot } from "@/lib/workouts/model";
import { orpc } from "@/utils/orpc";
import { useThemeColor } from "@/utils/theme";

export type EditorExercise = RoutineExerciseSnapshot;

const field =
  "min-h-11 rounded-xl border border-rule-2 bg-paper-2 px-3 font-sans text-base text-ink";

const bounded = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, Number.isFinite(n) ? n : min));

function restLabel(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** The fields of one routine exercise: sets, rep range, rest, target weight, progression. */
function ExerciseFields({
  exercise,
  units,
  onChange,
}: {
  exercise: EditorExercise;
  units: "metric" | "imperial";
  onChange: (next: Partial<EditorExercise>) => void;
}) {
  const { t } = useLingui();
  const [weightText, setWeightText] = useState(
    exercise.targetWeightKg == null
      ? ""
      : String(Number(weightFromKg(exercise.targetWeightKg, units).toFixed(2))),
  );
  const [incrementText, setIncrementText] = useState(
    exercise.progression.kind === "none"
      ? ""
      : String(Number(weightFromKg(exercise.progression.incrementKg, units).toFixed(2))),
  );
  const number = (key: "targetSets" | "repsMin" | "repsMax" | "restSeconds", value: string) =>
    onChange({
      [key]: bounded(
        Number(value),
        0,
        key === "restSeconds" ? 3600 : key === "targetSets" ? 20 : 1000,
      ),
    });
  return (
    <View className="gap-2 pt-2">
      <View className="flex-row flex-wrap gap-2">
        {(
          [
            ["targetSets", t`Sets`],
            ["repsMin", t`Min reps`],
            ["repsMax", t`Max reps`],
            ["restSeconds", t`Rest seconds`],
          ] as const
        ).map(([key, label]) => (
          <View key={key} className="min-w-[45%] flex-1 gap-1">
            <Text className="font-sans text-xs text-ink-3">{label}</Text>
            <TextInput
              accessibilityLabel={label}
              keyboardType="number-pad"
              value={String(exercise[key])}
              onChangeText={(value) => number(key, value)}
              className={field}
            />
          </View>
        ))}
      </View>
      <Text className="font-sans text-xs text-ink-3">
        {units === "imperial" ? t`Target weight (lb)` : t`Target weight (kg)`}
      </Text>
      <TextInput
        accessibilityLabel={t`Target weight`}
        keyboardType="decimal-pad"
        placeholder={t`Optional`}
        value={weightText}
        onChangeText={(value) => {
          setWeightText(value);
          if (value === "") onChange({ targetWeightKg: null });
          else if (/^\d+(?:\.\d+)?$/.test(value))
            onChange({ targetWeightKg: weightToKg(Number(value), units) });
        }}
        className={field}
      />
      <Text className="font-sans text-xs text-ink-3">
        <Trans>Progression rule</Trans>
      </Text>
      <View className="flex-row flex-wrap gap-2">
        {(
          [
            ["none", t`No progression`],
            ["double", t`Double progression`],
            ["linear", t`Linear progression`],
          ] as const
        ).map(([kind, label]) => (
          <Pressable
            key={kind}
            accessibilityRole="radio"
            accessibilityState={{ checked: exercise.progression.kind === kind }}
            onPress={() => {
              setIncrementText(String(Number(weightFromKg(0.5, units).toFixed(2))));
              onChange({
                progression:
                  kind === "none"
                    ? { kind: "none" }
                    : kind === "double"
                      ? { kind, incrementKg: 0.5 }
                      : { kind, incrementKg: 0.5, deloadPercent: 10, failureThreshold: 2 },
              });
            }}
            className={`min-h-11 justify-center rounded-full border px-3 ${
              exercise.progression.kind === kind ? "border-signal bg-paper-3" : "border-rule-2"
            }`}
          >
            <Text className="font-sans text-sm text-ink">{label}</Text>
          </Pressable>
        ))}
      </View>
      {exercise.progression.kind !== "none" ? (
        <View className="gap-1">
          <Text className="font-sans text-xs text-ink-3">
            {units === "imperial" ? t`Increment (lb)` : t`Increment (kg)`}
          </Text>
          <TextInput
            accessibilityLabel={t`Increment`}
            keyboardType="decimal-pad"
            value={incrementText}
            onChangeText={(value) => {
              setIncrementText(value);
              if (!/^\d+(?:\.\d*)?$/.test(value)) return;
              const incrementKg = weightToKg(Number(value), units);
              const progression = exercise.progression;
              if (incrementKg > 0 && progression.kind !== "none")
                onChange({ progression: { ...progression, incrementKg } });
            }}
            className={field}
          />
        </View>
      ) : null}
      {exercise.progression.kind === "linear" ? (
        <View className="flex-row gap-2">
          <View className="flex-1 gap-1">
            <Text className="font-sans text-xs text-ink-3">
              <Trans>Deload percent</Trans>
            </Text>
            <TextInput
              accessibilityLabel={t`Deload percent`}
              keyboardType="number-pad"
              value={String(exercise.progression.deloadPercent)}
              onChangeText={(value) => {
                const progression = exercise.progression;
                if (progression.kind === "linear")
                  onChange({
                    progression: { ...progression, deloadPercent: bounded(Number(value), 0, 100) },
                  });
              }}
              className={field}
            />
          </View>
          <View className="flex-1 gap-1">
            <Text className="font-sans text-xs text-ink-3">
              <Trans>Failure threshold</Trans>
            </Text>
            <TextInput
              accessibilityLabel={t`Failure threshold`}
              keyboardType="number-pad"
              value={String(exercise.progression.failureThreshold)}
              onChangeText={(value) => {
                const progression = exercise.progression;
                if (progression.kind === "linear")
                  onChange({
                    progression: {
                      ...progression,
                      failureThreshold: bounded(Number(value), 1, 20),
                    },
                  });
              }}
              className={field}
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}

/**
 * Issue #403 — the full-screen routine editor (mockup i): name, exercises
 * from the library (or a typed name), and per exercise sets, rep range,
 * rest and progression (#289). Reorder by drag or accessibility actions.
 * Saving goes through the caller, which keeps the existing idempotent
 * routine mutations.
 */
export function RoutineEditor({
  visible,
  title,
  initialName,
  initialExercises,
  units,
  saving,
  error,
  newKey,
  onCancel,
  onSave,
}: {
  visible: boolean;
  title: string;
  initialName: string;
  initialExercises: EditorExercise[];
  units: "metric" | "imperial";
  saving: boolean;
  error: string;
  newKey: () => string;
  onCancel: () => void;
  onSave: (name: string, exercises: EditorExercise[]) => void;
}) {
  const { t, i18n } = useLingui();
  const insets = useSafeAreaInsets();
  const ink = useThemeColor("ink");
  const signal = useThemeColor("signal");
  const destructive = useThemeColor("destructive");
  const placeholder = useThemeColor("ink-3");
  const [name, setName] = useState(initialName);
  const [exercises, setExercises] = useState<EditorExercise[]>(initialExercises);
  const [open, setOpen] = useState<string | null>(
    initialExercises.length === 1 ? initialExercises[0]!.key : null,
  );
  const [picker, setPicker] = useState(false);
  const [search, setSearch] = useState("");
  const results = useQuery({
    ...orpc.exerciseCatalog.search.queryOptions({
      input: { query: search.trim() || undefined, language: i18n.locale || "en", limit: 20 },
    }),
    enabled: picker,
  });
  const patch = (key: string, next: Partial<EditorExercise>) =>
    setExercises((list) => list.map((item) => (item.key === key ? { ...item, ...next } : item)));
  const add = (exerciseName: string, exerciseId: number | null) => {
    const key = newKey();
    setExercises((list) => [
      ...list,
      {
        key,
        exerciseId,
        name: exerciseName,
        targetSets: 3,
        repsMin: 8,
        repsMax: 12,
        targetWeightKg: null,
        restSeconds: 90,
        progression: { kind: "none" },
      },
    ]);
    setOpen(key);
    setPicker(false);
    setSearch("");
  };
  const valid =
    name.trim().length > 0 && exercises.length > 0 && exercises.every((e) => e.name.trim());
  const progressionText = (exercise: EditorExercise) =>
    exercise.progression.kind === "none"
      ? t`Progression: none`
      : exercise.progression.kind === "double"
        ? t`Progression: double, +${Number(weightFromKg(exercise.progression.incrementKg, units).toFixed(2))} ${units === "metric" ? "kg" : "lb"}`
        : t`Progression: linear, +${Number(weightFromKg(exercise.progression.incrementKg, units).toFixed(2))} ${units === "metric" ? "kg" : "lb"}`;
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onCancel}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1 bg-paper"
        style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
      >
        <View className="flex-row items-center justify-between border-b border-rule px-2 py-2">
          <Pressable
            testID="routine-editor-cancel"
            accessibilityRole="button"
            onPress={onCancel}
            className="min-h-11 justify-center px-2.5"
          >
            <Text className="font-sans text-base text-ink-2">
              <Trans>Cancel</Trans>
            </Text>
          </Pressable>
          <Text accessibilityRole="header" className="font-display text-lg font-semibold text-ink">
            {title}
          </Text>
          <Pressable
            testID="routine-editor-save"
            accessibilityRole="button"
            accessibilityState={{ disabled: !valid || saving }}
            disabled={!valid || saving}
            onPress={() => onSave(name, exercises)}
            className={`min-h-11 justify-center px-2.5 ${!valid || saving ? "opacity-50" : ""}`}
          >
            <Text className="font-sans text-base font-semibold text-signal">
              {saving ? t`Saving…` : t`Save`}
            </Text>
          </Pressable>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-3.5 p-4">
          <View className="gap-1.5">
            <Text className="font-sans text-xs font-semibold text-ink-3">
              <Trans>Name</Trans>
            </Text>
            <TextInput
              testID="routine-editor-name"
              accessibilityLabel={t`Routine name`}
              placeholder={t`Routine name`}
              placeholderTextColor={placeholder}
              value={name}
              onChangeText={setName}
              className="min-h-[50px] rounded-2xl border border-rule-2 bg-sheet px-4 font-sans text-lg font-semibold text-ink"
            />
          </View>
          {error ? (
            <Text accessibilityRole="alert" className="font-sans text-sm text-destructive">
              {error}
            </Text>
          ) : null}
          {exercises.map((exercise, index) => (
            <DraggableRow
              key={exercise.key}
              index={index}
              count={exercises.length}
              label={exercise.name || t`Exercise ${index + 1}`}
              pitch={open ? 9999 : 96}
              testIDPrefix="routine-editor-drag"
              onMove={(from, to) => setExercises((list) => moveItem(list, from, to))}
            >
              <View className="sheet gap-1 p-3">
                <View className="flex-row items-center gap-2.5">
                  <ExerciseThumbnail exerciseId={exercise.exerciseId} size={40} />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ expanded: open === exercise.key }}
                    accessibilityLabel={t`Edit ${exercise.name}`}
                    onPress={() => setOpen(open === exercise.key ? null : exercise.key)}
                    className="min-h-11 flex-1 justify-center gap-1"
                  >
                    <Text className="font-sans text-base font-semibold text-ink">
                      {exercise.name}
                    </Text>
                    <Text className="num font-sans text-sm text-ink-2">
                      {t`${exercise.targetSets} sets · ${exercise.repsMin}–${exercise.repsMax} reps · rest ${restLabel(exercise.restSeconds)}`}
                    </Text>
                    <Text className="font-sans text-xs text-ink-3">
                      {progressionText(exercise)}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={open === exercise.key ? t`Collapse` : t`Expand`}
                    onPress={() => setOpen(open === exercise.key ? null : exercise.key)}
                    className="h-11 w-11 items-center justify-center"
                  >
                    {open === exercise.key ? (
                      <ChevronUp size={20} color={ink} />
                    ) : (
                      <ChevronDown size={20} color={ink} />
                    )}
                  </Pressable>
                </View>
                {open === exercise.key ? (
                  <>
                    <ExerciseFields
                      exercise={exercise}
                      units={units}
                      onChange={(next) => patch(exercise.key, next)}
                    />
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => {
                        setExercises((list) => list.filter((item) => item.key !== exercise.key));
                        setOpen(null);
                      }}
                      className="min-h-11 flex-row items-center gap-2 self-start"
                    >
                      <Trash2 size={16} color={destructive} />
                      <Text className="font-sans text-sm text-destructive">
                        {t`Remove ${exercise.name}`}
                      </Text>
                    </Pressable>
                  </>
                ) : null}
              </View>
            </DraggableRow>
          ))}
          <Pressable
            testID="routine-editor-add"
            accessibilityRole="button"
            onPress={() => setPicker(true)}
            className="min-h-[52px] flex-row items-center justify-center gap-2 rounded-full border border-dashed border-rule-2"
          >
            <Plus size={16} color={signal} />
            <Text className="font-sans text-base font-semibold text-signal">
              <Trans>Add exercises from the library</Trans>
            </Text>
          </Pressable>
        </ScrollView>
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
              accessibilityLabel={t`Search exercise or enter a name`}
              placeholder={t`Search exercise or enter a name`}
              placeholderTextColor={placeholder}
              value={search}
              onChangeText={setSearch}
              className={field}
            />
            {(results.data ?? []).map((item: { id: number; name: string; media?: unknown }) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                onPress={() => add(item.name, item.id)}
                className="min-h-14 flex-row items-center gap-3 border-b border-rule"
              >
                <ExerciseThumbnail exerciseId={item.id} media={item.media} size={40} />
                <Text className="flex-1 font-sans text-base text-ink">{item.name}</Text>
              </Pressable>
            ))}
            {search.trim() ? (
              <Button variant="secondary" onPress={() => add(search.trim(), null)}>
                <Button.Label>{t`Add “${search.trim()}” as a custom exercise`}</Button.Label>
              </Button>
            ) : null}
            <Button variant="outline" onPress={() => setPicker(false)}>
              <Button.Label>{t`Cancel`}</Button.Label>
            </Button>
          </ScrollView>
        </Modal>
      </KeyboardAvoidingView>
    </Modal>
  );
}
