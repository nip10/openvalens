import { describe, expect, it } from "bun:test";

import {
  adjustRestTimer,
  EMPTY_REST_TIMER,
  remainingRestSeconds,
  restoreRestTimer,
  startRestTimer,
} from "./rest-timer-state";

describe("rest timer timestamp state machine", () => {
  const now = 1_000_000;
  it("starts at an absolute deadline and ticks from wall-clock time", () => {
    const timer = startRestTimer(EMPTY_REST_TIMER, "id:bench", 90, now);
    expect(timer.deadline).toBe(now + 90_000);
    expect(remainingRestSeconds(timer, now + 1_001)).toBe(89);
  });
  it("adjusts by 15 seconds in either direction", () => {
    const timer = startRestTimer(EMPTY_REST_TIMER, "name:squat", 90, now);
    expect(remainingRestSeconds(adjustRestTimer(timer, 15, now), now)).toBe(105);
    expect(remainingRestSeconds(adjustRestTimer(timer, -15, now), now)).toBe(75);
  });
  it("skips at zero and restores only a live deadline", () => {
    const timer = startRestTimer(EMPTY_REST_TIMER, "id:1", 90, now);
    expect(restoreRestTimer(timer, now + 90_000)).toEqual(EMPTY_REST_TIMER);
    expect(remainingRestSeconds(EMPTY_REST_TIMER, now)).toBe(0);
    expect(restoreRestTimer(timer, now + 10_000)).toEqual(timer);
  });
  it("clamps a negative adjustment at zero", () => {
    const timer = startRestTimer(EMPTY_REST_TIMER, "id:1", 5, now);
    expect(adjustRestTimer(timer, -15, now)).toEqual(EMPTY_REST_TIMER);
  });
});
