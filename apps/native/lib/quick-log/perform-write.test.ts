import { describe, expect, mock, test } from "bun:test";

import {
  canQueueAfter,
  performPickerWrite,
  type PickerApi,
  type PickerOffline,
} from "./perform-write";

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
      log: mock(async () => ({ id: "entry-1" })),
      deleteEntry: mock(async () => ({})),
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
  return api as unknown as PickerApi & typeof api;
}

function fakeOffline(overrides: Partial<PickerOffline> = {}) {
  return {
    enqueueMetric: mock(() => {}),
    enqueueWater: mock(() => "queue-1" as string | null),
    discardWater: mock(() => true),
    enqueueSupplement: mock(() => "supplement-intake:m-3" as string | null),
    discardSupplement: mock(() => true),
    ...overrides,
  };
}

const offlineError = Object.assign(new Error("Network request failed"), { name: "TypeError" });
const refused = { code: "INVALID_INPUT" };

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

const weight = {
  type: "metric" as const,
  kind: "weight" as const,
  samples: [
    {
      metricCode: "weight",
      observedAt: "2026-11-13T09:00:00.000Z",
      valueNumeric: 82.4,
      dedupeHash: "h-1",
    },
  ],
};

describe("performPickerWrite", () => {
  test("water saves and its undo deletes the entry just made", async () => {
    const api = fakeApi();
    const result = await performPickerWrite(water, api, fakeOffline());
    expect(result.queued).toBe(false);
    expect(api.plainWater.add).toHaveBeenCalledWith(water.input);
    await result.undo!();
    expect(api.plainWater.delete).toHaveBeenCalledWith(
      expect.objectContaining({ id: 8, expectedRevision: 1 }),
    );
  });

  test("water that cannot reach the server waits in the water queue, with the same id", async () => {
    const api = fakeApi({
      plainWater: { add: mock(async () => Promise.reject(offlineError)), delete: mock() },
    });
    const offline = fakeOffline();
    const result = await performPickerWrite(water, api, offline);
    expect(result.queued).toBe(true);
    expect(offline.enqueueWater).toHaveBeenCalledWith(water.input);
    await result.undo!();
    expect(offline.discardWater).toHaveBeenCalledWith("queue-1");
  });

  test("undoing queued water that may have been sent says so", async () => {
    const api = fakeApi({
      plainWater: { add: mock(async () => Promise.reject(offlineError)), delete: mock() },
    });
    const result = await performPickerWrite(
      water,
      api,
      fakeOffline({ discardWater: mock(() => false) }),
    );
    await expect(result.undo!()).rejects.toThrow();
  });

  test("water the server refuses is not queued", async () => {
    const api = fakeApi({
      plainWater: { add: mock(async () => Promise.reject(refused)), delete: mock() },
    });
    const offline = fakeOffline();
    await expect(performPickerWrite(water, api, offline)).rejects.toBe(refused);
    expect(offline.enqueueWater).not.toHaveBeenCalled();
  });

  test("a metric sample that cannot reach the server is queued, without an undo", async () => {
    const api = fakeApi({
      healthRecord: { ingestMetricSample: mock(async () => Promise.reject(offlineError)) },
    });
    const offline = fakeOffline();
    const result = await performPickerWrite(weight, api, offline);
    expect(result).toEqual({ queued: true });
    expect(offline.enqueueMetric).toHaveBeenCalledWith(weight.samples[0], offlineError);
  });

  test("a refused metric sample surfaces the error", async () => {
    const api = fakeApi({
      healthRecord: { ingestMetricSample: mock(async () => Promise.reject(refused)) },
    });
    const offline = fakeOffline();
    await expect(performPickerWrite(weight, api, offline)).rejects.toBe(refused);
    expect(offline.enqueueMetric).not.toHaveBeenCalled();
  });

  test("a replayed supplement intake offers no undo", async () => {
    const api = fakeApi({
      supplementIntake: {
        create: mock(async () => ({ id: 2, version: 1, created: false })),
        delete: mock(),
      },
    });
    const result = await performPickerWrite(
      {
        type: "supplement",
        input: {
          supplementId: 1,
          occurredAt: "2026-11-13T09:00:00.000Z",
          timeZone: "UTC",
          dose: "200 mg",
          clientMutationId: "m-2",
        },
      },
      api,
      fakeOffline(),
    );
    expect(result.undo).toBeUndefined();
  });

  const taken = {
    type: "supplement" as const,
    input: {
      supplementId: 3,
      occurredAt: "2026-11-13T09:00:00.000Z",
      timeZone: "Europe/Lisbon",
      dose: "200 mg",
      clientMutationId: "m-3",
    },
  };

  test("a supplement taken offline waits in the outbox; undo takes it off before it syncs", async () => {
    const api = fakeApi({
      supplementIntake: { create: mock(async () => Promise.reject(offlineError)), delete: mock() },
    });
    const offline = fakeOffline();
    const result = await performPickerWrite(taken, api, offline);
    expect(result.queued).toBe(true);
    // The same input, so a retry replays the same client mutation id.
    expect(offline.enqueueSupplement).toHaveBeenCalledWith(taken.input, offlineError);
    await result.undo!();
    expect(offline.discardSupplement).toHaveBeenCalledWith("supplement-intake:m-3");
    expect(api.supplementIntake.delete).not.toHaveBeenCalled();
  });

  test("undoing a queued intake that may have been sent says so", async () => {
    const api = fakeApi({
      supplementIntake: { create: mock(async () => Promise.reject(offlineError)), delete: mock() },
    });
    const result = await performPickerWrite(
      taken,
      api,
      fakeOffline({ discardSupplement: mock(() => false) }),
    );
    await expect(result.undo!()).rejects.toThrow();
  });

  test("an intake the server refuses, or one the device would not queue, is not saved offline", async () => {
    const refusedApi = fakeApi({
      supplementIntake: { create: mock(async () => Promise.reject(refused)), delete: mock() },
    });
    const offline = fakeOffline();
    await expect(performPickerWrite(taken, refusedApi, offline)).rejects.toBe(refused);
    expect(offline.enqueueSupplement).not.toHaveBeenCalled();

    const offlineApi = fakeApi({
      supplementIntake: { create: mock(async () => Promise.reject(offlineError)), delete: mock() },
    });
    await expect(
      performPickerWrite(taken, offlineApi, fakeOffline({ enqueueSupplement: mock(() => null) })),
    ).rejects.toBe(offlineError);
  });

  test("a tracker entry saves and its undo deletes it", async () => {
    const api = fakeApi();
    const input = { trackerId: "t-1", value: 20, timeZone: "UTC" };
    const result = await performPickerWrite({ type: "tracker", input }, api, fakeOffline());
    expect(api.trackers.log).toHaveBeenCalledWith(input);
    await result.undo!();
    expect(api.trackers.deleteEntry).toHaveBeenCalledWith({ id: "entry-1" });
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
    const result = await performPickerWrite(write, api, fakeOffline());
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
    expect((await performPickerWrite(write, replay, fakeOffline())).undo).toBeUndefined();
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
    const result = await performPickerWrite({ type: "pain", input }, api, fakeOffline());
    expect(api.pain.log).toHaveBeenCalledWith(input);
    await result.undo!();
    expect(api.pain.delete).toHaveBeenCalledWith({ id: "pain-1" });
  });

  test("only offline-type failures may wait on the device", () => {
    expect(canQueueAfter(offlineError)).toBe(true);
    expect(canQueueAfter({ status: 503 })).toBe(true);
    expect(canQueueAfter(refused)).toBe(false);
    expect(canQueueAfter({ code: "UNAUTHENTICATED" })).toBe(false);
    expect(canQueueAfter({ code: "ACCESS_READ_ONLY" })).toBe(false);
  });
});
