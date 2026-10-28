import { describe, expect, test } from "bun:test";
import { applyWorkoutOverlay } from "./overlay";
import type { WorkoutAcknowledgement, WorkoutQueueItem } from "./sync";

const uuid = "11111111-1111-4111-8111-111111111111";
const created: WorkoutQueueItem = {
  id: uuid,
  scope: "u:o",
  operation: "create",
  payload: {
    clientMutationId: uuid,
    date: "2026-01-01",
    type: "weights",
    notes: null,
    intensity: null,
    effortRating: null,
    exercises: [],
  },
  finishedAt: "2026-01-01T00:00:00Z",
  state: "pending",
  attempts: 0,
  error: null,
  createdAt: 1,
};

describe("durable workout acknowledgement overlays", () => {
  test("restored create acknowledgement appears at server ID and delete acknowledgement hides until absence is observed", () => {
    const ack: WorkoutAcknowledgement = {
      scope: "u:o",
      clientMutationId: uuid,
      serverId: 71,
      version: 1,
      result: { id: 71, version: 1 },
      item: created,
    };
    expect(applyWorkoutOverlay([], [], [ack])).toMatchObject([
      { id: 71, version: 1, pending: true },
    ]);
    const deleted: WorkoutAcknowledgement = {
      ...ack,
      version: 2,
      item: {
        ...created,
        operation: "delete",
        payload: { clientMutationId: uuid, id: 71, expectedVersion: 1 },
      },
    };
    expect(applyWorkoutOverlay([{ id: 71, version: 1 }], [], [deleted])).toEqual([]);
  });
  test("pending local IDs are stable and distinct even when timestamps match", () => {
    const secondId = "22222222-2222-4222-8222-222222222222";
    const second = {
      ...created,
      id: secondId,
      payload: { ...created.payload, clientMutationId: secondId },
    };
    const firstList = applyWorkoutOverlay([], [created, second]);
    const remount = applyWorkoutOverlay([], [created, second]);
    expect(firstList.map((row) => row.id)).toEqual(remount.map((row) => row.id));
    expect(new Set(firstList.map((row) => row.id)).size).toBe(2);
  });
});
