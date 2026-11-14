import { useLingui } from "@lingui/react/macro";
import type {
  GoalDefinition,
  GoalComparator,
  GoalRule,
  GoalMilestone,
} from "@openvalens/plans/goal-model";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "heroui-native";
import { Plus, Trash2 } from "lucide-react-native";
import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { Icon, Sheet } from "@/components/bloom";
import { DecimalHint } from "@/components/decimal-hint";
import { orpc } from "@/utils/orpc";
import { canEditEvidenceSource } from "@/utils/goal-ui";
import { parseDecimal } from "@openvalens/i18n/numbers";

type Source = GoalDefinition["source"];
type Kind = GoalRule["kind"];
type ComparatorKind = GoalComparator["kind"];
type Props = {
  initial?: {
    id: number;
    version: number;
    definition: GoalDefinition;
    sourceLocked?: boolean;
  };
  seed?: GoalDefinition;
  replacesId?: number;
  replacesVersion?: number;
  onSaved: (createdId?: number) => void;
};

const mutationId = () => globalThis.crypto.randomUUID();
const localDate = () => new Intl.DateTimeFormat("en-CA").format(new Date());
const timezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

function comparatorValue(value?: GoalComparator): string {
  if (!value) return "1";
  return String(value.kind === "range" ? value.minimum : value.value);
}

function comparatorUpper(value?: GoalComparator): string {
  return value?.kind === "range" ? String(value.maximum) : "";
}

function makeComparator(kind: ComparatorKind, minimum: number, maximum: number): GoalComparator {
  return kind === "range" ? { kind, minimum, maximum } : { kind, value: minimum };
}

export function GoalEditor({ initial, seed, replacesId, replacesVersion, onSaved }: Props) {
  const { t, i18n } = useLingui();
  const client = useQueryClient();
  const canChangeSource = initial
    ? canEditEvidenceSource(initial.definition, initial.sourceLocked)
    : true;
  const sourceIsLocked = Boolean(initial) && initial!.sourceLocked !== false;
  const sourceDefinition = initial?.definition ?? seed;
  const existingRule = sourceDefinition?.rule;
  const startingComparator =
    existingRule?.kind === "target" ||
    existingRule?.kind === "average" ||
    existingRule?.kind === "streak"
      ? existingRule.target
      : existingRule?.kind === "recurring"
        ? existingRule.completion
        : undefined;
  const [title, setTitle] = useState(sourceDefinition?.title ?? "");
  const [source, setSource] = useState<Source>(sourceDefinition?.source ?? "manual");
  const [metric, setMetric] = useState(sourceDefinition?.metric ?? "personal");
  const [exerciseQuery, setExerciseQuery] = useState("");
  const [unit, setUnit] = useState(sourceDefinition?.unit ?? "");
  const [kind, setKind] = useState<Kind>(existingRule?.kind ?? "target");
  const [comparison, setComparison] = useState<ComparatorKind>(
    startingComparator?.kind ?? "minimum",
  );
  const [minimum, setMinimum] = useState(comparatorValue(startingComparator));
  const [maximum, setMaximum] = useState(comparatorUpper(startingComparator));
  const [mode, setMode] = useState<"amount" | "completion">(
    sourceDefinition?.unit ? "amount" : "completion",
  );
  const [cadence, setCadence] = useState<"daily" | "weekdays" | "any-days-per-week">(
    existingRule?.kind === "recurring" ? existingRule.cadence : "daily",
  );
  const [weekdays, setWeekdays] = useState<number[]>(
    existingRule?.kind === "recurring" ? (existingRule.weekdays ?? []) : [],
  );
  const [daysPerWeek, setDaysPerWeek] = useState(
    String(existingRule?.kind === "recurring" ? (existingRule.daysPerWeek ?? 3) : 3),
  );
  const [streakDays, setStreakDays] = useState(
    String(existingRule?.kind === "streak" ? existingRule.targetDays : 5),
  );
  const [windowDays, setWindowDays] = useState(
    String(existingRule?.kind === "average" ? (existingRule.windowDays ?? 7) : 7),
  );
  const [deadline, setDeadline] = useState(
    existingRule?.kind === "target" ? (existingRule.targetDate ?? "") : "",
  );
  const [startDate, setStartDate] = useState(initial?.definition.startDate ?? localDate());
  const [timeZone, setTimeZone] = useState(sourceDefinition?.timeZone ?? timezone());
  const [cutoff, setCutoff] = useState(sourceDefinition?.dayCutoff ?? "");
  const [milestones, setMilestones] = useState<GoalMilestone[]>(sourceDefinition?.milestones ?? []);
  const [milestoneValue, setMilestoneValue] = useState("");
  const [milestoneDate, setMilestoneDate] = useState("");

  const supplements = useQuery(orpc.plans.listSupplements.queryOptions({ input: {} }));
  const exercises = useQuery({
    ...orpc.exerciseCatalog.search.queryOptions({
      input: { query: exerciseQuery.trim() || undefined, language: "en", limit: 20 },
    }),
    enabled: source === "workout" && exerciseQuery.trim().length >= 2,
  });
  const create = useMutation(
    orpc.goals.create.mutationOptions({
      onSuccess: async (created) => {
        await client.invalidateQueries({ queryKey: orpc.goals.key() });
        onSaved(created.id);
      },
    }),
  );
  const update = useMutation(
    orpc.goals.update.mutationOptions({
      onSuccess: async () => {
        await client.invalidateQueries({ queryKey: orpc.goals.key() });
        onSaved();
      },
    }),
  );

  const lower = parseDecimal(minimum, i18n.locale) ?? Number.NaN;
  const upper = parseDecimal(maximum, i18n.locale) ?? Number.NaN;
  const comparator = makeComparator(comparison, lower, upper);
  const selectedModeComparator =
    mode === "completion" ? { kind: "minimum" as const, value: 1 } : comparator;
  const rule: GoalRule =
    kind === "target"
      ? { kind, target: comparator, targetDate: deadline || null }
      : kind === "average"
        ? { kind, target: comparator, windowDays: Number(windowDays) }
        : kind === "streak"
          ? { kind, target: selectedModeComparator, targetDays: Number(streakDays) }
          : {
              kind,
              cadence: source === "water" ? "daily" : cadence,
              ...(cadence === "weekdays" && source !== "water" ? { weekdays } : {}),
              ...(cadence === "any-days-per-week" && source !== "water"
                ? { daysPerWeek: Number(daysPerWeek) }
                : {}),
              ...(mode === "completion" ? {} : { completion: selectedModeComparator }),
            };

  const validationMessages = {
    title: t`Enter a name for this goal.`,
    value: t`Enter a goal value.`,
    range: t`The maximum must be at least the minimum.`,
    water: t`The water target must be greater than zero.`,
    supplement: t`Choose a supplement.`,
    exercise: t`Choose a catalog exercise.`,
    streak: t`Enter a positive number of consecutive days.`,
    average: t`The average window must be at least one day.`,
    weekday: t`Choose at least one weekday.`,
    days: t`Choose one to seven days per week.`,
    start: t`Enter the start date as YYYY-MM-DD.`,
    timezone: t`Enter a valid timezone, such as Europe/London.`,
    cutoff: t`Enter cutoff as HH:mm.`,
    milestone: t`Each milestone needs a value and date.`,
  };
  const validationKey = validate({
    title,
    source,
    metric,
    kind,
    comparison,
    mode,
    minimum,
    maximum,
    lower,
    upper,
    windowDays,
    streakDays,
    cadence,
    weekdays,
    daysPerWeek,
    startDate,
    timeZone,
    cutoff,
    milestones,
  });
  const error = validationKey ? validationMessages[validationKey] : null;

  function save() {
    if (error) return;
    const definition: GoalDefinition = {
      ...(sourceDefinition ?? ({} as GoalDefinition)),
      id: initial?.definition.id ?? globalThis.crypto.randomUUID(),
      title: title.trim(),
      source,
      metric: source === "water" ? "water_ml" : source === "sleep" ? "sleep_hours" : metric,
      unit: source === "water" ? "ml" : source === "sleep" ? "h" : unit.trim() || null,
      rule,
      startDate,
      timeZone,
      dayCutoff: cutoff || null,
      status: initial?.definition.status ?? "active",
      milestones,
    };
    if (initial)
      update.mutate({
        id: initial.id,
        version: initial.version,
        definition,
        clientMutationId: mutationId(),
      });
    else
      create.mutate({
        definition,
        ...(replacesId ? { replacesId, replacesVersion } : {}),
        clientMutationId: mutationId(),
      });
  }

  function selectSource(next: Source) {
    setSource(next);
    if (next === "manual") setMetric("personal");
    if (next === "supplement" || next === "workout") setMetric("");
    if (next === "water") {
      setKind("recurring");
      setMode("amount");
      setCadence("daily");
      setUnit("ml");
    }
    if (next === "sleep") setUnit("h");
    if (next === "supplement") setMode("completion");
    if (next === "workout") setUnit("kg");
  }

  function addMilestone() {
    if (!milestoneValue.trim() || !milestoneDate) return;
    const value = parseDecimal(milestoneValue, i18n.locale);
    if (value === null) return;
    setMilestones((current) => [
      ...current,
      { id: globalThis.crypto.randomUUID(), value, targetDate: milestoneDate },
    ]);
    setMilestoneValue("");
    setMilestoneDate("");
  }

  return (
    <Sheet className="gap-4 p-4">
      <Text className="font-display text-lg font-semibold text-ink">
        {initial ? t`Edit goal` : replacesId ? t`Replacement goal` : t`New personal goal`}
      </Text>
      <Field
        label={t`Name`}
        value={title}
        onChangeText={setTitle}
        placeholder={t`Sleep at least 8 hours`}
      />
      <Choice
        label={t`Evidence source`}
        value={source}
        values={[
          ["manual", t`Manual`],
          ["water", t`Water diary`],
          ["sleep", t`Sleep records`],
          ["supplement", t`Supplement intake`],
          ["workout", t`Workout lift`],
        ]}
        disabled={!canChangeSource}
        onChange={(value) => selectSource(value as Source)}
      />
      {sourceIsLocked ? (
        <Text className="text-xs text-ink-3">{t`The source is fixed after evidence. Create a replacement to change it.`}</Text>
      ) : null}
      {source === "manual" ? (
        <>
          <Field
            label={t`Metric name`}
            value={metric}
            onChangeText={setMetric}
            placeholder={t`A measure you enter`}
            editable={canChangeSource}
          />
          <Field
            label={t`Unit (optional)`}
            value={unit}
            onChangeText={setUnit}
            placeholder={t`hours, kg, cups`}
            editable={canChangeSource}
          />
        </>
      ) : null}
      {source === "supplement" ? (
        <View className="gap-2">
          <Text className="text-sm text-ink-3">{t`Choose the specific supplement entry`}</Text>
          {supplements.data?.map((item) => (
            <ChoiceRow
              key={item.id}
              label={item.name}
              selected={metric === `supplement:${item.id}`}
              onPress={() => setMetric(`supplement:${item.id}`)}
            />
          ))}
          {supplements.isPending ? (
            <Text className="text-sm text-ink-3">{t`Loading supplements…`}</Text>
          ) : null}
          {supplements.isError ? (
            <Text
              accessibilityRole="alert"
              className="text-sm text-destructive"
            >{t`Could not load supplements. Retry on the Supplements screen.`}</Text>
          ) : null}
        </View>
      ) : null}
      {source === "workout" ? (
        <View className="gap-2">
          <Field
            label={t`Search exercise catalog`}
            value={exerciseQuery}
            onChangeText={setExerciseQuery}
            placeholder={t`Type at least two letters`}
          />
          {exercises.isPending ? <Text className="text-sm text-ink-3">{t`Searching…`}</Text> : null}
          {exercises.isError ? (
            <Text
              accessibilityRole="alert"
              className="text-sm text-destructive"
            >{t`Could not search exercises. Try again.`}</Text>
          ) : null}
          {exercises.data?.map((item) => (
            <ChoiceRow
              key={item.id}
              label={item.name}
              selected={metric === `exercise:${item.id}`}
              onPress={() => setMetric(`exercise:${item.id}`)}
            />
          ))}
        </View>
      ) : null}
      <Choice
        label={t`Tracking rule`}
        value={kind}
        disabled={source === "water"}
        values={[
          ["target", t`One-time target`],
          ["recurring", t`Recurring`],
          ["average", t`Rolling average`],
          ["streak", t`Consecutive-day streak`],
        ]}
        onChange={(value) => setKind(value as Kind)}
      />
      {kind === "recurring" || kind === "streak" ? (
        <Choice
          label={t`Daily evidence`}
          value={mode}
          disabled={source === "water"}
          values={[
            ["amount", t`Compare an amount`],
            ["completion", t`Mark done`],
          ]}
          onChange={(value) => {
            const next = value as typeof mode;
            setMode(next);
            if (next === "completion") setUnit("");
          }}
        />
      ) : null}
      {kind === "target" ||
      kind === "average" ||
      ((kind === "recurring" || kind === "streak") && mode === "amount") ? (
        <>
          <Choice
            label={
              kind === "recurring"
                ? t`Repeat when`
                : kind === "streak"
                  ? t`Streak qualifies when`
                  : t`Target comparison`
            }
            value={comparison}
            values={[
              ["minimum", t`At least`],
              ["maximum", t`At most`],
              ["range", t`Between`],
            ]}
            onChange={(value) => setComparison(value as ComparatorKind)}
          />
          <Field
            label={
              comparison === "range"
                ? t`Minimum`
                : source === "water"
                  ? t`Daily water target in ml`
                  : t`Value`
            }
            value={minimum}
            onChangeText={setMinimum}
            keyboardType="decimal-pad"
          />
          {comparison === "range" ? (
            <Field
              label={t`Maximum`}
              value={maximum}
              onChangeText={setMaximum}
              keyboardType="decimal-pad"
            />
          ) : null}
        </>
      ) : null}
      {kind === "recurring" ? (
        <>
          <Choice
            label={t`Schedule`}
            value={cadence}
            disabled={source === "water"}
            values={[
              ["daily", t`Every day`],
              ["weekdays", t`Selected weekdays`],
              ["any-days-per-week", t`Any days each week`],
            ]}
            onChange={(value) => setCadence(value as typeof cadence)}
          />
          {cadence === "weekdays" ? (
            <View className="gap-2">
              <Text className="text-sm text-ink-3">{t`Choose weekdays (Monday–Sunday)`}</Text>
              <View className="flex-row flex-wrap gap-2">
                {[1, 2, 3, 4, 5, 6, 7].map((day) => (
                  <Button
                    key={day}
                    size="sm"
                    variant={weekdays.includes(day) ? "primary" : "outline"}
                    onPress={() =>
                      setWeekdays((current) =>
                        current.includes(day)
                          ? current.filter((item) => item !== day)
                          : [...current, day].sort(),
                      )
                    }
                  >
                    <Button.Label>
                      {["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][day]}
                    </Button.Label>
                  </Button>
                ))}
              </View>
            </View>
          ) : null}
          {cadence === "any-days-per-week" ? (
            <Field
              label={t`Days each Monday–Sunday week`}
              value={daysPerWeek}
              onChangeText={setDaysPerWeek}
              keyboardType="number-pad"
            />
          ) : null}
        </>
      ) : null}
      {kind === "streak" ? (
        <Field
          label={t`Consecutive days`}
          value={streakDays}
          onChangeText={setStreakDays}
          keyboardType="number-pad"
        />
      ) : null}
      {kind === "average" ? (
        <Field
          label={t`Rolling window (days)`}
          value={windowDays}
          onChangeText={setWindowDays}
          keyboardType="number-pad"
        />
      ) : null}
      {kind === "target" ? (
        <Field
          label={t`Target date (optional)`}
          value={deadline}
          onChangeText={setDeadline}
          placeholder="YYYY-MM-DD"
        />
      ) : null}
      <Field
        label={t`Start date (backdate to include earlier history)`}
        value={startDate}
        onChangeText={setStartDate}
        placeholder="YYYY-MM-DD"
      />
      <Field
        label={t`Goal timezone`}
        value={timeZone}
        onChangeText={setTimeZone}
        placeholder="Europe/London"
      />
      <Field
        label={t`Daily cutoff (optional)`}
        value={cutoff}
        onChangeText={setCutoff}
        placeholder="HH:mm"
      />
      <Text className="text-xs text-ink-3">{t`Rule edits apply going forward. Weekly schedule edits begin next Monday. Pausing never carries a streak across the pause.`}</Text>
      <View className="gap-2">
        <Text className="font-display text-base font-semibold text-ink">{t`Milestones`}</Text>
        {milestones.map((milestone, index) => (
          <MilestoneRow
            key={milestone.id}
            milestone={milestone}
            onChange={(next) =>
              setMilestones((current) =>
                current.map((item, itemIndex) => (itemIndex === index ? next : item)),
              )
            }
            onRemove={() =>
              setMilestones((current) => current.filter((_, itemIndex) => itemIndex !== index))
            }
          />
        ))}
        <Field
          label={t`Checkpoint value`}
          value={milestoneValue}
          onChangeText={setMilestoneValue}
          keyboardType="decimal-pad"
        />
        <Field
          label={t`Checkpoint date`}
          value={milestoneDate}
          onChangeText={setMilestoneDate}
          placeholder="YYYY-MM-DD"
        />
        <Button size="sm" variant="outline" onPress={addMilestone}>
          <Icon icon={Plus} size={16} color="ink-2" />
          <Button.Label>{t`Add milestone`}</Button.Label>
        </Button>
        <Text className="text-xs text-ink-3">{t`Milestones are value-and-date checkpoints on this same metric.`}</Text>
      </View>
      {error ? (
        <Text accessibilityRole="alert" className="text-sm text-destructive">
          {error}
        </Text>
      ) : null}
      {create.isError || update.isError ? (
        <Text accessibilityRole="alert" className="text-sm text-destructive">
          {create.error?.message ??
            update.error?.message ??
            t`Could not save. Check the fields and try again.`}
        </Text>
      ) : null}
      <Button isDisabled={Boolean(error) || create.isPending || update.isPending} onPress={save}>
        <Button.Label>
          {create.isPending || update.isPending ? t`Saving…` : t`Save goal`}
        </Button.Label>
      </Button>
    </Sheet>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  editable,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  keyboardType?: "decimal-pad" | "number-pad";
  editable?: boolean;
}) {
  return (
    <View className="gap-2">
      <Text className="text-sm font-medium text-ink-3">{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        keyboardType={keyboardType}
        editable={editable}
        className="rounded-xl border border-border p-3 text-ink"
      />
      {keyboardType === "decimal-pad" ? <DecimalHint value={value} /> : null}
    </View>
  );
}

function Choice({
  label,
  value,
  values,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  values: Array<[string, string]>;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <View className="gap-2">
      <Text className="text-sm font-medium text-ink-3">{label}</Text>
      <View className="flex-row flex-wrap gap-2">
        {values.map(([key, title]) => (
          <Button
            key={key}
            size="sm"
            isDisabled={disabled}
            variant={value === key ? "primary" : "outline"}
            onPress={() => onChange(key)}
          >
            <Button.Label>{title}</Button.Label>
          </Button>
        ))}
      </View>
    </View>
  );
}

function ChoiceRow({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Button variant={selected ? "primary" : "outline"} onPress={onPress}>
      <Button.Label>{label}</Button.Label>
    </Button>
  );
}

function MilestoneRow({
  milestone,
  onChange,
  onRemove,
}: {
  milestone: GoalMilestone;
  onChange: (value: GoalMilestone) => void;
  onRemove: () => void;
}) {
  const { t, i18n } = useLingui();
  // The text as typed, so "8," stays while the member types; the number is
  // read from it on every change and checked on save (#455).
  const [valueText, setValueText] = useState(() =>
    Number.isFinite(milestone.value) ? String(milestone.value) : "",
  );
  return (
    <View className="rounded-2xl bg-paper-2 p-3">
      <View className="flex-row items-center justify-between">
        <Text className="font-semibold text-ink">{t`Checkpoint`}</Text>
        <Button size="sm" variant="ghost" onPress={onRemove}>
          <Icon icon={Trash2} size={16} color="ink-2" />
          <Button.Label>{t`Remove`}</Button.Label>
        </Button>
      </View>
      <Field
        label={t`Value`}
        value={valueText}
        onChangeText={(value) => {
          setValueText(value);
          onChange({ ...milestone, value: parseDecimal(value, i18n.locale) ?? Number.NaN });
        }}
        keyboardType="decimal-pad"
      />
      <Field
        label={t`Date`}
        value={milestone.targetDate}
        onChangeText={(value) => onChange({ ...milestone, targetDate: value })}
        placeholder="YYYY-MM-DD"
      />
    </View>
  );
}

function validate(input: {
  title: string;
  source: Source;
  metric: string;
  kind: Kind;
  comparison: ComparatorKind;
  mode: "amount" | "completion";
  minimum: string;
  maximum: string;
  lower: number;
  upper: number;
  windowDays: string;
  streakDays: string;
  cadence: string;
  weekdays: number[];
  daysPerWeek: string;
  startDate: string;
  timeZone: string;
  cutoff: string;
  milestones: GoalMilestone[];
}):
  | "title"
  | "value"
  | "range"
  | "water"
  | "supplement"
  | "exercise"
  | "streak"
  | "average"
  | "weekday"
  | "days"
  | "start"
  | "timezone"
  | "cutoff"
  | "milestone"
  | null {
  if (!input.title.trim()) return "title";
  if (
    !(input.kind === "recurring" && input.mode === "completion") &&
    (!input.minimum.trim() || !Number.isFinite(input.lower))
  )
    return "value";
  if (
    !(input.kind === "recurring" && input.mode === "completion") &&
    input.comparison === "range" &&
    (!input.maximum.trim() || !Number.isFinite(input.upper) || input.upper < input.lower)
  )
    return "range";
  if (input.source === "water" && input.lower <= 0) return "water";
  if (input.source === "supplement" && !/^supplement:[1-9]\d*$/.test(input.metric))
    return "supplement";
  if (input.source === "workout" && !/^exercise:[1-9]\d*$/.test(input.metric)) return "exercise";
  if (
    input.kind === "streak" &&
    (!Number.isInteger(Number(input.streakDays)) || Number(input.streakDays) < 1)
  )
    return "streak";
  if (
    input.kind === "average" &&
    (!Number.isInteger(Number(input.windowDays)) || Number(input.windowDays) < 1)
  )
    return "average";
  if (input.kind === "recurring" && input.cadence === "weekdays" && !input.weekdays.length)
    return "weekday";
  if (
    input.kind === "recurring" &&
    input.cadence === "any-days-per-week" &&
    (!Number.isInteger(Number(input.daysPerWeek)) ||
      Number(input.daysPerWeek) < 1 ||
      Number(input.daysPerWeek) > 7)
  )
    return "days";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate)) return "start";
  try {
    new Intl.DateTimeFormat("en", { timeZone: input.timeZone }).format();
  } catch {
    return "timezone";
  }
  if (input.cutoff && !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.cutoff)) return "cutoff";
  if (
    input.milestones.some(
      (milestone) =>
        !Number.isFinite(milestone.value) || !/^\d{4}-\d{2}-\d{2}$/.test(milestone.targetDate),
    )
  )
    return "milestone";
  return null;
}
