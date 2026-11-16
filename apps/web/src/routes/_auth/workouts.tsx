import { useLingui as useLinguiRuntime } from "@lingui/react";
import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  canRateEffortToday,
  EFFORT_QUESTION,
  EFFORT_RATING_OPTIONS,
  effortRatingLabel,
  INTENSITY_LABELS,
} from "@openvalens/api/presenters/activity-load";
import {
  summarizeWorkouts,
  workoutDurationLabel,
  workoutTypeLabel,
} from "@openvalens/api/presenters/workouts";
import { Button } from "@openvalens/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@openvalens/ui/components/select";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { offlineScope } from "@openvalens/api/presenters/offline";
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

import { ActivityLoadCard } from "@/components/activity-load-panel";
import {
  Activity,
  ArrowRight,
  Bike,
  BookOpen,
  ChevronRight,
  Dumbbell,
  Footprints,
  type LucideIcon,
  Target,
  Trophy,
  Waves,
} from "lucide-react";

import {
  Details,
  EmptyState,
  ErrorState,
  Page,
  PageHeader,
  Section,
  ToneIcon,
} from "@/components/page";
import { SectionTabs } from "@/components/section-tabs";
import { friendlyDate } from "@/utils/friendly";
import { orpc } from "@/utils/orpc";
import { ModuleHiddenNote } from "@/components/module-hidden-note";
import { AiAppWorkoutDrafts } from "@/components/ai-app-drafts";
import { WorkoutSessionEditor, type WorkoutEditorValue } from "@/components/workout-session-editor";
import { WorkoutRoutines, SaveWorkoutAsRoutine } from "@/components/workout-routines";
import { routineLifts, WorkoutLifts } from "@/components/workout-lifts";
import { FormDialog } from "@/components/form-dialog";
import { useLogDialog } from "@/components/quick-log/log-launcher";
import {
  sessionFromRoutine,
  sessionRoutineName,
  type StartableRoutine,
} from "@/components/workout-from-routine";
import { authClient } from "@/lib/auth-client";
import { useProductSettings } from "@/utils/product-settings";
import { Dialog, DialogContent, DialogTitle } from "@openvalens/ui/components/dialog";

export const Route = createFileRoute("/_auth/workouts")({
  component: WorkoutsPage,
  /**
   * `log` opens "Add a session" with the text as its notes, e.g. "ran 5 km" from
   * a palette one-liner (#440d). Workouts are not parsed; nothing is saved from it.
   */
  validateSearch: (search: Record<string, unknown>): { log?: string } =>
    typeof search.log === "string" && search.log.trim()
      ? { log: search.log.trim().slice(0, 500) }
      : {},
});

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** "" = not set; the select's value round-trips as a string. */
const NOT_SET = "none";
function definitiveWorkoutFailure(error: unknown): boolean {
  const code =
    typeof error === "object" && error !== null ? (error as { code?: unknown }).code : null;
  return code === "INVALID_INPUT" || code === "CONFLICT";
}

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
    orpc.plans.workouts.rateEffort.mutationOptions({
      onSuccess: () => onSaved(),
    }),
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

function WorkoutsPage() {
  const { t, i18n } = useLingui();
  const { _ } = useLinguiRuntime();
  const queryClient = useQueryClient();
  const session = authClient.useSession();
  const productSettings = useProductSettings();
  const units = productSettings.data?.units === "imperial" ? "imperial" : "metric";
  const scope = offlineScope(session.data as Parameters<typeof offlineScope>[0]);
  const [editing, setEditing] = useState<WorkoutEditorValue | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [editSnapshot, setEditSnapshot] = useState<{ id: number; version: number } | null>(null);
  const [deleting, setDeleting] = useState<any>(null);
  const [mutationId, setMutationId] = useState("");
  const [stateScope, setStateScope] = useState(scope);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const pendingCreate = useRef<{ fingerprint: string; input: any } | null>(null);
  const pendingUpdate = useRef<{ fingerprint: string; input: any } | null>(null);
  const pendingDelete = useRef<{ fingerprint: string; input: any } | null>(null);
  useEffect(() => {
    if (stateScope === scope) return;
    setStateScope(scope);
    setEditing(null);
    setSelected(null);
    setEditSnapshot(null);
    setDeleting(null);
    setMutationId("");
    pendingCreate.current = null;
    pendingUpdate.current = null;
    pendingDelete.current = null;
  }, [scope, stateScope]);
  const privateStateCurrent = stateScope === scope;
  const visibleEditing = privateStateCurrent ? editing : null;
  const visibleSelected = privateStateCurrent ? selected : null;
  const visibleDeleting = privateStateCurrent ? deleting : null;
  const [choosingRoutine, setChoosingRoutine] = useState(false);
  const [startingRoutine, setStartingRoutine] = useState<number | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [sessionKey, setSessionKey] = useState(0);
  const openSession = (value: WorkoutEditorValue) => {
    pendingCreate.current = null;
    pendingUpdate.current = null;
    pendingDelete.current = null;
    createWorkout.reset();
    setMutationId(globalThis.crypto?.randomUUID?.() ?? "");
    setSelected(null);
    setSessionKey((key) => key + 1);
    setEditing(value);
  };
  const startNewSession = (notes: string | null) =>
    openSession({
      date: todayIso(),
      type: "weights",
      duration: null,
      notes,
      intensity: null,
      effortRating: null,
      exercises: [],
    } as WorkoutEditorValue);
  const routinesBase = orpc.plans.routines.listRoutines.queryOptions({ input: {} });
  const routines = useQuery({
    ...routinesBase,
    queryKey: [...routinesBase.queryKey, { scope }],
    enabled: Boolean(scope),
  });
  const routinePreview = useMutation(orpc.plans.routines.startPreview.mutationOptions());
  /** "Start session" on a routine: the session entry, prefilled with its sets (workouts#4). */
  const startFromRoutine = (routine: StartableRoutine) => {
    if (!scope || !privateStateCurrent) return;
    setStartingRoutine(routine.id);
    setStartError(null);
    const startScope = scope;
    routinePreview
      .mutateAsync({ id: routine.id })
      .catch(() => null)
      .then((preview) => {
        if (scopeRef.current !== startScope) return;
        // Offline or a failed preview: start from the routine's own targets.
        const source = (preview?.routine ?? routine) as StartableRoutine;
        openSession(sessionFromRoutine(source, preview?.suggestions ?? [], todayIso()));
      })
      .finally(() => setStartingRoutine(null));
  };
  /** The "+" on this screen: pick a routine first when there are any (workouts#2). */
  const openLogEntry = () => {
    if ((routines.data?.length ?? 0) > 0) setChoosingRoutine(true);
    else startNewSession(null);
  };
  // A one-liner from the palette ("ran 5 km", #440d) opens a new session with it as the notes.
  const { log: typedSession } = Route.useSearch();
  const navigate = Route.useNavigate();
  useEffect(() => {
    if (!typedSession || !scope || !privateStateCurrent) return;
    startNewSession(typedSession);
    void navigate({ search: {}, replace: true });
  }, [typedSession, scope, privateStateCurrent]);
  const detail = useQuery({
    ...orpc.plans.workouts.getWorkout.queryOptions({
      input: { id: selected! },
    } as any),
    queryKey: [
      ...orpc.plans.workouts.getWorkout.queryOptions({
        input: { id: selected! },
      } as any).queryKey,
      { scope },
    ],
    enabled: Boolean(scope && privateStateCurrent && selected !== null),
  });
  const removeWorkout = useMutation(
    orpc.plans.workouts.deleteWorkout.mutationOptions({
      onSuccess: (_data, variables) => {
        if (
          scopeRef.current !== variables.expectedScope ||
          pendingDelete.current?.input.clientMutationId !== variables.clientMutationId
        )
          return;
        pendingDelete.current = null;
        setDeleting(null);
        setSelected(null);
        reloadWorkouts();
      },
    }),
  );
  const createWorkout = useMutation(
    orpc.plans.workouts.upsertWorkout.mutationOptions({
      onSuccess: (_data, variables) => {
        if (
          scopeRef.current !== variables.expectedScope ||
          pendingCreate.current?.input.clientMutationId !== variables.clientMutationId
        )
          return;
        pendingCreate.current = null;
        setEditing(null);
        reloadWorkouts();
      },
    }),
  );
  const saveWorkout = useMutation(
    orpc.plans.workouts.updateWorkout.mutationOptions({
      onSuccess: (_data, variables) => {
        if (
          scopeRef.current !== variables.expectedScope ||
          pendingUpdate.current?.input.clientMutationId !== variables.clientMutationId
        )
          return;
        pendingUpdate.current = null;
        setEditing(null);
        setSelected(null);
        reloadWorkouts();
      },
    }),
  );
  const workoutsBase = orpc.plans.workouts.listWorkouts.queryOptions({
    input: { limit: 50 },
  });
  const workouts = useQuery({
    ...workoutsBase,
    queryKey: [...workoutsBase.queryKey, { scope }],
    enabled: Boolean(scope),
  });
  const load = useQuery({
    ...orpc.activity.weeklyLoad.queryOptions({ input: {} }),
    staleTime: 60_000,
  });

  const reloadWorkouts = () => {
    void queryClient.invalidateQueries({
      queryKey: [["plans", "workouts", "listWorkouts"]],
    });
    void queryClient.invalidateQueries({ queryKey: [["plans", "workouts", "getWorkout"]] });
    void queryClient.invalidateQueries({
      queryKey: orpc.activity.weeklyLoad.key(),
    });
    void queryClient.invalidateQueries({
      queryKey: [["plans", "workouts", "exerciseHistory"]],
    });
    void queryClient.invalidateQueries({ queryKey: [["activity"]] });
  };
  useLogDialog("workout", scope && privateStateCurrent ? openLogEntry : null);

  const workoutSummary = summarizeWorkouts(workouts.data ?? []);
  const today = todayIso();
  const routineList = routines.data ?? [];
  const lifts = routineLifts(routineList);
  // The log is dense rows by week, newest first; weeks past the fourth fold away.
  const weeks = sessionWeeks(workouts.data ?? []);
  const recentWeeks = weeks.slice(0, 4);
  const olderWeeks = weeks.slice(4);
  const weightUnit = units === "imperial" ? "lb" : "kg";
  const volumeLabel = (kg: number) =>
    `${Math.round(units === "imperial" ? kg * 2.2046226218 : kg).toLocaleString(i18n.locale)} ${weightUnit}`;
  const editingExisting = visibleEditing !== null && visibleSelected !== null;
  const editingRoutine =
    visibleEditing && !editingExisting ? sessionRoutineName(visibleEditing, routineList) : null;

  /** One week of the log: its dates and totals, then a compact row per session. */
  const renderWeek = (week: SessionWeek<(typeof weeks)[number]["sessions"][number]>) => {
    const totals = summarizeWorkouts(week.sessions);
    // A plain date: "Week of Today" would read oddly on a Monday.
    const from = new Intl.DateTimeFormat(i18n.locale, {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    }).format(new Date(`${week.start}T00:00:00Z`));
    return (
      <section key={week.start} className="grid gap-2" aria-label={t`Week of ${from}`}>
        <h3 className="flex flex-wrap items-baseline gap-x-2 font-body text-sm font-semibold tracking-normal text-ink-2">
          <Trans>Week of {from}</Trans>
          <span className="num font-normal text-ink-3">
            {t`${plural(totals.count, { one: "# session", other: "# sessions" })}, ${totals.totalDurationLabel}`}
          </span>
        </h3>
        <ul className="sheet grid divide-y divide-rule px-4 py-1">
          {week.sessions.map((workout) => {
            const rating = workout.effortRating;
            const canRate =
              rating === null &&
              workout.canEdit === true &&
              workout.ownership === "mine" &&
              workout.id > 0 &&
              canRateEffortToday(workout.date, today);
            const routineName = sessionRoutineName(workout, routineList);
            const typeLabel = _(workoutTypeLabel(workout.type));
            const summary = workout.summary;
            const meta = [
              friendlyDate(i18n, workout.date),
              routineName ? typeLabel : null,
              workout.intensity ? _(INTENSITY_LABELS[workout.intensity]) : null,
              rating !== null ? t`Effort ${rating}/10` : null,
              summary && summary.exerciseCount > 0
                ? t`${plural(summary.exerciseCount, { one: "# exercise", other: "# exercises" })}, ${plural(summary.setCount, { one: "# set", other: "# sets" })}`
                : null,
              summary && summary.volumeKg > 0 ? volumeLabel(summary.volumeKg) : null,
            ].filter(Boolean);
            return (
              <li key={workout.id} className="grid gap-2 py-2.5">
                <button
                  type="button"
                  className="-mx-2 flex items-center gap-3 rounded-2xl px-2 py-1 text-left transition-colors duration-[var(--dur-short)] hover:bg-paper-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  onClick={() => setSelected(workout.id)}
                  aria-label={t`View workout details`}
                >
                  <ToneIcon icon={workoutIcon(workout.type)} tone="steps" size="sm" />
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span className="font-semibold break-words text-ink">
                      {routineName ?? typeLabel}
                    </span>
                    <span className="text-sm text-ink-3">{meta.join(" · ")}</span>
                    {workout.notes ? (
                      <span className="line-clamp-1 text-sm break-words text-ink-3">
                        {workout.notes}
                      </span>
                    ) : null}
                  </span>
                  <span className="num shrink-0 rounded-full bg-steps-soft px-2.5 py-1 text-sm font-semibold text-ink">
                    <span className="sr-only">{t`Duration`}: </span>
                    {workoutDurationLabel(workout.duration)}
                  </span>
                </button>
                {canRate ? (
                  <div className="pl-11">
                    <RateEffort workoutId={workout.id} onSaved={reloadWorkouts} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>
    );
  };

  return (
    <Page>
      <SectionTabs parent="/records/activity" />
      <ModuleHiddenNote module="activity" />
      <PageHeader
        title={<Trans>Workouts</Trans>}
        actions={
          <Link
            to="/exercise-library"
            className="inline-flex h-9 items-center gap-2 rounded-full border border-rule-2 bg-sheet px-4 text-sm font-medium text-ink no-underline transition-colors duration-[var(--dur-short)] hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <BookOpen className="size-4" aria-hidden="true" />
            <Trans>Exercise library</Trans>
          </Link>
        }
      />

      {/* Workouts a connected AI app sent with a non-catalog exercise (#439, M2c). */}
      <AiAppWorkoutDrafts onSaved={reloadWorkouts} />

      <WorkoutRoutines
        onStart={startFromRoutine}
        startingId={startingRoutine}
        startError={startError}
      />

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
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-hidden="true">
            {["a", "b", "c"].map((key) => (
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
            description={<Trans>Start a routine, or log a session with the + button.</Trans>}
          />
        ) : (
          <div className="grid gap-5">
            {recentWeeks.map(renderWeek)}
            {olderWeeks.length > 0 ? (
              <Details summary={<Trans>Older weeks</Trans>}>
                <div className="grid gap-5">{olderWeeks.map(renderWeek)}</div>
              </Details>
            ) : null}
          </div>
        )}
      </Section>

      <WorkoutLifts lifts={lifts} scope={scope} units={units} />

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

      <Section icon={Target} tone="weight" title={<Trans>Personal goals</Trans>}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-3">
            <Trans>Track personal goals separately from workout sessions.</Trans>
          </p>
          <Link
            to="/goals"
            className="inline-flex h-9 items-center gap-2 rounded-full border border-rule-2 bg-sheet px-4 text-sm font-medium text-ink no-underline transition-colors duration-[var(--dur-short)] hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <Trans>Open Goals</Trans>
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
      </Section>

      {/* The "+" asks for a routine first. */}
      <FormDialog
        open={choosingRoutine}
        onOpenChange={setChoosingRoutine}
        title={<Trans>Log a session</Trans>}
        description={<Trans>Which routine did you do?</Trans>}
      >
        <ul className="grid gap-2">
          {routineList.map((routine) => (
            <li key={routine.id}>
              <button
                type="button"
                disabled={startingRoutine !== null}
                onClick={() => {
                  setChoosingRoutine(false);
                  startFromRoutine(routine);
                }}
                className="flex w-full items-center gap-3 rounded-2xl border border-rule bg-sheet p-3 text-left transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-55"
              >
                <ToneIcon icon={Dumbbell} tone="steps" size="sm" />
                <span className="grid min-w-0 flex-1">
                  <span className="font-semibold break-words text-ink">{routine.name}</span>
                  <span className="text-sm text-ink-3">
                    {t`${plural(routine.exercises.length, { one: "# exercise", other: "# exercises" })}`}
                  </span>
                </span>
                <ChevronRight className="size-4 text-ink-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
        <Button
          variant="outline"
          onClick={() => {
            setChoosingRoutine(false);
            startNewSession(null);
          }}
        >
          <Trans>Without a routine</Trans>
        </Button>
      </FormDialog>

      <FormDialog
        open={visibleEditing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        size="lg"
        title={
          editingExisting ? (
            <Trans>Edit session</Trans>
          ) : editingRoutine ? (
            editingRoutine
          ) : (
            <Trans>Log a session</Trans>
          )
        }
      >
        {visibleEditing && editingExisting ? (
          <>
            <WorkoutSessionEditor
              initial={visibleEditing}
              units={units}
              onCancel={() => setEditing(null)}
              busy={saveWorkout.isPending}
              error={saveWorkout.isError ? t`Could not save. Please retry.` : null}
              onSave={(value) => {
                if (!scope || !privateStateCurrent || !selected) return;
                const expectedVersion = editSnapshot?.id === selected ? editSnapshot.version : null;
                if (expectedVersion === null) return;
                const fingerprint = JSON.stringify({
                  scope,
                  id: selected,
                  expectedVersion,
                  value,
                });
                if (pendingUpdate.current && pendingUpdate.current.fingerprint !== fingerprint)
                  return;
                const input = pendingUpdate.current?.input ?? {
                  id: selected,
                  expectedVersion,
                  expectedScope: scope,
                  clientMutationId: mutationId || globalThis.crypto?.randomUUID?.() || "",
                  workout: value,
                };
                if (!input.clientMutationId) return;
                pendingUpdate.current = { fingerprint, input };
                setMutationId(input.clientMutationId);
                saveWorkout.mutate(input as any);
              }}
            />
            {saveWorkout.isError && definitiveWorkoutFailure(saveWorkout.error) ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    pendingUpdate.current = null;
                    saveWorkout.reset();
                    setMutationId(globalThis.crypto?.randomUUID?.() ?? "");
                  }}
                >
                  <Trans>Revise and try again</Trans>
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    pendingUpdate.current = null;
                    saveWorkout.reset();
                    setEditing(null);
                    setEditSnapshot(null);
                    void detail.refetch();
                  }}
                >
                  <Trans>Reload latest</Trans>
                </Button>
              </div>
            ) : null}
          </>
        ) : visibleEditing ? (
          <>
            <WorkoutSessionEditor
              // A fresh editor per start, so a routine's prefill replaces the last draft.
              key={sessionKey}
              initial={visibleEditing}
              units={units}
              busy={createWorkout.isPending}
              error={createWorkout.isError ? t`Could not save. Please retry.` : null}
              onCancel={() => setEditing(null)}
              onSave={(value) => {
                if (!scope || !privateStateCurrent) return;
                const fingerprint = JSON.stringify({ scope, value });
                if (pendingCreate.current && pendingCreate.current.fingerprint !== fingerprint)
                  return;
                const input = pendingCreate.current?.input ?? {
                  expectedScope: scope,
                  clientMutationId: mutationId || globalThis.crypto?.randomUUID?.() || "",
                  ...value,
                };
                if (!input.clientMutationId) return;
                pendingCreate.current = { fingerprint, input };
                setMutationId(input.clientMutationId);
                createWorkout.mutate(input as any);
              }}
            />
            {createWorkout.isError && definitiveWorkoutFailure(createWorkout.error) ? (
              <Button
                variant="outline"
                onClick={() => {
                  pendingCreate.current = null;
                  createWorkout.reset();
                  setMutationId(globalThis.crypto?.randomUUID?.() ?? "");
                }}
              >
                <Trans>Revise and try again</Trans>
              </Button>
            ) : null}
          </>
        ) : null}
      </FormDialog>

      {visibleSelected !== null && !visibleEditing ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setSelected(null);
          }}
        >
          <DialogContent
            showCloseButton={false}
            className="sheet max-h-[90vh] max-w-2xl overflow-y-auto grid gap-4 p-6"
          >
            <DialogTitle className="font-display text-2xl">
              <Trans>Workout details</Trans>
            </DialogTitle>
            {detail.isPending ? (
              <p>
                <Trans>Loading…</Trans>
              </p>
            ) : detail.data ? (
              <>
                <p>{(detail.data as any).notes}</p>
                {(detail.data as any).exercises?.map((exercise: any, i: number) => (
                  <article key={i} className="rounded-xl border p-3">
                    <h3 className="font-semibold">{exercise.name}</h3>
                    {exercise.notes && <p>{exercise.notes}</p>}
                    <ul>
                      {exercise.sets?.map((set: any, j: number) => (
                        <li key={j}>
                          <Trans>Set {j + 1}</Trans>: {set.reps} × {set.weightKg ?? "—"} kg{" "}
                          {set.notes}
                        </li>
                      ))}
                    </ul>
                  </article>
                ))}
                {(detail.data as any).prs?.length ? (
                  <p className="font-semibold">
                    <Trans>Personal records</Trans>: {(detail.data as any).prs.join(", ")}
                  </p>
                ) : null}
                {(detail.data as any).canEdit ? (
                  <div className="flex gap-2">
                    <Button
                      onClick={() => {
                        const d: any = detail.data;
                        pendingUpdate.current = null;
                        saveWorkout.reset();
                        setEditSnapshot({ id: d.id, version: d.version });
                        setMutationId(globalThis.crypto?.randomUUID?.() ?? "");
                        setEditing({
                          date: d.date,
                          type: d.type,
                          duration: d.duration,
                          notes: d.notes,
                          intensity: d.intensity,
                          effortRating: d.effortRating,
                          exercises: d.exercises,
                        } as WorkoutEditorValue);
                      }}
                    >
                      <Trans>Edit</Trans>
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() => {
                        const d: any = detail.data;
                        const samePendingTarget =
                          pendingDelete.current?.fingerprint ===
                          JSON.stringify({
                            scope,
                            id: d.id,
                            version: d.version,
                          });
                        if (!samePendingTarget) pendingDelete.current = null;
                        setDeleting(detail.data);
                      }}
                    >
                      <Trans>Delete</Trans>
                    </Button>
                  </div>
                ) : (
                  <p>
                    <Trans>This legacy workout is read-only.</Trans>
                  </p>
                )}
                <SaveWorkoutAsRoutine workout={detail.data as any} />
              </>
            ) : (
              <p>
                <Trans>Could not load workout.</Trans>
              </p>
            )}
            <Button variant="ghost" onClick={() => setSelected(null)}>
              <Trans>Close</Trans>
            </Button>
          </DialogContent>
        </Dialog>
      ) : null}
      <AlertDialog
        open={!!visibleDeleting}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans>Delete this workout?</Trans>
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
                if (scope && privateStateCurrent && visibleDeleting) {
                  const fingerprint = JSON.stringify({
                    scope,
                    id: visibleDeleting.id,
                    version: visibleDeleting.version,
                  });
                  if (pendingDelete.current && pendingDelete.current.fingerprint !== fingerprint)
                    return;
                  const input = pendingDelete.current?.input ?? {
                    id: visibleDeleting.id,
                    expectedVersion: visibleDeleting.version,
                    expectedScope: scope,
                    clientMutationId: globalThis.crypto?.randomUUID?.() ?? "",
                  };
                  if (!input.clientMutationId) return;
                  pendingDelete.current = { fingerprint, input };
                  removeWorkout.mutate(input as any);
                }
              }}
            >
              <Trans>Delete</Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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

export type SessionWeek<T> = { start: string; sessions: T[] };

/**
 * Sessions grouped by the week they fall in (weeks start on Monday), newest
 * week first, keeping the given order inside a week. `start` is the Monday,
 * as YYYY-MM-DD.
 */
export function sessionWeeks<T extends { date: string }>(sessions: readonly T[]): SessionWeek<T>[] {
  const byWeek = new Map<string, T[]>();
  for (const session of sessions) {
    const day = new Date(`${session.date.slice(0, 10)}T00:00:00Z`);
    if (Number.isNaN(day.getTime())) continue;
    day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
    const start = day.toISOString().slice(0, 10);
    byWeek.set(start, [...(byWeek.get(start) ?? []), session]);
  }
  return [...byWeek.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([start, rows]) => ({ start, sessions: rows }));
}
