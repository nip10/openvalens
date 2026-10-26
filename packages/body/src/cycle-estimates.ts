/**
 * Cycle phase estimates (Issue #91). Pure, dependency-free and shared with
 * the web and native bundles.
 *
 * Phases are only ever estimates, counted backward from the next logged
 * period: the luteal phase is about the last 12–14 days before a period, and
 * the follicular phase varies too much (10–30 days, Bull et al. 2019) to use
 * fixed windows. Until the next period is logged, the current cycle has no
 * phase estimate, only "estimated, low confidence". Nothing here predicts an
 * ovulation day, a fertile window or "safe days", and nothing feeds calories,
 * macros or targets.
 */

export type LoggedPeriod = { startDate: string; endDate: string | null };

export type CycleEstimate = {
  startDate: string;
  /** Start of the next logged period; null for the current cycle. */
  nextStartDate: string | null;
  lengthDays: number | null;
  /**
   * Days likely in the luteal phase: the 14 days before the next period,
   * of which the last 12 are the more likely part. Null for the current cycle.
   */
  lutealEstimate: { from: string; likelyFrom: string; to: string } | null;
};

export type CycleEstimates =
  | { state: "off"; reason: "no_natural_cycle" }
  | { state: "no_data" }
  | {
      state: "estimated";
      /** Completed cycles, newest first, then the current one first of all. */
      cycles: CycleEstimate[];
      current: { startDate: string; dayOfCycle: number; confidence: "low" } | null;
    };

/** Shared copy; never names an ovulation day, fertile window or safe days. */
export const CYCLE_COPY = Object.freeze({
  estimateLabel: "Estimate",
  lutealLabel: "Estimated luteal phase (about the last 12 to 14 days before your period)",
  currentLowConfidence:
    "Estimated, low confidence. A phase can only be estimated once your next period is logged.",
  noNaturalCycle:
    "Phase estimates are off because you said you use hormonal contraception or have no natural cycle.",
  notForContraception:
    "For your own reference only. This is not a contraception or fertility tool and does not change your nutrition targets.",
  consentVersion: "cycle-v1",
  consentText:
    "Cycle logging is optional and separate from everything else. Your cycle data stays private to you: workspace owners and other members cannot see it, and it is left out of AI and coach features, clinical exports, Telegram, email and analytics. You can turn it off and erase it at any time.",
});

const DAY_MS = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isCalendarDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function toDay(date: string): number {
  return Date.parse(`${date}T00:00:00Z`) / DAY_MS;
}

function fromDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

export function estimateCycles(input: {
  periods: readonly LoggedPeriod[];
  today: string;
  noNaturalCycle: boolean;
}): CycleEstimates {
  if (input.noNaturalCycle) return { state: "off", reason: "no_natural_cycle" };
  const starts = [
    ...new Set(
      input.periods
        .map((period) => period.startDate)
        .filter((date) => isCalendarDate(date) && date <= input.today),
    ),
  ].sort();
  if (!starts.length) return { state: "no_data" };

  const cycles: CycleEstimate[] = [];
  for (let index = 0; index < starts.length - 1; index++) {
    const start = toDay(starts[index]!);
    const next = toDay(starts[index + 1]!);
    const lengthDays = next - start;
    cycles.push({
      startDate: starts[index]!,
      nextStartDate: starts[index + 1]!,
      lengthDays,
      // A cycle too short to hold the window gets no estimate rather than one
      // that overlaps the period it starts with.
      lutealEstimate:
        lengthDays > 14
          ? { from: fromDay(next - 14), likelyFrom: fromDay(next - 12), to: fromDay(next - 1) }
          : null,
    });
  }
  const latest = starts.at(-1)!;
  cycles.push({ startDate: latest, nextStartDate: null, lengthDays: null, lutealEstimate: null });
  cycles.reverse();
  return {
    state: "estimated",
    cycles,
    current: {
      startDate: latest,
      dayOfCycle: toDay(input.today) - toDay(latest) + 1,
      confidence: "low",
    },
  };
}
