import { describe, expect, mock, test } from "bun:test";

import {
  isDroppedQueuedWriteError,
  isQueuedSupplementIntake,
  queuedSupplementIntakes,
  sendQueuedWrite,
  supplementIntakeQueueKey,
  type QueuedWrite,
  type QueuedWriteApi,
  type SupplementIntakePayload,
} from "./queued-write";

const metric: QueuedWrite = {
  metricCode: "weight",
  observedAt: "2026-11-13T09:00:00.000Z",
  valueNumeric: 82.4,
  dedupeHash: "h-1",
};

const input: SupplementIntakePayload = {
  supplementId: 3,
  occurredAt: "2026-11-13T09:00:00.000Z",
  timeZone: "Europe/Lisbon",
  dose: "200 mg",
  clientMutationId: "m-3",
};

const intake: QueuedWrite = { type: "supplement_intake", input };

function fakeApi() {
  const api = {
    healthRecord: { ingestMetricSample: mock(async () => ({})) },
    supplementIntake: { create: mock(async () => ({})) },
  };
  return api as unknown as QueuedWriteApi & typeof api;
}

describe("queued writes (#440)", () => {
  test("a metric row goes through ingestMetricSample, an intake through supplementIntake.create", async () => {
    const api = fakeApi();
    await sendQueuedWrite(metric, api);
    await sendQueuedWrite(intake, api);
    expect(api.healthRecord.ingestMetricSample).toHaveBeenCalledTimes(1);
    expect(api.healthRecord.ingestMetricSample).toHaveBeenCalledWith(metric);
    expect(api.supplementIntake.create).toHaveBeenCalledTimes(1);
    expect(api.supplementIntake.create).toHaveBeenCalledWith(input);
  });

  test("rows written before #440 have no type and still read as metrics", () => {
    expect(isQueuedSupplementIntake(metric)).toBe(false);
    expect(isQueuedSupplementIntake(intake)).toBe(true);
    expect(queuedSupplementIntakes([metric, intake])).toEqual([input]);
  });

  test("one queue row per client mutation id", () => {
    expect(supplementIntakeQueueKey("m-3")).toBe("supplement-intake:m-3");
  });

  test("only writes the server will never take are dropped", () => {
    const offline = Object.assign(new Error("Network request failed"), { name: "TypeError" });
    expect(isDroppedQueuedWriteError(metric, { code: "INVALID_INPUT" })).toBe(true);
    expect(isDroppedQueuedWriteError(intake, { code: "INVALID_INPUT" })).toBe(true);
    // A supplement that is gone, or a mutation id already used for another intake.
    expect(isDroppedQueuedWriteError(intake, { code: "NOT_FOUND" })).toBe(true);
    expect(isDroppedQueuedWriteError(intake, { code: "CONFLICT" })).toBe(true);
    expect(isDroppedQueuedWriteError(metric, { code: "NOT_FOUND" })).toBe(false);
    for (const error of [offline, { code: "UNAUTHENTICATED" }, { code: "ACCESS_READ_ONLY" }])
      expect(isDroppedQueuedWriteError(intake, error)).toBe(false);
  });
});
