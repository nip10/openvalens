/**
 * Today's supplement checklist (supplements#5): every dose scheduled for the
 * member's local today, grouped by time of day, each matched to a dose taken
 * today. Pure TypeScript, so the page and its tests share it.
 *
 * The rules mirror the server's "due" list (`supplementsDueNow` in
 * `packages/api/src/quick-log.ts` and `isPlanItemDue` in the Telegram
 * reminders): a schedule is due on a day by its frequency, and each dose taken
 * today covers one scheduled dose of that supplement, earliest first. Nothing
 * here scores or judges adherence; it only says which doses are recorded.
 */

/** Display order of the groups; `anytime` holds supplements with no schedule. */
export const CHECKLIST_GROUPS = [
  "morning",
  "lunch",
  "dinner",
  "pre-bed",
  "training",
  "anytime",
] as const;
export type ChecklistGroupId = (typeof CHECKLIST_GROUPS)[number];

/** When each time of day starts, as the server orders doses (training: any time). */
const FROM_HOUR: Readonly<Record<string, number>> = {
  morning: 5,
  lunch: 11,
  dinner: 17,
  "pre-bed": 20,
  training: 0,
};

export type ChecklistSupplement = {
  id: number;
  name: string;
  dose: string | null;
  form?: string | null;
};

export type ChecklistSchedule = {
  id: number;
  supplementId: number;
  timeOfDay: string;
  quantity: string | null;
  frequency: string | null;
  daysOfWeek: readonly number[] | null;
  status: string;
};

export type ChecklistIntake = { id: number; supplementId: number; occurredAt: string };

export type ChecklistItem = {
  /** Stable React key. */
  key: string;
  supplement: ChecklistSupplement;
  scheduleId: number | null;
  /** What "Taken" records as the dose; null when nothing is known (use the full form). */
  dose: string | null;
  /** The dose taken today that covers this item, or null. */
  taken: ChecklistIntake | null;
};

export type ChecklistGroup = { id: ChecklistGroupId; items: ChecklistItem[] };

/** ISO weekday (1 = Monday … 7 = Sunday) of a `YYYY-MM-DD` date. */
function isoWeekday(date: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const day = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  const weekday = day.getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

/** Active and due on `date` by its frequency (daily or none: every day; weekly: chosen days). */
export function scheduleDueOn(
  schedule: Pick<ChecklistSchedule, "status" | "frequency" | "daysOfWeek">,
  date: string,
): boolean {
  if (schedule.status.trim().toLowerCase() !== "active") return false;
  const frequency = (schedule.frequency ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "_");
  if (frequency === "" || frequency === "daily") return true;
  if (frequency !== "weekly" && frequency !== "training_days") return false;
  const weekday = isoWeekday(date);
  return weekday !== null && (schedule.daysOfWeek ?? []).includes(weekday);
}

const BARE_NUMBER = /^\d+(?:[.,]\d+)?$/;

/**
 * The dose one "Taken" records: the schedule's amount read against the
 * supplement's dose. "2" of "200 mg" → "2 × 200 mg"; "1" → "200 mg"; a worded
 * amount ("1 scoop") as written; no amount → the supplement's dose.
 */
export function scheduledDose(
  quantity: string | null | undefined,
  supplementDose: string | null | undefined,
): string | null {
  const amount = quantity?.trim() ?? "";
  const dose = supplementDose?.trim() ?? "";
  if (!amount) return dose || null;
  if (BARE_NUMBER.test(amount) && dose) {
    return Number(amount.replace(",", ".")) === 1 ? dose : `${amount} × ${dose}`;
  }
  return amount;
}

/** `YYYY-MM-DD` of an instant in the device's zone. */
export function localDateOf(instant: Date): string {
  const y = instant.getFullYear();
  const m = String(instant.getMonth() + 1).padStart(2, "0");
  const d = String(instant.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const groupOf = (timeOfDay: string): ChecklistGroupId => {
  const id = timeOfDay.trim().toLowerCase();
  return (CHECKLIST_GROUPS as readonly string[]).includes(id) && id !== "anytime"
    ? (id as ChecklistGroupId)
    : "anytime";
};

/**
 * Today's checklist: one item per schedule due on `today`, plus one per
 * supplement with no schedule at all (under "anytime"). Doses taken
 * on `today` (device zone) cover a supplement's items earliest first; extra
 * doses beyond the schedule stay in the history only. Empty groups are left out.
 */
export function buildChecklist(input: {
  supplements: readonly ChecklistSupplement[];
  schedules: readonly ChecklistSchedule[];
  intakes: readonly ChecklistIntake[];
  today: string;
}): ChecklistGroup[] {
  const takenToday = new Map<number, ChecklistIntake[]>();
  for (const intake of [...input.intakes].sort((a, b) =>
    a.occurredAt.localeCompare(b.occurredAt),
  )) {
    if (localDateOf(new Date(intake.occurredAt)) !== input.today) continue;
    const list = takenToday.get(intake.supplementId) ?? [];
    list.push(intake);
    takenToday.set(intake.supplementId, list);
  }

  const groups = new Map<ChecklistGroupId, ChecklistItem[]>();
  const push = (group: ChecklistGroupId, item: ChecklistItem) =>
    groups.set(group, [...(groups.get(group) ?? []), item]);

  for (const supplement of input.supplements) {
    const own = input.schedules.filter((schedule) => schedule.supplementId === supplement.id);
    const taken = takenToday.get(supplement.id) ?? [];
    // No schedule at all: taken whenever. Schedules that are all paused: not today.
    if (own.length === 0) {
      push("anytime", {
        key: `supplement-${supplement.id}`,
        supplement,
        scheduleId: null,
        dose: scheduledDose(null, supplement.dose),
        taken: taken[0] ?? null,
      });
      continue;
    }
    const due = own
      .filter((schedule) => scheduleDueOn(schedule, input.today))
      .sort(
        (a, b) =>
          (FROM_HOUR[a.timeOfDay.trim().toLowerCase()] ?? 0) -
            (FROM_HOUR[b.timeOfDay.trim().toLowerCase()] ?? 0) || a.id - b.id,
      );
    due.forEach((schedule, index) =>
      push(groupOf(schedule.timeOfDay), {
        key: `schedule-${schedule.id}`,
        supplement,
        scheduleId: schedule.id,
        dose: scheduledDose(schedule.quantity, supplement.dose),
        taken: taken[index] ?? null,
      }),
    );
  }

  return CHECKLIST_GROUPS.filter((id) => groups.has(id)).map((id) => ({
    id,
    items: groups.get(id)!.sort((a, b) => a.supplement.name.localeCompare(b.supplement.name)),
  }));
}

/**
 * How a schedule reads on a supplement's card: the amount with the form when
 * the amount is a bare number ("2 × capsule"), a worded amount as written
 * ("1 scoop"), or null when there is no amount.
 */
export function scheduleAmount(
  quantity: string | null | undefined,
  form: string | null | undefined,
): string | null {
  const amount = quantity?.trim() ?? "";
  if (!amount) return null;
  const kind = form?.trim() ?? "";
  if (BARE_NUMBER.test(amount) && kind) return `${amount} × ${kind}`;
  return amount;
}
