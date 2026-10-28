import { useLingui } from "@lingui/react/macro";
import { Button } from "@openvalens/ui/components/button";
import { Input } from "@openvalens/ui/components/input";
import { Label } from "@openvalens/ui/components/label";
import { Textarea } from "@openvalens/ui/components/textarea";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { client } from "@/utils/orpc";
import { orpc } from "@/utils/orpc";
import { offlineScope } from "@openvalens/api/presenters/offline";
import { authClient } from "@/lib/auth-client";
import { INTENSITY_LABELS } from "@openvalens/api/presenters/activity-load";
import { workoutTypeLabel } from "@openvalens/api/presenters/workouts";

export type WorkoutEditorValue = Omit<
  Parameters<typeof client.plans.workouts.upsertWorkout>[0],
  "clientMutationId" | "expectedScope"
>;

type Props = {
  initial: WorkoutEditorValue;
  units: "metric" | "imperial";
  onSave: (value: WorkoutEditorValue) => void | Promise<void>;
  onCancel: () => void;
  busy?: boolean;
  error?: string | null;
  submitLabel?: string;
};

type EditorSet = WorkoutEditorValue["exercises"][number]["sets"][number] & { clientId: string };
type EditorExercise = Omit<WorkoutEditorValue["exercises"][number], "sets"> & {
  clientId: string;
  sets: EditorSet[];
};
type EditorValue = Omit<WorkoutEditorValue, "exercises"> & { exercises: EditorExercise[] };
const TYPES = ["weights", "running", "cycling", "swimming", "tennis", "other"] as const;
const INTENSITIES = ["light", "moderate", "vigorous"] as const;
const MAX_EXERCISES = 100;
const MAX_SETS = 100;
const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

function displayedWeight(kg: number | null | undefined, units: Props["units"]) {
  if (kg == null) return "";
  return String(Number((units === "imperial" ? kg * 2.2046226218 : kg).toFixed(2)));
}

export function WorkoutSessionEditor({
  initial,
  units,
  onSave,
  onCancel,
  busy = false,
  error,
  submitLabel,
}: Props) {
  const { t, i18n } = useLingui();
  const [value, setValue] = useState<EditorValue>(() => ({
    ...initial,
    exercises: initial.exercises.map((exercise) => ({
      ...exercise,
      clientId: uid(),
      sets: exercise.sets.map((set) => ({ ...set, clientId: uid() })),
    })),
  }));
  const [weights, setWeights] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      value.exercises.flatMap((exercise) =>
        exercise.sets.map((set) => [set.clientId, displayedWeight(set.weightKg, units)]),
      ),
    ),
  );
  const [exerciseName, setExerciseName] = useState("");
  const [catalogQuery, setCatalogQuery] = useState("");
  const session = authClient.useSession();
  const scope = offlineScope(session.data as Parameters<typeof offlineScope>[0]);
  const catalogInput = {
    query: catalogQuery.trim() || undefined,
    language: Intl.DateTimeFormat().resolvedOptions().locale.slice(0, 16) || "en",
    limit: 20,
  };
  const catalog = useQuery({
    ...orpc.exerciseCatalog.search.queryOptions({ input: catalogInput }),
    queryKey: [
      ...orpc.exerciseCatalog.search.queryOptions({ input: catalogInput }).queryKey,
      { scope },
    ],
    enabled: Boolean(scope && catalogQuery.trim().length >= 2),
    placeholderData: undefined,
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const update = (patch: Partial<EditorValue>) => setValue((current) => ({ ...current, ...patch }));
  const changeExercise = (index: number, patch: Partial<EditorExercise>) =>
    update({
      exercises: value.exercises.map((exercise, i) =>
        i === index ? { ...exercise, ...patch } : exercise,
      ),
    });
  const changeSet = (ei: number, si: number, patch: Partial<EditorSet>) =>
    changeExercise(ei, {
      sets: value.exercises[ei]!.sets.map((set, i) => (i === si ? { ...set, ...patch } : set)),
    });
  const addExercise = (name = exerciseName) => {
    const trimmed = name.trim();
    if (!trimmed || value.exercises.length >= MAX_EXERCISES) return;
    update({
      exercises: [
        ...value.exercises,
        { clientId: uid(), name: trimmed, exerciseId: null, notes: null, sets: [] },
      ],
    });
    setExerciseName("");
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const errors: Record<string, string> = {};
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(value.date) ||
      Number.isNaN(Date.parse(`${value.date}T00:00:00`))
    )
      errors.date = t`Enter a valid date.`;
    if (
      value.duration != null &&
      (!Number.isInteger(value.duration) || value.duration < 1 || value.duration > 1440)
    )
      errors.duration = t`Duration must be between 1 and 1,440 minutes.`;
    if ((value.notes?.length ?? 0) > 2000) errors.notes = t`Use 2,000 characters or fewer.`;
    if (value.exercises.length > MAX_EXERCISES)
      errors.exercises = t`A session can have at most 100 exercises.`;
    value.exercises.forEach((exercise, ei) => {
      if (!exercise.name.trim() || exercise.name.length > 200)
        errors[`exercise-${ei}`] = t`Exercise name is required (200 characters max).`;
      if (exercise.sets.length > MAX_SETS)
        errors[`sets-${ei}`] = t`An exercise can have at most 100 sets.`;
      exercise.sets.forEach((set, si) => {
        const key = `${ei}.${si}`;
        if (!Number.isInteger(set.reps) || set.reps < 1 || set.reps > 1000)
          errors[`reps-${key}`] = t`Reps must be from 1 to 1,000.`;
        if (
          set.weightKg != null &&
          (!Number.isFinite(set.weightKg) || set.weightKg < 0 || set.weightKg > 1000)
        )
          errors[`weight-${key}`] = t`Weight must be from 0 to 1,000 kg.`;
        if (set.rpe != null && (!Number.isFinite(set.rpe) || set.rpe < 0 || set.rpe > 10))
          errors[`rpe-${key}`] = t`RPE must be from 0 to 10.`;
        if ((set.notes?.length ?? 0) > 2000)
          errors[`setnotes-${key}`] = t`Use 2,000 characters or fewer.`;
      });
    });
    setFieldErrors(errors);
    if (Object.keys(errors).length || busy || saving) return;
    setSaving(true);
    try {
      const exercises = value.exercises.map(({ clientId: _exerciseId, sets, ...exercise }) => ({
        ...exercise,
        sets: sets.map(({ clientId: _setId, ...set }) => set),
      }));
      await onSave({ ...initial, ...value, exercises });
    } finally {
      setSaving(false);
    }
  };
  const pending = busy || saving;
  return (
    <form onSubmit={submit} noValidate className="grid gap-6">
      <section className="sheet grid gap-4 p-4 sm:p-6" aria-labelledby="workout-session-heading">
        <div>
          <h2
            id="workout-session-heading"
            className="font-display text-xl text-ink"
          >{t`Session details`}</h2>
          <p className="mt-1 text-sm text-ink-3">{t`Record the session as it happened. Exercise and set details are optional.`}</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="workout-date">{t`Date`}</Label>
            <Input
              id="workout-date"
              type="date"
              value={value.date}
              onChange={(e) => update({ date: e.target.value })}
              aria-invalid={!!fieldErrors.date}
              aria-describedby={fieldErrors.date ? "workout-date-error" : undefined}
            />
            {fieldErrors.date && (
              <p id="workout-date-error" className="text-sm text-destructive">
                {fieldErrors.date}
              </p>
            )}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="workout-type">{t`Workout type`}</Label>
            <select
              id="workout-type"
              className="h-10 rounded-xl border border-line bg-paper px-3 text-ink"
              value={value.type}
              onChange={(e) => update({ type: e.target.value as WorkoutEditorValue["type"] })}
            >
              {TYPES.map((type) => (
                <option key={type} value={type}>
                  {i18n._(workoutTypeLabel(type))}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="workout-duration">{t`Duration (minutes)`}</Label>
            <Input
              id="workout-duration"
              type="number"
              min="1"
              max="1440"
              value={value.duration ?? ""}
              onChange={(e) =>
                update({ duration: e.target.value === "" ? null : Number(e.target.value) })
              }
              aria-invalid={!!fieldErrors.duration}
              aria-describedby={fieldErrors.duration ? "workout-duration-error" : undefined}
            />
            {fieldErrors.duration && (
              <p id="workout-duration-error" className="text-sm text-destructive">
                {fieldErrors.duration}
              </p>
            )}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="workout-intensity">{t`Intensity`}</Label>
            <select
              id="workout-intensity"
              className="h-10 rounded-xl border border-line bg-paper px-3 text-ink"
              value={value.intensity ?? ""}
              onChange={(e) =>
                update({ intensity: (e.target.value || null) as WorkoutEditorValue["intensity"] })
              }
            >
              <option value="">{t`Not set`}</option>
              {INTENSITIES.map((item) => (
                <option key={item} value={item}>
                  {i18n._(INTENSITY_LABELS[item])}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="workout-effort">{t`Effort (0–10)`}</Label>
            <Input
              id="workout-effort"
              type="number"
              min="0"
              max="10"
              step="1"
              value={value.effortRating ?? ""}
              onChange={(e) =>
                update({ effortRating: e.target.value === "" ? null : Number(e.target.value) })
              }
            />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="workout-notes">{t`Session notes`}</Label>
            <Textarea
              id="workout-notes"
              maxLength={2000}
              value={value.notes ?? ""}
              onChange={(e) => update({ notes: e.target.value || null })}
            />
            {fieldErrors.notes && <p className="text-sm text-destructive">{fieldErrors.notes}</p>}
          </div>
        </div>
      </section>
      <section className="sheet grid gap-4 p-4 sm:p-6" aria-labelledby="exercise-heading">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="exercise-heading" className="font-display text-xl text-ink">{t`Exercises`}</h2>
            <p className="mt-1 text-sm text-ink-3">{t`Search the exercise catalog or enter a name. A session with no exercises is valid.`}</p>
          </div>
          <span className="text-sm text-ink-3">
            {value.exercises.length} / {MAX_EXERCISES}
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="workout-catalog-search">{t`Search exercise catalog`}</Label>
            <Input
              id="workout-catalog-search"
              type="search"
              autoComplete="off"
              value={catalogQuery}
              onChange={(e) => setCatalogQuery(e.target.value)}
              placeholder={t`Type at least 2 characters`}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="workout-exercise-name">{t`Or enter an exercise name`}</Label>
            <div className="flex gap-2">
              <Input
                id="workout-exercise-name"
                value={exerciseName}
                onChange={(e) => setExerciseName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addExercise();
                  }
                }}
                placeholder={t`Exercise name`}
              />
              <Button
                type="button"
                variant="outline"
                disabled={!exerciseName.trim() || value.exercises.length >= MAX_EXERCISES}
                onClick={() => addExercise()}
              >
                <Plus className="size-4" aria-hidden="true" />
                {t`Add`}
              </Button>
            </div>
          </div>
        </div>
        {catalogQuery.trim().length >= 2 && (
          <div className="rounded-xl border border-line bg-paper p-3" aria-live="polite">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">{t`Catalog results`}</p>
            {catalog.isPending ? (
              <p className="text-sm text-ink-3">{t`Searching…`}</p>
            ) : catalog.isError ? (
              <p
                role="alert"
                className="text-sm text-destructive"
              >{t`Catalog search is unavailable. You can still add an exercise by name.`}</p>
            ) : catalog.data?.length ? (
              <ul className="grid gap-1">
                {catalog.data.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-ink transition hover:bg-paper-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => {
                        if (value.exercises.length >= MAX_EXERCISES) return;
                        update({
                          exercises: [
                            ...value.exercises,
                            {
                              clientId: uid(),
                              name: item.name,
                              exerciseId: item.id,
                              notes: null,
                              sets: [],
                            },
                          ],
                        });
                        setCatalogQuery("");
                      }}
                    >
                      <span>{item.name}</span>
                      <span className="text-xs text-ink-3">{t`Add`}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-3">{t`No matching exercises. Add a name manually instead.`}</p>
            )}
          </div>
        )}
        {fieldErrors.exercises && (
          <p role="alert" className="text-sm text-destructive">
            {fieldErrors.exercises}
          </p>
        )}
        {value.exercises.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line bg-paper-2/60 px-4 py-5 text-sm text-ink-3">{t`No exercises added. Cardio and session-only workouts can be saved without exercise details.`}</div>
        ) : (
          <ol className="grid gap-3">
            {value.exercises.map((exercise, ei) => (
              <li
                key={exercise.clientId}
                className="rounded-2xl border border-line bg-paper-2/50 p-3 sm:p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <Label htmlFor={`exercise-name-${ei}`}>{t`Exercise ${ei + 1}`}</Label>
                    <Input
                      className="mt-1"
                      id={`exercise-name-${ei}`}
                      value={exercise.name}
                      maxLength={200}
                      onChange={(e) => changeExercise(ei, { name: e.target.value })}
                    />
                    {fieldErrors[`exercise-${ei}`] && (
                      <p className="text-sm text-destructive">{fieldErrors[`exercise-${ei}`]}</p>
                    )}
                  </div>
                  <div className="flex gap-1 pt-5">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={t`Move ${exercise.name} up`}
                      disabled={ei === 0}
                      onClick={() => {
                        const list = [...value.exercises];
                        [list[ei - 1], list[ei]] = [list[ei]!, list[ei - 1]!];
                        update({ exercises: list });
                      }}
                    >
                      <ArrowUp className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={t`Move ${exercise.name} down`}
                      disabled={ei === value.exercises.length - 1}
                      onClick={() => {
                        const list = [...value.exercises];
                        [list[ei], list[ei + 1]] = [list[ei + 1]!, list[ei]!];
                        update({ exercises: list });
                      }}
                    >
                      <ArrowDown className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={t`Remove ${exercise.name}`}
                      onClick={() =>
                        update({ exercises: value.exercises.filter((_, i) => i !== ei) })
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
                <div className="mt-3 grid gap-1.5">
                  <Label htmlFor={`exercise-notes-${ei}`}>{t`Exercise notes`}</Label>
                  <Textarea
                    id={`exercise-notes-${ei}`}
                    maxLength={2000}
                    value={exercise.notes ?? ""}
                    onChange={(e) => changeExercise(ei, { notes: e.target.value || null })}
                  />
                </div>
                <div className="mt-4 flex items-center justify-between gap-2">
                  <h3 className="font-semibold text-ink">
                    {t`Sets`}{" "}
                    <span className="font-normal text-ink-3">({exercise.sets.length})</span>
                  </h3>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={!exercise.sets.length || exercise.sets.length >= MAX_SETS}
                      onClick={() => {
                        const last = exercise.sets.at(-1)!;
                        const copiedSet = { ...last, clientId: uid() };
                        changeExercise(ei, { sets: [...exercise.sets, copiedSet] });
                        setWeights((current) => ({
                          ...current,
                          [copiedSet.clientId]:
                            weights[last.clientId] ?? displayedWeight(last.weightKg, units),
                        }));
                      }}
                    >
                      <Plus className="size-4" aria-hidden="true" />
                      {t`Copy set`}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={exercise.sets.length >= MAX_SETS}
                      onClick={() =>
                        changeExercise(ei, {
                          sets: [
                            ...exercise.sets,
                            { clientId: uid(), reps: 8, weightKg: null, rpe: null, notes: null },
                          ],
                        })
                      }
                    >
                      <Plus className="size-4" aria-hidden="true" />
                      {t`Add set`}
                    </Button>
                  </div>
                </div>
                {exercise.sets.length ? (
                  <ol className="mt-2 grid gap-2">
                    {exercise.sets.map((set, si) => {
                      const key = `${ei}.${si}`;
                      const weightText =
                        weights[set.clientId] ?? displayedWeight(set.weightKg, units);
                      return (
                        <li
                          key={set.clientId}
                          className="rounded-xl border border-line bg-paper p-3"
                        >
                          <div className="mb-2 flex items-center justify-between">
                            <strong className="text-sm text-ink">{t`Set ${si + 1}`}</strong>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              aria-label={t`Remove set ${si + 1}`}
                              onClick={() =>
                                changeExercise(ei, {
                                  sets: exercise.sets.filter((_, i) => i !== si),
                                })
                              }
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                            <div className="grid gap-1">
                              <Label htmlFor={`reps-${key}`}>{t`Reps`}</Label>
                              <Input
                                id={`reps-${key}`}
                                type="number"
                                min="1"
                                max="1000"
                                value={set.reps}
                                onChange={(e) =>
                                  changeSet(ei, si, {
                                    reps: e.target.value === "" ? 0 : Number(e.target.value),
                                  })
                                }
                              />
                              {fieldErrors[`reps-${key}`] && (
                                <small className="text-destructive">
                                  {fieldErrors[`reps-${key}`]}
                                </small>
                              )}
                            </div>
                            <div className="grid gap-1">
                              <Label
                                htmlFor={`weight-${key}`}
                              >{t`Weight (${units === "imperial" ? "lb" : "kg"})`}</Label>
                              <Input
                                id={`weight-${set.clientId}`}
                                inputMode="decimal"
                                value={weightText}
                                onChange={(e) => {
                                  const text = e.target.value;
                                  setWeights((current) => ({ ...current, [set.clientId]: text }));
                                  if (text === "") changeSet(ei, si, { weightKg: null });
                                  else if (
                                    /^\d*(\.\d*)?$/.test(text) &&
                                    Number.isFinite(Number(text))
                                  )
                                    changeSet(ei, si, {
                                      weightKg:
                                        Number(text) / (units === "imperial" ? 2.2046226218 : 1),
                                    });
                                }}
                              />
                              {fieldErrors[`weight-${key}`] && (
                                <small className="text-destructive">
                                  {fieldErrors[`weight-${key}`]}
                                </small>
                              )}
                            </div>
                            <div className="grid gap-1">
                              <Label htmlFor={`rpe-${key}`}>{t`RPE (optional)`}</Label>
                              <Input
                                id={`rpe-${key}`}
                                type="number"
                                min="0"
                                max="10"
                                step="0.5"
                                value={set.rpe ?? ""}
                                onChange={(e) =>
                                  changeSet(ei, si, {
                                    rpe: e.target.value === "" ? null : Number(e.target.value),
                                  })
                                }
                              />
                              {fieldErrors[`rpe-${key}`] && (
                                <small className="text-destructive">
                                  {fieldErrors[`rpe-${key}`]}
                                </small>
                              )}
                            </div>
                            <div className="grid gap-1">
                              <Label htmlFor={`set-notes-${key}`}>{t`Set notes`}</Label>
                              <Input
                                id={`set-notes-${key}`}
                                maxLength={2000}
                                value={set.notes ?? ""}
                                onChange={(e) =>
                                  changeSet(ei, si, { notes: e.target.value || null })
                                }
                              />
                              {fieldErrors[`setnotes-${key}`] && (
                                <small className="text-destructive">
                                  {fieldErrors[`setnotes-${key}`]}
                                </small>
                              )}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                ) : (
                  <p className="mt-2 rounded-lg bg-paper px-3 py-3 text-sm text-ink-3">{t`No sets recorded. You can add a set, or leave this exercise without sets.`}</p>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="ghost"
          disabled={pending}
          onClick={onCancel}
        >{t`Cancel`}</Button>
        <Button type="submit" disabled={pending}>
          {pending ? t`Saving…` : (submitLabel ?? t`Save workout`)}
        </Button>
      </div>
    </form>
  );
}
