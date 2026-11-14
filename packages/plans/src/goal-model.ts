/** Persistence-independent shared model for personal goals. */
export const GOAL_SOURCES = [
  "manual",
  "water",
  "supplement",
  "workout",
  "sleep",
  "tracker",
] as const;
export type GoalSource = (typeof GOAL_SOURCES)[number];
export const GOAL_RULE_KINDS = ["target", "recurring", "average", "streak"] as const;
export type GoalRuleKind = (typeof GOAL_RULE_KINDS)[number];
export type GoalLifecycleStatus = "active" | "paused" | "completed" | "deleted";
export type IsoDate = string;
export type IsoInstant = string;

export type GoalComparator =
  | { kind: "minimum"; value: number }
  | { kind: "maximum"; value: number }
  | { kind: "range"; minimum: number; maximum: number };
export type GoalRule =
  | { kind: "target"; target: GoalComparator; targetDate?: IsoDate | null }
  | {
      kind: "recurring";
      cadence: "daily" | "weekdays" | "any-days-per-week";
      weekdays?: number[];
      daysPerWeek?: number;
      completion?: GoalComparator;
    }
  | { kind: "average"; target: GoalComparator; windowDays?: number }
  | { kind: "streak"; target: GoalComparator; targetDays: number };

export interface GoalDefinition {
  id: string;
  title: string;
  source: GoalSource;
  metric: string;
  unit?: string | null;
  rule: GoalRule;
  startDate: IsoDate;
  timeZone: string;
  dayCutoff?: string | null;
  status: GoalLifecycleStatus;
  milestones?: GoalMilestone[];
  versions?: GoalRuleVersion[];
  pauses?: GoalPause[];
}
export interface GoalMilestone {
  id: string;
  value: number;
  targetDate: IsoDate;
  comparator?: GoalComparator;
}
/** effectiveDate/effectiveAt are inclusive. Calendar changes should include effectiveAt for unambiguous timed evidence. */
export interface GoalRuleVersion {
  id: string;
  effectiveDate: IsoDate;
  rule: GoalRule;
  effectiveAt?: IsoInstant;
  timeZone?: string;
  dayCutoff?: string | null;
}
export interface GoalPause {
  startDate: IsoDate;
  endDate: IsoDate | null;
  /** First active goal date after this pause; pause dates are half-open when present. */
  resumedOn?: IsoDate;
  pausedAt?: IsoInstant;
  resumedAt?: IsoInstant;
}

/** occurredAt requires an explicit offset; dateOnly is for evidence without a timestamp. */
export interface GoalEvidence {
  id: string;
  source: GoalSource;
  metric: string;
  occurredAt?: IsoInstant;
  dateOnly?: IsoDate;
  value?: number;
  completed?: boolean;
  authoritative?: boolean;
  sourceRecordId?: string;
}
export type GoalValidationIssue = { path: string; message: string };
export type GoalValidationResult =
  | { ok: true; value: GoalDefinition }
  | { ok: false; issues: GoalValidationIssue[] };
export type GoalEvidenceValidationResult =
  | { ok: true; value: GoalEvidence }
  | { ok: false; issues: GoalValidationIssue[] };

/** Maximum supported history is explicit; evaluator rejects larger windows without truncating. */
export const MAX_HISTORY_DAYS = 36_600;
const MAX_ARRAY_ITEMS = 100;

/** Validate untrusted JSON without throwing on nulls, primitives, arrays, or malformed members. */
export function validateGoalDefinition(input: unknown): GoalValidationResult {
  const issues: GoalValidationIssue[] = [];
  const issue = (path: string, message: string) => issues.push({ path, message });
  if (!record(input))
    return { ok: false, issues: [{ path: "", message: "Expected a goal object" }] };
  const g = input;
  for (const key of ["id", "title", "metric"] as const)
    if (typeof g[key] !== "string" || !(g[key] as string).trim())
      issue(key, "Required non-empty string");
  if (!(GOAL_SOURCES as readonly unknown[]).includes(g.source)) issue("source", "Unknown source");
  if (!isIsoDate(g.startDate)) issue("startDate", "Expected valid YYYY-MM-DD date");
  if (typeof g.timeZone !== "string" || !validTimeZone(g.timeZone))
    issue("timeZone", "Expected IANA timezone");
  if (!(["active", "paused", "completed", "deleted"] as readonly unknown[]).includes(g.status))
    issue("status", "Unknown lifecycle status");
  validateCutoff(g.dayCutoff, "dayCutoff", issue);
  validateRule(g.rule, "rule", issue);
  const versions = boundedArray(g.versions, "versions", issue);
  const pauses = boundedArray(g.pauses, "pauses", issue);
  const milestones = boundedArray(g.milestones, "milestones", issue);
  versions.forEach((item, i) => {
    const path = `versions.${i}`;
    if (!record(item)) {
      issue(path, "Expected version object");
      return;
    }
    if (typeof item.id !== "string" || !item.id.trim())
      issue(`${path}.id`, "Required non-empty id");
    if (!isIsoDate(item.effectiveDate)) issue(`${path}.effectiveDate`, "Expected valid date");
    if (item.effectiveAt !== undefined && !isIsoInstant(item.effectiveAt))
      issue(`${path}.effectiveAt`, "Expected ISO instant with offset");
    if (
      item.timeZone !== undefined &&
      (typeof item.timeZone !== "string" || !validTimeZone(item.timeZone))
    )
      issue(`${path}.timeZone`, "Expected IANA timezone");
    if (Object.hasOwn(item, "dayCutoff"))
      validateCutoff(item.dayCutoff, `${path}.dayCutoff`, issue);
    validateRule(item.rule, `${path}.rule`, issue);
  });
  pauses.forEach((item, i) => {
    const path = `pauses.${i}`;
    if (!record(item)) {
      issue(path, "Expected pause object");
      return;
    }
    if (!isIsoDate(item.startDate)) issue(`${path}.startDate`, "Expected valid date");
    if (item.endDate !== null && !isIsoDate(item.endDate))
      issue(`${path}.endDate`, "Expected valid date or null");
    if (isIsoDate(item.startDate) && isIsoDate(item.endDate) && item.endDate < item.startDate)
      issue(`${path}.endDate`, "Pause cannot end before it starts");
    if (item.resumedOn !== undefined && !isIsoDate(item.resumedOn))
      issue(`${path}.resumedOn`, "Expected valid date");
    if (
      item.resumedOn !== undefined &&
      isIsoDate(item.startDate) &&
      isIsoDate(item.resumedOn) &&
      item.resumedOn < item.startDate
    )
      issue(`${path}.resumedOn`, "Resume cannot precede pause start");
    if (item.pausedAt !== undefined && !isIsoInstant(item.pausedAt))
      issue(`${path}.pausedAt`, "Expected ISO instant with offset");
    if (item.resumedAt !== undefined && !isIsoInstant(item.resumedAt))
      issue(`${path}.resumedAt`, "Expected ISO instant with offset");
    if (
      isIsoInstant(item.pausedAt) &&
      isIsoInstant(item.resumedAt) &&
      Date.parse(item.resumedAt) < Date.parse(item.pausedAt)
    )
      issue(`${path}.resumedAt`, "Resume instant cannot precede pause instant");
  });
  milestones.forEach((item, i) => {
    const path = `milestones.${i}`;
    if (!record(item)) {
      issue(path, "Expected milestone object");
      return;
    }
    if (typeof item.id !== "string" || !item.id.trim())
      issue(`${path}.id`, "Required non-empty id");
    if (typeof item.value !== "number" || !Number.isFinite(item.value))
      issue(`${path}.value`, "Milestone value must be finite");
    if (!isIsoDate(item.targetDate)) issue(`${path}.targetDate`, "Expected valid date");
    if (item.comparator !== undefined)
      validateComparator(item.comparator, `${path}.comparator`, issue);
  });
  if (issues.length) return { ok: false, issues };
  return { ok: true, value: input as unknown as GoalDefinition };
}

export function validateGoalEvidence(input: unknown): GoalEvidenceValidationResult {
  const issues: GoalValidationIssue[] = [];
  const issue = (path: string, message: string) => issues.push({ path, message });
  if (!record(input))
    return { ok: false, issues: [{ path: "", message: "Expected evidence object" }] };
  const e = input;
  if (typeof e.id !== "string" || !e.id.trim()) issue("id", "Required non-empty id");
  if (!(GOAL_SOURCES as readonly unknown[]).includes(e.source)) issue("source", "Unknown source");
  if (typeof e.metric !== "string" || !e.metric.trim())
    issue("metric", "Required non-empty metric");
  if ((e.occurredAt === undefined) === (e.dateOnly === undefined))
    issue("occurredAt", "Provide exactly one of occurredAt or dateOnly");
  if (e.occurredAt !== undefined && !isIsoInstant(e.occurredAt))
    issue("occurredAt", "Expected ISO instant with offset");
  if (e.dateOnly !== undefined && !isIsoDate(e.dateOnly))
    issue("dateOnly", "Expected valid YYYY-MM-DD date");
  if (e.value !== undefined && (typeof e.value !== "number" || !Number.isFinite(e.value)))
    issue("value", "Evidence value must be finite");
  if (e.completed !== undefined && typeof e.completed !== "boolean")
    issue("completed", "Expected boolean");
  if (e.authoritative !== undefined && typeof e.authoritative !== "boolean")
    issue("authoritative", "Expected boolean");
  if (
    e.sourceRecordId !== undefined &&
    (typeof e.sourceRecordId !== "string" || !e.sourceRecordId.trim())
  )
    issue("sourceRecordId", "Expected non-empty string");
  return issues.length
    ? { ok: false, issues }
    : { ok: true, value: input as unknown as GoalEvidence };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function boundedArray(
  value: unknown,
  path: string,
  issue: (path: string, message: string) => void,
): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    issue(path, "Expected an array");
    return [];
  }
  if (value.length > MAX_ARRAY_ITEMS) issue(path, `Cannot exceed ${MAX_ARRAY_ITEMS} items`);
  return value.slice(0, MAX_ARRAY_ITEMS);
}
function validateCutoff(
  value: unknown,
  path: string,
  issue: (path: string, message: string) => void,
): void {
  if (
    value !== undefined &&
    value !== null &&
    (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value))
  )
    issue(path, "Expected HH:mm local cutoff or null");
}
function validateRule(
  value: unknown,
  path: string,
  issue: (path: string, message: string) => void,
): void {
  if (
    !record(value) ||
    typeof value.kind !== "string" ||
    !(GOAL_RULE_KINDS as readonly string[]).includes(value.kind)
  ) {
    issue(path, "Unknown or malformed rule kind");
    return;
  }
  const rule = value;
  if (rule.kind === "target") {
    validateComparator(rule.target, `${path}.target`, issue);
    if (rule.targetDate !== undefined && rule.targetDate !== null && !isIsoDate(rule.targetDate))
      issue(`${path}.targetDate`, "Expected valid date or null");
  } else if (rule.kind === "average") {
    validateComparator(rule.target, `${path}.target`, issue);
    if (
      rule.windowDays !== undefined &&
      (!Number.isInteger(rule.windowDays) ||
        (rule.windowDays as number) < 1 ||
        (rule.windowDays as number) > MAX_HISTORY_DAYS)
    )
      issue(`${path}.windowDays`, `Must be an integer from 1 to ${MAX_HISTORY_DAYS}`);
  } else if (rule.kind === "streak") {
    validateComparator(rule.target, `${path}.target`, issue);
    if (
      !Number.isInteger(rule.targetDays) ||
      (rule.targetDays as number) < 1 ||
      (rule.targetDays as number) > MAX_HISTORY_DAYS
    )
      issue(`${path}.targetDays`, "Must be a bounded positive integer");
  } else {
    if (
      rule.cadence !== "daily" &&
      rule.cadence !== "weekdays" &&
      rule.cadence !== "any-days-per-week"
    )
      issue(`${path}.cadence`, "Unknown cadence");
    if (rule.cadence === "weekdays") {
      if (
        !Array.isArray(rule.weekdays) ||
        rule.weekdays.length === 0 ||
        rule.weekdays.length > 7 ||
        rule.weekdays.some((d) => !Number.isInteger(d) || (d as number) < 1 || (d as number) > 7)
      )
        issue(`${path}.weekdays`, "Provide unique ISO weekdays 1..7");
      else if (new Set(rule.weekdays).size !== rule.weekdays.length)
        issue(`${path}.weekdays`, "Weekdays must be distinct");
    }
    if (
      rule.cadence === "any-days-per-week" &&
      (!Number.isInteger(rule.daysPerWeek) ||
        (rule.daysPerWeek as number) < 1 ||
        (rule.daysPerWeek as number) > 7)
    )
      issue(`${path}.daysPerWeek`, "Must be 1..7");
    if (rule.completion !== undefined)
      validateComparator(rule.completion, `${path}.completion`, issue);
  }
}
function validateComparator(
  value: unknown,
  path: string,
  issue: (path: string, message: string) => void,
): void {
  if (!record(value) || typeof value.kind !== "string") {
    issue(path, "Expected comparator object");
    return;
  }
  const comparator = value;
  if (comparator.kind === "minimum" || comparator.kind === "maximum") {
    if (typeof comparator.value !== "number" || !Number.isFinite(comparator.value))
      issue(`${path}.value`, "Threshold must be finite");
  } else if (comparator.kind === "range") {
    if (typeof comparator.minimum !== "number" || !Number.isFinite(comparator.minimum))
      issue(`${path}.minimum`, "Threshold must be finite");
    if (typeof comparator.maximum !== "number" || !Number.isFinite(comparator.maximum))
      issue(`${path}.maximum`, "Threshold must be finite");
    if (
      typeof comparator.minimum === "number" &&
      typeof comparator.maximum === "number" &&
      comparator.minimum > comparator.maximum
    )
      issue(path, "Range minimum exceeds maximum");
  } else issue(path, "Unknown comparator kind");
}
export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function isIsoInstant(value: unknown): value is IsoInstant {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value)
  )
    return false;
  const date = value.slice(0, 10);
  const clock = value.slice(11, 19);
  const offset = value.endsWith("Z") ? null : value.slice(-6);
  if (
    !isIsoDate(date) ||
    Number(clock.slice(0, 2)) > 23 ||
    Number(clock.slice(3, 5)) > 59 ||
    Number(clock.slice(6, 8)) > 59
  )
    return false;
  if (offset && (Number(offset.slice(1, 3)) > 23 || Number(offset.slice(4, 6)) > 59)) return false;
  return Number.isFinite(Date.parse(value));
}
function validTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
