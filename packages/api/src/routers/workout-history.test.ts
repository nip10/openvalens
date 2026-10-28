import { describe, expect, test } from "bun:test";
import { workoutHistoryInputSchema } from "./workout-history";

const cursor = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

describe("workout history RPC input boundary", () => {
  test("accepts valid history input and a structurally valid cursor", () => {
    expect(
      workoutHistoryInputSchema.safeParse({
        exercise: { exerciseId: 7 },
        limit: 20,
        cursor: cursor({ date: "2026-10-01", createdAt: "2026-10-01T12:00:00.000Z", id: 12 }),
      }).success,
    ).toBe(true);
  });

  test("rejects malformed, incomplete, and invalid-date cursors at the API boundary", () => {
    for (const value of [
      "not-json",
      cursor({}),
      cursor({ date: "2026-02-31", createdAt: "2026-10-01T00:00:00Z", id: 1 }),
      cursor({ date: "2026-10-01", createdAt: "bad", id: 1 }),
      cursor({ date: "2026-10-01", createdAt: "2026-10-01T00:00:00Z", id: 0 }),
    ]) {
      expect(
        workoutHistoryInputSchema.safeParse({ exercise: { name: "Bench" }, cursor: value }).success,
      ).toBe(false);
    }
  });

  test("keeps history and batched lookup inputs strict", () => {
    expect(
      workoutHistoryInputSchema.safeParse({ exercise: { name: "Bench" }, organizationId: "org-b" })
        .success,
    ).toBe(false);
  });
});
