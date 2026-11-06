import { plural } from "@lingui/core/macro";
import { useLingui as useLinguiRuntime } from "@lingui/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { type ActivityLoadResult } from "@openvalens/api/activity-load-contract";
import {
  ACTIVITY_LOAD_COPY,
  activityLoadView,
  type ActivityNumberView,
  canRateEffortToday,
  EFFORT_QUESTION,
  EFFORT_RATING_OPTIONS,
  effortRatingLabel,
  INTENSITY_LABELS,
  sessionEffortText,
} from "@openvalens/api/presenters/activity-load";
import {
  summarizeWorkouts,
  workoutDurationLabel,
  workoutTypeLabel,
} from "@openvalens/api/presenters/workouts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useRouter } from "expo-router";
import { Button, Spinner } from "heroui-native";
import { BookOpen, Dumbbell, Flame, Footprints, Timer, TrendingUp, Zap } from "lucide-react-native";
import { useState } from "react";
import { Alert, Pressable, RefreshControl, Text, View } from "react-native";

import {
  Details,
  EmptyState,
  ErrorState,
  Icon,
  InfoTip,
  Page,
  PageHeader,
  Prose,
  Section,
  Sheet,
  StatTile,
  TileRow,
  ToneIcon,
} from "@/components/bloom";
import { TrendChart } from "@/components/chart";
import { Container } from "@/components/container";
import { friendlyDate } from "@/utils/friendly";
import { orpc } from "@/utils/orpc";
import { useThemeColor } from "@/utils/theme";
import { ModuleHiddenNote } from "@/components/module-hidden-note";
import { WorkoutSession } from "@/components/workout-session";
import { SessionCard, TrainingStart, TrainingWeek } from "@/components/training-home";
import { toggleEffort } from "@/utils/activity-load-screen";
import { WorkoutSessionDetail } from "@/components/workout-session-detail";
import { useWorkoutSession } from "@/lib/workouts/sync";
import type { WorkoutDetail } from "@/lib/workouts/model";
import { createWorkoutDraft } from "@/lib/workouts/model";
import { authClient } from "@/lib/auth-client";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
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
      className={`min-h-9 justify-center rounded-full border px-3.5 py-1.5 active:opacity-70 ${selected ? "border-primary bg-primary/15" : "border-rule-2 bg-sheet"}`}
    >
      <Text className={`font-sans text-sm ${selected ? "font-semibold text-ink" : "text-ink-2"}`}>
        {label}
      </Text>
    </Pressable>
  );
}

/** How many sessions show as cards; the rest are in the full log. */
const RECENT_SESSIONS = 6;

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

export default function WorkoutsScreen() {
  const { t, i18n } = useLingui();
  const { _ } = useLinguiRuntime();
  const queryClient = useQueryClient();
  const router = useRouter();
  const foreground = useThemeColor("foreground");
  const session = useWorkoutSession();
  const { data: auth } = authClient.useSession();
  const identity = `${auth?.user?.id ?? ""}:${auth?.session.activeOrganizationId ?? ""}`;
  const [selectedWorkout, setSelectedWorkout] = useState<WorkoutDetail | null>(null);

  const workouts = useQuery({
    ...orpc.plans.workouts.listWorkouts.queryOptions({ input: { limit: 50 } }),
    queryKey: [...orpc.plans.workouts.listWorkouts.queryKey({ input: { limit: 50 } }), identity],
    enabled: !!auth?.user?.id && !!auth.session.activeOrganizationId,
  });
  const load = useQuery({
    ...orpc.activity.weeklyLoad.queryOptions({ input: {} }),
    queryKey: [...orpc.activity.weeklyLoad.queryKey({ input: {} }), identity],
    enabled: !!auth?.user?.id && !!auth.session.activeOrganizationId,
  });
  const settings = useQuery(orpc.adminSettings.productSettings.queryOptions({ input: {} }));
  const units = settings.data?.units === "imperial" ? "lb" : "kg";

  const header = (
    <PageHeader
      title={t`Training`}
      actions={
        <Link href="/exercise-library" asChild>
          <Button variant="outline" size="sm" accessibilityRole="link">
            <Icon icon={BookOpen} size={16} color="ink-2" />
            <Button.Label>{t`Library`}</Button.Label>
          </Button>
        </Link>
      }
    />
  );

  // routineSnapshot is stored as jsonb, so the server type is unknown; it is written only from RoutineSnapshot.
  const workoutItems = session.optimisticWorkouts((workouts.data ?? []) as WorkoutDetail[]);
  const workoutSummary = summarizeWorkouts(workoutItems);
  const today = todayIso();
  const recent = workoutItems.slice(0, RECENT_SESSIONS);

  const reloadWorkouts = () => {
    void workouts.refetch();
    void queryClient.invalidateQueries({
      queryKey: [["plans", "workouts", "listWorkouts"]],
    });
    void queryClient.invalidateQueries({ queryKey: orpc.activity.weeklyLoad.key() });
  };

  return (
    <Container
      scrollViewProps={{
        refreshControl: (
          <RefreshControl
            refreshing={workouts.isRefetching || load.isRefetching}
            onRefresh={() => {
              void workouts.refetch();
              void load.refetch();
            }}
            tintColor={foreground}
          />
        ),
      }}
    >
      <Page>
        <ModuleHiddenNote module="activity" />
        {header}

        <WorkoutSession />
        {session.draft ? null : (
          <TrainingStart
            workouts={workoutItems}
            today={today}
            onStartDraft={(draft) => session.saveDraft(draft)}
            onEmptyWorkout={() => session.saveDraft(createWorkoutDraft())}
            onPastSession={() => session.saveDraft(createWorkoutDraft())}
            onNewRoutine={() => router.push("/routines")}
          />
        )}
        {session.draft ? (
          <Button
            variant="outline"
            testID="workout-log-past-busy"
            onPress={() =>
              Alert.alert(
                t`Active workout in progress`,
                t`Save or discard your active workout before starting a past session.`,
                [
                  { text: t`Cancel`, style: "cancel" },
                  {
                    text: t`Discard and continue`,
                    style: "destructive",
                    onPress: () => {
                      if (session.discardDraft()) session.saveDraft(createWorkoutDraft());
                    },
                  },
                ],
              )
            }
          >
            <Button.Label>{t`Log past session`}</Button.Label>
          </Button>
        ) : null}
        <WorkoutSessionDetail
          workout={auth?.user?.id && auth.session.activeOrganizationId ? selectedWorkout : null}
          units={units === "lb" ? "imperial" : "metric"}
          onClose={() => setSelectedWorkout(null)}
        />

        {workoutItems.length > 0 ? (
          <TrainingWeek workouts={workoutItems} today={today} units={units} />
        ) : null}
        <Section
          icon={Dumbbell}
          tone="steps"
          title={t`Recent sessions`}
          description={
            workoutSummary.count > 0
              ? t`${plural(workoutSummary.count, { one: "# session", other: "# sessions" })}, ${workoutSummary.totalDurationLabel}`
              : undefined
          }
        >
          {workouts.isPending ? (
            <Text className="font-sans text-sm text-ink-3">
              <Trans>Loading recent sessions…</Trans>
            </Text>
          ) : workouts.isError && workoutItems.length === 0 ? (
            <View className="gap-2">
              <Text className="font-sans text-sm text-ink-2">
                <Trans>Could not load recent sessions.</Trans>
              </Text>
              <Button variant="outline" size="sm" onPress={() => void workouts.refetch()}>
                <Button.Label>{t`Retry`}</Button.Label>
              </Button>
            </View>
          ) : workoutItems.length === 0 ? (
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
                const localPending =
                  workout.id < 1 ||
                  workout.ownership !== "mine" ||
                  session.items.some(
                    (item) =>
                      item.targetId === workout.id ||
                      ("localKey" in workout && item.id === workout.localKey),
                  );
                const canRate =
                  !!workout.canEdit &&
                  !localPending &&
                  workout.id > 0 &&
                  workout.ownership === "mine" &&
                  rating === null &&
                  canRateEffortToday(workout.date, today);
                return (
                  <SessionCard
                    key={workout.id}
                    workout={workout}
                    typeLabel={_(workoutTypeLabel(workout.type))}
                    durationLabel={workoutDurationLabel(workout.duration)}
                    units={units}
                    onPress={() => setSelectedWorkout(workout)}
                  >
                    {rating !== null ? (
                      <Text className="font-sans text-sm text-ink-3">
                        {t`Effort ${rating}/10`}
                        {workout.intensity ? ` · ${_(INTENSITY_LABELS[workout.intensity])}` : ""}
                      </Text>
                    ) : null}
                    {workout.notes ? (
                      <Text className="font-sans text-sm text-ink-2">{workout.notes}</Text>
                    ) : null}
                    {canRate ? (
                      <RateEffort workoutId={workout.id} onSaved={reloadWorkouts} />
                    ) : null}
                  </SessionCard>
                );
              })}
              <Details summary={<Trans>Full log</Trans>}>
                <Sheet className="gap-0 px-4 py-1">
                  {workoutItems.map((workout, index, arr) => (
                    <View
                      key={workout.id}
                      className={`flex-row items-start justify-between gap-3 py-3 ${
                        index < arr.length - 1 ? "border-b border-rule" : ""
                      }`}
                    >
                      <View className="min-w-0 flex-1 gap-0.5">
                        <Pressable
                          accessibilityRole="button"
                          onPress={() => setSelectedWorkout(workout)}
                        >
                          <Text className="font-sans text-base font-medium text-ink">
                            {_(workoutTypeLabel(workout.type))}
                          </Text>
                          <Text className="font-sans text-sm text-ink-3">
                            {workout.date}
                            {workout.notes ? `, ${workout.notes}` : ""}
                          </Text>
                          <Text className="font-sans text-sm text-ink-3">
                            {sessionEffortText(workout, i18n)}
                          </Text>
                        </Pressable>
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

        <Link href="/goals" asChild>
          <Button variant="outline">
            <Button.Label>{t`Goals`}</Button.Label>
          </Button>
        </Link>
        <Link href="/body-map" asChild>
          <Button variant="outline">
            <Button.Label>{t`Body map`}</Button.Label>
          </Button>
        </Link>

        {load.isPending ? (
          <Sheet className="items-center py-10">
            <Spinner />
          </Sheet>
        ) : load.isError || !load.data ? (
          <ErrorState
            title={<Trans>Could not load weekly activity.</Trans>}
            action={
              <Button variant="outline" size="sm" onPress={() => void load.refetch()}>
                <Button.Label>{t`Retry`}</Button.Label>
              </Button>
            }
          />
        ) : (
          <ActivityLoadView result={load.data} />
        )}
      </Page>
    </Container>
  );
}
