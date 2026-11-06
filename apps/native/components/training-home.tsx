import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Link } from "expo-router";
import { Play, Star } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

import { Sheet } from "@/components/bloom";
import { useRoutineStarter, WorkoutRoutineStart } from "@/components/workout-routines";
import {
  daysBetween,
  estimateMinutes,
  lastDone,
  nextRoutine,
  sessionLines,
  sessionTitle,
  weekSummary,
  workoutVolumeKg,
  type HomeWorkout,
} from "@/lib/workouts/home";
import type { WorkoutDraft } from "@/lib/workouts/model";
import { friendlyDate } from "@/utils/friendly";
import { useThemeColor } from "@/utils/theme";

const KG_TO_LB = 2.2046226218;

function formatVolume(kg: number, units: "kg" | "lb", locale: string): string {
  const value = Math.round(units === "lb" ? kg * KG_TO_LB : kg);
  return `${new Intl.NumberFormat(locale).format(value)} ${units}`;
}

function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${hours}h ${String(rest).padStart(2, "0")}m` : `${rest}m`;
}

/**
 * Issue #402 — the top of the Training tab: one obvious start action (the
 * next routine), an empty workout and a past session as secondary actions,
 * then routine cards that start in one tap.
 */
export function TrainingStart({
  workouts,
  today,
  onStartDraft,
  onEmptyWorkout,
  onPastSession,
  onNewRoutine,
}: {
  workouts: readonly HomeWorkout[];
  today: string;
  onStartDraft: (draft: WorkoutDraft) => boolean;
  onEmptyWorkout: () => void;
  onPastSession: () => void;
  onNewRoutine: () => void;
}) {
  const { t } = useLingui();
  const signalInk = useThemeColor("signal-ink");
  const { routines, start, busy } = useRoutineStarter(onStartDraft);
  const list = routines.data ?? [];
  const next = nextRoutine(list, workouts);
  const last = next ? lastDone(next.id, workouts) : null;
  const ago = last ? daysBetween(last, today) : null;
  return (
    <View className="gap-3">
      {next ? (
        <Sheet className="gap-2 p-5">
          <View className="flex-row justify-between">
            <Text className="font-sans text-xs font-semibold text-ink-3">
              <Trans>Next up</Trans>
            </Text>
          </View>
          <Text accessibilityRole="header" className="font-display text-2xl font-semibold text-ink">
            {next.name}
          </Text>
          {next.exercises.length > 0 ? (
            <Text className="font-sans text-sm text-ink-2">
              {next.exercises
                .slice(0, 3)
                .map((exercise) => exercise.name)
                .join(" · ")}
              {next.exercises.length > 3 ? ` · +${next.exercises.length - 3}` : ""}
            </Text>
          ) : null}
          <Text className="font-sans text-sm text-ink-3">
            {t`About ${estimateMinutes(next)} min`}
            {ago == null
              ? ""
              : ` · ${
                  ago <= 0
                    ? t`last done today`
                    : t`last done ${plural(ago, { one: "# day ago", other: "# days ago" })}`
                }`}
          </Text>
          <Pressable
            testID="training-start-next"
            accessibilityRole="button"
            accessibilityState={{ busy: busy === next.id, disabled: busy !== null }}
            disabled={busy !== null}
            onPress={() => start(next)}
            className="mt-1.5 min-h-[52px] flex-row items-center justify-center gap-2 rounded-full bg-signal"
          >
            <Play size={16} color={signalInk} fill={signalInk} />
            <Text className="font-sans text-base font-semibold" style={{ color: signalInk }}>
              {busy === next.id ? t`Preparing…` : t`Start ${next.name}`}
            </Text>
          </Pressable>
        </Sheet>
      ) : null}
      <View className="flex-row gap-2">
        <Pressable
          testID="workout-start"
          accessibilityRole="button"
          onPress={onEmptyWorkout}
          className={`min-h-12 flex-1 items-center justify-center rounded-full px-3 ${
            next ? "border border-rule-2 bg-sheet" : "bg-signal"
          }`}
        >
          <Text
            className={`font-sans text-sm font-semibold ${next ? "text-ink" : ""}`}
            style={next ? undefined : { color: signalInk }}
          >
            {next ? t`+ Empty workout` : t`Start workout`}
          </Text>
        </Pressable>
        <Pressable
          testID="workout-log-past"
          accessibilityRole="button"
          onPress={onPastSession}
          className="min-h-12 flex-1 items-center justify-center rounded-full border border-rule-2 bg-sheet px-3"
        >
          <Text className="font-sans text-sm font-semibold text-ink">
            <Trans>Log past session</Trans>
          </Text>
        </Pressable>
      </View>
      <View className="flex-row items-center justify-between">
        <Text accessibilityRole="header" className="font-display text-xl font-semibold text-ink">
          <Trans>Routines</Trans>
        </Text>
        <Link href="/routines" asChild>
          <Pressable
            testID="training-routines-all"
            accessibilityRole="link"
            className="min-h-11 justify-center"
          >
            <Text className="font-sans text-sm font-semibold text-signal">
              <Trans>See all ›</Trans>
            </Text>
          </Pressable>
        </Link>
      </View>
      <WorkoutRoutineStart onStart={onStartDraft} onNew={onNewRoutine} />
      {list.length === 0 && !routines.isLoading ? (
        <Text className="font-sans text-sm text-ink-3">
          <Trans>Save a routine to start it here in one tap.</Trans>
        </Text>
      ) : null}
    </View>
  );
}

/** "This week   3 sessions · 2h 41m · 18,450 kg" */
export function TrainingWeek({
  workouts,
  today,
  units,
}: {
  workouts: readonly HomeWorkout[];
  today: string;
  units: "kg" | "lb";
}) {
  const { t, i18n } = useLingui();
  const week = weekSummary(workouts, today);
  return (
    <View className="flex-row flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <Text accessibilityRole="header" className="font-display text-xl font-semibold text-ink">
        <Trans>This week</Trans>
      </Text>
      <Text className="num font-sans text-sm text-ink-2">
        {t`${plural(week.sessions, { one: "# session", other: "# sessions" })}`} ·{" "}
        {formatMinutes(week.minutes)}
        {week.volumeKg > 0 ? ` · ${formatVolume(week.volumeKg, units, i18n.locale)}` : ""}
      </Text>
    </View>
  );
}

/**
 * A recent session as a Hevy-style card: title, date and duration, the first
 * exercises with set counts, a PR badge and the total volume.
 */
export function SessionCard({
  workout,
  typeLabel,
  durationLabel,
  units,
  onPress,
  children,
}: {
  workout: HomeWorkout;
  typeLabel: string;
  durationLabel: string;
  units: "kg" | "lb";
  onPress: () => void;
  children?: React.ReactNode;
}) {
  const { t, i18n } = useLingui();
  const signal = useThemeColor("signal");
  const { lines, more } = sessionLines(workout);
  const volume = workoutVolumeKg(workout);
  const prs = workout.prs?.length ?? 0;
  const title = sessionTitle(workout) ?? typeLabel;
  return (
    <Sheet className="gap-1.5 p-4">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t`${title}, ${friendlyDate(i18n, workout.date)}. View workout details`}
        onPress={onPress}
        className="gap-1.5"
      >
        <View className="flex-row items-baseline justify-between gap-2">
          <Text numberOfLines={1} className="shrink font-sans text-base font-semibold text-ink">
            {title}
          </Text>
          <Text className="num font-sans text-sm text-ink-3">
            {friendlyDate(i18n, workout.date)}
            {workout.duration ? ` · ${durationLabel}` : ""}
          </Text>
        </View>
        {lines.map((line, index) => (
          <View
            key={`${line.name}-${index}`}
            className="flex-row items-center justify-between gap-2"
          >
            <Text numberOfLines={1} className="shrink font-sans text-sm text-ink-2">
              {`${line.sets} × ${line.name}`}
            </Text>
            {index === 0 && prs > 0 ? (
              <View className="flex-row items-center gap-1">
                <Star size={12} color={signal} fill={signal} />
                <Text className="font-sans text-sm font-semibold text-signal">
                  {t`${plural(prs, { one: "PR", other: "# PRs" })}`}
                </Text>
              </View>
            ) : index === lines.length - 1 && volume > 0 ? (
              <Text className="num font-sans text-sm text-ink-2">
                {formatVolume(volume, units, i18n.locale)}
              </Text>
            ) : null}
          </View>
        ))}
        {more > 0 ? (
          <Text className="font-sans text-sm text-ink-3">
            {t`${plural(more, { one: "+# more exercise", other: "+# more exercises" })}`}
          </Text>
        ) : null}
        {lines.length === 0 ? (
          <Text className="font-sans text-sm text-ink-3">
            <Trans>No exercises logged</Trans>
          </Text>
        ) : null}
        {lines.length > 0 && lines.length < 2 && prs > 0 && volume > 0 ? (
          <Text className="num font-sans text-sm text-ink-2">
            {formatVolume(volume, units, i18n.locale)}
          </Text>
        ) : null}
      </Pressable>
      {children}
    </Sheet>
  );
}
