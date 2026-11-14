import { Trans, useLingui } from "@lingui/react/macro";
import type {
  GoalDefinition,
  GoalMilestone,
  GoalRule,
  GoalComparator,
} from "@openvalens/plans/goal-model";
import {
  trackerGoalMeasuresValue,
  trackerGoalMetric,
  trackerGoalRuleKinds,
  trackerGoalUnit,
  trackerIdFromGoalMetric,
} from "@openvalens/plans/goal-tracker";
import type { TrackerType } from "@openvalens/trackers/model";
import { Button } from "@openvalens/ui/components/button";
import { Input } from "@openvalens/ui/components/input";
import { Label } from "@openvalens/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@openvalens/ui/components/select";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Clock3, Plus, Trash2 } from "lucide-react";
import { orpc } from "@/utils/orpc";
import { canEditEvidenceSource } from "./-goals-ui";

type GoalSource = GoalDefinition["source"];
type GoalKind = GoalRule["kind"];
type Comparison = GoalComparator["kind"];
export type ExistingGoal = {
  recordId: number;
  version: number;
  definition: GoalDefinition;
  sourceLocked?: boolean;
};
type GoalEditorProps = {
  initial?: ExistingGoal;
  seed?: GoalDefinition;
  replacesId?: number;
  replacesVersion?: number;
  onSaved: (createdId?: number) => void;
};

const mutationId = () => globalThis.crypto.randomUUID();
const localDate = () => new Intl.DateTimeFormat("en-CA").format(new Date());
const deviceZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const id = () => globalThis.crypto.randomUUID();

function comparatorValue(comparator: GoalComparator | undefined): string {
  if (!comparator) return "1";
  return String(comparator.kind === "range" ? comparator.minimum : comparator.value);
}

function comparatorMaximum(comparator: GoalComparator | undefined): string {
  return comparator?.kind === "range" ? String(comparator.maximum) : "";
}

function toComparator(kind: Comparison, lower: number, upper: number): GoalComparator {
  if (kind === "range") return { kind, minimum: lower, maximum: upper };
  return { kind, value: lower };
}

export function GoalEditor({
  initial,
  seed,
  replacesId,
  replacesVersion,
  onSaved,
}: GoalEditorProps) {
  const { t } = useLingui();
  const queryClient = useQueryClient();
  const canChangeSource = initial
    ? canEditEvidenceSource(initial.definition, initial.sourceLocked)
    : true;
  const sourceIsLocked = Boolean(initial) && initial!.sourceLocked !== false;
  const definition = initial?.definition ?? seed;
  const startingRule = definition?.rule;
  const startingComparator =
    startingRule?.kind === "target" || startingRule?.kind === "average"
      ? startingRule.target
      : startingRule?.kind === "streak"
        ? startingRule.target
        : startingRule?.kind === "recurring"
          ? startingRule.completion
          : undefined;
  const [title, setTitle] = useState(definition?.title ?? "");
  const [source, setSource] = useState<GoalSource>(definition?.source ?? "manual");
  const [metric, setMetric] = useState(definition?.metric ?? "personal");
  const [exerciseQuery, setExerciseQuery] = useState("");
  const [unit, setUnit] = useState(definition?.unit ?? "");
  const [kind, setKind] = useState<GoalKind>(startingRule?.kind ?? "target");
  const [comparison, setComparison] = useState<Comparison>(startingComparator?.kind ?? "minimum");
  const [lower, setLower] = useState(comparatorValue(startingComparator));
  const [upper, setUpper] = useState(comparatorMaximum(startingComparator));
  const [recurringMode, setRecurringMode] = useState<"amount" | "completion">(
    definition?.unit ? "amount" : "completion",
  );
  const [targetDate, setTargetDate] = useState(
    startingRule?.kind === "target" ? (startingRule.targetDate ?? "") : "",
  );
  const [windowDays, setWindowDays] = useState(
    String(startingRule?.kind === "average" ? (startingRule.windowDays ?? 7) : 7),
  );
  const [streakDays, setStreakDays] = useState(
    String(startingRule?.kind === "streak" ? startingRule.targetDays : 5),
  );
  const [cadence, setCadence] = useState<"daily" | "weekdays" | "any-days-per-week">(
    startingRule?.kind === "recurring" ? startingRule.cadence : "daily",
  );
  const [weekdays, setWeekdays] = useState<number[]>(
    startingRule?.kind === "recurring" ? (startingRule.weekdays ?? []) : [],
  );
  const [daysPerWeek, setDaysPerWeek] = useState(
    String(startingRule?.kind === "recurring" ? (startingRule.daysPerWeek ?? 3) : 3),
  );
  const [startDate, setStartDate] = useState(initial?.definition.startDate ?? localDate());
  const [timeZone, setTimeZone] = useState(definition?.timeZone ?? deviceZone());
  const [cutoff, setCutoff] = useState(definition?.dayCutoff ?? "");
  const [milestones, setMilestones] = useState<GoalMilestone[]>(definition?.milestones ?? []);
  const [milestoneValue, setMilestoneValue] = useState("");
  const [milestoneDate, setMilestoneDate] = useState("");

  const supplements = useQuery(orpc.plans.listSupplements.queryOptions({ input: {} }));
  // Goals can use the member's own trackers only (#451).
  const trackers = useQuery({
    ...orpc.trackers.list.queryOptions({
      input: { timeZone: deviceZone(), includeArchived: true },
    }),
    enabled: source === "tracker",
  });
  const ownTrackers = (trackers.data ?? []).filter((tracker) => tracker.canEdit);
  const selectedTracker = ownTrackers.find(
    (tracker) => tracker.id === trackerIdFromGoalMetric(metric),
  );
  const trackerType: TrackerType | null =
    source === "tracker" ? (selectedTracker?.type ?? null) : null;
  const allowedKinds: readonly GoalKind[] = trackerType
    ? trackerGoalRuleKinds(trackerType)
    : ["target", "recurring", "average", "streak"];
  /** Yes/no and 1-5 scale goals count done days: no amounts, no milestones. */
  const countsDoneDays = trackerType !== null && !trackerGoalMeasuresValue(trackerType);
  const trackerUnit = source === "tracker" ? unit : "";
  const catalogInput = {
    query: exerciseQuery.trim() || undefined,
    language: Intl.DateTimeFormat().resolvedOptions().locale.slice(0, 16) || "en",
    limit: 20,
  };
  const exercises = useQuery({
    ...orpc.exerciseCatalog.search.queryOptions({ input: catalogInput }),
    enabled: source === "workout" && exerciseQuery.trim().length >= 2,
  });
  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: orpc.goals.key() });
  };
  const create = useMutation(
    orpc.goals.create.mutationOptions({
      onSuccess: async (created) => {
        await invalidate();
        onSaved(created.id);
      },
    }),
  );
  const update = useMutation(
    orpc.goals.update.mutationOptions({
      onSuccess: async () => {
        await invalidate();
        onSaved();
      },
    }),
  );

  const threshold = Number(lower);
  const maximum = Number(upper);
  const comparator = toComparator(comparison, threshold, maximum);
  const rule: GoalRule = buildRule({
    kind,
    source,
    cadence,
    weekdays,
    daysPerWeek: Number(daysPerWeek),
    comparator,
    streakDays: Number(streakDays),
    windowDays: Number(windowDays),
    targetDate,
    recurringMode,
    threshold,
  });
  const validationMessages = {
    title: t`Enter a name for this goal.`,
    value: t`Enter a goal value.`,
    selection: t`Choose a supplement or catalog exercise.`,
    tracker: t`Choose one of your trackers.`,
    target: t`Enter a valid target value.`,
    range: t`The range maximum must be at least the minimum.`,
    water: t`The daily water amount must be greater than zero.`,
    window: t`The rolling window must be at least one day.`,
    streak: t`Enter a positive number of consecutive days.`,
    weekday: t`Choose at least one weekday.`,
    days: t`Choose between one and seven days per week.`,
    start: t`Choose a start date.`,
    timezone: t`Enter a valid timezone, such as Europe/London.`,
    cutoff: t`Enter a valid local cutoff time.`,
    milestone: t`Each milestone needs a value and date.`,
  };
  const validationKey = validateEditor({
    title,
    source,
    metric,
    kind,
    comparison,
    lower,
    upper,
    threshold,
    maximum,
    windowDays,
    streakDays,
    cadence,
    weekdays,
    daysPerWeek,
    startDate,
    timeZone,
    cutoff,
    recurringMode,
    milestones,
  });
  const validationError = validationKey ? validationMessages[validationKey] : null;

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (validationError) return;
    const next: GoalDefinition = {
      ...(definition ?? ({} as GoalDefinition)),
      id: initial?.definition.id ?? id(),
      title: title.trim(),
      source,
      metric: source === "water" ? "water_ml" : source === "sleep" ? "sleep_hours" : metric,
      unit: source === "water" ? "ml" : source === "sleep" ? "h" : unit.trim() || null,
      rule,
      startDate,
      timeZone,
      // Tracker goals follow the tracker's own calendar days.
      dayCutoff: source === "tracker" ? null : cutoff || null,
      status: initial?.definition.status ?? "active",
      milestones: countsDoneDays ? [] : milestones,
    };
    if (initial) {
      update.mutate({
        id: initial.recordId,
        version: initial.version,
        definition: next,
        clientMutationId: mutationId(),
      });
    } else {
      create.mutate({
        definition: next,
        ...(replacesId ? { replacesId, replacesVersion } : {}),
        clientMutationId: mutationId(),
      });
    }
  }

  function addMilestone() {
    const value = Number(milestoneValue);
    if (!milestoneValue.trim() || !Number.isFinite(value) || !milestoneDate) return;
    setMilestones((current) => [...current, { id: id(), value, targetDate: milestoneDate }]);
    setMilestoneValue("");
    setMilestoneDate("");
  }

  const isPending = create.isPending || update.isPending;
  const isError = create.isError || update.isError;
  const errorMessage = create.error ?? update.error;

  return (
    <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
      <Field label={t`Name`}>
        <Input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={t`Sleep at least 8 hours`}
          required
        />
      </Field>
      <Field label={t`How will you track it?`}>
        <Select disabled={!canChangeSource} value={source} onValueChange={changeSource}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="manual">{t`Enter it myself`}</SelectItem>
            <SelectItem value="water">{t`Water diary`}</SelectItem>
            <SelectItem value="sleep">{t`Sleep records`}</SelectItem>
            <SelectItem value="supplement">{t`Supplement intake`}</SelectItem>
            <SelectItem value="workout">{t`Workout lift`}</SelectItem>
            <SelectItem value="tracker">{t`One of my trackers`}</SelectItem>
          </SelectContent>
        </Select>
        {sourceIsLocked ? (
          <p className="text-xs text-ink-3">{t`Evidence source stays fixed. Create a replacement goal to change it.`}</p>
        ) : null}
      </Field>
      {source === "tracker" ? (
        <Field label={t`Tracker`}>
          <Select
            disabled={!canChangeSource}
            value={trackerIdFromGoalMetric(metric) ?? ""}
            onValueChange={chooseTracker}
          >
            <SelectTrigger aria-label={t`Tracker`}>
              <SelectValue placeholder={t`Choose a tracker`} />
            </SelectTrigger>
            <SelectContent>
              {ownTrackers
                .filter((tracker) => !tracker.archivedAt || tracker.id === selectedTracker?.id)
                .map((tracker) => (
                  <SelectItem key={tracker.id} value={tracker.id}>
                    {tracker.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          {trackers.isError ? (
            <p
              role="alert"
              className="text-sm text-destructive"
            >{t`Could not load your trackers. Try again.`}</p>
          ) : trackers.isSuccess && ownTrackers.length === 0 ? (
            <p className="text-xs text-ink-3">{t`You have no trackers yet. Create one on the Trackers page first.`}</p>
          ) : trackers.isSuccess && trackerIdFromGoalMetric(metric) && !selectedTracker ? (
            <p className="text-xs text-ink-3">{t`This tracker was deleted. The goal keeps its history.`}</p>
          ) : null}
          {trackerType ? (
            <p className="text-xs text-ink-3">{trackerRuleHint(trackerType)}</p>
          ) : null}
        </Field>
      ) : null}
      {source === "manual" ? (
        <>
          <Field label={t`Metric name`}>
            <Input
              value={metric}
              onChange={(event) => setMetric(event.target.value)}
              placeholder={t`A measure you will enter`}
              disabled={!canChangeSource}
            />
          </Field>
          <Field label={t`Unit`}>
            <Input
              value={unit}
              onChange={(event) => setUnit(event.target.value)}
              placeholder={t`hours, kg, servings…`}
              disabled={!canChangeSource}
            />
          </Field>
        </>
      ) : null}
      {source === "supplement" ? (
        <Field label={t`Supplement`}>
          <Select
            value={metric.startsWith("supplement:") ? metric.slice(11) : ""}
            onValueChange={(value) => setMetric(`supplement:${value}`)}
          >
            <SelectTrigger>
              <SelectValue placeholder={t`Choose a supplement`} />
            </SelectTrigger>
            <SelectContent>
              {(supplements.data ?? []).map((supplement) => (
                <SelectItem key={supplement.id} value={String(supplement.id)}>
                  {supplement.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {supplements.isError ? (
            <p
              role="alert"
              className="text-sm text-destructive"
            >{t`Could not load supplements. Retry from the Supplements page.`}</p>
          ) : null}
        </Field>
      ) : null}
      {source === "workout" ? (
        <Field label={t`Find and select an exercise`}>
          <Input
            value={exerciseQuery}
            onChange={(event) => setExerciseQuery(event.target.value)}
            placeholder={t`Search exercise name`}
          />
          {exercises.isPending && exerciseQuery.trim().length >= 2 ? (
            <p className="text-xs text-ink-3">{t`Searching exercises…`}</p>
          ) : null}
          {exercises.isError ? (
            <p
              role="alert"
              className="text-sm text-destructive"
            >{t`Could not search exercises. Try again.`}</p>
          ) : null}
          {exercises.data ? (
            <div className="grid max-h-48 gap-1 overflow-y-auto">
              {(exercises.data as Array<{ id: number; name: string }>).map((exercise) => (
                <button
                  key={exercise.id}
                  type="button"
                  onClick={() => setMetric(`exercise:${exercise.id}`)}
                  className={`rounded-lg p-2 text-left text-sm hover:bg-muted ${metric === `exercise:${exercise.id}` ? "bg-weight-soft font-semibold" : ""}`}
                >
                  {exercise.name}
                </button>
              ))}
            </div>
          ) : null}
          {metric.startsWith("exercise:") ? (
            <p className="text-xs text-ink-3">
              {t`Selected exercise`} {metric.slice(9)}
            </p>
          ) : null}
        </Field>
      ) : null}
      <Field label={t`Tracking rule`}>
        <Select
          disabled={source === "water"}
          value={kind}
          onValueChange={(value) => setKind(value as GoalKind)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {allowedKinds.includes("target") ? (
              <SelectItem value="target">{t`One-time target`}</SelectItem>
            ) : null}
            {allowedKinds.includes("recurring") ? (
              <SelectItem value="recurring">{t`Repeat on a schedule`}</SelectItem>
            ) : null}
            {allowedKinds.includes("average") ? (
              <SelectItem value="average">{t`Rolling average`}</SelectItem>
            ) : null}
            {allowedKinds.includes("streak") ? (
              <SelectItem value="streak">{t`Consecutive days`}</SelectItem>
            ) : null}
          </SelectContent>
        </Select>
        {source === "water" ? (
          <p className="text-xs text-ink-3">{t`Water targets are daily amounts managed here.`}</p>
        ) : null}
      </Field>
      {kind === "recurring" ? (
        <>
          {source === "tracker" ? null : (
            <Field label={t`Daily tracking`}>
              <Select
                value={recurringMode}
                onValueChange={(value) => {
                  const next = value as "amount" | "completion";
                  setRecurringMode(next);
                  if (next === "completion") setUnit("");
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="amount">{t`Record an amount`}</SelectItem>
                  <SelectItem value="completion">{t`Mark done`}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          )}
          {recurringMode === "amount" ? (
            <ComparatorFields
              label={
                source === "water"
                  ? t`Daily water target (ml)`
                  : trackerUnit
                    ? t`Daily amount (${trackerUnit})`
                    : t`Daily amount`
              }
              comparison={comparison}
              setComparison={setComparison}
              lower={lower}
              setLower={setLower}
              upper={upper}
              setUpper={setUpper}
            />
          ) : null}
          <Field label={t`Schedule`}>
            <Select
              disabled={source === "water"}
              value={source === "water" ? "daily" : cadence}
              onValueChange={(value) => setCadence(value as typeof cadence)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">{t`Every day`}</SelectItem>
                <SelectItem value="weekdays">{t`Selected weekdays`}</SelectItem>
                <SelectItem value="any-days-per-week">{t`Any days each week`}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {cadence === "weekdays" && source !== "water" ? (
            <Field label={t`Days (Monday–Sunday)`}>
              <WeekdayPicker value={weekdays} onChange={setWeekdays} />
            </Field>
          ) : null}
          {cadence === "any-days-per-week" && source !== "water" ? (
            <Field label={t`Days in each Monday–Sunday week`}>
              <Input
                type="number"
                min="1"
                max="7"
                value={daysPerWeek}
                onChange={(event) => setDaysPerWeek(event.target.value)}
              />
            </Field>
          ) : null}
        </>
      ) : null}
      {kind === "target" || kind === "average" ? (
        <>
          <ComparatorFields
            label={
              kind === "average"
                ? trackerUnit
                  ? t`Average target (${trackerUnit})`
                  : t`Average target`
                : trackerUnit
                  ? t`Target value (${trackerUnit})`
                  : t`Target value`
            }
            comparison={comparison}
            setComparison={setComparison}
            lower={lower}
            setLower={setLower}
            upper={upper}
            setUpper={setUpper}
          />
          {kind === "average" ? (
            <Field label={t`Rolling window (days)`}>
              <Input
                type="number"
                min="1"
                value={windowDays}
                onChange={(event) => setWindowDays(event.target.value)}
              />
            </Field>
          ) : (
            <Field label={t`Target date (optional)`}>
              <Input
                type="date"
                value={targetDate}
                onChange={(event) => setTargetDate(event.target.value)}
              />
            </Field>
          )}
        </>
      ) : null}
      {kind === "streak" ? (
        <>
          {source === "tracker" ? null : (
            <Field label={t`Streak evidence`}>
              <Select
                value={recurringMode}
                onValueChange={(value) => {
                  const next = value as "amount" | "completion";
                  setRecurringMode(next);
                  if (next === "completion") setUnit("");
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="amount">{t`Compare a daily amount`}</SelectItem>
                  <SelectItem value="completion">{t`Mark done each day`}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          )}
          {recurringMode === "amount" ? (
            <ComparatorFields
              label={trackerUnit ? t`Daily amount needed (${trackerUnit})` : t`Daily amount needed`}
              comparison={comparison}
              setComparison={setComparison}
              lower={lower}
              setLower={setLower}
              upper={upper}
              setUpper={setUpper}
            />
          ) : null}
          <Field label={t`Consecutive days`}>
            <Input
              type="number"
              min="1"
              value={streakDays}
              onChange={(event) => setStreakDays(event.target.value)}
            />
          </Field>
        </>
      ) : null}
      <Field label={t`Starts on`}>
        <Input
          type="date"
          value={startDate}
          onChange={(event) => setStartDate(event.target.value)}
        />
      </Field>
      <Field label={t`Goal timezone`}>
        <Input value={timeZone} onChange={(event) => setTimeZone(event.target.value)} />
      </Field>
      {source === "tracker" ? null : (
        <Field label={t`Daily cutoff (optional)`}>
          <Input type="time" value={cutoff} onChange={(event) => setCutoff(event.target.value)} />
        </Field>
      )}
      <div className="sm:col-span-2 rounded-2xl bg-muted p-3 text-sm text-ink-3">
        <Clock3 className="mr-2 inline size-4" />
        <Trans>
          Backdate the start only to include earlier history. Rule edits apply going forward; weekly
          schedule edits start next Monday.
        </Trans>
      </div>
      {countsDoneDays ? null : (
        <section className="grid gap-3 sm:col-span-2" aria-labelledby="milestones-heading">
          <h3 id="milestones-heading" className="font-semibold text-ink">{t`Milestones`}</h3>
          {milestones.map((milestone) => (
            <MilestoneEditor
              key={milestone.id}
              milestone={milestone}
              unit={unit}
              onChange={(next) =>
                setMilestones((current) =>
                  current.map((item) => (item.id === next.id ? next : item)),
                )
              }
              onRemove={() =>
                setMilestones((current) => current.filter((item) => item.id !== milestone.id))
              }
            />
          ))}
          <div className="flex flex-wrap items-end gap-2">
            <Field label={t`Checkpoint value`}>
              <Input
                type="number"
                step="any"
                value={milestoneValue}
                onChange={(event) => setMilestoneValue(event.target.value)}
              />
            </Field>
            <Field label={t`Checkpoint date`}>
              <Input
                type="date"
                value={milestoneDate}
                onChange={(event) => setMilestoneDate(event.target.value)}
              />
            </Field>
            <Button type="button" variant="outline" onClick={addMilestone}>
              <Plus className="mr-1 size-4" />
              {t`Add milestone`}
            </Button>
          </div>
          <p className="text-xs text-ink-3">{t`Milestones are value-and-date checkpoints on this same goal, not separate phases.`}</p>
        </section>
      )}
      {validationError ? (
        <p role="alert" className="text-sm text-destructive sm:col-span-2">
          {validationError}
        </p>
      ) : null}
      {isError ? (
        <p role="alert" className="text-sm text-destructive sm:col-span-2">
          {errorMessage?.message ?? t`Could not save this goal. Check the details and try again.`}
        </p>
      ) : null}
      <div className="sm:col-span-2">
        <Button type="submit" disabled={isPending || Boolean(validationError)}>
          {isPending ? t`Saving…` : t`Save goal`}
        </Button>
      </div>
    </form>
  );

  function changeSource(value: string) {
    const next = value as GoalSource;
    setSource(next);
    if (next === "manual") setMetric("personal");
    if (next === "supplement" || next === "workout") setMetric("");
    if (next === "water") {
      setKind("recurring");
      setRecurringMode("amount");
      setCadence("daily");
      setComparison("minimum");
      setUnit("ml");
    }
    if (next === "sleep") setUnit("h");
    if (next === "supplement") setRecurringMode("completion");
    if (next === "workout") setUnit("kg");
    if (next === "tracker") {
      setMetric("");
      setUnit("");
    }
  }

  /** Picks a tracker and keeps only the rules its type allows (#451). */
  function chooseTracker(trackerId: string) {
    const tracker = ownTrackers.find((item) => item.id === trackerId);
    if (!tracker) return;
    setMetric(trackerGoalMetric(tracker.id));
    setUnit(trackerGoalUnit(tracker) ?? "");
    const kinds = trackerGoalRuleKinds(tracker.type);
    if (!kinds.includes(kind)) setKind(kinds[0]!);
    if (trackerGoalMeasuresValue(tracker.type)) {
      setRecurringMode("amount");
    } else {
      setRecurringMode("completion");
      setComparison("minimum");
      setLower("1");
    }
  }

  function trackerRuleHint(type: TrackerType): string {
    if (type === "scale")
      return t`A 1–5 rating goal is a streak of days you logged it. It never sets a target for the rating itself.`;
    if (type === "yes_no") return t`Counts the days with a yes.`;
    if (type === "duration") return t`Durations are compared in minutes per day.`;
    return t`Several entries in a day are combined the way this tracker combines them.`;
  }
}

export function buildRule(input: {
  kind: GoalKind;
  source: GoalSource;
  cadence: "daily" | "weekdays" | "any-days-per-week";
  weekdays: number[];
  daysPerWeek: number;
  comparator: GoalComparator;
  streakDays: number;
  windowDays: number;
  targetDate: string;
  recurringMode: "amount" | "completion";
  threshold: number;
}): GoalRule {
  const comparator =
    input.recurringMode === "completion"
      ? { kind: "minimum" as const, value: 1 }
      : input.comparator;
  if (input.kind === "target")
    return { kind: "target", target: input.comparator, targetDate: input.targetDate || null };
  if (input.kind === "average")
    return { kind: "average", target: input.comparator, windowDays: input.windowDays };
  if (input.kind === "streak")
    return { kind: "streak", target: comparator, targetDays: input.streakDays };
  const cadence = input.source === "water" ? "daily" : input.cadence;
  return {
    kind: "recurring",
    cadence,
    ...(cadence === "weekdays" ? { weekdays: input.weekdays } : {}),
    ...(cadence === "any-days-per-week" ? { daysPerWeek: input.daysPerWeek } : {}),
    ...(input.recurringMode === "completion" ? {} : { completion: comparator }),
  };
}

function validateEditor(input: {
  title: string;
  source: GoalSource;
  metric: string;
  kind: GoalKind;
  comparison: Comparison;
  lower: string;
  upper: string;
  threshold: number;
  maximum: number;
  windowDays: string;
  streakDays: string;
  cadence: string;
  weekdays: number[];
  daysPerWeek: string;
  startDate: string;
  timeZone: string;
  cutoff: string;
  recurringMode: string;
  milestones: GoalMilestone[];
}):
  | "title"
  | "value"
  | "selection"
  | "tracker"
  | "target"
  | "range"
  | "water"
  | "window"
  | "streak"
  | "weekday"
  | "days"
  | "start"
  | "timezone"
  | "cutoff"
  | "milestone"
  | null {
  if (!input.title.trim()) return "title";
  if (input.source === "tracker" && !trackerIdFromGoalMetric(input.metric)) return "tracker";
  if (!(input.kind === "recurring" && input.recurringMode === "completion") && !input.lower.trim())
    return "value";
  if (
    (input.source === "supplement" && !/^supplement:[1-9]\d*$/.test(input.metric)) ||
    (input.source === "workout" && !/^exercise:[1-9]\d*$/.test(input.metric))
  )
    return "selection";
  if (
    !(input.kind === "recurring" && input.recurringMode === "completion") &&
    !Number.isFinite(input.threshold)
  )
    return "target";
  if (
    !(input.kind === "recurring" && input.recurringMode === "completion") &&
    input.comparison === "range" &&
    (!input.upper.trim() || !Number.isFinite(input.maximum) || input.maximum < input.threshold)
  )
    return "range";
  if (input.source === "water" && input.threshold <= 0) return "water";
  if (
    input.kind === "average" &&
    (!Number.isInteger(Number(input.windowDays)) || Number(input.windowDays) < 1)
  )
    return "window";
  if (
    input.kind === "streak" &&
    (!Number.isInteger(Number(input.streakDays)) || Number(input.streakDays) < 1)
  )
    return "streak";
  if (input.kind === "recurring" && input.cadence === "weekdays" && input.weekdays.length === 0)
    return "weekday";
  if (
    input.kind === "recurring" &&
    input.cadence === "any-days-per-week" &&
    (!Number.isInteger(Number(input.daysPerWeek)) ||
      Number(input.daysPerWeek) < 1 ||
      Number(input.daysPerWeek) > 7)
  )
    return "days";
  if (!input.startDate) return "start";
  try {
    new Intl.DateTimeFormat("en", { timeZone: input.timeZone }).format();
  } catch {
    return "timezone";
  }
  if (input.cutoff && !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.cutoff)) return "cutoff";
  if (
    input.milestones.some((milestone) => !Number.isFinite(milestone.value) || !milestone.targetDate)
  )
    return "milestone";
  return null;
}

function ComparatorFields({
  label,
  comparison,
  setComparison,
  lower,
  setLower,
  upper,
  setUpper,
}: {
  label: string;
  comparison: Comparison;
  setComparison: (value: Comparison) => void;
  lower: string;
  setLower: (value: string) => void;
  upper: string;
  setUpper: (value: string) => void;
}) {
  const { t } = useLingui();
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      <Select value={comparison} onValueChange={(value) => setComparison(value as Comparison)}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="minimum">{t`At least`}</SelectItem>
          <SelectItem value="maximum">{t`At most`}</SelectItem>
          <SelectItem value="range">{t`Between`}</SelectItem>
        </SelectContent>
      </Select>
      <Input
        aria-label={comparison === "range" ? t`Minimum` : label}
        type="number"
        step="any"
        value={lower}
        onChange={(event) => setLower(event.target.value)}
      />
      {comparison === "range" ? (
        <Input
          aria-label={t`Maximum`}
          type="number"
          step="any"
          value={upper}
          onChange={(event) => setUpper(event.target.value)}
        />
      ) : null}
    </div>
  );
}

function WeekdayPicker({
  value,
  onChange,
}: {
  value: number[];
  onChange: (days: number[]) => void;
}) {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return (
    <div className="flex flex-wrap gap-1">
      {days.map((label, index) => {
        const day = index + 1;
        const selected = value.includes(day);
        return (
          <Button
            key={day}
            type="button"
            size="sm"
            variant={selected ? "default" : "outline"}
            aria-pressed={selected}
            onClick={() =>
              onChange(selected ? value.filter((item) => item !== day) : [...value, day].sort())
            }
          >
            {label}
          </Button>
        );
      })}
    </div>
  );
}

function MilestoneEditor({
  milestone,
  unit,
  onChange,
  onRemove,
}: {
  milestone: GoalMilestone;
  unit: string;
  onChange: (value: GoalMilestone) => void;
  onRemove: () => void;
}) {
  const { t } = useLingui();
  return (
    <div className="sheet flex flex-wrap items-end gap-2 p-3">
      <Field label={t`Checkpoint value (${unit || "value"})`}>
        <Input
          type="number"
          step="any"
          value={String(milestone.value)}
          onChange={(event) => onChange({ ...milestone, value: Number(event.target.value) })}
        />
      </Field>
      <Field label={t`Checkpoint date`}>
        <Input
          type="date"
          value={milestone.targetDate}
          onChange={(event) => onChange({ ...milestone, targetDate: event.target.value })}
        />
      </Field>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        aria-label={t`Remove milestone`}
        onClick={onRemove}
      >
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid content-start gap-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
