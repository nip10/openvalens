import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { formatSteps } from "@openvalens/api/presenters/activity";
import { formatWaterAmount } from "@openvalens/api/presenters/plain-water";
import { formatSleepDuration } from "@openvalens/api/presenters/sleep";
import { Button } from "@openvalens/ui/components/button";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Droplet, Footprints, History, type LucideIcon, Moon, Plus, Utensils } from "lucide-react";
import type { ReactNode } from "react";

import { type Tone, ToneIcon } from "@/components/page";
import { useOpenLog } from "@/components/quick-log/log-launcher";
import type { DayFigures } from "@/components/timeline-day-figures";
import { orpc } from "@/utils/orpc";

/** Today as a local YYYY-MM-DD date. */
function localToday(): string {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${m}-${d}`;
}

type Item = {
  key: string;
  icon: LucideIcon;
  tone: Tone;
  label: ReactNode;
  value: string;
  to: "/records/sleep" | "/records/activity" | "/nutrition";
};

type WaterDay = { enabled: boolean; quantityMl: number | null; entries: unknown[] } | undefined;

/**
 * The strip's four figures from today's server figures (`timeline.dayTotals`)
 * and the plain-water subtotal. A part the server leaves out (module off, no
 * permission) is left out here too; a part with nothing yet shows "—".
 */
export function todaySoFarItems(
  figures: DayFigures | undefined,
  water: WaterDay,
  options: {
    i18n: Parameters<typeof formatWaterAmount>[3];
    isEnabled: (module: "sleep" | "activity" | "food") => boolean;
    imperial: boolean;
  },
): Item[] {
  const { i18n, isEnabled } = options;
  const items: Item[] = [];
  if (isEnabled("sleep"))
    items.push({
      key: "sleep",
      icon: Moon,
      tone: "sleep",
      label: <Trans>Sleep</Trans>,
      value: figures?.asleepMinutes ? formatSleepDuration(figures.asleepMinutes) : "—",
      to: "/records/sleep",
    });
  if (isEnabled("activity"))
    items.push({
      key: "steps",
      icon: Footprints,
      tone: "steps",
      label: <Trans>Steps</Trans>,
      value: figures?.steps ? formatSteps(Math.round(figures.steps)) : "—",
      to: "/records/activity",
    });
  if (isEnabled("food")) {
    items.push({
      key: "meals",
      icon: Utensils,
      tone: "food",
      label: <Trans>Meals</Trans>,
      value: figures?.meals ? String(figures.meals) : "—",
      to: "/nutrition",
    });
    if (water?.enabled)
      items.push({
        key: "water",
        icon: Droplet,
        tone: "water",
        label: <Trans>Water</Trans>,
        value:
          water.entries.length === 0
            ? "—"
            : formatWaterAmount(
                water.quantityMl,
                options.imperial ? "fl_oz" : "ml",
                // The server drops the amount in hide-numbers mode (#88).
                water.quantityMl === null,
                i18n,
              ),
        to: "/nutrition",
      });
  }
  return items;
}

/**
 * dashboard#12 — "Today so far": the day's sleep, steps, meals and water in
 * one strip under the greeting, with "Log…" (the quick log palette) and the
 * full timeline beside them.
 */
export function TodaySoFar({
  isEnabled,
  imperial,
}: {
  isEnabled: (module: "sleep" | "activity" | "food") => boolean;
  imperial: boolean;
}) {
  const { t, i18n } = useLingui();
  const openLog = useOpenLog();
  const today = localToday();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const totals = useQuery({
    ...orpc.timeline.dayTotals.queryOptions({ input: { from: today, to: today } }),
    staleTime: 30_000,
  });
  const water = useQuery({
    ...orpc.plainWater.getDay.queryOptions({ input: { date: today, timeZone } }),
    enabled: isEnabled("food"),
    staleTime: 30_000,
  });
  const items = todaySoFarItems(totals.data?.[0], water.data, { i18n, isEnabled, imperial });

  return (
    <section
      aria-label={t`Today so far`}
      className="sheet flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4"
    >
      <h2 className="w-full text-base text-ink-2 sm:w-auto">
        <Trans>Today so far</Trans>
      </h2>
      {totals.isPending ? (
        <Skeleton className="h-8 w-64 rounded-full" />
      ) : (
        <ul className="flex flex-wrap items-center gap-x-5 gap-y-3">
          {items.map((item) => (
            <li key={item.key}>
              <Link
                to={item.to}
                className="flex items-center gap-2 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <ToneIcon icon={item.icon} tone={item.tone} size="sm" />
                <span className="grid leading-tight">
                  <span className="text-xs text-ink-3">{item.label}</span>
                  <span className="num font-display font-medium text-ink">{item.value}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
        <Button variant="outline" size="sm" onClick={() => openLog()}>
          <Plus aria-hidden="true" />
          {i18n._(msg({ message: "Log…", comment: "Opens the quick log palette." }))}
        </Button>
        <Button variant="ghost" size="sm" asChild>
          <Link to="/records/timeline">
            <History aria-hidden="true" />
            <Trans>Full timeline</Trans>
          </Link>
        </Button>
      </div>
    </section>
  );
}
