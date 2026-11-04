import type { GoalDefinition, IsoDate } from "./goal-model";
import { isIsoDate } from "./goal-model";

/** Resolve the effective rule and calendar at an instant. Effective instants are
 * authoritative when supplied; older date-only versions remain calendar-day based. */
export function goalDefinitionAt(definition: GoalDefinition, instant: Date): GoalDefinition {
  if (!Number.isFinite(instant.getTime())) throw new TypeError("instant must be a valid Date");
  const candidates = (definition.versions ?? []).filter((version) => {
    if (version.effectiveAt) return Date.parse(version.effectiveAt) <= instant.getTime();
    const zone = version.timeZone ?? definition.timeZone;
    return localDate(instant, zone) >= version.effectiveDate;
  });
  candidates.sort((a, b) => {
    const aAt = a.effectiveAt ? Date.parse(a.effectiveAt) : dateBoundary(a.effectiveDate);
    const bAt = b.effectiveAt ? Date.parse(b.effectiveAt) : dateBoundary(b.effectiveDate);
    return aAt - bAt || a.effectiveDate.localeCompare(b.effectiveDate);
  });
  let result = definition;
  for (const version of candidates) {
    result = {
      ...result,
      rule: version.rule,
      ...(version.timeZone !== undefined ? { timeZone: version.timeZone } : {}),
      ...(Object.hasOwn(version, "dayCutoff") ? { dayCutoff: version.dayCutoff } : {}),
    };
  }
  return result;
}

/** Resolve the goal's local date at an instant using the effective calendar.
 * Sleep is wake-date based and intentionally ignores the configured cutoff. */
export function goalDateAt(definition: GoalDefinition, instant: Date): IsoDate {
  const effective = goalDefinitionAt(definition, instant);
  let date = localDate(instant, effective.timeZone);
  const cutoff = definition.source === "sleep" ? null : (effective.dayCutoff ?? "00:00");
  if (cutoff) {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: effective.timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(instant);
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    const minute = Number(parts.find((part) => part.type === "minute")?.value);
    if (`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}` < cutoff)
      date = addDays(date, -1);
  }
  return date;
}

function localDate(instant: Date, timeZone: string): IsoDate {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  if (!isIsoDate(date)) throw new RangeError("Could not resolve local calendar date");
  return date;
}
function dateBoundary(date: IsoDate): number {
  return Date.parse(`${date}T00:00:00.000Z`);
}
function addDays(date: IsoDate, amount: number): IsoDate {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}
