import { plural } from "@lingui/core/macro";
import { useLingui as useLinguiRuntime } from "@lingui/react";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  ACTIVITY_INTENSITIES,
  type ActivityIntensityOption,
  type ActivityLoadResult,
} from "@openvalens/api/activity-load-contract";
import {
  ACTIVITY_LOAD_COPY,
  activityLoadView,
  type ActivityNumberView,
  canRateEffortToday,
  EFFORT_QUESTION,
  EFFORT_RATING_OPTIONS,
  effortRatingLabel,
  INTENSITY_DESCRIPTIONS,
  INTENSITY_LABELS,
  sessionEffortText,
} from "@openvalens/api/presenters/activity-load";
import {
  GOAL_DIRECTION_OPTIONS,
  GOAL_PRIORITY_OPTIONS,
  goalDirectionLabel,
  goalMeasurementFields,
  goalPriorityLabel,
  goalStatusLabel,
  summarizeGoals,
  type GoalDirectionOption,
  type GoalPriorityOption,
  summarizeWorkouts,
  workoutDurationLabel,
  workoutTypeLabel,
  workoutTypeRecordName,
} from "@openvalens/api/presenters/workouts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "expo-router";
import { Button, Spinner } from "heroui-native";
import {
  Activity,
  Bike,
  BookOpen,
  Dumbbell,
  Flame,
  Footprints,
  type LucideIcon,
  Plus,
  Target,
  Timer,
  TrendingUp,
  Trophy,
  Waves,
  Zap,
} from "lucide-react-native";
import { useState } from "react";
import { Pressable, RefreshControl, Text, TextInput, View } from "react-native";

import {
  Details,
  EmptyState,
  ErrorState,
  Icon,
  InfoTip,
  ListCard,
  Meter,
  Page,
  PageHeader,
  Prose,
  Section,
  Sheet,
  StatTile,
  type StatusTone,
  TileRow,
  ToneIcon,
} from "@/components/bloom";
import { TrendChart } from "@/components/chart";
import { Container } from "@/components/container";
import { toggleEffort, toggleIntensity } from "@/utils/activity-load-screen";
import { friendlyDate } from "@/utils/friendly";
import { orpc } from "@/utils/orpc";
import { goalLogValue } from "@/utils/score-screen";
import { useThemeColor } from "@/utils/theme";

const WORKOUT_TYPES = ["weights", "running", "cycling", "swimming", "tennis", "other"] as const;
type WorkoutType = (typeof WORKOUT_TYPES)[number];

const GOAL_STATUSES = ["not_started", "in_progress", "achieved", "paused", "cancelled"] as const;
type GoalStatus = (typeof GOAL_STATUSES)[number];

const MAX_DURATION_MINUTES = 1440;

/** How many sessions show as cards; the rest are in the full log. */
const RECENT_SESSIONS = 6;

const INPUT_CLASS =
  "min-h-11 rounded-xl border border-rule-2 bg-paper-2 px-3 font-sans text-base text-ink";

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

function goalTone(status: string): StatusTone {
  if (status === "achieved") return "good";
  return "neutral";
}

/** How far a goal has come from its start toward its target, 0 to 1; null without three numbers (as web). */
function goalShare(start: string | null, now: string | null, target: string | null): number | null {
  const a = Number.parseFloat(start ?? "");
  const b = Number.parseFloat(now ?? "");
  const c = Number.parseFloat(target ?? "");
  if (![a, b, c].every(Number.isFinite) || a === c) return null;
  return (b - a) / (c - a);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Whole minutes in [1, 1440], or null when blank/invalid. */
function parseDurationMinutes(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > MAX_DURATION_MINUTES) return null;
  return parsed;
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <Text className="font-sans text-sm font-medium text-ink-3">{children}</Text>;
}

function Pill({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      className={`min-h-9 justify-center rounded-full border px-3.5 py-1.5 active:opacity-70 ${
        selected ? "border-primary bg-primary/15" : "border-rule-2 bg-sheet"
      }`}
    >
      <Text className={`font-sans text-sm ${selected ? "font-semibold text-ink" : "text-ink-2"}`}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Issue #99 — 0–10 effort choices (CR-10); tapping the selected one clears it. */
function EffortPills({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (next: number | null) => void;
}) {
  const { i18n } = useLingui();
  return (
    <View className="flex-row flex-wrap gap-2" accessibilityLabel={i18n._(EFFORT_QUESTION)}>
      {EFFORT_RATING_OPTIONS.map((rating) => (
        <Pill
          key={rating}
          label={effortRatingLabel(rating, i18n)}
          selected={value === rating}
          onPress={() => onChange(toggleEffort(value, rating))}
        />
      ))}
    </View>
  );
}

/** Issue #99 — add a missing effort rating later the same day (same as web "Rate"). */
function RateEffort({ workoutId, onSaved }: { workoutId: number; onSaved: () => void }) {
  const { t, i18n } = useLingui();
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState<number | null>(null);
  const rate = useMutation(
    orpc.plans.workouts.rateEffort.mutationOptions({ onSuccess: () => onSaved() }),
  );
  if (!open)
    return (
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        className="min-h-11 justify-center self-start"
      >
        <Text className="font-sans text-sm font-semibold text-signal">
          <Trans>Rate effort</Trans>
        </Text>
      </Pressable>
    );
  return (
    <View className="gap-2">
      <Text className="font-sans text-sm text-ink-3">{i18n._(EFFORT_QUESTION)}</Text>
      <EffortPills value={rating} onChange={setRating} />
      <View className="flex-row items-center gap-3">
        <Button
          size="sm"
          variant="secondary"
          isDisabled={rating === null || rate.isPending}
          onPress={() => {
            if (rating !== null) rate.mutate({ id: workoutId, effortRating: rating });
          }}
        >
          {t`Save rating`}
        </Button>
        {rate.isError ? (
          <Text className="font-sans text-sm text-destructive">
            <Trans>Could not save.</Trans>
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** The method behind one weekly number: breakdown, coverage, formula and sources. */
function NumberMethod({ part }: { part: ActivityNumberView }) {
  return (
    <View className="gap-1.5">
      <Text className="font-sans text-base font-semibold text-ink">{part.title}</Text>
      {part.breakdown.map((line) => (
        <Text key={line} className="font-sans text-sm text-ink-2">
          {line}
        </Text>
      ))}
      {part.coverage.map((line) => (
        <Text key={line} className="font-sans text-sm text-ink-3">
          {line}
        </Text>
      ))}
      <Text className="font-sans text-sm text-ink-2">{part.formula}</Text>
      {part.sources.map((line) => (
        <Text key={line} className="font-sans text-sm text-ink-3">
          {line}
        </Text>
      ))}
    </View>
  );
}

/** Issue #99 — weekly activity (same content as the web card), in Bloom. */
function ActivityLoadView({ result }: { result: ActivityLoadResult }) {
  const { i18n } = useLingui();
  const view = activityLoadView(result, i18n);
  const active = result.load?.activeMinutes;
  const activeMeter =
    active && active.activeMinutes !== null && active.whoRange.lower > 0
      ? { value: active.activeMinutes / active.whoRange.lower }
      : undefined;
  const chartData = (result.load?.effort.days ?? []).map((day) => ({
    value: day.points ?? 0,
    label: friendlyDate(i18n, day.date),
  }));
  const parts = [view.activeMinutes, view.effort].filter(
    (part): part is ActivityNumberView => part !== null,
  );

  return (
    <View className="gap-3">
      <View className="gap-1">
        <View className="flex-row items-center gap-2">
          <ToneIcon icon={Flame} tone="steps" size="sm" />
          <Text
            className="shrink font-display text-xl font-semibold text-ink"
            accessibilityRole="header"
          >
            {view.title}
          </Text>
          <InfoTip title={view.title}>
            <Prose>{view.intro}</Prose>
            {view.notes.map((line) => (
              <Text key={line} className="font-sans text-sm text-ink-3">
                {line}
              </Text>
            ))}
            {view.versionText ? (
              <Text className="font-sans text-sm text-ink-3">{view.versionText}</Text>
            ) : null}
          </InfoTip>
        </View>
        {view.windowText ? (
          <Text className="font-sans text-sm text-ink-3">{view.windowText}</Text>
        ) : null}
      </View>

      {view.withheldExplanation ? (
        <Sheet>
          <Prose>{view.withheldExplanation}</Prose>
        </Sheet>
      ) : null}

      {view.activeMinutes && view.effort ? (
        <TileRow>
          <View accessible accessibilityLabel={view.activeMinutes.accessibilityLabel}>
            <StatTile
              icon={Timer}
              tone="steps"
              label={view.activeMinutes.title}
              value={view.activeMinutes.valueText}
              unit={view.activeMinutes.available ? view.activeMinutes.unitText : undefined}
              meter={activeMeter}
              note={view.activeMinutes.statusText}
            />
          </View>
          <View accessible accessibilityLabel={view.effort.accessibilityLabel}>
            <StatTile
              icon={Zap}
              tone="steps"
              label={view.effort.title}
              value={view.effort.valueText}
              unit={view.effort.available ? view.effort.unitText : undefined}
              note={view.effort.statusText}
            />
          </View>
        </TileRow>
      ) : null}

      {parts.length > 0 ? (
        <Details summary={<Trans>How this is calculated</Trans>}>
          <Sheet className="gap-4">
            {parts.map((part) => (
              <NumberMethod key={part.key} part={part} />
            ))}
          </Sheet>
        </Details>
      ) : null}

      {view.effortDays.length > 0 ? (
        <Sheet className="gap-3">
          <Text className="font-sans text-base font-semibold text-ink-2">
            <Trans>Effort points by day</Trans>
          </Text>
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <TrendChart tone="steps" data={chartData} bars minValue={0} />
          </View>
          <Details summary={<Trans>By day</Trans>}>
            <View className="gap-1">
              {view.effortDays.map((day) => (
                <View
                  key={day.date}
                  className="flex-row justify-between gap-4 py-1"
                  accessible
                  accessibilityLabel={day.accessibilityLabel}
                >
                  <Text className="font-sans text-sm text-ink-3">{day.label}</Text>
                  <Text
                    className="font-sans text-sm font-semibold text-ink"
                    style={{ fontVariant: ["tabular-nums"] }}
                  >
                    {day.valueText}
                  </Text>
                </View>
              ))}
            </View>
          </Details>
        </Sheet>
      ) : null}

      {view.comparison ? (
        <Sheet
          className="flex-row items-start gap-3"
          accessibilityLabel={view.comparison.accessibilityLabel}
        >
          <ToneIcon icon={TrendingUp} tone="steps" size="sm" />
          <View className="min-w-0 flex-1 gap-1">
            <View className="flex-row items-center gap-1">
              <Text className="shrink font-sans text-base font-semibold text-ink">
                {view.comparison.title}
              </Text>
              <InfoTip title={view.comparison.title}>
                {view.comparison.detail ? <Prose>{view.comparison.detail}</Prose> : null}
                <Text className="font-sans text-sm text-ink-3">{view.comparison.limits}</Text>
              </InfoTip>
            </View>
            <Text className="font-sans text-sm text-ink-2">{view.comparison.text}</Text>
          </View>
        </Sheet>
      ) : null}

      {view.context.length > 0 ? (
        <Sheet className="flex-row items-start gap-3">
          <ToneIcon icon={Footprints} tone="steps" size="sm" />
          <View className="min-w-0 flex-1 gap-1">
            <Text className="font-sans text-base font-semibold text-ink">
              {i18n._(ACTIVITY_LOAD_COPY.contextTitle)}
            </Text>
            {view.context.map((line) => (
              <Text key={line} className="font-sans text-sm text-ink-2">
                {line}
              </Text>
            ))}
          </View>
        </Sheet>
      ) : null}
    </View>
  );
}

function AddWorkoutForm({ onSaved }: { onSaved: () => void }) {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  const placeholder = useThemeColor("ink-3");
  const [type, setType] = useState<WorkoutType>("weights");
  const [date, setDate] = useState(todayIso);
  const [duration, setDuration] = useState("");
  const [notes, setNotes] = useState("");
  // Issue #99 — both optional; left unset they are shown as missing, never guessed.
  const [intensity, setIntensity] = useState<ActivityIntensityOption | null>(null);
  const [effort, setEffort] = useState<number | null>(null);

  const save = useMutation(
    orpc.plans.workouts.upsertWorkout.mutationOptions({
      onSuccess: () => {
        setDuration("");
        setNotes("");
        setDate(todayIso());
        setIntensity(null);
        setEffort(null);
        onSaved();
      },
    }),
  );

  const parsedDuration = parseDurationMinutes(duration);
  const durationInvalid = duration.trim().length > 0 && parsedDuration === null;
  const dateMissing = date.trim().length === 0;

  const submit = () => {
    if (dateMissing || durationInvalid) return;
    save.mutate({
      date,
      type,
      duration: parsedDuration,
      notes: notes.trim().length > 0 ? notes.trim() : null,
      intensity,
      effortRating: effort,
      // `upsertWorkout` requires at least one exercise with one set; the
      // session header is what this form captures, so we seed a single
      // placeholder set the user can refine later.
      exercises: [{ name: workoutTypeRecordName(type), notes: null, sets: [{ reps: 1 }] }],
    });
  };

  return (
    <Section sheet icon={Plus} tone="steps" title={t`Add a session`}>
      <View className="gap-2">
        <FieldLabel>
          <Trans>Type</Trans>
        </FieldLabel>
        <View className="flex-row flex-wrap gap-2">
          {WORKOUT_TYPES.map((value) => (
            <Pill
              key={value}
              label={_(workoutTypeLabel(value))}
              selected={value === type}
              onPress={() => setType(value)}
            />
          ))}
        </View>
      </View>
      <View className="flex-row gap-3">
        <View className="flex-1 gap-2">
          <FieldLabel>
            <Trans>Date</Trans>
          </FieldLabel>
          <TextInput
            value={date}
            onChangeText={setDate}
            placeholder={t`YYYY-MM-DD`}
            className={INPUT_CLASS}
            placeholderTextColor={placeholder}
          />
        </View>
        <View className="flex-1 gap-2">
          <FieldLabel>
            <Trans>Duration (minutes)</Trans>
          </FieldLabel>
          <TextInput
            value={duration}
            onChangeText={setDuration}
            placeholder="45"
            keyboardType="numeric"
            className={INPUT_CLASS}
            placeholderTextColor={placeholder}
          />
        </View>
      </View>
      <View className="gap-2">
        <View className="flex-row items-center gap-1">
          <FieldLabel>
            <Trans>Intensity (optional)</Trans>
          </FieldLabel>
          <InfoTip title={t`Intensity (optional)`}>
            <Prose>
              <Trans>
                Talk test: light — you can talk and sing; moderate — you can talk, but not sing;
                vigorous — you can only say a few words without pausing for breath.
              </Trans>
            </Prose>
          </InfoTip>
        </View>
        <View className="flex-row flex-wrap gap-2">
          {ACTIVITY_INTENSITIES.map((value) => (
            <Pill
              key={value}
              label={_(INTENSITY_LABELS[value])}
              selected={value === intensity}
              onPress={() => setIntensity(toggleIntensity(intensity, value))}
            />
          ))}
        </View>
        {intensity ? (
          <Text className="font-sans text-sm text-ink-3">
            {_(INTENSITY_DESCRIPTIONS[intensity])}
          </Text>
        ) : null}
      </View>
      <View className="gap-2">
        <FieldLabel>
          <Trans>Effort, 0–10 (optional)</Trans>
        </FieldLabel>
        <View className="flex-row items-center gap-1">
          <Text className="shrink font-sans text-sm text-ink-3">
            <Trans>You can also add it later today.</Trans>
          </Text>
          <InfoTip title={t`Effort, 0–10 (optional)`}>
            <Prose>{_(EFFORT_QUESTION)}</Prose>
          </InfoTip>
        </View>
        <EffortPills value={effort} onChange={setEffort} />
      </View>
      <View className="gap-2">
        <FieldLabel>
          <Trans>Notes</Trans>
        </FieldLabel>
        <TextInput
          value={notes}
          onChangeText={setNotes}
          placeholder={t`How did it go?`}
          multiline
          className="min-h-20 rounded-xl border border-rule-2 bg-paper-2 px-3 py-2 font-sans text-base text-ink"
          placeholderTextColor={placeholder}
        />
      </View>
      <View className="flex-row flex-wrap items-center gap-3 pt-1">
        <Button onPress={submit} isDisabled={dateMissing || durationInvalid || save.isPending}>
          {save.isPending ? t`Saving…` : t`Save`}
        </Button>
        {durationInvalid ? (
          <Text className="font-sans text-sm text-destructive">
            <Trans>Duration must be 1–1440 minutes.</Trans>
          </Text>
        ) : save.isSuccess ? (
          <Text className="font-sans text-sm text-success">
            <Trans>Saved</Trans>
          </Text>
        ) : save.isError ? (
          <Text className="font-sans text-sm text-destructive">
            <Trans>Could not save.</Trans>
          </Text>
        ) : null}
      </View>
    </Section>
  );
}

function AddGoalForm({ onSaved }: { onSaved: () => void }) {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  const placeholder = useThemeColor("ink-3");
  const [title, setTitle] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [status, setStatus] = useState<GoalStatus>("not_started");
  // Issue #95 — optional measurement so goal progress can be calculated (same as web).
  const [startValue, setStartValue] = useState("");
  const [targetValue, setTargetValue] = useState("");
  const [direction, setDirection] = useState<GoalDirectionOption | null>(null);
  const [priority, setPriority] = useState<GoalPriorityOption>("normal");

  const save = useMutation(
    orpc.plans.goals.upsertGoal.mutationOptions({
      onSuccess: () => {
        setTitle("");
        setTargetDate("");
        setStatus("not_started");
        setStartValue("");
        setTargetValue("");
        setDirection(null);
        setPriority("normal");
        onSaved();
      },
    }),
  );

  const titleMissing = title.trim().length === 0;
  const measurement = goalMeasurementFields({ startValue, targetValue, direction, priority });

  const submit = () => {
    if (titleMissing || !measurement.ok) return;
    save.mutate({
      title: title.trim(),
      // `upsertGoal` requires a category; goals created here default to
      // the general health category.
      category: "health",
      targetDate: targetDate.trim().length > 0 ? targetDate : null,
      status,
      ...measurement.fields,
    });
  };

  return (
    <Section sheet icon={Plus} tone="weight" title={t`Add a goal`}>
      <View className="gap-2">
        <FieldLabel>
          <Trans>Title</Trans>
        </FieldLabel>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder={t`Run a 5k`}
          className={INPUT_CLASS}
          placeholderTextColor={placeholder}
        />
      </View>
      <View className="gap-2">
        <FieldLabel>
          <Trans>Due date</Trans>
        </FieldLabel>
        <TextInput
          value={targetDate}
          onChangeText={setTargetDate}
          placeholder={t`YYYY-MM-DD`}
          className={INPUT_CLASS}
          placeholderTextColor={placeholder}
        />
      </View>
      <View className="gap-2">
        <FieldLabel>
          <Trans>Status</Trans>
        </FieldLabel>
        <View className="flex-row flex-wrap gap-2">
          {GOAL_STATUSES.map((value) => (
            <Pill
              key={value}
              label={_(goalStatusLabel(value))}
              selected={value === status}
              onPress={() => setStatus(value)}
            />
          ))}
        </View>
      </View>
      <View className="flex-row gap-3">
        <View className="flex-1 gap-2">
          <FieldLabel>
            <Trans>Starting value (optional)</Trans>
          </FieldLabel>
          <TextInput
            value={startValue}
            onChangeText={setStartValue}
            placeholder="80 kg"
            accessibilityLabel={t`Starting value (optional)`}
            className={INPUT_CLASS}
            placeholderTextColor={placeholder}
          />
        </View>
        <View className="flex-1 gap-2">
          <FieldLabel>
            <Trans>Target (optional)</Trans>
          </FieldLabel>
          <TextInput
            value={targetValue}
            onChangeText={setTargetValue}
            placeholder="75 kg"
            accessibilityLabel={t`Target (optional)`}
            className={INPUT_CLASS}
            placeholderTextColor={placeholder}
          />
        </View>
      </View>
      <View className="gap-2">
        <FieldLabel>
          <Trans>Progress means the value should</Trans>
        </FieldLabel>
        <View className="flex-row flex-wrap gap-2">
          {GOAL_DIRECTION_OPTIONS.map((value) => (
            <Pill
              key={value}
              label={_(goalDirectionLabel(value))}
              selected={value === direction}
              onPress={() => setDirection(value === direction ? null : value)}
            />
          ))}
        </View>
      </View>
      <View className="gap-2">
        <FieldLabel>
          <Trans>Priority</Trans>
        </FieldLabel>
        <View className="flex-row flex-wrap gap-2">
          {GOAL_PRIORITY_OPTIONS.map((value) => (
            <Pill
              key={value}
              label={_(goalPriorityLabel(value))}
              selected={value === priority}
              onPress={() => setPriority(value)}
            />
          ))}
        </View>
      </View>
      <View className="flex-row flex-wrap items-center gap-3 pt-1">
        <Button
          variant="outline"
          onPress={submit}
          isDisabled={titleMissing || !measurement.ok || save.isPending}
        >
          {save.isPending ? t`Saving…` : t`Save`}
        </Button>
        {!measurement.ok ? (
          <Text className="font-sans text-sm text-destructive" accessibilityRole="alert">
            {_(measurement.error)}
          </Text>
        ) : save.isSuccess ? (
          <Text className="font-sans text-sm text-success">
            <Trans>Saved</Trans>
          </Text>
        ) : save.isError ? (
          <Text className="font-sans text-sm text-destructive">
            <Trans>Could not save.</Trans>
          </Text>
        ) : null}
      </View>
    </Section>
  );
}

/** Issue #95 — record today's value for a goal (same as web "Log"). */
function LogGoalValue({ goalId, onSaved }: { goalId: number; onSaved: () => void }) {
  const { t } = useLingui();
  const placeholder = useThemeColor("ink-3");
  const [text, setText] = useState("");
  const log = useMutation(
    orpc.plans.goals.upsertCheckin.mutationOptions({
      onSuccess: () => {
        setText("");
        onSaved();
      },
    }),
  );
  const value = goalLogValue(text);
  return (
    <View className="flex-row items-center gap-2">
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder={t`Today`}
        accessibilityLabel={t`Today's value`}
        maxLength={80}
        className="min-h-11 w-28 rounded-xl border border-rule-2 bg-paper-2 px-3 font-sans text-sm text-ink"
        placeholderTextColor={placeholder}
      />
      <Button
        size="sm"
        variant="secondary"
        isDisabled={value === null || log.isPending}
        onPress={() => {
          if (value !== null) log.mutate({ goalId, date: todayIso(), value });
        }}
      >
        {t`Log`}
      </Button>
    </View>
  );
}

export default function WorkoutsScreen() {
  const { t, i18n } = useLingui();
  const { _ } = useLinguiRuntime();
  const queryClient = useQueryClient();
  const foreground = useThemeColor("foreground");

  const workouts = useQuery(
    orpc.plans.workouts.listWorkouts.queryOptions({ input: { limit: 50 } }),
  );
  const goals = useQuery(orpc.plans.goals.listGoals.queryOptions({ input: {} }));
  const load = useQuery(orpc.activity.weeklyLoad.queryOptions({ input: {} }));

  const header = (
    <PageHeader
      title={t`Workouts`}
      actions={
        <Link href="/exercise-library" asChild>
          <Button variant="outline" size="sm" accessibilityRole="link">
            <Icon icon={BookOpen} size={16} color="ink-2" />
            <Button.Label>{t`Exercise library`}</Button.Label>
          </Button>
        </Link>
      }
    />
  );

  if (workouts.isPending || goals.isPending)
    return (
      <Container>
        <Page>
          {header}
          <Sheet className="items-center py-10">
            <Spinner />
          </Sheet>
        </Page>
      </Container>
    );

  if (workouts.isError || !workouts.data || goals.isError || !goals.data)
    return (
      <Container>
        <Page>
          {header}
          <ErrorState
            title={<Trans>Could not load workouts.</Trans>}
            action={
              <Button
                variant="outline"
                size="sm"
                onPress={() => {
                  void workouts.refetch();
                  void goals.refetch();
                }}
              >
                {t`Retry`}
              </Button>
            }
          />
        </Page>
      </Container>
    );

  const workoutSummary = summarizeWorkouts(workouts.data);
  const goalSummary = summarizeGoals(goals.data);
  const today = todayIso();
  const recent = workouts.data.slice(0, RECENT_SESSIONS);

  const reloadWorkouts = () => {
    void workouts.refetch();
    void queryClient.invalidateQueries({
      queryKey: [["plans", "workouts", "listWorkouts"]],
    });
    void queryClient.invalidateQueries({ queryKey: orpc.activity.weeklyLoad.key() });
  };
  const reloadGoals = () => {
    void goals.refetch();
    void queryClient.invalidateQueries({ queryKey: [["plans", "goals", "listGoals"]] });
    void queryClient.invalidateQueries({ queryKey: orpc.score.key() });
  };

  return (
    <Container
      scrollViewProps={{
        refreshControl: (
          <RefreshControl
            refreshing={workouts.isRefetching || goals.isRefetching || load.isRefetching}
            onRefresh={() => {
              void workouts.refetch();
              void goals.refetch();
              void load.refetch();
            }}
            tintColor={foreground}
          />
        ),
      }}
    >
      <Page>
        {header}

        {load.isPending ? (
          <Sheet className="items-center py-10">
            <Spinner />
          </Sheet>
        ) : load.isError || !load.data ? (
          <ErrorState
            title={<Trans>Could not load weekly activity.</Trans>}
            action={
              <Button variant="outline" size="sm" onPress={() => void load.refetch()}>
                {t`Retry`}
              </Button>
            }
          />
        ) : (
          <ActivityLoadView result={load.data} />
        )}

        <Section
          icon={Dumbbell}
          tone="steps"
          title={t`Session log`}
          description={
            workoutSummary.count > 0
              ? t`${plural(workoutSummary.count, { one: "# session", other: "# sessions" })} · ${workoutSummary.totalDurationLabel}`
              : undefined
          }
        >
          {workouts.data.length === 0 ? (
            <EmptyState
              icon={Dumbbell}
              tone="steps"
              title={<Trans>No workouts yet</Trans>}
              description={<Trans>Add a session to start tracking.</Trans>}
            />
          ) : (
            <View className="gap-3">
              {recent.map((workout) => {
                const rating = workout.effortRating;
                const canRate = rating === null && canRateEffortToday(workout.date, today);
                return (
                  <ListCard
                    key={workout.id}
                    icon={workoutIcon(workout.type)}
                    tone="steps"
                    title={_(workoutTypeLabel(workout.type))}
                    subtitle={`${friendlyDate(i18n, workout.date)}${
                      workout.intensity ? `, ${_(INTENSITY_LABELS[workout.intensity])}` : ""
                    }`}
                    chip={workoutDurationLabel(workout.duration)}
                    status={
                      rating !== null
                        ? { label: `${rating}/10`, tone: "neutral" }
                        : canRate
                          ? undefined
                          : { label: t`Not rated`, tone: "neutral" }
                    }
                  >
                    {workout.notes ? (
                      <Text className="font-sans text-sm text-ink-2">{workout.notes}</Text>
                    ) : null}
                    {canRate ? (
                      <RateEffort workoutId={workout.id} onSaved={reloadWorkouts} />
                    ) : null}
                  </ListCard>
                );
              })}
              <Details summary={<Trans>Full log</Trans>}>
                <Sheet className="gap-0 px-4 py-1">
                  {workouts.data.map((workout, index, arr) => (
                    <View
                      key={workout.id}
                      className={`flex-row items-start justify-between gap-3 py-3 ${
                        index < arr.length - 1 ? "border-b border-rule" : ""
                      }`}
                    >
                      <View className="min-w-0 flex-1 gap-0.5">
                        <Text className="font-sans text-base font-medium text-ink">
                          {_(workoutTypeLabel(workout.type))}
                        </Text>
                        <Text className="font-sans text-sm text-ink-3">
                          {workout.date}
                          {workout.notes ? ` · ${workout.notes}` : ""}
                        </Text>
                        <Text className="font-sans text-sm text-ink-3">
                          {sessionEffortText(workout, i18n)}
                        </Text>
                      </View>
                      <Text
                        className="font-sans text-sm font-semibold text-ink"
                        style={{ fontVariant: ["tabular-nums"] }}
                      >
                        {workoutDurationLabel(workout.duration)}
                      </Text>
                    </View>
                  ))}
                </Sheet>
              </Details>
            </View>
          )}
        </Section>

        <AddWorkoutForm onSaved={reloadWorkouts} />

        <Section
          icon={Target}
          tone="weight"
          title={t`Goals`}
          description={
            goalSummary.total > 0 ? (
              <Trans>
                {goalSummary.open} open · {goalSummary.achieved} achieved
              </Trans>
            ) : undefined
          }
        >
          {goals.data.length === 0 ? (
            <EmptyState
              icon={Target}
              tone="weight"
              title={<Trans>No goals yet</Trans>}
              description={<Trans>Add a goal to start tracking.</Trans>}
            />
          ) : (
            <View className="gap-3">
              {goals.data.map((goal) => {
                const progress = goalShare(goal.baselineValue, goal.currentValue, goal.targetValue);
                return (
                  <ListCard
                    key={goal.id}
                    icon={Target}
                    tone="weight"
                    title={goal.title}
                    status={{ label: _(goalStatusLabel(goal.status)), tone: goalTone(goal.status) }}
                    subtitle={
                      goal.targetDate
                        ? t`Due ${friendlyDate(i18n, goal.targetDate)}`
                        : t`No due date`
                    }
                    chip={
                      goal.currentValue || goal.targetValue
                        ? `${goal.currentValue ?? "—"} / ${goal.targetValue ?? "—"}`
                        : undefined
                    }
                  >
                    {progress !== null ? <Meter value={progress} tone="weight" /> : null}
                    <LogGoalValue goalId={goal.id} onSaved={reloadGoals} />
                  </ListCard>
                );
              })}
            </View>
          )}
        </Section>

        <AddGoalForm onSaved={reloadGoals} />
      </Page>
    </Container>
  );
}
