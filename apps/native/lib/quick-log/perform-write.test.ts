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
    ...overrides,
  };
  return api as unknown as PickerApi & typeof api;
}

function fakeOffline(overrides: Partial<PickerOffline> = {}) {
  return {
    enqueueMetric: mock(() => {}),
    enqueueWater: mock(() => "queue-1" as string | null),
    discardWater: mock(() => true),
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

  test("a tracker entry saves and its undo deletes it", async () => {
    const api = fakeApi();
    const input = { trackerId: "t-1", value: 20, timeZone: "UTC" };
    const result = await performPickerWrite({ type: "tracker", input }, api, fakeOffline());
    expect(api.trackers.log).toHaveBeenCalledWith(input);
    await result.undo!();
    expect(api.trackers.deleteEntry).toHaveBeenCalledWith({ id: "entry-1" });
  });

  test("only offline-type failures may wait on the device", () => {
    expect(canQueueAfter(offlineError)).toBe(true);
    expect(canQueueAfter({ status: 503 })).toBe(true);
    expect(canQueueAfter(refused)).toBe(false);
    expect(canQueueAfter({ code: "UNAUTHENTICATED" })).toBe(false);
    expect(canQueueAfter({ code: "ACCESS_READ_ONLY" })).toBe(false);
  });
});
