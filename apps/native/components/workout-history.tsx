import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Button, Card, Spinner } from "heroui-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { TrendChart } from "@/components/chart";
import { authClient } from "@/lib/auth-client";
import { weightFromKg } from "@/lib/workouts/model";
import { orpc } from "@/utils/orpc";

type ExerciseRef = { exerciseId: number } | { name: string };
type Metric = "top" | "estimated" | "volume";

export function WorkoutExerciseHistory({ exercise }: { exercise: ExerciseRef }) {
  const { t, i18n } = useLingui();
  const { data: session } = authClient.useSession();
  const userId = session?.user?.id;
  const organizationId = session?.session?.activeOrganizationId;
  const scope = userId && organizationId ? `${userId}:${organizationId}` : null;
  const [metric, setMetric] = useState<Metric>("top");
  const settings = useQuery(orpc.adminSettings.productSettings.queryOptions({ input: {} }));
  const units = settings.data?.units === "imperial" ? "imperial" : "metric";
  const exerciseKey =
    "exerciseId" in exercise ? `id:${exercise.exerciseId}` : `name:${exercise.name}`;
  const historyOptions = orpc.plans.workouts.exerciseHistory.infiniteOptions({
    input: (cursor: string | undefined) => ({ exercise, limit: 20, ...(cursor ? { cursor } : {}) }),
    initialPageParam: undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: Boolean(scope),
  });
  const history = useInfiniteQuery({
    ...historyOptions,
    queryKey: [...historyOptions.queryKey, { scope, exerciseKey }],
  });
  const pages = history.data?.pages ?? [];
  const items = Array.from(
    new Map(pages.flatMap((page) => page.items).map((item) => [item.workoutId, item])).values(),
  ).sort(
    (a, b) =>
      b.date.localeCompare(a.date) ||
      b.createdAt.localeCompare(a.createdAt) ||
      b.workoutId - a.workoutId,
  );
  const convert = (kg: number) => weightFromKg(kg, units);
  const unit = units === "metric" ? t`kg` : t`lb`;
  const valueFor = (item: (typeof items)[number]) =>
    metric === "top"
      ? item.topSetWeightKg
      : metric === "estimated"
        ? item.estimated1RmKg
        : item.volumeKg;
  const chart = items
    .slice()
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.workoutId - b.workoutId,
    )
    .flatMap((item) => {
      const value = valueFor(item);
      return value === null ||
        value === undefined ||
        !Number.isFinite(value) ||
        (metric === "estimated" &&
          !item.exercises.some((exercise) =>
            exercise.sets.some((set) => set.reps !== null && set.reps >= 1 && set.reps <= 12),
          ))
        ? []
        : [
            {
              value: metric === "volume" ? convert(value) : convert(value),
              label: new Intl.DateTimeFormat(i18n.locale, {
                month: "short",
                day: "numeric",
              }).format(new Date(`${item.date}T12:00:00`)),
            },
          ];
    });
  const records = pages[0]?.records;
  const formatWeight = (kg: number | null | undefined) =>
    kg == null ? t`No record` : `${convert(kg).toFixed(1)} ${unit}`;
  if (!scope)
    return (
      <Text className="font-sans text-sm text-ink-3">
        <Trans>Sign in to view exercise history.</Trans>
      </Text>
    );
  if (history.isPending) return <Spinner />;
  if (history.isError)
    return (
      <View className="gap-2">
        <Text accessibilityRole="alert" className="font-sans text-sm text-ink-3">
          <Trans>History is unavailable right now.</Trans>
        </Text>
        <Button variant="secondary" onPress={() => void history.refetch()}>{t`Try again`}</Button>
      </View>
    );
  if (!items.length)
    return (
      <View className="rounded-2xl border border-dashed border-rule-2 p-4">
        <Text className="font-sans font-medium text-ink">
          <Trans>No history yet</Trans>
        </Text>
        <Text className="font-sans text-sm text-ink-3">
          <Trans>Logged sessions for this exercise will appear here.</Trans>
        </Text>
      </View>
    );
  const metrics: Array<{ key: Metric; label: string }> = [
    { key: "top", label: t`Top weight` },
    { key: "estimated", label: t`Estimated 1RM (Epley)` },
    { key: "volume", label: t`Volume` },
  ];
  return (
    <View className="gap-4">
      <View
        accessibilityRole="tablist"
        accessibilityLabel={t`History chart measure`}
        className="flex-row flex-wrap gap-2"
      >
        {metrics.map((item) => (
          <Pressable
            key={item.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: metric === item.key }}
            onPress={() => setMetric(item.key)}
            className={`min-h-11 justify-center rounded-full border px-3 ${metric === item.key ? "border-primary bg-primary/10" : "border-rule-2"}`}
          >
            <Text className="font-sans text-sm text-ink">{item.label}</Text>
          </Pressable>
        ))}
      </View>
      <Text
        accessibilityRole="text"
        className="font-sans text-sm text-ink-3"
      >{t`${metrics.find((item) => item.key === metric)?.label}: ${chart.length} recorded sessions. Values are shown in ${unit}.`}</Text>
      {metric === "estimated" ? (
        <Text className="font-sans text-sm text-ink-3">
          <Trans>
            Epley estimates use sets of 1–12 reps. Sets above 12 reps remain included in history and
            volume.
          </Trans>
        </Text>
      ) : null}
      {chart.length ? (
        <TrendChart data={chart} tone="steps" formatYLabel={(value) => Number(value).toFixed(0)} />
      ) : (
        <Text className="font-sans text-sm text-ink-3">
          <Trans>No eligible values for this measure.</Trans>
        </Text>
      )}
      <Card variant="secondary" className="gap-2 rounded-2xl p-4">
        <Text className="font-display text-lg font-semibold text-ink">
          <Trans>Personal records</Trans>
        </Text>
        <Text className="font-sans text-sm text-ink">{t`Heaviest: ${formatWeight(records?.heaviestWeightKg)}`}</Text>
        <Text className="font-sans text-sm text-ink">{t`Best estimated 1RM (Epley): ${formatWeight(records?.bestEstimated1RmKg)}`}</Text>
        {records?.mostRepsAtWeight?.length ? (
          records.mostRepsAtWeight.map((record) => (
            <Text
              key={record.weightKg}
              className="font-sans text-sm text-ink"
            >{t`${formatWeight(record.weightKg)} for ${plural(record.reps, { one: "# rep", other: "# reps" })}`}</Text>
          ))
        ) : (
          <Text className="font-sans text-sm text-ink-3">
            <Trans>No reps-at-weight records yet.</Trans>
          </Text>
        )}
      </Card>
      <Text className="font-display text-lg font-semibold text-ink">
        <Trans>Sessions</Trans>
      </Text>
      {items.map((item) => (
        <Card key={item.workoutId} variant="secondary" className="gap-2 rounded-2xl p-4">
          <Text className="font-sans font-semibold text-ink">
            {new Intl.DateTimeFormat(i18n.locale, { dateStyle: "medium" }).format(
              new Date(`${item.date}T12:00:00`),
            )}
          </Text>
          {item.prs.map((pr, index) => (
            <Text
              key={`${pr.kind}-${index}`}
              className="font-sans text-xs font-semibold text-signal"
            >
              {pr.kind === "heaviest_weight"
                ? t`Personal record · Heaviest weight`
                : pr.kind === "estimated_1rm"
                  ? t`Personal record · Estimated 1RM (Epley)`
                  : t`Personal record · Reps at weight`}{" "}
              · {formatWeight(pr.kind === "estimated_1rm" ? pr.estimated1RmKg : pr.weightKg)}
              {pr.reps ? ` · ${t`${pr.reps} reps`}` : ""}
            </Text>
          ))}
          {item.exercises
            .flatMap((e) => e.sets)
            .map((set, index) => (
              <Text key={`${item.workoutId}-${index}`} className="font-sans text-sm text-ink-2">
                {set.weightKg === null ? t`Bodyweight` : formatWeight(set.weightKg)}
                {set.reps === null ? "" : ` × ${set.reps}`}
              </Text>
            ))}
        </Card>
      ))}
      {history.hasNextPage ? (
        <Button
          variant="secondary"
          isDisabled={history.isFetchingNextPage}
          onPress={() => void history.fetchNextPage()}
        >
          {history.isFetchingNextPage ? t`Loading…` : t`Load more sessions`}
        </Button>
      ) : null}
    </View>
  );
}
