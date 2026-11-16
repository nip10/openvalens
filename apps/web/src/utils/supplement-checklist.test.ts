import { describe, expect, test } from "bun:test";

import {
  buildChecklist,
  type ChecklistSchedule,
  localDateOf,
  scheduleAmount,
  scheduleDueOn,
  scheduledDose,
} from "./supplement-checklist";

const schedule = (patch: Partial<ChecklistSchedule> & { id: number; supplementId: number }) => ({
  timeOfDay: "morning",
  quantity: null,
  frequency: "daily",
  daysOfWeek: null,
  status: "active",
  ...patch,
});

/** An instant on the device's local `date` at `hour`, as the API returns it. */
const at = (date: string, hour: number) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y!, m! - 1, d!, hour, 15).toISOString();
};

// 2026-11-16 is a Monday.
const today = "2026-11-16";
const vitaminD = { id: 1, name: "Vitamin D3", dose: "1000 IU", form: "softgel" };
const magnesium = { id: 2, name: "Magnesium", dose: "200 mg", form: "capsule" };
const creatine = { id: 3, name: "Creatine", dose: "3 g", form: "powder" };

describe("scheduleDueOn", () => {
  test("daily and unset frequencies are due every day", () => {
    expect(scheduleDueOn({ status: "active", frequency: "daily", daysOfWeek: null }, today)).toBe(
      true,
    );
    expect(scheduleDueOn({ status: "active", frequency: null, daysOfWeek: null }, today)).toBe(
      true,
    );
  });

  test("weekly and training days are due on their chosen weekdays only", () => {
    expect(scheduleDueOn({ status: "active", frequency: "weekly", daysOfWeek: [1] }, today)).toBe(
      true,
    );
    expect(
      scheduleDueOn({ status: "active", frequency: "training days", daysOfWeek: [2, 4] }, today),
    ).toBe(false);
  });

  test("a paused schedule is never due", () => {
    expect(scheduleDueOn({ status: "paused", frequency: "daily", daysOfWeek: null }, today)).toBe(
      false,
    );
  });
});

describe("scheduledDose", () => {
  test("reads a bare amount against the supplement's dose", () => {
    expect(scheduledDose("1", "1000 IU")).toBe("1000 IU");
    expect(scheduledDose("2", "200 mg")).toBe("2 × 200 mg");
  });

  test("keeps a worded amount, and falls back to the dose or nothing", () => {
    expect(scheduledDose("1 scoop", "3 g")).toBe("1 scoop");
    expect(scheduledDose(null, "3 g")).toBe("3 g");
    expect(scheduledDose("", null)).toBeNull();
  });
});

describe("scheduleAmount", () => {
  test("names the form beside a bare amount", () => {
    expect(scheduleAmount("2", "capsule")).toBe("2 × capsule");
    expect(scheduleAmount("1 scoop", "powder")).toBe("1 scoop");
    expect(scheduleAmount("2", null)).toBe("2");
    expect(scheduleAmount(null, "softgel")).toBeNull();
  });
});

describe("buildChecklist", () => {
  test("groups today's doses by time of day, in the day's order", () => {
    const groups = buildChecklist({
      supplements: [vitaminD, magnesium, creatine],
      schedules: [
        schedule({ id: 10, supplementId: 2, timeOfDay: "pre-bed", quantity: "2" }),
        schedule({ id: 11, supplementId: 1, timeOfDay: "morning", quantity: "1" }),
        schedule({ id: 12, supplementId: 3, timeOfDay: "training", quantity: "1 scoop" }),
      ],
      intakes: [],
      today,
    });
    expect(groups.map((group) => group.id)).toEqual(["morning", "pre-bed", "training"]);
    expect(groups[1]!.items[0]).toMatchObject({
      scheduleId: 10,
      dose: "2 × 200 mg",
      taken: null,
    });
  });

  test("a dose taken today ticks the item; yesterday's does not", () => {
    const groups = buildChecklist({
      supplements: [vitaminD],
      schedules: [schedule({ id: 11, supplementId: 1 })],
      intakes: [
        { id: 7, supplementId: 1, occurredAt: at("2026-11-15", 8) },
        { id: 8, supplementId: 1, occurredAt: at(today, 8) },
      ],
      today,
    });
    expect(groups[0]!.items[0]!.taken?.id).toBe(8);
  });

  test("doses cover a supplement's schedules earliest first", () => {
    const groups = buildChecklist({
      supplements: [magnesium],
      schedules: [
        schedule({ id: 20, supplementId: 2, timeOfDay: "pre-bed" }),
        schedule({ id: 21, supplementId: 2, timeOfDay: "morning" }),
      ],
      intakes: [{ id: 9, supplementId: 2, occurredAt: at(today, 9) }],
      today,
    });
    const morning = groups.find((group) => group.id === "morning")!;
    const preBed = groups.find((group) => group.id === "pre-bed")!;
    expect(morning.items[0]!.taken?.id).toBe(9);
    expect(preBed.items[0]!.taken).toBeNull();
  });

  test("weekly doses not due today and paused supplements stay off the list", () => {
    const groups = buildChecklist({
      supplements: [vitaminD, magnesium],
      schedules: [
        schedule({ id: 30, supplementId: 1, frequency: "weekly", daysOfWeek: [3] }),
        schedule({ id: 31, supplementId: 2, status: "paused" }),
      ],
      intakes: [],
      today,
    });
    expect(groups).toEqual([]);
  });

  test("a supplement with no schedule can still be ticked under any time", () => {
    const groups = buildChecklist({ supplements: [creatine], schedules: [], intakes: [], today });
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ id: "anytime", items: [{ scheduleId: null, dose: "3 g" }] });
  });
});

test("localDateOf uses the device's calendar day", () => {
  expect(localDateOf(new Date(2026, 10, 16, 23, 59))).toBe("2026-11-16");
});
