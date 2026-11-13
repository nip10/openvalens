import { describe, expect, test } from "bun:test";
import type { DrinkSummaryWire } from "@openvalens/api/contracts/nutrition-drinks";
import { logEntryInput } from "@openvalens/api/contracts/nutrition-diary";

import { availablePresets, drinkTotalsState, lastCaffeineByNight, presetLogInput } from "./drinks";
import { enqueue, mergeDay, type OutboxStore, type QueuedChange } from "./outbox";

const espresso = {
  key: "espresso" as const,
  catalogId: "fdc:171890",
  volumeMl: 30,
  amountG: 30.3,
  available: true,
};

function memoryStore(): OutboxStore {
  const rows = new Map<string, QueuedChange>();
  let seq = 0;
  return {
    list: (scope) =>
      [...rows.values()].filter((row) => row.scope === scope).sort((a, b) => a.seq - b.seq),
    put: (item) => void rows.set(item.id, structuredClone(item)),
    remove: (scope, id) => {
      if (rows.get(id)?.scope === scope) rows.delete(id);
    },
    nextSeq: () => ++seq,
  };
}

const ready = (
  overrides: Partial<Pick<DrinkSummaryWire, "caffeine" | "alcohol">> = {},
): DrinkSummaryWire => ({
  localDate: "2026-11-13",
  caffeine: {
    status: "ready",
    total: { knownEntries: 1, totalEntries: 1, amount: 64, atLeast: false },
    reference: null,
    referenceNote: null,
  },
  alcohol: { status: "off" },
  ...overrides,
});

describe("drink presets on mobile (#443)", () => {
  test("only presets the server can log are offered", () => {
    expect(availablePresets(undefined)).toEqual([]);
    expect(
      availablePresets({
        presets: [espresso, { ...espresso, key: "beer", available: false }],
      }).map((entry) => entry.key),
    ).toEqual(["espresso"]);
  });

  test("a tap queues a valid catalog log with method preset in the given slot", () => {
    const input = presetLogInput(espresso, {
      clientMutationId: "m-1",
      localDate: "2026-11-13",
      timeZone: "Europe/Lisbon",
      slot: "snack",
      name: "Espresso · 30 ml",
    });
    expect(input.op.kind).toBe("log");
    if (input.op.kind !== "log") throw new Error("not a log");
    // The queued request is exactly what the server accepts.
    expect(logEntryInput.parse(input.op.input)).toEqual(input.op.input);
    expect(input.op.input).toMatchObject({
      food: { kind: "catalog", id: "fdc:171890" },
      amount: 30.3,
      unit: "g",
      method: "preset",
      slot: "snack",
    });
    expect(input.preview).toEqual({ name: "Espresso · 30 ml", source: "fdc", nutrients: null });
  });

  test("a queued preset shows in the day before it syncs", () => {
    const store = memoryStore();
    enqueue(
      store,
      "acct",
      presetLogInput(espresso, {
        clientMutationId: "m-2",
        localDate: "2026-11-13",
        timeZone: "Europe/Lisbon",
        slot: "breakfast",
        name: "Espresso · 30 ml",
      }),
    );
    const rows = mergeDay([], store.list("acct"), "2026-11-13");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe("local");
  });
});

describe("drink totals state", () => {
  test("nothing while both settings are off or unknown", () => {
    expect(drinkTotalsState(undefined, false)).toBe("none");
    expect(
      drinkTotalsState(ready({ caffeine: { status: "off" }, alcohol: { status: "off" } }), false),
    ).toBe("none");
  });

  test("hide-numbers hides both totals, locally or from the server", () => {
    expect(drinkTotalsState(ready(), true)).toBe("hidden");
    expect(drinkTotalsState(ready({ alcohol: { status: "hidden" } }), false)).toBe("hidden");
    expect(drinkTotalsState(ready(), false)).toBe("ready");
  });
});

describe("last caffeine per night", () => {
  test("nothing while the caffeine setting is off", () => {
    expect(lastCaffeineByNight(undefined)).toBeNull();
    expect(lastCaffeineByNight({ status: "off" })).toBeNull();
  });

  test("maps night keys to their last caffeine", () => {
    const map = lastCaffeineByNight({
      status: "ready",
      nights: [
        { key: "2026-11-12", lastCaffeineAt: "2026-11-12T16:40:00.000Z" },
        { key: "2026-11-11", lastCaffeineAt: null },
      ],
    });
    expect(map?.get("2026-11-12")).toBe("2026-11-12T16:40:00.000Z");
    expect(map?.get("2026-11-11")).toBeNull();
  });
});
