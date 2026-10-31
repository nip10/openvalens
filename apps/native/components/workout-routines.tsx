import { Trans, useLingui } from "@lingui/react/macro";
import * as Crypto from "expo-crypto";
import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
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
import { weightFromKg, weightToKg } from "@/lib/workouts/model";
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
const initial = (): Exercise => ({
  key: uuid(),
  exerciseId: null,
  name: "",
  targetSets: 3,
  repsMin: 8,
  repsMax: 12,
  targetWeightKg: null,
  restSeconds: 90,
  progression: { kind: "none" },
});
const bounded = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, Number.isFinite(n) ? n : min));
function fields(name: string, notes: string | null | undefined, exercises: Exercise[]) {
  return { name: name.trim(), notes: notes ?? null, exercises };
}

export function WorkoutRoutineStart({ onStart }: { onStart: (draft: WorkoutDraft) => boolean }) {
  const { t, i18n } = useLingui();
  const scope = useOfflineScope();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const unitsQuery = useQuery(orpc.adminSettings.productSettings.queryOptions({ input: {} }));
  const units = unitsQuery.data?.units === "imperial" ? "imperial" : "metric";
  const muted = useThemeColor("ink-2");
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
  return (
    <View>
      {routines.data?.map((r) => (
        <View key={r.id}>
          <Pressable
            accessibilityRole="button"
            disabled={busy !== null}
            onPress={() => start(r as Routine)}
            style={{
              backgroundColor: "#526b53",
              padding: 14,
              borderRadius: 14,
              marginVertical: 5,
            }}
          >
            <Text style={{ color: "white", fontWeight: "700" }}>
              {busy === r.id ? t`Preparing…` : r.name}
            </Text>
          </Pressable>
          {r.exercises.map((e) => (
            <Text key={e.key} style={{ color: muted }}>
              {e.name}
            </Text>
          ))}
        </View>
      ))}
      {routines.isLoading ? <Text>{t`Loading routines…`}</Text> : null}
      {error || routines.error ? (
        <Text accessibilityRole="alert" style={{ color: "#a34235" }}>
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

export function WorkoutRoutines() {
  const { t } = useLingui();
  const scope = useOfflineScope();
  const unitsQuery = useQuery(orpc.adminSettings.productSettings.queryOptions({ input: {} }));
  const units = unitsQuery.data?.units === "imperial" ? "imperial" : "metric";
  const base = orpc.plans.routines.listRoutines.queryOptions({ input: {} });
  const list = useQuery({ ...base, queryKey: [...base.queryKey, scope] });
  const [name, setName] = useState("");
  const [exercises, setExercises] = useState<Exercise[]>([initial()]);
  const [editing, setEditing] = useState<Routine | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [decimalText, setDecimalText] = useState<Record<string, string>>({});
  const pendingSave = useRef<{ fingerprint: string; input: any } | null>(null);
  const pendingDeletes = useRef(new Map<string, any>());
  const searchQuery = useQuery(
    orpc.exerciseCatalog.search.queryOptions({
      input: { query: search.trim() || undefined, language: "en", limit: 15 },
    }),
  );
  useEffect(() => {
    setName("");
    setExercises([initial()]);
    setEditing(null);
    setPendingId(null);
    pendingSave.current = null;
    pendingDeletes.current.clear();
    setError("");
  }, [scope]);
  const ink = useThemeColor("ink");
  const muted = useThemeColor("ink-2");
  const paper = useThemeColor("paper");
  const panel = useThemeColor("paper-2");
  const rule = useThemeColor("rule-2");
  useEffect(() => {
    if (list.data) setError("");
  }, [list.data]);
  const patch = (index: number, update: Partial<Exercise>) =>
    setExercises((xs) => xs.map((x, i) => (i === index ? { ...x, ...update } : x)));
  const reset = () => {
    setName("");
    setExercises([initial()]);
    setEditing(null);
    setPendingId(null);
    pendingSave.current = null;
  };
  const save = async () => {
    if (
      !scope ||
      !name.trim() ||
      exercises.some((e) => !e.name.trim()) ||
      Object.values(decimalText).some((v) => v !== "" && !/^\d+(?:\.\d+)?$/.test(v))
    )
      return;
    const fingerprint = JSON.stringify({
      scope,
      id: editing?.id,
      version: editing?.version,
      name: name.trim(),
      exercises,
    });
    if (pendingSave.current && pendingSave.current.fingerprint !== fingerprint) {
      setError(
        t`Your edits changed while a save may still be in progress. Retry the original request or cancel and start a new save.`,
      );
      return;
    }
    const input = pendingSave.current?.input ?? {
      ...fields(name, null, exercises),
      ...(editing ? { id: editing.id, expectedVersion: editing.version } : {}),
      clientMutationId: pendingId ?? uuid(),
      expectedScope: scope,
    };
    pendingSave.current = { fingerprint, input };
    setPendingId(input.clientMutationId);
    setError("");
    try {
      if (editing) await client.plans.routines.updateRoutine(input);
      else await client.plans.routines.createRoutine(input);
      reset();
      await list.refetch();
    } catch {
      setError(t`Routine wasn’t saved. Your edits are still here; retry or refresh.`);
    }
  };
  const edit = (r: Routine) => {
    pendingSave.current = null;
    setEditing(r);
    setName(r.name);
    setExercises(r.exercises.map((e) => ({ ...e })));
    setPendingId(null);
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
  const fieldStyle = {
    backgroundColor: panel,
    borderWidth: 1,
    borderColor: rule,
    borderRadius: 12,
    padding: 11,
    color: ink,
    marginVertical: 4,
  } as const;
  const setNum = (
    i: number,
    key: "targetSets" | "repsMin" | "repsMax" | "restSeconds",
    v: string,
  ) =>
    patch(i, {
      [key]: bounded(Number(v), 0, key === "restSeconds" ? 3600 : key === "targetSets" ? 20 : 1000),
    });
  return (
    <ScrollView
      contentContainerStyle={{
        padding: 20,
        backgroundColor: paper,
        flexGrow: 1,
      }}
    >
      <Text
        accessibilityRole="header"
        className="font-display"
        style={{ fontSize: 30, fontWeight: "600", color: ink }}
      >
        <Trans>Your routines</Trans>
      </Text>
      <Text style={{ color: muted, marginBottom: 12 }}>
        <Trans>Private plans for workouts you want to repeat.</Trans>
      </Text>
      {list.isLoading ? <Text style={{ color: muted }}>{t`Loading routines…`}</Text> : null}
      {list.error || error ? (
        <Text accessibilityRole="alert" style={{ color: "#a34235", marginVertical: 8 }}>
          {error ||
            t`Couldn’t load your routines. Cached routines remain available; try refreshing.`}
        </Text>
      ) : null}
      <Pressable accessibilityRole="button" onPress={() => list.refetch()} style={{ padding: 12 }}>
        <Text style={{ color: ink }}>
          <Trans>Refresh routines</Trans>
        </Text>
      </Pressable>
      {list.data?.map((r) => (
        <View
          key={r.id}
          style={{
            backgroundColor: panel,
            padding: 15,
            borderRadius: 18,
            marginVertical: 6,
          }}
        >
          <Text style={{ fontSize: 20, fontWeight: "700", color: ink }}>{r.name}</Text>
          {r.exercises.map((e, i) => (
            <Text key={e.key} style={{ color: muted, marginTop: 4 }}>
              {i + 1}. {e.name} · {e.targetSets} {t`sets`} · {e.repsMin}–{e.repsMax} {t`reps`}
            </Text>
          ))}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
            <Pressable accessibilityRole="button" onPress={() => edit(r as Routine)}>
              <Text style={{ color: ink, padding: 10 }}>
                <Trans>Edit</Trans>
              </Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => remove(r as Routine)}>
              <Text style={{ color: "#a34235", padding: 10 }}>
                <Trans>Delete</Trans>
              </Text>
            </Pressable>
          </View>
        </View>
      ))}
      <View
        style={{
          backgroundColor: panel,
          padding: 16,
          borderRadius: 18,
          marginTop: 18,
        }}
      >
        <Text style={{ fontSize: 22, fontWeight: "700", color: ink }}>
          {editing ? <Trans>Edit routine</Trans> : <Trans>Make a routine</Trans>}
        </Text>
        <TextInput
          accessibilityLabel={t`Routine name`}
          placeholder={t`Routine name`}
          value={name}
          onChangeText={setName}
          style={fieldStyle}
        />
        {exercises.map((e, i) => (
          <View
            key={e.key}
            style={{
              paddingVertical: 10,
              borderBottomWidth: 1,
              borderColor: rule,
            }}
          >
            <Text style={{ color: ink, fontWeight: "700" }}>
              <Trans>Exercise</Trans> {i + 1}
            </Text>
            <TextInput
              accessibilityLabel={t`Search exercise or enter a name`}
              placeholder={t`Search exercise or enter a name`}
              value={e.name}
              onChangeText={(v) => {
                patch(i, { name: v, exerciseId: null });
                setSearch(v);
              }}
              style={fieldStyle}
            />
            {search.trim() && search === e.name
              ? searchQuery.data?.map((result: any) => (
                  <Pressable
                    key={result.id}
                    accessibilityRole="button"
                    onPress={() => {
                      patch(i, { name: result.name, exerciseId: result.id });
                      setSearch("");
                    }}
                  >
                    <Text style={{ color: ink, padding: 9 }}>{result.name}</Text>
                  </Pressable>
                ))
              : null}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 5 }}>
              {(
                [
                  ["targetSets", t`Sets`],
                  ["repsMin", t`Min reps`],
                  ["repsMax", t`Max reps`],
                  ["restSeconds", t`Rest seconds`],
                ] as const
              ).map(([key, label]) => (
                <View key={key} style={{ flexGrow: 1, width: "45%" }}>
                  <Text style={{ color: muted }}>{label}</Text>
                  <TextInput
                    accessibilityLabel={label}
                    keyboardType="number-pad"
                    value={String(e[key])}
                    onChangeText={(v) => setNum(i, key, v)}
                    style={fieldStyle}
                  />
                </View>
              ))}
            </View>
            <Text style={{ color: muted }}>
              {units === "imperial" ? t`Target weight (lb)` : t`Target weight (kg)`}
            </Text>
            <TextInput
              accessibilityLabel={t`Target weight`}
              keyboardType="decimal-pad"
              placeholder={t`Optional`}
              value={
                decimalText[`${e.key}:weight`] ??
                (e.targetWeightKg == null
                  ? ""
                  : String(Number(weightFromKg(e.targetWeightKg, units).toFixed(2))))
              }
              onChangeText={(v) => {
                setDecimalText((raw) => ({ ...raw, [`${e.key}:weight`]: v }));
                if (v === "") patch(i, { targetWeightKg: null });
                else if (/^\d+(?:\.\d+)?$/.test(v) && Number.isFinite(Number(v)))
                  patch(i, { targetWeightKg: weightToKg(Number(v), units) });
              }}
              style={fieldStyle}
            />
            <Text style={{ color: muted }}>
              <Trans>Progression rule</Trans>
            </Text>
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
                accessibilityState={{ checked: e.progression.kind === kind }}
                onPress={() =>
                  patch(i, {
                    progression:
                      kind === "none"
                        ? { kind: "none" }
                        : kind === "double"
                          ? { kind, incrementKg: 0.5 }
                          : {
                              kind,
                              incrementKg: 0.5,
                              deloadPercent: 10,
                              failureThreshold: 2,
                            },
                  })
                }
              >
                <Text style={{ color: ink, paddingVertical: 5 }}>
                  {e.progression.kind === kind ? "◉" : "○"} {label}
                </Text>
              </Pressable>
            ))}
            {e.progression.kind !== "none" ? (
              <View>
                <Text style={{ color: muted }}>
                  {units === "imperial" ? t`Increment (lb)` : t`Increment (kg)`}
                </Text>
                <TextInput
                  accessibilityLabel={t`Increment`}
                  keyboardType="decimal-pad"
                  value={
                    decimalText[`${e.key}:increment`] ??
                    String(Number(weightFromKg(e.progression.incrementKg, units).toFixed(2)))
                  }
                  onChangeText={(v) => {
                    setDecimalText((raw) => ({ ...raw, [`${e.key}:increment`]: v }));
                    if (!/^(?:\d+(?:\.\d*)?)?$/.test(v) || v === "") return;
                    const incrementKg = weightToKg(Number(v), units);
                    if (!Number.isFinite(incrementKg) || incrementKg <= 0) return;
                    const progression = e.progression;
                    if (progression.kind === "double" || progression.kind === "linear")
                      patch(i, { progression: { ...progression, incrementKg } });
                  }}
                  style={fieldStyle}
                />
              </View>
            ) : null}
            {e.progression.kind === "linear" ? (
              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: muted }}>
                    <Trans>Deload percent</Trans>
                  </Text>
                  <TextInput
                    accessibilityLabel={t`Deload percent`}
                    keyboardType="number-pad"
                    value={String(e.progression.deloadPercent)}
                    onChangeText={(v) => {
                      const progression = e.progression;
                      if (progression.kind === "linear")
                        patch(i, {
                          progression: {
                            ...progression,
                            deloadPercent: bounded(Number(v), 0, 100),
                          },
                        });
                    }}
                    style={fieldStyle}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: muted }}>
                    <Trans>Failure threshold</Trans>
                  </Text>
                  <TextInput
                    accessibilityLabel={t`Failure threshold`}
                    keyboardType="number-pad"
                    value={String(e.progression.failureThreshold)}
                    onChangeText={(v) => {
                      const progression = e.progression;
                      if (progression.kind === "linear")
                        patch(i, {
                          progression: {
                            ...progression,
                            failureThreshold: bounded(Number(v), 1, 20),
                          },
                        });
                    }}
                    style={fieldStyle}
                  />
                </View>
              </View>
            ) : null}
            <View style={{ flexDirection: "row", gap: 12 }}>
              <Pressable
                accessibilityRole="button"
                disabled={i === 0}
                onPress={() =>
                  setExercises((xs) => {
                    const a = [...xs];
                    [a[i - 1], a[i]] = [a[i], a[i - 1]];
                    return a;
                  })
                }
              >
                <Text style={{ color: ink, padding: 8 }}>
                  <Trans>Move up</Trans>
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={i === exercises.length - 1}
                onPress={() =>
                  setExercises((xs) => {
                    const a = [...xs];
                    [a[i], a[i + 1]] = [a[i + 1], a[i]];
                    return a;
                  })
                }
              >
                <Text style={{ color: ink, padding: 8 }}>
                  <Trans>Move down</Trans>
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  setExercises((xs) => (xs.length > 1 ? xs.filter((_, j) => j !== i) : [initial()]))
                }
              >
                <Text style={{ color: "#a34235", padding: 8 }}>
                  <Trans>Remove</Trans>
                </Text>
              </Pressable>
            </View>
          </View>
        ))}
        <Pressable
          accessibilityRole="button"
          onPress={() => setExercises((xs) => [...xs, initial()])}
          style={{ padding: 12 }}
        >
          <Text style={{ color: ink }}>
            <Trans>Add exercise</Trans>
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={!name.trim() || exercises.some((e) => !e.name.trim())}
          onPress={save}
          style={{
            backgroundColor: "#526b53",
            padding: 14,
            borderRadius: 14,
            marginTop: 8,
          }}
        >
          <Text style={{ color: "white", textAlign: "center" }}>
            {editing ? t`Save changes` : t`Save routine`}
          </Text>
        </Pressable>
        {editing ? (
          <Pressable accessibilityRole="button" onPress={reset} style={{ padding: 12 }}>
            <Text style={{ color: ink, textAlign: "center" }}>
              <Trans>Cancel editing</Trans>
            </Text>
          </Pressable>
        ) : null}
      </View>
    </ScrollView>
  );
}
