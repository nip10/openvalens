import type {
  GoalDefinition,
  GoalEvidence,
  GoalMilestone,
  GoalRule,
  GoalRuleVersion,
  IsoDate,
  GoalComparator,
} from "./goal-model";
import { isIsoDate, MAX_HISTORY_DAYS } from "./goal-model";
import { goalDateAt } from "./goal-calendar";

export type GoalDayState =
  | "qualifies"
  | "does-not-qualify"
  | "unknown"
  | "paused"
  | "not-scheduled";
export type GoalUnknownReason = "no-evidence" | "incomplete-daily-coverage" | "missing-value";
export interface GoalDayEvaluation {
  date: IsoDate;
  ruleVersionId?: string;
  state: GoalDayState;
  value: number | null;
  coverage: "complete" | "incomplete" | "paused" | "not-scheduled";
  unknownReason?: GoalUnknownReason;
}
export interface GoalEvaluation {
  asOf: IsoDate;
  state: "active" | "paused" | "completed" | "deleted" | "overdue" | "not-started";
  achieved: boolean;
  achievedDate: IsoDate | null;
  overdue: boolean;
  currentValue: number | null;
  currentStreak: number;
  bestStreak: number;
  coverage: {
    completeDays: number;
    incompleteDays: number;
    unknownDays: number;
    pausedDays: number;
  };
  unknownReasons: GoalUnknownReason[];
  days: GoalDayEvaluation[];
  milestones: Array<{
    id: string;
    value: number;
    targetDate: IsoDate;
    achieved: boolean;
    achievedDate: IsoDate | null;
    achievedOnTime: boolean;
    achievedLate: boolean;
    overdue: boolean;
  }>;
  recurringWeeks: Array<{
    weekStart: IsoDate;
    weekEnd: IsoDate;
    qualifyingDays: number;
    requiredDays: number;
    met: boolean;
    complete: boolean;
    eligible: boolean;
  }>;
  windowCoverage: { requiredDays: number; coveredDays: number; complete: boolean } | null;
}

/**
 * Pure evaluation at an explicit local goal date. Evidence must be the current
 * canonical set (corrections replace/remove source records before this call).
 * The full date history is returned; callers must not trim it to chart range.
 */
export function evaluateGoal(
  goal: GoalDefinition,
  evidence: readonly GoalEvidence[],
  asOf: IsoDate,
): GoalEvaluation {
  return evaluateGoalCore(goal, evidence, asOf, true);
}

function evaluateGoalCore(
  goal: GoalDefinition,
  evidence: readonly GoalEvidence[],
  asOf: IsoDate,
  includeCompletedSegments: boolean,
): GoalEvaluation {
  if (!isIsoDate(asOf)) throw new TypeError("asOf must be a valid YYYY-MM-DD date");
  if (!isIsoDate(goal.startDate)) throw new RangeError("Goal startDate is invalid");
  const historyLength = daysBetween(goal.startDate, asOf) + 1;
  if (historyLength > MAX_HISTORY_DAYS)
    throw new RangeError(
      `Goal history exceeds ${MAX_HISTORY_DAYS} days; history is never truncated`,
    );
  if (evidence.length > 100_000) throw new RangeError("Goal evidence exceeds 100000 records");
  if (
    (goal.versions?.length ?? 0) > 100 ||
    (goal.pauses?.length ?? 0) > 100 ||
    (goal.milestones?.length ?? 0) > 100
  )
    throw new RangeError("Goal versions, pauses, and milestones are limited to 100 each");
  // Preserve full canonical history for sticky target/checkpoint achievements,
  // while reducing a second, resume-eligible view for fresh runs and windows.
  const daily = reduceGoalEvidence(goal, evidence);
  const freshDaily = reduceGoalEvidence(
    goal,
    evidence.filter((item) => eligibleAfterResume(goal, item)),
  );
  const days: GoalDayEvaluation[] = [];
  for (let date = goal.startDate; date <= asOf; date = addDays(date, 1)) {
    if (date < goal.startDate) continue;
    if (isPaused(goal, date)) {
      days.push({ date, state: "paused", value: null, coverage: "paused" });
      continue;
    }
    const fullDailyValue = daily.get(date);
    const selectedVersion = fullDailyValue?.versionId
      ? goal.versions?.find((v) => v.id === fullDailyValue.versionId)
      : versionForDate(goal, date);
    const rule = selectedVersion?.rule ?? goal.rule;
    const dailyValue =
      rule.kind === "streak" || rule.kind === "average" ? freshDaily.get(date) : fullDailyValue;
    const current = dailyValue?.value ?? null;
    const complete = dailyValue?.covered ?? false;
    let state: GoalDayState = "unknown";
    let unknownReason: GoalUnknownReason | undefined;
    if (!dailyValue || dailyValue.count === 0) unknownReason = "no-evidence";
    else if (!complete) unknownReason = "incomplete-daily-coverage";
    else if (current === null && dailyValue.completed === undefined)
      unknownReason = "missing-value";
    else
      state = qualifies(rule, current, dailyValue.completed === true)
        ? "qualifies"
        : "does-not-qualify";
    if (!isScheduled(rule, date)) {
      state = "not-scheduled";
      unknownReason = undefined;
    }
    if (rule.kind === "average") {
      const window = averageFromReduced(goal, freshDaily, date, rule.windowDays ?? 7);
      if (!window.complete) {
        state = "unknown";
        unknownReason = window.evidenceDays ? "incomplete-daily-coverage" : "no-evidence";
      } else {
        state = compare(window.value!, rule.target) ? "qualifies" : "does-not-qualify";
        unknownReason = undefined;
      }
    }
    days.push({
      date,
      ruleVersionId: selectedVersion?.id,
      state,
      value: current,
      coverage: state === "not-scheduled" ? "not-scheduled" : complete ? "complete" : "incomplete",
      ...(unknownReason ? { unknownReason } : {}),
    });
  }

  // Source-supported achievement is derived from the complete retained history;
  // explicit lifecycle completion remains separate and does not fabricate evidence.
  let targetHit = days.find(
    (d) => d.state === "qualifies" && ruleForDay(goal, d).kind === "target",
  );
  let streakHit = findStreakAchievement(goal, days);
  const completedSegments = includeCompletedSegments
    ? deriveCompletedSegmentAchievements(goal, evidence, asOf)
    : [];
  for (const segment of completedSegments) {
    if (segment.targetAchievementDate) {
      const hit = days.find((day) => day.date === segment.targetAchievementDate) ?? {
        date: segment.targetAchievementDate,
        state: "qualifies" as const,
        value: null,
        coverage: "complete" as const,
      };
      if (!targetHit || hit.date < targetHit.date) targetHit = hit;
    }
    if (segment.streakAchievementDate) {
      const streakDay = days.find((day) => day.date === segment.streakAchievementDate) ?? {
        date: segment.streakAchievementDate,
        state: "qualifies" as const,
        value: null,
        coverage: "complete" as const,
      };
      if (!streakHit || streakDay.date < streakHit.date) streakHit = streakDay;
    }
  }
  const achievedDay = [targetHit, streakHit]
    .filter((hit): hit is GoalDayEvaluation => !!hit)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  const targetAchieved = !!achievedDay;
  const completedMilestones = (goal.milestones ?? []).map((m) => {
    let hit = findMilestoneAchievement(goal, m, days);
    for (const segment of completedSegments) {
      const date = segment.milestoneDates.get(m.id);
      if (date && (!hit || date < hit.date)) {
        hit = days.find((day) => day.date === date) ?? {
          date,
          state: "qualifies",
          value: null,
          coverage: "complete",
        };
      }
    }
    return {
      ...m,
      achieved: !!hit,
      achievedDate: hit?.date ?? null,
      achievedOnTime: !!hit && hit.date <= m.targetDate,
      achievedLate: !!hit && hit.date > m.targetDate,
      overdue: !hit && asOf > m.targetDate,
    };
  });
  const { currentStreak, bestStreak: freshBestStreak } = streaks(goal, days, asOf);
  const bestStreak = Math.max(freshBestStreak, ...completedSegments.map((s) => s.bestStreak));
  const values = days.filter((d) => d.state !== "paused" && d.value !== null);
  const latest = values.at(-1);
  const ruleNow = ruleForDate(goal, asOf);
  const averageResult =
    ruleNow.kind === "average"
      ? averageFromReduced(goal, freshDaily, asOf, ruleNow.windowDays ?? 7)
      : null;
  const averageCurrent = averageResult?.value ?? null;
  const currentValue = ruleNow.kind === "average" ? averageCurrent : (latest?.value ?? null);
  const activeRule = ruleForDate(goal, asOf);
  const overdue =
    (!targetAchieved &&
      activeRule.kind === "target" &&
      !!activeRule.targetDate &&
      asOf > activeRule.targetDate) ||
    completedMilestones.some((m) => m.overdue);
  let state: GoalEvaluation["state"];
  if (goal.status === "deleted") state = "deleted";
  else if (goal.status === "completed" || targetAchieved) state = "completed";
  else if (isPaused(goal, asOf) || goal.status === "paused") state = "paused";
  else if (asOf < goal.startDate) state = "not-started";
  else if (overdue) state = "overdue";
  else state = "active";
  const completeDays = days.filter((d) => d.coverage === "complete").length;
  const incompleteDays = days.filter((d) => d.coverage === "incomplete").length;
  const unknownReasons = [
    ...new Set(days.flatMap((d) => (d.unknownReason ? [d.unknownReason] : []))),
  ];
  const recurringWeeks = days.length > 0 ? evaluateRecurringWeeks(goal, days) : [];
  return {
    asOf,
    state,
    achieved: targetAchieved,
    achievedDate: achievedDay?.date ?? null,
    overdue,
    currentValue,
    currentStreak,
    bestStreak,
    coverage: {
      completeDays,
      incompleteDays,
      unknownDays: days.filter((d) => d.state === "unknown").length,
      pausedDays: days.filter((d) => d.state === "paused").length,
    },
    unknownReasons,
    days,
    milestones: completedMilestones,
    recurringWeeks,
    windowCoverage: averageResult
      ? {
          requiredDays: ruleNow.kind === "average" ? (ruleNow.windowDays ?? 7) : 0,
          coveredDays: averageResult.coveredDays,
          complete: averageResult.complete,
        }
      : null,
  };
}

interface SegmentAchievement {
  targetAchievementDate: IsoDate | null;
  streakAchievementDate: IsoDate | null;
  milestoneDates: Map<string, IsoDate>;
  bestStreak: number;
}

/** Re-evaluate each actual pre-pause segment from its own canonical evidence slice. */
function deriveCompletedSegmentAchievements(
  goal: GoalDefinition,
  evidence: readonly GoalEvidence[],
  asOf: IsoDate,
): SegmentAchievement[] {
  const pauses = [...(goal.pauses ?? [])].sort((a, b) => {
    const aAt =
      a.pausedAt && Number.isFinite(Date.parse(a.pausedAt))
        ? Date.parse(a.pausedAt)
        : Date.parse(`${a.startDate}T00:00:00Z`);
    const bAt =
      b.pausedAt && Number.isFinite(Date.parse(b.pausedAt))
        ? Date.parse(b.pausedAt)
        : Date.parse(`${b.startDate}T00:00:00Z`);
    return aAt - bAt;
  });
  const result: SegmentAchievement[] = [];
  let segmentStartAt: number | undefined;
  let segmentStartDate = goal.startDate;
  for (const [pauseIndex, pause] of pauses.entries()) {
    const parsedBoundary = pause.pausedAt ? Date.parse(pause.pausedAt) : Number.NaN;
    const timedBoundary = Number.isFinite(parsedBoundary) ? parsedBoundary : undefined;
    const boundaryDate =
      timedBoundary === undefined ? pause.startDate : goalDateAt(goal, new Date(timedBoundary));
    if (boundaryDate > asOf) break;
    const startDate = segmentStartDate;
    // A pause that closes before this segment became active has no completed
    // opportunity to evaluate and must not move the active segment backwards.
    const segmentEndDate = timedBoundary === undefined ? addDays(boundaryDate, -1) : boundaryDate;
    if (segmentEndDate < startDate) {
      const parsedResumeAt = pause.resumedAt ? Date.parse(pause.resumedAt) : Number.NaN;
      const skippedResumeAt = Number.isFinite(parsedResumeAt) ? parsedResumeAt : undefined;
      const skippedResumeDate = skippedResumeAt
        ? goalDateAt(goal, new Date(skippedResumeAt))
        : undefined;
      const skippedCalendarDate =
        pause.resumedOn ?? (pause.endDate ? addDays(pause.endDate, 1) : undefined);
      segmentStartAt =
        skippedResumeAt === undefined
          ? segmentStartAt
          : Math.max(segmentStartAt ?? skippedResumeAt, skippedResumeAt);
      if (skippedResumeDate || skippedCalendarDate) {
        segmentStartDate = [segmentStartDate, skippedResumeDate, skippedCalendarDate]
          .filter((date): date is IsoDate => !!date)
          .sort()
          .at(-1)!;
      } else if (pause.endDate === null) {
        // An overlapping open pause keeps the goal inactive; do not let a
        // later historical boundary turn it into an unbounded active segment.
        segmentStartDate = addDays(asOf, 1);
        segmentStartAt = undefined;
      }
      continue;
    }
    const segmentEvidence = evidence.filter((item) => {
      if (item.occurredAt) {
        const occurredAt = Date.parse(item.occurredAt);
        const date = evidenceDate(goal, item);
        return (
          Number.isFinite(occurredAt) &&
          !!date &&
          date >= startDate &&
          (timedBoundary === undefined ? date <= segmentEndDate : occurredAt < timedBoundary) &&
          (segmentStartAt === undefined || occurredAt >= segmentStartAt)
        );
      }
      // Date-only evidence has no ordering within a day. Keep the resumed day
      // (the established calendar-date policy), but never attribute the closing
      // pause date to the pre-pause segment.
      if (item.dateOnly)
        return (
          isIsoDate(item.dateOnly) && item.dateOnly >= startDate && item.dateOnly <= segmentEndDate
        );
      return true;
    });
    // Keep only chronological prior pause constraints/resets. Omit this
    // closing pause for the honest same-day slice and all later pauses, which
    // must not suppress achievements earned before their own boundaries.
    const segmentGoal: GoalDefinition = {
      ...goal,
      startDate,
      pauses: pauses.slice(0, pauseIndex),
    };
    const evaluation = evaluateGoalCore(segmentGoal, segmentEvidence, segmentEndDate, false);
    const streakDate = findStreakAchievement(segmentGoal, evaluation.days)?.date ?? null;
    const targetDate = evaluation.days.find(
      (day) => day.state === "qualifies" && ruleForDay(segmentGoal, day).kind === "target",
    )?.date;
    result.push({
      targetAchievementDate: targetDate ?? null,
      streakAchievementDate: streakDate,
      milestoneDates: new Map(
        evaluation.milestones.flatMap((milestone) =>
          milestone.achievedDate ? [[milestone.id, milestone.achievedDate] as const] : [],
        ),
      ),
      bestStreak: evaluation.bestStreak,
    });
    const parsedResumeAt = pause.resumedAt ? Date.parse(pause.resumedAt) : Number.NaN;
    segmentStartAt = Number.isFinite(parsedResumeAt) ? parsedResumeAt : undefined;
    const timestampResumeDate = segmentStartAt
      ? goalDateAt(goal, new Date(segmentStartAt))
      : undefined;
    const calendarResumeDate =
      pause.resumedOn ?? (pause.endDate ? addDays(pause.endDate, 1) : undefined);
    segmentStartDate =
      [timestampResumeDate, calendarResumeDate]
        .filter((date): date is IsoDate => !!date)
        .sort()
        .at(-1) ?? (pause.endDate === null ? addDays(asOf, 1) : startDate);
  }
  return result;
}

interface ReducedDay {
  value: number | null;
  completed: boolean;
  covered: boolean;
  count: number;
  versionId?: string;
}
/** Daily source semantics: water/sleep sum; workout max; manual uses explicit daily values/completion; supplement counts once per day; tracker evidence arrives already combined per day (`trackerGoalEvidence`), so the latest record is the day. */
export function reduceGoalEvidence(
  goal: GoalDefinition,
  evidence: readonly GoalEvidence[],
): Map<IsoDate, ReducedDay> {
  const grouped = new Map<IsoDate, GoalEvidence[]>();
  for (const item of evidence) {
    if (item.source !== goal.source || item.metric !== goal.metric) continue;
    const date = evidenceDate(goal, item);
    if (!date || date < goal.startDate) continue;
    const rows = grouped.get(date) ?? [];
    rows.push(item);
    grouped.set(date, rows);
  }
  const result = new Map<IsoDate, ReducedDay>();
  for (const [date, rows] of grouped) {
    // One canonical record per source identity; authoritative sleep/workout rows suppress ambiguous duplicates.
    let selected = deduplicate(rows);
    if (goal.source === "sleep" || goal.source === "workout") {
      const authoritative = selected.filter((r) => r.authoritative);
      if (authoritative.length) selected = authoritative;
      else if (selected.length > 1) selected = [];
    }
    const numeric = selected
      .map((r) => r.value)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    const completed = selected.some((r) => r.completed === true);
    let value: number | null = null;
    if (numeric.length) {
      if (goal.source === "workout") value = Math.max(...numeric);
      else if (goal.source === "supplement") value = Math.max(...numeric); // one daily credit regardless of doses
      else if (goal.source === "manual" || goal.source === "tracker") {
        const latest = [...selected].sort(compareEvidenceOccurrence).at(-1);
        value =
          typeof latest?.value === "number" && Number.isFinite(latest.value) ? latest.value : null;
      } else value = numeric.reduce((a, b) => a + b, 0);
    }
    const latestEvidence = [...selected].sort(compareEvidenceOccurrence).at(-1);
    const selectedVersion = latestEvidence
      ? versionForEvidence(goal, latestEvidence, date)
      : versionForDate(goal, date);
    result.set(date, {
      value,
      completed,
      covered:
        selected.length > 0 &&
        selected.every((r) => r.value !== undefined || r.completed !== undefined),
      count: rows.length,
      versionId: selectedVersion?.id,
    });
  }
  return result;
}
function deduplicate(rows: GoalEvidence[]): GoalEvidence[] {
  const records = new Map<string, GoalEvidence>();
  for (const row of rows) records.set(row.sourceRecordId ?? row.id, row);
  return [...records.values()];
}
function compareEvidenceOccurrence(a: GoalEvidence, b: GoalEvidence): number {
  const timestamp = (item: GoalEvidence) =>
    item.occurredAt
      ? Date.parse(item.occurredAt)
      : item.dateOnly
        ? Date.parse(`${item.dateOnly}T00:00:00Z`)
        : 0;
  if (timestamp(a) !== timestamp(b)) return timestamp(a) - timestamp(b);
  // Manual check-in IDs are database sequences: numeric insertion order is
  // the correction/occurrence tie-breaker (lexical order puts 9 after 10).
  const aId = Number(a.id),
    bId = Number(b.id);
  if (Number.isSafeInteger(aId) && Number.isSafeInteger(bId)) return aId - bId;
  return a.id.localeCompare(b.id, undefined, { numeric: true });
}

function evidenceDate(goal: GoalDefinition, item: GoalEvidence): IsoDate | null {
  if (item.dateOnly) return isIsoDate(item.dateOnly) ? item.dateOnly : null;
  if (!item.occurredAt || !/(Z|[+-]\d\d:\d\d)$/.test(item.occurredAt)) return null;
  const instant = new Date(item.occurredAt);
  if (!Number.isFinite(instant.getTime())) return null;
  return goalDateAt(goal, instant);
}
function qualifies(rule: GoalRule, value: number | null, completed: boolean): boolean {
  if (rule.kind === "recurring")
    return rule.completion
      ? value !== null && compare(value, rule.completion)
      : completed || value !== null;
  if (rule.kind === "average") return value !== null && compare(value, rule.target);
  if (rule.kind === "streak") return completed || (value !== null && compare(value, rule.target));
  return value !== null && compare(value, rule.target);
}
function isScheduled(rule: GoalRule, date: IsoDate): boolean {
  if (rule.kind !== "recurring" || rule.cadence !== "weekdays") return true;
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
  return rule.weekdays?.includes(weekday) ?? false;
}
function compare(
  value: number,
  c: { kind: string; value?: number; minimum?: number; maximum?: number },
): boolean {
  if (c.kind === "minimum") return value >= c.value!;
  if (c.kind === "maximum") return value <= c.value!;
  return value >= c.minimum! && value <= c.maximum!;
}
function ruleForDate(goal: GoalDefinition, date: IsoDate): GoalRule {
  return versionForDate(goal, date)?.rule ?? goal.rule;
}
/**
 * The rule in force on a local goal date: the latest version effective on or
 * before it, otherwise the goal's first rule. A stored goal's `rule` is its
 * first rule; later edits live in `versions`.
 */
export function goalRuleAt(goal: GoalDefinition, date: IsoDate): GoalRule {
  return ruleForDate(goal, date);
}
function versionForDate(goal: GoalDefinition, date: IsoDate): GoalRuleVersion | undefined {
  return [...(goal.versions ?? [])]
    .filter((v) => v.effectiveDate <= date)
    .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate))
    .at(-1);
}
function versionForEvidence(
  goal: GoalDefinition,
  evidence: GoalEvidence,
  date: IsoDate,
): GoalRuleVersion | undefined {
  if (evidence.occurredAt) {
    const instant = Date.parse(evidence.occurredAt);
    return [...(goal.versions ?? [])]
      .filter((v) =>
        v.effectiveAt ? Date.parse(v.effectiveAt) <= instant : v.effectiveDate <= date,
      )
      .sort(
        (a, b) =>
          a.effectiveDate.localeCompare(b.effectiveDate) ||
          (a.effectiveAt ?? "").localeCompare(b.effectiveAt ?? ""),
      )
      .at(-1);
  }
  return versionForDate(goal, date);
}
function ruleForDay(goal: GoalDefinition, day: GoalDayEvaluation): GoalRule {
  return (
    goal.versions?.find((v) => v.id === day.ruleVersionId)?.rule ?? ruleForDate(goal, day.date)
  );
}
function isPaused(goal: GoalDefinition, date: IsoDate): boolean {
  return (goal.pauses ?? []).some(
    (p) =>
      p.startDate <= date &&
      (p.resumedOn ? date < p.resumedOn : p.endDate === null || date <= p.endDate),
  );
}
function streaks(
  goal: GoalDefinition,
  days: GoalDayEvaluation[],
  asOf: IsoDate,
): { currentStreak: number; bestStreak: number } {
  let current = 0,
    best = 0,
    run = 0;
  for (const day of days) {
    if ((goal.pauses ?? []).some((pause) => pause.resumedOn === day.date)) run = 0;
    if (day.state === "qualifies") {
      run++;
      best = Math.max(best, run);
    } else if (day.state !== "not-scheduled") run = 0;
  }
  let index = days.length - 1;
  // Today's still-unknown opportunity is pending: report yesterday's run without crediting today.
  if (days[index]?.date === asOf && days[index]?.state === "unknown") index--;
  for (; index >= 0 && days[index]!.state === "qualifies"; index--) current++;
  const latestResume = (goal.pauses ?? [])
    .map((pause) => pause.resumedOn)
    .filter((date): date is IsoDate => !!date && date <= asOf)
    .sort()
    .at(-1);
  if (latestResume) {
    current = 0;
    for (let i = days.length - 1; i >= 0 && days[i]!.date >= latestResume; i--) {
      const day = days[i]!;
      if (day.state === "qualifies") current++;
      else if (day.state !== "not-scheduled" && !(day.date === asOf && day.state === "unknown"))
        break;
    }
  }
  return { currentStreak: current, bestStreak: best };
}
function averageFromReduced(
  goal: GoalDefinition,
  daily: Map<IsoDate, ReducedDay>,
  end: IsoDate,
  size: number,
): { value: number | null; coveredDays: number; evidenceDays: number; complete: boolean } {
  let total = 0,
    coveredDays = 0,
    evidenceDays = 0;
  for (let offset = 0; offset < size; offset++) {
    const date = addDays(end, -offset);
    if (date < goal.startDate || isPaused(goal, date) || crossesResume(goal, date, end)) break;
    const day = daily.get(date);
    if (day?.count) evidenceDays++;
    if (day?.covered && day.value !== null) {
      total += day.value;
      coveredDays++;
    }
  }
  const contiguous =
    end >= goal.startDate &&
    !isPaused(goal, end) &&
    Array.from({ length: size }, (_, i) => addDays(end, -i)).every(
      (d) => d >= goal.startDate && !isPaused(goal, d),
    );
  return {
    value: coveredDays ? total / coveredDays : null,
    coveredDays,
    evidenceDays,
    complete: contiguous && coveredDays === size,
  };
}
function crossesResume(goal: GoalDefinition, start: IsoDate, end: IsoDate): boolean {
  return (goal.pauses ?? []).some(
    (pause) => !!pause.resumedOn && pause.resumedOn > start && pause.resumedOn <= end,
  );
}
function evaluateRecurringWeeks(
  goal: GoalDefinition,
  days: GoalDayEvaluation[],
): GoalEvaluation["recurringWeeks"] {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const start = mondayOf(goal.startDate);
  const out: GoalEvaluation["recurringWeeks"] = [];
  for (let weekStart = start; weekStart <= days.at(-1)!.date; weekStart = addDays(weekStart, 7)) {
    const weekEnd = addDays(weekStart, 6);
    const rule = ruleForDate(goal, weekStart);
    if (rule.kind !== "recurring" || rule.cadence !== "any-days-per-week") continue;
    const pausedInWeek = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).some((date) =>
      isPaused(goal, date),
    );
    // The first/last partial calendar week is not a complete opportunity.
    // A goal beginning midweek starts counting its first full Monday-Sunday.
    const eligible = weekStart >= goal.startDate && weekEnd <= days.at(-1)!.date && !pausedInWeek;
    const rows = Array.from({ length: 7 }, (_, i) => byDate.get(addDays(weekStart, i)));
    const count = rows.filter((d) => d?.state === "qualifies").length;
    const complete =
      eligible &&
      rows.every((d) => !!d && (d.coverage === "complete" || d.coverage === "not-scheduled"));
    out.push({
      weekStart,
      weekEnd,
      qualifyingDays: count,
      requiredDays: rule.daysPerWeek!,
      met: eligible && count >= rule.daysPerWeek!,
      complete,
      eligible,
    });
  }
  return out;
}
function findStreakAchievement(
  goal: GoalDefinition,
  days: GoalDayEvaluation[],
): GoalDayEvaluation | undefined {
  let run = 0;
  for (const day of days) {
    if ((goal.pauses ?? []).some((pause) => pause.resumedOn === day.date)) run = 0;
    if (day.state === "qualifies") run++;
    else if (day.state !== "not-scheduled") run = 0;
    const rule = ruleForDay(goal, day);
    if (rule.kind === "streak" && run >= rule.targetDays) return day;
  }
  return undefined;
}
function eligibleAfterResume(goal: GoalDefinition, item: GoalEvidence): boolean {
  if (item.source !== goal.source || item.metric !== goal.metric || !item.occurredAt) return true;
  const date = evidenceDate(goal, item);
  const occurredAt = Date.parse(item.occurredAt);
  if (!date || !Number.isFinite(occurredAt)) return true;
  return !(goal.pauses ?? []).some((pause) => {
    // Date-only evidence has no clock time, so its asserted calendar date is
    // retained. Timed evidence on a resumed date starts at resumedAt.
    if (pause.resumedOn === date && pause.resumedAt && occurredAt < Date.parse(pause.resumedAt))
      return true;
    // Paused interval is half-open; an event exactly at resumedAt is eligible.
    return (
      !!pause.pausedAt &&
      !!pause.resumedAt &&
      occurredAt >= Date.parse(pause.pausedAt) &&
      occurredAt < Date.parse(pause.resumedAt)
    );
  });
}
function findMilestoneAchievement(
  goal: GoalDefinition,
  milestone: GoalMilestone,
  days: GoalDayEvaluation[],
): GoalDayEvaluation | undefined {
  const byDate = new Map(days.map((day) => [day.date, day]));
  for (const day of days) {
    if (day.state === "paused" || day.state === "unknown" || day.state === "not-scheduled")
      continue;
    const rule = ruleForDay(goal, day);
    let value = day.value;
    if (rule.kind === "average")
      value = averageFromDailyEvaluations(goal, byDate, day.date, rule.windowDays ?? 7);
    if (value === null || value === undefined) continue;
    const parent =
      rule.kind === "target" || rule.kind === "average" || rule.kind === "streak"
        ? rule.target
        : rule.completion;
    const checkpoint = milestone.comparator ??
      checkpointComparator(parent, milestone.value) ?? {
        kind: "minimum" as const,
        value: milestone.value,
      };
    if (checkpoint && compare(value, checkpoint)) return day;
  }
  return undefined;
}
function checkpointComparator(
  parent: GoalComparator | undefined,
  value: number,
): GoalComparator | undefined {
  if (!parent) return undefined;
  if (parent.kind === "minimum") return { kind: "minimum", value };
  if (parent.kind === "maximum") return { kind: "maximum", value };
  if (value < parent.minimum) return { kind: "minimum", value };
  if (value > parent.maximum) return { kind: "maximum", value };
  return parent;
}
function averageFromDailyEvaluations(
  goal: GoalDefinition,
  days: Map<IsoDate, GoalDayEvaluation>,
  end: IsoDate,
  size: number,
): number | null {
  if (crossesResume(goal, addDays(end, -(size - 1)), end)) return null;
  const rows = Array.from({ length: size }, (_, i) => days.get(addDays(end, -i)));
  if (rows.some((d) => !d || d.coverage !== "complete" || d.value === null)) return null;
  return rows.reduce((sum, d) => sum + d!.value!, 0) / size;
}
function mondayOf(date: IsoDate): IsoDate {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, -(weekday === 0 ? 6 : weekday - 1));
}
function daysBetween(start: IsoDate, end: IsoDate): number {
  return Math.floor(
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000,
  );
}
function addDays(date: IsoDate, amount: number): IsoDate {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + amount);
  return d.toISOString().slice(0, 10);
}
