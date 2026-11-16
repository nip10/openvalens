import { Trans, useLingui } from "@lingui/react/macro";
import { evenAxisTicks } from "@openvalens/api/presenters/body";
import {
  BLOOD_PRESSURE_DUPLICATE_NOTE,
  bloodPressureSourceLabel,
  formatBloodPressure,
  formatBpm,
} from "@openvalens/api/presenters/vitals";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@openvalens/ui/components/chart";
import { useQuery } from "@tanstack/react-query";
import { Gauge } from "lucide-react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { EmptyState, Section, StatusPill } from "@/components/page";
import { friendlyDate } from "@/utils/friendly";
import { orpc } from "@/utils/orpc";

/**
 * Blood pressure on Vitals (#440): a chart of the recent readings and the
 * list, device and typed-in readings side by side; nothing is merged. A
 * reading is logged from the "+" (the quick log's blood pressure form, one tap
 * from heart rate), which writes the same metric codes a Bluetooth monitor
 * writes.
 */
export function useBloodPressureReadings() {
  return useQuery(orpc.vitals.bloodPressureReadings.queryOptions({ input: { limit: 60 } }));
}

type Reading = NonNullable<ReturnType<typeof useBloodPressureReadings>["data"]>[number];

export function BloodPressureChart({ readings }: { readings: readonly Reading[] }) {
  const { t, i18n } = useLingui();
  const config = {
    systolic: { label: t`Systolic`, color: "var(--tone-heart)" },
    diastolic: {
      label: t`Diastolic`,
      color: "color-mix(in oklab, var(--tone-heart) 55%, var(--sheet))",
    },
  } satisfies ChartConfig;
  const series = [...readings]
    .sort((a, b) => a.observedAt.localeCompare(b.observedAt))
    .map((reading) => ({
      at: reading.observedAt,
      systolic: Math.round(reading.systolic),
      diastolic: Math.round(reading.diastolic),
    }));
  const values = series.flatMap((point) => [point.systolic, point.diastolic]);
  const ticks = evenAxisTicks(Math.min(...values) - 5, Math.max(...values) + 5);

  return (
    <Section icon={Gauge} tone="heart" title={<Trans>Blood pressure</Trans>}>
      <div className="sheet p-5">
        {series.length < 2 ? (
          <EmptyState
            icon={Gauge}
            title={<Trans>Not enough readings for a chart yet</Trans>}
            description={<Trans>Log blood pressure with +, or sync a monitor.</Trans>}
          />
        ) : (
          <ChartContainer config={config} className="aspect-auto h-64 w-full">
            <AreaChart data={series} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
              <defs>
                <linearGradient id="bp-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--tone-heart)" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="var(--tone-heart)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--rule)" strokeDasharray="4 6" />
              <XAxis
                dataKey="at"
                tickLine={false}
                axisLine={false}
                minTickGap={32}
                tickFormatter={(value: string) => friendlyDate(i18n, value)}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={52}
                tickCount={5}
                domain={[ticks[0] ?? "auto", ticks.at(-1) ?? "auto"]}
                ticks={ticks}
                interval={0}
                tickFormatter={(value: number) => `${Math.round(value)}`}
                label={{
                  value: "mmHg",
                  angle: -90,
                  position: "insideLeft",
                  fill: "var(--ink-3)",
                  fontSize: 12,
                }}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(_, payload) => {
                      const at = payload?.[0]?.payload?.at as string | undefined;
                      return at ? friendlyDate(i18n, at) : "";
                    }}
                    formatter={(value, name) => [
                      `${Math.round(Number(value))} mmHg`,
                      name === "systolic" ? t`Systolic` : t`Diastolic`,
                    ]}
                  />
                }
              />
              <Area
                type="monotone"
                dataKey="systolic"
                stroke="var(--color-systolic)"
                strokeWidth={3}
                fill="url(#bp-fill)"
                dot={{ r: 2.5, fill: "var(--color-systolic)", strokeWidth: 0 }}
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                dataKey="diastolic"
                stroke="var(--color-diastolic)"
                strokeWidth={3}
                fill="transparent"
                dot={{ r: 2.5, fill: "var(--color-diastolic)", strokeWidth: 0 }}
                isAnimationActive={false}
              />
            </AreaChart>
          </ChartContainer>
        )}
      </div>
    </Section>
  );
}

export function BloodPressureList({
  readings,
  limit = 10,
}: {
  readings: readonly Reading[];
  limit?: number;
}) {
  const { t, i18n } = useLingui();
  const shown = readings.slice(0, limit);
  if (shown.length === 0) return null;
  return (
    <div className="grid gap-2">
      <h3 className="text-sm font-semibold text-ink-2">
        <Trans>Blood pressure</Trans>
      </h3>
      <ul
        className="sheet grid divide-y divide-rule px-5 py-1"
        aria-label={t`Blood pressure readings`}
      >
        {shown.map((reading) => (
          <li
            key={`${reading.observedAt}-${reading.source ?? ""}`}
            className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3"
          >
            <span className="num font-semibold text-ink">
              {formatBloodPressure(reading)}
              {reading.pulse !== null ? (
                <span className="ml-2 font-normal text-ink-3">{formatBpm(reading.pulse)}</span>
              ) : null}
            </span>
            <span className="flex flex-wrap items-center gap-2 text-sm text-ink-3">
              <span className="num">
                {`${friendlyDate(i18n, reading.observedAt)} ${new Date(reading.observedAt).toLocaleTimeString(i18n.locale, { hour: "2-digit", minute: "2-digit" })}`}
              </span>
              <span>{bloodPressureSourceLabel(reading, i18n)}</span>
              {reading.possibleDuplicate ? (
                <StatusPill tone="warn">
                  <Trans>Possible duplicate</Trans>
                </StatusPill>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      {shown.some((reading) => reading.possibleDuplicate) ? (
        <p className="text-sm text-ink-3">{i18n._(BLOOD_PRESSURE_DUPLICATE_NOTE)}</p>
      ) : null}
    </div>
  );
}
