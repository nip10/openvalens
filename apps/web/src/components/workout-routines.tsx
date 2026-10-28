import { Trans, useLingui } from "@lingui/react/macro";
import { i18n } from "@lingui/core";
import { offlineScope } from "@openvalens/api/presenters/offline";
import { Button } from "@openvalens/ui/components/button";
import { Input } from "@openvalens/ui/components/input";
import { Label } from "@openvalens/ui/components/label";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Dumbbell, Plus, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@openvalens/ui/components/alert-dialog";
import { PageHeader, Section } from "@/components/page";
import { authClient } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";
import { WorkoutRoutineExerciseEditor } from "@/components/workout-routine-exercise-editor";
import { progressionWhy } from "@openvalens/api/presenters/workout-progression";
import { useProductSettings } from "@/utils/product-settings";

export type RoutineExercise = {
  key: string;
  exerciseId: number | null;
  name: string;
  targetSets: number;
  repsMin: number;
  repsMax: number;
  targetWeightKg: number | null;
  restSeconds: number;
  progression:
    | { kind: "none" }
    | { kind: "double"; incrementKg: number }
    | {
        kind: "linear";
        incrementKg: number;
        deloadPercent: number;
        failureThreshold: number;
      };
};
type Exercise = RoutineExercise;
type Routine = {
  id: number;
  version: number;
  name: string;
  notes: string | null;
  exercises: Exercise[];
};
const mutationId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

export function SaveWorkoutAsRoutine({
  workout,
}: {
  workout: {
    exercises?: Array<{
      name: string;
      exerciseId?: number | null;
      sets?: Array<{ reps?: number | null; weightKg?: number | null }>;
    }>;
  };
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [requestId, setRequestId] = useState("");
  const [message, setMessage] = useState("");
  const session = authClient.useSession();
  const scope = offlineScope(session.data as Parameters<typeof offlineScope>[0]);
  const client = useQueryClient();
  const save = useMutation(
    orpc.plans.routines.createRoutine.mutationOptions({
      onSuccess: async () => {
        pendingSave.current = null;
        setOpen(false);
        await client.invalidateQueries({
          queryKey: orpc.plans.routines.listRoutines.queryOptions({ input: {} }).queryKey,
        });
      },
    }),
  );
  const pendingSave = useRef<{
    fingerprint: string;
    input: Parameters<typeof save.mutate>[0];
  } | null>(null);
  const copy = () =>
    (workout.exercises ?? []).map((exercise): Exercise => {
      const valid = (exercise.sets ?? [])
        .map((set) => set.reps)
        .filter(
          (reps): reps is number => typeof reps === "number" && Number.isInteger(reps) && reps > 0,
        );
      const reps = valid.length ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length) : 8;
      const weights = (exercise.sets ?? [])
        .map((set) => set.weightKg)
        .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
      return {
        key: mutationId(),
        exerciseId: exercise.exerciseId ?? null,
        name: exercise.name,
        targetSets: Math.max(1, exercise.sets?.length ?? 3),
        repsMin: reps,
        repsMax: reps,
        targetWeightKg: weights.length ? weights[weights.length - 1]! : null,
        restSeconds: 90,
        progression: { kind: "none" },
      };
    });
  return (
    <div className="grid gap-3">
      <Button
        variant="outline"
        onClick={() => {
          setName("");
          setRequestId(mutationId());
          pendingSave.current = null;
          setMessage("");
          setOpen(true);
        }}
      >
        <Plus className="size-4" aria-hidden="true" />
        <Trans>Save as routine</Trans>
      </Button>
      {open ? (
        <form
          className="sheet grid gap-3 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!scope || !name.trim()) return;
            const fingerprint = JSON.stringify({ name: name.trim(), workout });
            if (pendingSave.current && pendingSave.current.fingerprint !== fingerprint) {
              setMessage(
                t`Your workout form changed while a save may still be in progress. Retry the original request or cancel and start a new save.`,
              );
              return;
            }
            const input = pendingSave.current?.input ?? {
              expectedScope: scope,
              clientMutationId: requestId,
              name: name.trim(),
              notes: null,
              exercises: copy(),
            };
            pendingSave.current = { fingerprint, input };
            save.mutate(input);
          }}
        >
          <Label htmlFor="save-routine-name">
            <Trans>Routine name</Trans>
          </Label>
          <Input
            id="save-routine-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={200}
          />
          {save.isError ? (
            <p role="alert" className="text-sm text-ink-2">
              <Trans>Could not save the routine. Your finished workout is unchanged.</Trans>
            </p>
          ) : null}
          {message ? (
            <p role="status" className="text-sm text-ink-2">
              {message}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button disabled={!scope || !name.trim() || save.isPending}>
              {save.isPending ? t`Saving…` : t`Save routine`}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              <Trans>Cancel</Trans>
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

export function WorkoutRoutines() {
  const { t } = useLingui();
  const session = authClient.useSession();
  const scope = offlineScope(session.data as Parameters<typeof offlineScope>[0]);
  const client = useQueryClient();
  const [catalogQuery, setCatalogQuery] = useState("");
  const [editing, setEditing] = useState<Routine | null>(null);
  const [name, setName] = useState("");
  const [exerciseName, setExerciseName] = useState("");
  const [units, setUnits] = useState<"metric" | "imperial">("metric");
  const [attemptId, setAttemptId] = useState("");
  const pendingEdit = useRef<{ fingerprint: string; data: any } | null>(null);
  const pendingDeletes = useRef(new Map<string, any>());
  const productSettings = useProductSettings();
  useEffect(() => {
    setUnits(productSettings.data?.units === "imperial" ? "imperial" : "metric");
  }, [productSettings.data?.units]);
  const query = useQuery({
    ...orpc.plans.routines.listRoutines.queryOptions({ input: {} }),
    queryKey: [...orpc.plans.routines.listRoutines.queryOptions({ input: {} }).queryKey, { scope }],
    enabled: Boolean(scope),
  });
  const catalog = useQuery({
    ...orpc.exerciseCatalog.search.queryOptions({
      input: { query: catalogQuery || undefined, language: "en", limit: 50 },
    }),
    queryKey: [
      ...orpc.exerciseCatalog.search.queryOptions({
        input: { query: catalogQuery || undefined, language: "en", limit: 50 },
      }).queryKey,
      { scope },
    ],
    enabled: Boolean(scope),
  });
  useEffect(() => {
    setEditing(null);
    setName("");
    setExerciseName("");
    setAttemptId("");
    setDeleteTarget(null);
    pendingEdit.current = null;
    pendingDeletes.current.clear();
  }, [scope]);
  const [message, setMessage] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Routine | null>(null);
  const invalidate = () =>
    client.invalidateQueries({
      queryKey: orpc.plans.routines.listRoutines.queryOptions({ input: {} }).queryKey,
    });
  const create = useMutation(
    orpc.plans.routines.createRoutine.mutationOptions({
      onSuccess: async () => {
        pendingEdit.current = null;
        setName("");
        setEditing(null);
        setMessage(t`Routine created.`);
        await invalidate();
      },
      onError: () => setMessage(t`Could not save. Refresh and review for a newer version.`),
    }),
  );
  const update = useMutation(
    orpc.plans.routines.updateRoutine.mutationOptions({
      onSuccess: async () => {
        pendingEdit.current = null;
        setEditing(null);
        setMessage(t`Routine saved.`);
        await invalidate();
      },
      onError: () =>
        setMessage(t`Could not save. Your changes are retained; refresh to resolve the conflict.`),
    }),
  );
  const remove = useMutation(
    orpc.plans.routines.deleteRoutine.mutationOptions({
      onSuccess: async () => {
        pendingDeletes.current.clear();
        await invalidate();
      },
      onError: () => setMessage(t`Could not delete. Refresh and review the routine.`),
    }),
  );
  const preview = useMutation(orpc.plans.routines.startPreview.mutationOptions());
  const startEdit = (routine?: Routine) => {
    pendingEdit.current = null;
    setEditing(routine ?? { id: 0, version: 0, name: "", notes: null, exercises: [] });
    setName(routine?.name ?? "");
    setExerciseName("");
    setAttemptId(mutationId());
  };
  const addExercise = () => {
    if (!exerciseName.trim() || !editing) return;
    setEditing({
      ...editing,
      exercises: [
        ...editing.exercises,
        {
          key: mutationId(),
          exerciseId: null,
          name: exerciseName.trim(),
          targetSets: 3,
          repsMin: 8,
          repsMax: 12,
          targetWeightKg: null,
          restSeconds: 90,
          progression: { kind: "none" },
        },
      ],
    });
    setExerciseName("");
  };
  const submit = () => {
    if (!scope || !editing || !name.trim()) return;
    const fingerprint = JSON.stringify({
      scope,
      id: editing.id,
      version: editing.version,
      name: name.trim(),
      notes: editing.notes,
      exercises: editing.exercises,
    });
    if (pendingEdit.current && pendingEdit.current.fingerprint !== fingerprint) {
      setMessage(
        t`Your edits changed while a save may still be in progress. Retry the original request or cancel and start a new save.`,
      );
      return;
    }
    const data = pendingEdit.current?.data ?? {
      expectedScope: scope,
      clientMutationId: attemptId || mutationId(),
      name: name.trim(),
      notes: editing.notes,
      exercises: editing.exercises,
    };
    pendingEdit.current = { fingerprint, data };
    if (editing.id)
      update.mutate({
        ...data,
        id: editing.id,
        expectedVersion: editing.version,
      });
    else create.mutate(data);
  };
  return (
    <div className="grid gap-6">
      <PageHeader
        title={<Trans>Workout routines</Trans>}
        info={
          <Trans>
            Build a reusable plan. Progression suggestions are optional and never change past
            workouts.
          </Trans>
        }
        actions={
          <Button onClick={() => startEdit()}>
            <Plus className="size-4" aria-hidden="true" />
            <Trans>New routine</Trans>
          </Button>
        }
      />
      {message ? (
        <p role="status" aria-live="polite" className="text-sm text-ink-2">
          {message}
        </p>
      ) : null}
      {query.isPending ? (
        <p role="status">
          <Trans>Loading routines…</Trans>
        </p>
      ) : query.isError ? (
        <div role="alert" className="flex items-center gap-3">
          <p>
            <Trans>Could not load routines.</Trans>
          </p>
          <Button variant="outline" onClick={() => void query.refetch()}>
            <Trans>Retry</Trans>
          </Button>
        </div>
      ) : null}
      {editing ? (
        <Section
          sheet
          icon={Dumbbell}
          tone="steps"
          title={editing.id ? <Trans>Edit routine</Trans> : <Trans>New routine</Trans>}
        >
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="routine-name">
                <Trans>Name</Trans>
              </Label>
              <Input
                id="routine-name"
                value={name}
                maxLength={200}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Input
                aria-label={t`Search exercise catalog`}
                value={catalogQuery}
                onChange={(event) => setCatalogQuery(event.target.value)}
                placeholder={t`Search catalog`}
              />
              <select
                aria-label={t`Catalog exercise`}
                className="h-10 rounded-xl border border-line bg-paper px-3"
                value=""
                onChange={(event) => {
                  const selected = catalog.data?.find(
                    (item) => String(item.id) === event.target.value,
                  );
                  if (selected && editing)
                    setEditing({
                      ...editing,
                      exercises: [
                        ...editing.exercises,
                        {
                          key: mutationId(),
                          exerciseId: selected.id,
                          name: selected.name,
                          targetSets: 3,
                          repsMin: 8,
                          repsMax: 12,
                          targetWeightKg: null,
                          restSeconds: 90,
                          progression: { kind: "none" },
                        },
                      ],
                    });
                }}
              >
                <option value="">{t`Choose catalog exercise`}</option>
                {catalog.data?.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <div className="flex gap-2">
                <Input
                  aria-label={t`Exercise name`}
                  value={exerciseName}
                  onChange={(event) => setExerciseName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addExercise();
                    }
                  }}
                  placeholder={t`Or enter an exercise name`}
                />
                <Button type="button" variant="outline" onClick={addExercise}>
                  <Trans>Add</Trans>
                </Button>
              </div>
            </div>
            <ol className="grid gap-2">
              {editing.exercises.map((exercise, index) => (
                <li key={exercise.key}>
                  <WorkoutRoutineExerciseEditor
                    exercise={exercise}
                    index={index}
                    total={editing.exercises.length}
                    units={units}
                    onChange={(next) =>
                      setEditing((current) =>
                        current
                          ? {
                              ...current,
                              exercises: current.exercises.map((item) =>
                                item.key === exercise.key ? next : item,
                              ),
                            }
                          : current,
                      )
                    }
                    onRemove={() =>
                      setEditing((current) =>
                        current
                          ? {
                              ...current,
                              exercises: current.exercises.filter(
                                (item) => item.key !== exercise.key,
                              ),
                            }
                          : current,
                      )
                    }
                    onMoveUp={() =>
                      setEditing((current) => {
                        if (!current || index === 0) return current;
                        const rows = [...current.exercises];
                        [rows[index - 1], rows[index]] = [rows[index]!, rows[index - 1]!];
                        return { ...current, exercises: rows };
                      })
                    }
                    onMoveDown={() =>
                      setEditing((current) => {
                        if (!current || index >= current.exercises.length - 1) return current;
                        const rows = [...current.exercises];
                        [rows[index], rows[index + 1]] = [rows[index + 1]!, rows[index]!];
                        return { ...current, exercises: rows };
                      })
                    }
                  />
                </li>
              ))}
            </ol>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={!scope || !name.trim() || create.isPending || update.isPending}
                onClick={submit}
              >
                {create.isPending || update.isPending ? t`Saving…` : t`Save routine`}
              </Button>
              <Button variant="ghost" onClick={() => setEditing(null)}>
                <Trans>Cancel</Trans>
              </Button>
            </div>
          </div>
        </Section>
      ) : null}
      <ul className="grid gap-4 md:grid-cols-2">
        {query.data?.map((routine) => (
          <li key={routine.id} className="sheet grid gap-4 p-5">
            <div>
              <h2 className="font-display text-xl text-ink">{routine.name}</h2>
              <p className="text-sm text-ink-3">
                {routine.exercises.length} <Trans>exercises</Trans>
              </p>
            </div>
            <ol className="grid gap-1 text-sm">
              {routine.exercises.map((exercise, index) => (
                <li key={exercise.key}>
                  {index + 1}. {exercise.name} · {exercise.targetSets} × {exercise.repsMin}
                  {exercise.repsMax !== exercise.repsMin ? `–${exercise.repsMax}` : ""}
                </li>
              ))}
            </ol>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={async () => {
                  try {
                    await preview.mutateAsync({ id: routine.id });
                    setMessage(
                      t`Preview ready. Suggestions are read-only; edit the routine to change future targets.`,
                    );
                  } catch {
                    setMessage(t`Could not load a preview. Your routine is unchanged.`);
                  }
                }}
              >
                <Trans>Preview</Trans>
              </Button>
              <Button variant="outline" onClick={() => startEdit(routine)}>
                <Trans>Edit</Trans>
              </Button>
              <Button variant="destructive" onClick={() => setDeleteTarget(routine)}>
                <Trash2 className="size-4" />
                <Trans>Delete</Trans>
              </Button>
            </div>
            {preview.data?.routine.id === routine.id ? (
              <div className="rounded-xl bg-paper-2 p-3 text-sm">
                <h3 className="font-semibold">
                  <Trans>Suggested next session</Trans>
                </h3>
                {preview.data.suggestions.map((item) => (
                  <p key={item.key}>
                    {routine.exercises.find((exercise) => exercise.key === item.key)?.name}:{" "}
                    {item.suggestion.reps} <Trans>reps</Trans>
                    {item.suggestion.weightKg === null
                      ? ""
                      : ` · ${Number((units === "imperial" ? item.suggestion.weightKg * 2.2046226218 : item.suggestion.weightKg).toFixed(2))} ${units === "imperial" ? "lb" : "kg"}`}{" "}
                    —{" "}
                    {i18n._(
                      progressionWhy(
                        item.suggestion,
                        routine.exercises.find((exercise) => exercise.key === item.key)!,
                        units,
                      ),
                    )}
                  </p>
                ))}
                <p className="mt-2 text-ink-3">
                  <Trans>
                    Suggestions are optional. Change future targets in Edit; recorded workouts stay
                    as they were.
                  </Trans>
                </p>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {query.data?.length === 0 ? (
        <p className="rounded-2xl bg-paper-2 p-6 text-ink-3">
          <Trans>No routines yet. Create one to reuse a plan.</Trans>
        </p>
      ) : null}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans>Delete {deleteTarget?.name}?</Trans>
            </AlertDialogTitle>
            <AlertDialogDescription>
              <Trans>This cannot be undone.</Trans>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <Trans>Cancel</Trans>
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (deleteTarget && scope) {
                  const key = `${deleteTarget.id}:${deleteTarget.version}`;
                  const data = pendingDeletes.current.get(key) ?? {
                    id: deleteTarget.id,
                    expectedVersion: deleteTarget.version,
                    expectedScope: scope,
                    clientMutationId: mutationId(),
                  };
                  pendingDeletes.current.set(key, data);
                  remove.mutate(data);
                }
                setDeleteTarget(null);
              }}
            >
              <Trans>Delete</Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
