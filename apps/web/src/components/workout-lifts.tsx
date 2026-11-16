import { Trans, useLingui } from "@lingui/react/macro";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useQueries } from "@tanstack/react-query";
import { Dumbbell } from "lucide-react";

import { Section, ToneIcon } from "@/components/page";
import { Sparkline } from "@/components/sparkline";
import { friendlyDate } from "@/utils/friendly";
import { orpc } from "@/utils/orpc";

type LiftRef = { exerciseId: number } | { name: string };
export type Lift = { key: string; name: string; ref: LiftRef };

/** Most lifts the section shows; a long routine list keeps its first ones. */
const MAX_LIFTS = 8;
const KG_TO_LB = 2.2046226218;

/**
 * The main lifts: each exercise in the member's routines once, in routine
 * order. A library exercise is matched by its id, a typed one by its name.
 */
export function routineLifts(
  routines: ReadonlyArray<{
    exercises: ReadonlyArray<{ exerciseId: number | null; name: string }>;
  }>,
): Lift[] {
  const seen = new Set<string>();
  const lifts: Lift[] = [];
  for (const routine of routines)
    for (const exercise of routine.exercises) {
      const name = exercise.name.trim();
      if (!name && exercise.exerciseId === null) continue;
      const key =
        exercise.exerciseId !== null
          ? `id:${exercise.exerciseId}`
          : `name:${name.toLocaleLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      lifts.push({
        key,
        name,
        ref: exercise.exerciseId !== null ? { exerciseId: exercise.exerciseId } : { name },
      });
    }
  return lifts.slice(0, MAX_LIFTS);
}

type HistoryPage = {
  items: Array<{ date: string; topSetWeightKg: number | null }>;
};

/**
 * One lift's top-set weight per session, oldest first, and the change from
 * the first of those sessions to the latest. Plain arithmetic on the logged
 * sets; nothing is projected.
 */
export function liftTrend(page: HistoryPage | null | undefined) {
  const points = (page?.items ?? [])
    .filter(
      (item): item is { date: string; topSetWeightKg: number } => item.topSetWeightKg !== null,
    )
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
  const first = points[0] ?? null;
  const latest = points.at(-1) ?? null;
  return {
    values: points.map((point) => point.topSetWeightKg),
    latest,
    first,
    change:
      first && latest && points.length > 1 ? latest.topSetWeightKg - first.topSetWeightKg : null,
  };
}

/**
 * "Lifts" on Workouts (workouts#7): a card per main lift with its latest top
 * set, a small line of the top set over the recent sessions, and the change
 * since the first of them.
 */
export function WorkoutLifts({
  lifts,
  scope,
  units,
}: {
  lifts: readonly Lift[];
  scope: string | null;
  units: "metric" | "imperial";
}) {
  const { t, i18n } = useLingui();
  const histories = useQueries({
    queries: lifts.map((lift) => {
      const options = orpc.plans.workouts.exerciseHistory.queryOptions({
        input: { exercise: lift.ref, limit: 20 },
      });
      return { ...options, queryKey: [...options.queryKey, { scope }], enabled: Boolean(scope) };
    }),
  });
  if (lifts.length === 0) return null;
  const unit =
    units === "imperial"
      ? t({ message: "lb", context: "unit" })
      : t({ message: "kg", context: "unit" });
  const number = new Intl.NumberFormat(i18n.locale, { maximumFractionDigits: 1 });
  const weight = (kg: number) => number.format(units === "imperial" ? kg * KG_TO_LB : kg);

  return (
    <Section
      icon={Dumbbell}
      tone="steps"
      title={<Trans>Lifts</Trans>}
      info={
        <Trans>
          The heaviest set of each session for the exercises in your routines, over your last 20
          sessions of each.
        </Trans>
      }
    >
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {lifts.map((lift, index) => {
          const query = histories[index];
          const trend = liftTrend(query?.data as HistoryPage | undefined);
          const change = trend.change;
          const delta =
            change !== null ? `${change > 0 ? "+" : "−"}${weight(Math.abs(change))}` : "";
          const since = trend.first ? friendlyDate(i18n, trend.first.date) : "";
          const lastDate = trend.latest ? friendlyDate(i18n, trend.latest.date) : "";
          return (
            <li key={lift.key} className="sheet flex min-w-0 flex-col gap-3 p-4">
              <div className="flex items-center gap-3">
                <ToneIcon icon={Dumbbell} tone="steps" size="sm" />
                <span className="min-w-0 flex-1 font-semibold break-words text-ink">
                  {lift.name}
                </span>
              </div>
              {query?.isPending && scope ? (
                <Skeleton className="h-10 w-full rounded-xl" />
              ) : trend.latest ? (
                <div className="mt-auto grid gap-1">
                  <div className="flex items-end justify-between gap-3">
                    <span className="num font-display text-2xl leading-none font-medium text-ink">
                      {weight(trend.latest.topSetWeightKg)}{" "}
                      <span className="font-body text-sm font-normal text-ink-3">{unit}</span>
                    </span>
                    <Sparkline values={trend.values} tone="steps" width={80} height={24} />
                  </div>
                  <span className="text-sm text-ink-3">
                    {change === null ? (
                      <Trans>Top set, {lastDate}</Trans>
                    ) : change === 0 ? (
                      <Trans>Same as {since}</Trans>
                    ) : (
                      <Trans>
                        {delta} {unit} since {since}
                      </Trans>
                    )}
                  </span>
                </div>
              ) : (
                <p className="mt-auto text-sm text-ink-3">
                  {query?.isError ? (
                    <Trans>Could not load this lift.</Trans>
                  ) : (
                    <Trans>No weighted sets logged yet.</Trans>
                  )}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
