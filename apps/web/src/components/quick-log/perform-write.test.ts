import { describe, expect, mock, test } from "bun:test";

import { performQuickLogWrite, type QuickLogApi } from "./perform-write";

function fakeApi(overrides: Partial<Record<string, unknown>> = {}) {
  const api = {
    healthRecord: { ingestMetricSample: mock(async () => ({})) },
    sleep: {
      logManualSession: mock(async () => ({ id: 4, created: true, possibleDuplicate: false })),
      deleteManualSession: mock(async () => ({ deleted: true })),
    },
    plainWater: {
      add: mock(async () => ({ outcome: "applied", entry: { id: 8, revision: 1 } })),
      delete: mock(async () => ({})),
    },
    supplementIntake: {
      create: mock(async () => ({ id: 2, version: 1, created: true })),
      delete: mock(async () => ({})),
    },
    trackers: {
      log: mock(async () => ({ id: "entry-1", value: 1200 })),
      deleteEntry: mock(async () => ({ deleted: true })),
    },
    nutritionDiary: {
      logEntry: mock(async () => ({ created: true, entry: { id: 11, revision: 1 } })),
      deleteEntry: mock(async () => ({})),
    },
    pain: {
      log: mock(async () => [{ id: "pain-1" }]),
      delete: mock(async () => ({ deleted: true })),
    },
    ...overrides,
  };
  return api as unknown as QuickLogApi & typeof api;
}

const water = {
  type: "water" as const,
  input: {
    quantity: 500,
    unit: "ml" as const,
    observedAt: "2026-11-13T09:00:00.000Z",
    timeZone: "Europe/Lisbon",
    clientMutationId: "m-1",
  },
};

describe("performQuickLogWrite", () => {
  test("water saves and its undo deletes the entry just made", async () => {
    const api = fakeApi();
    const result = await performQuickLogWrite(water, api, mock());
    expect(api.plainWater.add).toHaveBeenCalledWith(water.input);
    await result.undo!();
    expect(api.plainWater.delete).toHaveBeenCalledWith(
      expect.objectContaining({ id: 8, expectedRevision: 1 }),
    );
  });

  test("a tracker entry saves through trackers.log and its undo deletes it", async () => {
    const api = fakeApi();
    const input = {
      trackerId: "00000000-0000-4000-8000-000000000001",
      value: 1200,
      loggedAt: "2026-11-13T09:00:00.000Z",
      timeZone: "Europe/Lisbon",
    };
    const result = await performQuickLogWrite({ type: "tracker", input }, api, mock());
    expect(api.trackers.log).toHaveBeenCalledWith(input);
    expect(result.queued).toBe(false);
    await result.undo!();
    expect(api.trackers.deleteEntry).toHaveBeenCalledWith({ id: "entry-1" });
  });

  test("a replayed supplement intake offers no undo", async () => {
    const api = fakeApi({
      supplementIntake: {
        create: mock(async () => ({ id: 2, version: 1, created: false })),
        delete: mock(),
      },
    });
    const result = await performQuickLogWrite(
      {
        type: "supplement",
        input: {
          supplementId: 1,
          occurredAt: "2026-11-13T09:00:00.000Z",
          timeZone: "UTC",
          dose: "1 capsule",
          clientMutationId: "m-2",
        },
      },
      api,
      mock(),
    );
    expect(result.undo).toBeUndefined();
  });

  test("metric samples have no undo; a failed one goes to the outbox", async () => {
    let calls = 0;
    const api = fakeApi({
      healthRecord: {
        ingestMetricSample: mock(async () => {
          calls += 1;
          if (calls === 2) throw new Error("offline");
          return {};
        }),
      },
    });
    const enqueue = mock();
    const samples = [
      { metricCode: "blood_pressure_systolic", observedAt: "x", valueNumeric: 120 },
      { metricCode: "blood_pressure_diastolic", observedAt: "x", valueNumeric: 80 },
    ];
    const result = await performQuickLogWrite(
      { type: "metric", kind: "blood_pressure", samples },
      api,
      enqueue,
    );
    expect(result).toEqual({ queued: true });
    expect(enqueue).toHaveBeenCalledWith(samples[1], expect.any(Error));
  });

  test("sleep undo removes the night; an existing night is not undone", async () => {
    const api = fakeApi();
    const input = { startAt: "a", endAt: "b", quality: null };
    const made = await performQuickLogWrite({ type: "sleep", input }, api, mock());
    await made.undo!();
    expect(api.sleep.deleteManualSession).toHaveBeenCalledWith({ id: 4 });

    const replay = fakeApi({
      sleep: {
        logManualSession: mock(async () => ({ id: 4, created: false })),
        deleteManualSession: mock(),
      },
    });
    expect((await performQuickLogWrite({ type: "sleep", input }, replay, mock())).undo).toBe(
      undefined,
    );
  });

  test("a drink preset (#443) is a diary entry; undo deletes it, a replay offers none", async () => {
    const api = fakeApi();
    const input = {
      clientMutationId: "m-3",
      localDate: "2026-11-13",
      timeZone: "Europe/Lisbon",
      slot: "breakfast" as const,
      food: { kind: "catalog" as const, id: "fdc:171891" },
      amount: 30,
      unit: "g" as const,
      method: "preset" as const,
    };
    const write = { type: "drink" as const, preset: "espresso" as const, volumeMl: 30, input };
    const result = await performQuickLogWrite(write, api, mock());
    expect(api.nutritionDiary.logEntry).toHaveBeenCalledWith(input);
    await result.undo!();
    expect(api.nutritionDiary.deleteEntry).toHaveBeenCalledWith(
      expect.objectContaining({ entryId: 11, expectedRevision: 1 }),
    );

    const replay = fakeApi({
      nutritionDiary: {
        logEntry: mock(async () => ({ created: false, entry: { id: 11, revision: 1 } })),
        deleteEntry: mock(),
      },
    });
    expect((await performQuickLogWrite(write, replay, mock())).undo).toBeUndefined();
  });

  test("pain (#442) saves through pain.log and its undo deletes every entry made", async () => {
    const api = fakeApi();
    const input = {
      regions: ["joint.knee_left"] as [string],
      rating: 4,
      type: null,
      loggedAt: "2026-11-13T09:00:00.000Z",
      timeZone: "Europe/Lisbon",
    };
    const result = await performQuickLogWrite({ type: "pain", input }, api, mock());
    expect(api.pain.log).toHaveBeenCalledWith(input);
    await result.undo!();
    expect(api.pain.delete).toHaveBeenCalledWith({ id: "pain-1" });
  });
});
