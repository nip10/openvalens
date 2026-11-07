import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { MoreHorizontal, Play, Plus } from "lucide-react-native";
import * as Crypto from "expo-crypto";
import { useEffect, useRef, useState } from "react";
import {
  ActionSheetIOS,
  Alert,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { RoutineEditor } from "@/components/routine-editor";
import { useWorkoutSession } from "@/lib/workouts/sync";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { client, orpc } from "@/utils/orpc";
import { useOfflineScope } from "@/lib/offline/sync";
import {
  createDraftFromRoutinePreview,
  type WorkoutDraft,
  type WorkoutDetail,
  type RoutineExerciseSnapshot,
} from "@/lib/workouts/model";
import { useThemeColor } from "@/utils/theme";
import { progressionWhy } from "@openvalens/api/presenters/workout-progression";

type Exercise = RoutineExerciseSnapshot;
type Routine = {
  id: number;
  version: number;
  name: string;
  notes: string | null;
  exercises: Exercise[];
};
const uuid = () => Crypto.randomUUID();
const bounded = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, Number.isFinite(n) ? n : min));
function fields(name: string, notes: string | null | undefined, exercises: Exercise[]) {
  return { name: name.trim(), notes: notes ?? null, exercises };
}

/**
 * Starting a routine (#402): fetch its preview with progression suggestions
 * (falling back to the cached routine offline), build the draft, and confirm
 * suggested changes. Shared by the Training home and the routines screen.
 */
export function useRoutineStarter(onStart: (draft: WorkoutDraft) => boolean) {
  const { t, i18n } = useLingui();
  const scope = useOfflineScope();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const unitsQuery = useQuery(orpc.adminSettings.productSettings.queryOptions({ input: {} }));
  const units = unitsQuery.data?.units === "imperial" ? "imperial" : "metric";
  const routines = useQuery({
    ...orpc.plans.routines.listRoutines.queryOptions({ input: {} }),
    queryKey: [...orpc.plans.routines.listRoutines.queryOptions({ input: {} }).queryKey, scope],
  });
  const start = async (r: Routine) => {
    setBusy(r.id);
    setError("");
    try {
      const preview = await client.plans.routines.startPreview({ id: r.id });
      const source = preview ?? { routine: r, suggestions: [] };
      const draft = createDraftFromRoutinePreview(source);
      const why = new Map((source.suggestions ?? []).map((x) => [x.key, x.suggestion]));
      draft.exercises = draft.exercises.map((exercise, index) => {
        const target = source.routine.exercises[index];
        const s = why.get(target.key);
        if (!s) return exercise;
        return {
          ...exercise,
          sets: exercise.sets.map((set) => ({
            ...set,
            weightKg: s.weightKg ?? set.weightKg,
            reps: String(s.reps ?? set.reps),
          })),
        };
      });
      draft.routineSnapshot = {
        ...draft.routineSnapshot!,
        exercises: draft.routineSnapshot!.exercises.map((e) => ({
          ...e,
          suggestion: why.get(e.key),
        })),
      };
      const reasons = (source.suggestions ?? [])
        .map((x) => {
          const prescription = source.routine.exercises.find((e) => e.key === x.key);
          return `${prescription?.name}: ${i18n._(progressionWhy(x.suggestion, prescription ?? { repsMin: 1, repsMax: 1 }, units))}`;
        })
        .join("\n");
      if (reasons)
        Alert.alert(t`Suggested changes`, reasons, [
          { text: t`Start workout`, onPress: () => onStart(draft) },
        ]);
      else onStart(draft);
    } catch {
      const cached = routines.data?.find((x) => x.id === r.id);
      if (cached) onStart(createDraftFromRoutinePreview({ routine: cached }));
      else setError(t`Couldn’t prepare this routine. Refresh when you’re connected.`);
    } finally {
      setBusy(null);
    }
  };
  return { routines, start: (r: Routine) => void start(r), busy, error };
}

export type StartableRoutine = Routine;

/**
 * Issue #402 — routine cards (Hevy): tappable, one tap to start, in a
 * horizontal row, with "+ New" at the end. Replaces the green banners.
 */
export function WorkoutRoutineStart({
  onStart,
  onNew,
}: {
  onStart: (draft: WorkoutDraft) => boolean;
  onNew?: () => void;
}) {
  const { t } = useLingui();
  const { routines, start, busy, error } = useRoutineStarter(onStart);
  const signal = useThemeColor("signal");
  const list = (routines.data ?? []) as Routine[];
  return (
    <View className="gap-2">
      {list.length > 0 || onNew ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerClassName="gap-2.5 pr-4"
        >
          {list.map((r, index) => (
            <Pressable
              key={r.id}
              testID={`routine-card-${index + 1}`}
              accessibilityRole="button"
              accessibilityLabel={t`Start ${r.name}`}
              accessibilityState={{ busy: busy === r.id, disabled: busy !== null }}
              disabled={busy !== null}
              onPress={() => start(r)}
              className="sheet w-40 gap-1 p-3.5"
            >
              <Text numberOfLines={1} className="font-sans text-base font-semibold text-ink">
                {r.name}
              </Text>
              <Text className="font-sans text-sm text-ink-3">
                {t`${plural(r.exercises.length, { one: "# exercise", other: "# exercises" })}`}
              </Text>
              <Text numberOfLines={2} className="font-sans text-xs text-ink-3">
                {r.exercises
                  .slice(0, 3)
                  .map((e) => e.name)
                  .join(" · ")}
              </Text>
              <View className="mt-1 min-h-10 flex-row items-center gap-1.5">
                <Play size={12} color={signal} fill={signal} />
                <Text className="font-sans text-sm font-semibold text-signal">
                  {busy === r.id ? t`Preparing…` : t`Start`}
                </Text>
              </View>
            </Pressable>
          ))}
          {onNew ? (
            <Pressable
              testID="routine-card-new"
              accessibilityRole="button"
              accessibilityLabel={t`New routine`}
              onPress={onNew}
              className="w-28 items-center justify-center gap-1 rounded-3xl border border-dashed border-rule-2 p-3.5"
            >
              <Plus size={18} color={signal} />
              <Text className="font-sans text-sm font-semibold text-signal">
                <Trans>New</Trans>
              </Text>
            </Pressable>
          ) : null}
        </ScrollView>
      ) : null}
      {routines.isLoading ? (
        <Text className="font-sans text-sm text-ink-3">{t`Loading routines…`}</Text>
      ) : null}
      {error || routines.error ? (
        <Text accessibilityRole="alert" className="font-sans text-sm text-destructive">
          {error || t`Couldn’t load routines. Try again when connected.`}
        </Text>
      ) : null}
    </View>
  );
}

export function SaveWorkoutAsRoutine({
  workout,
}: {
  workout: Pick<WorkoutDetail, "exercises"> & Partial<Pick<WorkoutDetail, "id">>;
}) {
  const { t } = useLingui();
  const scope = useOfflineScope();
  const cache = useQueryClient();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const ink = useThemeColor("ink");
  const surface = useThemeColor("paper-2");
  const pending = useRef<{ fingerprint: string; input: any } | null>(null);
  useEffect(() => {
    pending.current = null;
    setName("");
  }, [scope]);
  const save = async () => {
    if (!scope || !name.trim()) return;
    const fingerprint = JSON.stringify({ scope, name: name.trim(), workout });
    if (pending.current && pending.current.fingerprint !== fingerprint) return;
    setSaving(true);
    try {
      const input = pending.current?.input ?? {
        ...fields(
          name,
          null,
          workout.exercises.map((e) => {
            const reps = e.sets.map((s) => s.reps).filter((n) => Number.isInteger(n) && n > 0);
            return {
              key: uuid(),
              exerciseId: e.exerciseId ?? null,
              name: e.name,
              targetSets: bounded(e.sets.length, 1, 20),
              repsMin: reps.length ? Math.min(...reps) : 8,
              repsMax: reps.length ? Math.max(...reps) : 8,
              targetWeightKg: e.sets.find((s) => s.weightKg != null)?.weightKg ?? null,
              restSeconds: 90,
              progression: { kind: "none" as const },
            };
          }),
        ),
        clientMutationId: uuid(),
        expectedScope: scope,
      };
      pending.current = { fingerprint, input };
      await client.plans.routines.createRoutine(input);
      pending.current = null;
      setName("");
      await cache.invalidateQueries({
        queryKey: orpc.plans.routines.listRoutines.queryOptions({ input: {} }).queryKey,
      });
    } catch {
      Alert.alert(
        t`Could not save routine`,
        t`Your workout is unchanged. Check your connection or try again.`,
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <View style={{ padding: 14, backgroundColor: surface, borderRadius: 18 }}>
      <Text style={{ color: ink, fontSize: 18, fontWeight: "700" }}>
        <Trans>Save as a routine</Trans>
      </Text>
      <TextInput
        accessibilityLabel={t`Routine name`}
        placeholder={t`Routine name`}
        value={name}
        onChangeText={setName}
        style={{
          padding: 12,
          color: ink,
          borderWidth: 1,
          borderColor: useThemeColor("rule-2"),
          borderRadius: 12,
        }}
      />
      <Pressable
        accessibilityRole="button"
        disabled={!name.trim() || saving}
        onPress={save}
        style={{
          backgroundColor: "#526b53",
          padding: 14,
          borderRadius: 14,
          marginTop: 8,
        }}
      >
        <Text style={{ color: "white", textAlign: "center" }}>
          {saving ? t`Saving…` : t`Save routine`}
        </Text>
      </Pressable>
    </View>
  );
}

/**
 * Issue #403 — Routines inside Training (mockup h): each routine with its
 * exercises, one-tap Start and a ⋯ menu (Edit, Duplicate, Delete with a
 * confirm); pull to refresh; New and Edit open the full-screen editor.
 * Folders come later (owner decision). Saves keep the idempotent
 * create/update/delete mutations and their retry-safe client ids.
 */
export function WorkoutRoutines({
  startNew = false,
  onStarted,
  addExercise,
  onAddDone,
}: {
  startNew?: boolean;
  onStarted?: () => void;
  /** "Add to routine" from an exercise page (#404): pick a routine (or New) to add it to. */
  addExercise?: { id: number; name: string } | null;
  onAddDone?: () => void;
}) {
  const { t } = useLingui();
  const scope = useOfflineScope();
  const session = useWorkoutSession();
  const unitsQuery = useQuery(orpc.adminSettings.productSettings.queryOptions({ input: {} }));
  const units = unitsQuery.data?.units === "imperial" ? "imperial" : "metric";
  const {
    routines: list,
    start,
    busy,
    error: startError,
  } = useRoutineStarter((draft) => {
    if (session.draft) {
      Alert.alert(
        t`Active workout in progress`,
        t`Finish or discard your active workout before starting another.`,
      );
      return false;
    }
    const saved = session.saveDraft(draft);
    if (saved) onStarted?.();
    return saved;
  });
  const ink = useThemeColor("ink");
  const foreground = useThemeColor("foreground");
  const signalInk = useThemeColor("signal-ink");
  const [editor, setEditor] = useState<{
    routine: Routine | null;
    seed: number;
    append?: { id: number; name: string };
  } | null>(startNew ? { routine: null, seed: 0 } : null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const pendingSave = useRef<{ fingerprint: string; input: any } | null>(null);
  const pendingDeletes = useRef(new Map<string, any>());
  useEffect(() => {
    setEditor(null);
    pendingSave.current = null;
    pendingDeletes.current.clear();
    setError("");
  }, [scope]);
  useEffect(() => {
    if (startNew) setEditor({ routine: null, seed: Date.now() });
  }, [startNew]);
  const refresh = () => void list.refetch();

  const save = async (name: string, exercises: Exercise[]) => {
    if (!scope) return;
    const editing = editor?.routine ?? null;
    const fingerprint = JSON.stringify({
      scope,
      id: editing?.id,
      version: editing?.version,
      name: name.trim(),
      exercises,
    });
    // A retry of the same edits reuses the same client id (idempotent).
    const input =
      pendingSave.current?.fingerprint === fingerprint
        ? pendingSave.current.input
        : {
            ...fields(name, editing?.notes ?? null, exercises),
            ...(editing ? { id: editing.id, expectedVersion: editing.version } : {}),
            clientMutationId: uuid(),
            expectedScope: scope,
          };
    pendingSave.current = { fingerprint, input };
    setSaving(true);
    setError("");
    try {
      if (editing) await client.plans.routines.updateRoutine(input);
      else await client.plans.routines.createRoutine(input);
      pendingSave.current = null;
      const appended = Boolean(editor?.append);
      setEditor(null);
      await list.refetch();
      if (appended) onAddDone?.();
    } catch {
      setError(t`Routine wasn’t saved. Your edits are still here; retry or refresh.`);
    } finally {
      setSaving(false);
    }
  };

  const duplicate = async (r: Routine) => {
    if (!scope) return;
    try {
      await client.plans.routines.createRoutine({
        ...fields(
          t`${r.name} (copy)`,
          r.notes,
          r.exercises.map((e) => ({ ...e, key: uuid(), suggestion: undefined })),
        ),
        clientMutationId: uuid(),
        expectedScope: scope,
      });
      await list.refetch();
    } catch {
      setError(t`Couldn’t duplicate the routine. Try again when connected.`);
    }
  };

  const remove = (r: Routine) =>
    Alert.alert(t`Delete ${r.name}?`, t`Past workouts stay unchanged.`, [
      { text: t`Cancel`, style: "cancel" },
      {
        text: t`Delete`,
        style: "destructive",
        onPress: async () => {
          const key = `${r.id}:${r.version}`;
          const input = pendingDeletes.current.get(key) ?? {
            id: r.id,
            expectedVersion: r.version,
            clientMutationId: uuid(),
            expectedScope: scope!,
          };
          pendingDeletes.current.set(key, input);
          try {
            await client.plans.routines.deleteRoutine(input);
            pendingDeletes.current.delete(key);
            await list.refetch();
          } catch {
            setError(t`Routine changed or couldn’t be deleted. Refresh and try again.`);
          }
        },
      },
    ]);

  const menu = (r: Routine) => {
    const actions = [
      { label: t`Edit`, run: () => setEditor({ routine: r, seed: Date.now() }) },
      { label: t`Duplicate`, run: () => void duplicate(r) },
      { label: t`Delete`, run: () => remove(r) },
    ];
    if (Platform.OS === "ios")
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: r.name,
          options: [...actions.map((a) => a.label), t`Cancel`],
          destructiveButtonIndex: 2,
          cancelButtonIndex: 3,
        },
        (index) => actions[index]?.run(),
      );
    else
      Alert.alert(
        r.name,
        undefined,
        actions.map((a, index) => ({
          text: a.label,
          style: index === 2 ? ("destructive" as const) : ("default" as const),
          onPress: a.run,
        })),
        { cancelable: true },
      );
  };

  const routines = (list.data ?? []) as Routine[];
  return (
    <ScrollView
      contentContainerClassName="gap-3.5 bg-paper px-4 pb-10 pt-5"
      refreshControl={
        <RefreshControl refreshing={list.isRefetching} onRefresh={refresh} tintColor={foreground} />
      }
    >
      <View className="flex-row items-center justify-between">
        <Text accessibilityRole="header" className="font-display text-3xl font-semibold text-ink">
          <Trans>Routines</Trans>
        </Text>
        <Pressable
          testID="routines-new"
          accessibilityRole="button"
          accessibilityLabel={t`New routine`}
          onPress={() =>
            setEditor({
              routine: null,
              seed: Date.now(),
              ...(addExercise ? { append: addExercise } : {}),
            })
          }
          className="min-h-11 flex-row items-center gap-1 rounded-full bg-signal px-4"
        >
          <Plus size={16} color={signalInk} />
          <Text className="font-sans text-base font-semibold" style={{ color: signalInk }}>
            <Trans>New</Trans>
          </Text>
        </Pressable>
      </View>
      {addExercise ? (
        <View className="sheet flex-row items-center gap-3 p-4">
          <Text className="flex-1 font-sans text-sm text-ink">
            {t`Choose a routine to add ${addExercise.name} to, or make a new one.`}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => onAddDone?.()}
            className="min-h-11 justify-center px-2"
          >
            <Text className="font-sans text-sm font-semibold text-ink-2">
              <Trans>Cancel</Trans>
            </Text>
          </Pressable>
        </View>
      ) : null}
      {list.isLoading ? (
        <Text className="font-sans text-sm text-ink-3">{t`Loading routines…`}</Text>
      ) : null}
      {list.error || error || startError ? (
        <Text accessibilityRole="alert" className="font-sans text-sm text-destructive">
          {error ||
            startError ||
            t`Couldn’t load your routines. Cached routines remain available; try refreshing.`}
        </Text>
      ) : null}
      {routines.length === 0 && !list.isLoading ? (
        <View className="sheet items-center gap-2 p-6">
          <Text className="font-display text-xl text-ink">
            <Trans>No routines yet</Trans>
          </Text>
          <Text className="text-center font-sans text-sm text-ink-2">
            <Trans>Plan a workout you want to repeat, then start it in one tap.</Trans>
          </Text>
        </View>
      ) : (
        <View className="sheet py-1 pl-4 pr-1.5">
          {routines.map((r, index) => (
            <View
              key={r.id}
              className={`min-h-[68px] flex-row items-center gap-2 ${
                index < routines.length - 1 ? "border-b border-rule" : ""
              }`}
            >
              <View className="min-w-0 flex-1 gap-0.5 py-2">
                <Text numberOfLines={1} className="font-sans text-base font-semibold text-ink">
                  {r.name}
                </Text>
                <Text numberOfLines={1} className="font-sans text-sm text-ink-3">
                  {t`${plural(r.exercises.length, { one: "# exercise", other: "# exercises" })}`}
                  {r.exercises.length > 0 ? ` · ${r.exercises.map((e) => e.name).join(", ")}` : ""}
                </Text>
              </View>
              {addExercise ? (
                <Pressable
                  testID={`routines-add-${index + 1}`}
                  accessibilityRole="button"
                  accessibilityLabel={t`Add ${addExercise.name} to ${r.name}`}
                  onPress={() => setEditor({ routine: r, seed: Date.now(), append: addExercise })}
                  className="min-h-11 justify-center rounded-full border border-rule-2 px-3.5"
                >
                  <Text className="font-sans text-sm font-semibold text-signal">
                    <Trans>Add here</Trans>
                  </Text>
                </Pressable>
              ) : (
                <Pressable
                  testID={`routines-start-${index + 1}`}
                  accessibilityRole="button"
                  accessibilityLabel={t`Start ${r.name}`}
                  accessibilityState={{ busy: busy === r.id, disabled: busy !== null }}
                  disabled={busy !== null}
                  onPress={() => start(r)}
                  className="min-h-11 justify-center rounded-full border border-rule-2 px-3.5"
                >
                  <Text className="font-sans text-sm font-semibold text-signal">
                    {busy === r.id ? t`Preparing…` : t`Start`}
                  </Text>
                </Pressable>
              )}
              <Pressable
                testID={`routines-menu-${index + 1}`}
                accessibilityRole="button"
                accessibilityLabel={t`${r.name} options`}
                onPress={() => menu(r)}
                className="h-11 w-11 items-center justify-center"
              >
                <MoreHorizontal size={20} color={ink} />
              </Pressable>
            </View>
          ))}
        </View>
      )}
      {editor ? (
        <RoutineEditor
          key={`${editor.routine?.id ?? "new"}-${editor.seed}`}
          visible
          title={editor.routine ? t`Edit routine` : t`New routine`}
          initialName={editor.routine?.name ?? ""}
          initialExercises={[
            ...(editor.routine?.exercises ?? []).map((e) => ({ ...e })),
            ...(editor.append
              ? [
                  {
                    key: uuid(),
                    exerciseId: editor.append.id,
                    name: editor.append.name,
                    targetSets: 3,
                    repsMin: 8,
                    repsMax: 12,
                    targetWeightKg: null,
                    restSeconds: 90,
                    progression: { kind: "none" as const },
                  },
                ]
              : []),
          ]}
          units={units}
          saving={saving}
          error={error}
          newKey={uuid}
          onCancel={() => {
            pendingSave.current = null;
            setError("");
            setEditor(null);
          }}
          onSave={(name, exercises) => void save(name, exercises)}
        />
      ) : null}
    </ScrollView>
  );
}
