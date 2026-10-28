import { describe, expect, it } from "bun:test";
import { estimateEpley1Rm, normalizeExerciseName } from "./workout-history";

describe("workout history canonical performance math", () => {
  it("normalizes only free-text identity with NFKC, whitespace and case", () => {
    expect(normalizeExerciseName("  Ｂench\t PRESS  ")).toBe("bench press");
  });

  it("estimates Epley 1RM only for positive weights and reps 1 through 12", () => {
    expect(estimateEpley1Rm(100, 1)).toBeCloseTo(103.333333);
    expect(estimateEpley1Rm(100, 12)).toBe(140);
    expect(estimateEpley1Rm(0, 5)).toBeNull();
    expect(estimateEpley1Rm(100, 13)).toBeNull();
    expect(estimateEpley1Rm(100, null)).toBeNull();
  });
});
