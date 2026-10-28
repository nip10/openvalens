import { Trans, useLingui } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { offlineScope } from "@openvalens/api/presenters/offline";
import { authClient } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";
import { useProductSettings } from "@/utils/product-settings";

type ExerciseRef = { exerciseId: number } | { name: string };
const kgToLb = (kg: number) => kg * 2.2046226218;

export function WorkoutExerciseHistory({ exercise }: { exercise: ExerciseRef }) {
  const { t, i18n } = useLingui();
  const { data: session } = authClient.useSession();
  const scope = offlineScope(session as Parameters<typeof offlineScope>[0]);
  const settings = useProductSettings();
  const locale = settings.data?.locale ?? "en-US";
  const imperial = settings.data?.units === "imperial";
  const number = useMemo(
    () => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }),
    [locale],
  );
  const dateFormat = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }),
    [locale],
  );
  const [metric, setMetric] = useState<"weight" | "estimated1Rm" | "volume">("weight");
  const [cursor, setCursor] = useState<string>();
  const [history, setHistory] = useState<any[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const identity = JSON.stringify([scope, exercise]);
  const previous = useRef(identity);
  const options = orpc.plans.workouts.exerciseHistory.queryOptions({
    input: { exercise, limit: 20, cursor },
  });
  const query = useQuery({
    ...options,
    queryKey: [...options.queryKey, { scope }],
    enabled: Boolean(scope),
  });

  useEffect(() => {
    if (previous.current !== identity) {
      previous.current = identity;
      setCursor(undefined);
      setHistory([]);
      setNextCursor(null);
    }
  }, [identity]);
  useEffect(() => {
    if (!query.data) return;
    setHistory((existing) => {
      const merged = new Map(existing.map((item) => [item.workoutId, item]));
      for (const item of query.data.items) merged.set(item.workoutId, item);
      return [...merged.values()].sort(
        (a, b) =>
          a.date.localeCompare(b.date) ||
          a.createdAt.localeCompare(b.createdAt) ||
          a.workoutId - b.workoutId,
      );
    });
    setNextCursor(query.data.nextCursor);
  }, [query.data]);

  const rows = useMemo(
    () =>
      history.map((item) => {
        const raw =
          metric === "weight"
            ? item.topSetWeightKg
            : metric === "estimated1Rm"
              ? item.estimated1RmKg
              : item.volumeKg;
        const converted = raw === null ? null : imperial ? kgToLb(raw) : raw;
        return {
          ...item,
          value: converted,
          chartDate: dateFormat.format(new Date(`${item.date}T12:00:00`)),
        };
      }),
    [history, metric, imperial, dateFormat],
  );
  const records = query.data?.records;
  const unit = i18n._(
    imperial ? msg({ message: "lb", context: "unit" }) : msg({ message: "kg", context: "unit" }),
  );
  const weight = (kg: number) => `${number.format(imperial ? kgToLb(kg) : kg)} ${unit}`;

  if (!scope)
    return (
      <p className="text-sm text-ink-3">
        <Trans>Sign in to view your exercise history.</Trans>
      </p>
    );
  if (query.isPending && !history.length)
    return (
      <p role="status" className="text-sm text-ink-3">
        <Trans>Loading exercise history…</Trans>
      </p>
    );
  if (query.isError && !history.length)
    return (
      <div role="alert" className="grid gap-2 text-sm">
        <p>
          <Trans>History is unavailable right now.</Trans>
        </p>
        <button className="underline" onClick={() => void query.refetch()}>
          <Trans>Try again</Trans>
        </button>
      </div>
    );

  return (
    <section className="grid min-w-0 gap-4" aria-label={t`Exercise history`}>
      <div className="flex flex-wrap gap-2" role="group" aria-label={t`Chart metric`}>
        {(
          [
            ["weight", <Trans key="weight">Top weight</Trans>],
            ["estimated1Rm", <Trans key="e1rm">Estimated 1RM</Trans>],
            ["volume", <Trans key="volume">Volume</Trans>],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={metric === value}
            onClick={() => setMetric(value)}
            className={`min-h-10 rounded-full border px-4 text-sm ${metric === value ? "border-steps bg-steps-soft font-semibold" : "border-border bg-card"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="text-xs text-ink-3">
        <Trans>Estimated 1RM uses the Epley formula for weighted sets of 1–12 reps.</Trans>
      </p>
      {rows.length ? (
        <>
          <p className="sr-only" aria-live="polite">
            {rows
              .map(
                (row) =>
                  t`${row.date}: ${row.value === null ? t`No result` : weight(metric === "volume" ? row.value / (imperial ? kgToLb(1) : 1) : row.value)}`,
              )
              .join(". ")}
          </p>
          <div
            className="h-64 w-full min-w-0"
            role="img"
            aria-label={
              imperial
                ? t`Exercise history chart in pounds`
                : t`Exercise history chart in kilograms`
            }
          >
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={rows} margin={{ top: 12, right: 12, left: 4, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="chartDate" />
                <YAxis width={55} />
                <Tooltip
                  formatter={(value) =>
                    t`${number.format(Number(value))} ${metric === "volume" ? (imperial ? t`lb-reps` : t`kg-reps`) : unit}`
                  }
                  labelFormatter={(label) => String(label)}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  connectNulls={false}
                  stroke="var(--color-steps)"
                  fill="var(--color-steps-soft)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </>
      ) : (
        <p className="rounded-xl bg-paper-2 p-4 text-sm text-ink-3">
          <Trans>No history yet. Log this exercise in a workout to see your progress here.</Trans>
        </p>
      )}
      {records && (
        <div className="flex flex-wrap gap-2 text-sm">
          <Record
            label={<Trans>Heaviest</Trans>}
            value={records.heaviestWeightKg === null ? null : weight(records.heaviestWeightKg)}
          />
          <Record
            label={<Trans>Best estimated 1RM</Trans>}
            value={records.bestEstimated1RmKg === null ? null : weight(records.bestEstimated1RmKg)}
          />
          {records.mostRepsAtWeight.map((record) => (
            <Record
              key={`${record.weightKg}`}
              label={<Trans>Most reps at {weight(record.weightKg)}</Trans>}
              value={<Trans>{record.reps} reps</Trans>}
            />
          ))}
        </div>
      )}
      <ol className="grid gap-3">
        {[...rows].reverse().map((item) => (
          <li key={item.workoutId} className="rounded-xl border border-border p-4">
            <div className="flex flex-wrap justify-between gap-2">
              <strong>{item.chartDate}</strong>
              {item.prs.map((pr: { kind: string }, index: number) => (
                <span
                  key={`${pr.kind}-${index}`}
                  className="rounded-full bg-signal-soft px-3 py-1 text-sm font-semibold"
                >
                  {pr.kind === "heaviest_weight" ? (
                    <Trans>Heaviest weight PR</Trans>
                  ) : pr.kind === "estimated_1rm" ? (
                    <Trans>Estimated 1RM PR</Trans>
                  ) : (
                    <Trans>Reps PR</Trans>
                  )}
                </span>
              ))}
            </div>
            <p className="mt-1 text-sm text-ink-2">
              {item.exercises
                .flatMap(
                  (e: { sets: Array<{ reps: number | null; weightKg: number | null }> }) => e.sets,
                )
                .map(
                  (set: { reps: number | null; weightKg: number | null }, i: number) =>
                    t`${i + 1}. ${set.reps ?? "—"} reps × ${set.weightKg === null ? t`Bodyweight` : weight(set.weightKg)}`,
                )
                .join(" · ")}
            </p>
            {item.volumeKg > 0 ? (
              <p className="mt-1 text-xs text-ink-3">
                <Trans>Volume: {weight(item.volumeKg)}-reps</Trans>
              </p>
            ) : null}
          </li>
        ))}
      </ol>
      {query.isError && (
        <p role="alert" className="text-sm text-ink-3">
          <Trans>Could not load more history.</Trans>
        </p>
      )}
      {nextCursor && (
        <button
          className="min-h-11 justify-self-start underline"
          disabled={query.isFetching}
          onClick={() => setCursor(nextCursor)}
        >
          <Trans>Load older sessions</Trans>
        </button>
      )}
    </section>
  );
}

function Record({ label, value }: { label: React.ReactNode; value: React.ReactNode | null }) {
  return (
    <p className="rounded-full bg-paper-2 px-3 py-2">
      {label}: <strong>{value ?? "—"}</strong>
    </p>
  );
}
