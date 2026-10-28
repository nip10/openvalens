import { describe, expect, test } from "bun:test";
import { expectedWorkoutScope, workoutOwnership } from "./workout-contract";

describe("private workout contract", () => {
  test("scope is bound to authenticated user and organization", () => {
    expect(expectedWorkoutScope("user-a", "org-a")).toBe("user-a:org-a");
    expect(expectedWorkoutScope("user-a", "org-a")).not.toBe(
      expectedWorkoutScope("user-b", "org-a"),
    );
  });

  test("legacy rows remain read-only and ownership is caller-specific", () => {
    expect(workoutOwnership(null, "user-a")).toBe("legacy");
    expect(workoutOwnership("user-a", "user-a")).toBe("mine");
    expect(workoutOwnership("user-b", "user-a")).toBeNull();
  });
});
