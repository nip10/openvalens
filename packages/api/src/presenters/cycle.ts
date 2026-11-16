/**
 * Client-safe cycle copy (Issue #91), shared by the web and native screens.
 *
 * The English source of truth is `CYCLE_COPY` in `@openvalens/body`, which
 * the server also reads (for the consent version). Here the same text is a
 * set of Lingui message descriptors (#67); `cycle.test.ts` keeps the two in
 * step. The disclaimer and consent text are tagged `safety`, so a community
 * translation shows them in English until a reviewer approves them.
 */
import { msg } from "@lingui/core/macro";
import { CYCLE_COPY as CYCLE_SOURCE } from "@openvalens/body/cycle-estimates";

export const CYCLE_COPY = Object.freeze({
  estimateLabel: msg`Estimate`,
  lutealLabel: msg({
    message: "Estimated luteal phase (about the last 12 to 14 days before your period)",
    comment: "safety",
  }),
  currentLowConfidence: msg({
    message:
      "Estimated, low confidence. A phase can only be estimated once your next period is logged.",
    comment: "safety",
  }),
  noNaturalCycle: msg({
    message:
      "Phase estimates are off because you said you use hormonal contraception or have no natural cycle.",
    comment: "safety",
  }),
  notForContraception: msg({
    message:
      "For your own reference only. This is not a contraception or fertility tool and does not change your nutrition targets.",
    comment: "safety",
  }),
  /** Not shown: the version the server checks consent against. */
  consentVersion: CYCLE_SOURCE.consentVersion,
  consentText: msg({
    message:
      "Cycle logging is optional and separate from everything else. Your cycle data stays private to you: workspace owners and other members cannot see it, and it is left out of AI and coach features, clinical exports, Telegram, email and analytics. You can turn it off and erase it at any time.",
    comment: "safety",
  }),
});

// ─── Day strips ─────────────────────────────────────────────────

export type CycleFlow = "spotting" | "light" | "medium" | "heavy";

/** A logged period as the strip reads it. */
export type StripPeriod = { startDate: string; endDate: string | null; flow: CycleFlow | null };

/** A cycle from the estimates (`@openvalens/body` `CycleEstimate`). */
export type StripCycle = {
  startDate: string;
  nextStartDate: string | null;
  lengthDays: number | null;
  lutealEstimate: { from: string; to: string } | null;
};

export type StripDay = {
  date: string;
  /** Day of the cycle, from 1. */
  day: number;
  /** A logged period day: its flow, `"unrecorded"` when no flow was logged, else null. */
  period: CycleFlow | "unrecorded" | null;
  /** Inside the existing luteal-phase estimate (completed cycles only). */
  estimated: boolean;
  today: boolean;
};

export type CycleStrip = {
  startDate: string;
  /** Null for the current cycle, which is still going. */
  lengthDays: number | null;
  current: boolean;
  days: StripDay[];
};

const DAY_MS = 86_400_000;
const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY_MS;
const dateOf = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);

/**
 * One strip per cycle, current first: a cell per day from day 1 to the day
 * before the next period (or to today), marked only with what was logged and
 * the existing luteal estimate. Nothing here predicts a day that has not
 * happened: the current cycle ends at today.
 */
export function cycleStrips(
  cycles: readonly StripCycle[],
  periods: readonly StripPeriod[],
  today: string,
): CycleStrip[] {
  const spans = periods.map((period) => ({
    from: dayNumber(period.startDate),
    // A period logged without an end date covers its start day only.
    to: dayNumber(period.endDate ?? period.startDate),
    flow: period.flow,
  }));
  const todayNumber = dayNumber(today);
  return cycles.map((cycle) => {
    const start = dayNumber(cycle.startDate);
    const end = cycle.nextStartDate ? dayNumber(cycle.nextStartDate) - 1 : todayNumber;
    const luteal = cycle.lutealEstimate
      ? { from: dayNumber(cycle.lutealEstimate.from), to: dayNumber(cycle.lutealEstimate.to) }
      : null;
    const days: StripDay[] = [];
    for (let at = start; at <= end; at++) {
      const span = spans.find((entry) => entry.from <= at && at <= entry.to);
      days.push({
        date: dateOf(at),
        day: at - start + 1,
        period: span ? (span.flow ?? "unrecorded") : null,
        estimated: luteal !== null && luteal.from <= at && at <= luteal.to,
        today: at === todayNumber,
      });
    }
    return {
      startDate: cycle.startDate,
      lengthDays: cycle.nextStartDate ? cycle.lengthDays : null,
      current: cycle.nextStartDate === null,
      days,
    };
  });
}

/**
 * The shortest and longest of the member's recent completed cycles (up to
 * six), as logged: a plain fact from their history, not a prediction. Null
 * without a completed cycle.
 */
export function recentCycleLengths(
  cycles: readonly Pick<StripCycle, "lengthDays" | "nextStartDate">[],
  limit = 6,
): { shortest: number; longest: number } | null {
  const lengths = cycles
    .filter((cycle) => cycle.nextStartDate !== null && cycle.lengthDays !== null)
    .slice(0, limit)
    .map((cycle) => cycle.lengthDays!);
  if (lengths.length === 0) return null;
  return { shortest: Math.min(...lengths), longest: Math.max(...lengths) };
}
