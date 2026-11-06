import { describe, expect, test } from "bun:test";
import { NUTRIENT_KEYS, type DiaryEntry } from "@openvalens/api/contracts/nutrition-diary";

import type { DiaryRow, QueuedChange } from "./outbox";
import {
  consumedAtForHour,
  groupByHour,
  hourLabel,
  localHour,
  rowInstant,
  slotForHour,
  sumMacros,
} from "./timeline";

function nutrients(kcal: number | null, protein: number | null = null) {
  const values = Object.fromEntries(NUTRIENT_KEYS.map((key) => [key, null])) as Record<
    (typeof NUTRIENT_KEYS)[number],
    number | null
  >;
  values.energyKcal = kcal;
  values.proteinG = protein;
  return values;
}

function entry(id: number, createdAt: string, consumedAt: string | null = null): DiaryEntry {
  return {
    id,
    localDate: "2026-11-06",
    timeZone: "Europe/Lisbon",
    slot: "breakfast",
    amount: 100,
    unit: "g",
    method: "search",
    clientMutationId: null,
    revision: 1,
    deleted: false,
    consumedAt,
    createdAt,
    updatedAt: createdAt,
    food: {
      snapshotId: id,
      source: "manual",
      sourceQualifiedId: null,
      sourceVersion: null,
      attribution: null,
      name: `Food ${id}`,
      brand: null,
      basis: {
        nutrientBasisAmount: 100,
        nutrientBasisUnit: "g",
        servingSizeAmount: null,
        servingSizeUnit: null,
        servingLabel: null,
      },
      nutrientsPerBasis: nutrients(100),
    },
    nutrients: nutrients(100, 5),
  };
}

const server = (e: DiaryEntry): DiaryRow => ({
  kind: "server",
  key: `server:${e.id}`,
  entry: e,
  sync: "synced",
  pendingKind: null,
});

function queuedLog(key: string, createdAt: number, consumedAt?: string): DiaryRow {
  const change = {
    id: key,
    scope: "s",
    seq: 1,
    op: {
      kind: "log",
      input: {
        clientMutationId: key,
        localDate: "2026-11-06",
        timeZone: "Europe/Lisbon",
        slot: "lunch",
        food: { kind: "snapshot", snapshotId: 1 },
        amount: 1,
        unit: "serving",
        method: "search",
        ...(consumedAt ? { consumedAt } : {}),
      },
    },
    status: "queued",
    attempts: 0,
    lastErrorCode: null,
    conflict: null,
    preview: { name: "Queued", source: "manual", nutrients: nutrients(50, null) },
    createdAt,
  } satisfies QueuedChange;
  return { kind: "local", key, change, sync: "queued" };
}

describe("timeline", () => {
  test("an entry sits at its eaten-at time, else at its logged time", () => {
    expect(rowInstant(server(entry(1, "2026-11-06T09:15:00.000Z")))).toBe(
      "2026-11-06T09:15:00.000Z",
    );
    expect(
      rowInstant(server(entry(2, "2026-11-06T20:00:00.000Z", "2026-11-06T08:00:00.000Z"))),
    ).toBe("2026-11-06T08:00:00.000Z");
    expect(rowInstant(queuedLog("q", Date.parse("2026-11-06T12:30:00Z")))).toBe(
      "2026-11-06T12:30:00.000Z",
    );
    expect(
      rowInstant(queuedLog("q2", Date.parse("2026-11-06T12:30:00Z"), "2026-11-06T07:00:00Z")),
    ).toBe("2026-11-06T07:00:00.000Z");
  });

  test("an unreadable time never throws", () => {
    expect(rowInstant(server(entry(3, "")))).toBe("1970-01-01T00:00:00.000Z");
  });

  test("groups by local hour in the diary's zone, earliest first, with subtotals", () => {
    // Lisbon is UTC+0 in November; New York is UTC-5.
    const rows = [
      server(entry(1, "2026-11-06T12:40:00.000Z")),
      server(entry(2, "2026-11-06T08:05:00.000Z")),
      queuedLog("q", Date.parse("2026-11-06T12:10:00Z")),
      server(entry(4, "2026-11-06T08:50:00.000Z")),
    ];
    const hours = groupByHour(rows, "Europe/Lisbon");
    expect(hours.map((h) => h.hour)).toEqual([8, 12]);
    expect(hours[0]!.rows.map((r) => r.key)).toEqual(["server:2", "server:4"]);
    expect(hours[1]!.rows.map((r) => r.key)).toEqual(["q", "server:1"]);
    expect(hours[0]!.totals).toEqual({
      energyKcal: 200,
      proteinG: 10,
      carbohydrateG: null,
      fatG: null,
    });
    // Unknown protein is left out, never counted as 0.
    expect(hours[1]!.totals.energyKcal).toBe(150);
    expect(hours[1]!.totals.proteinG).toBe(5);
    expect(groupByHour(rows, "America/New_York").map((h) => h.hour)).toEqual([3, 7]);
  });

  test("an hour's time is that wall-clock hour in the zone, across daylight saving", () => {
    expect(consumedAtForHour("2026-11-06", 8, "Europe/Lisbon")).toBe("2026-11-06T08:00:00.000Z");
    expect(consumedAtForHour("2026-07-06", 8, "Europe/Lisbon")).toBe("2026-07-06T07:00:00.000Z");
    expect(consumedAtForHour("2026-11-06", 8, "America/New_York")).toBe("2026-11-06T13:00:00.000Z");
    const at = consumedAtForHour("2026-03-29", 13, "Europe/Lisbon");
    expect(localHour(at, "Europe/Lisbon")).toBe(13);
  });

  test("labels, slots and empty sums", () => {
    expect(hourLabel(8)).toBe("08:00");
    expect(hourLabel(13)).toBe("13:00");
    expect(slotForHour(8)).toBe("breakfast");
    expect(slotForHour(12)).toBe("lunch");
    expect(slotForHour(19)).toBe("dinner");
    expect(slotForHour(23)).toBe("snack");
    expect(sumMacros([])).toEqual({
      energyKcal: null,
      proteinG: null,
      carbohydrateG: null,
      fatG: null,
    });
  });
});
