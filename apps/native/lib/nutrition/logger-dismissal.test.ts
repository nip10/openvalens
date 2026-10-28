import { describe, expect, test } from "bun:test";

import { FoodLoggerDismissal } from "./logger-dismissal";

describe("FoodLoggerDismissal", () => {
  test("ordinary cancel and route dismissal announce nothing saved only once", () => {
    const state = new FoodLoggerDismissal();
    expect(state.dismiss()).toBe("nothing_saved");
    expect(state.dismiss()).toBeNull();
  });

  test("a dispatched food creation uses the honest persistence warning", () => {
    const state = new FoodLoggerDismissal();
    state.markCreateDispatched();
    expect(state.dismiss()).toBe("pending_food_creation_cancelled");
    expect(state.dismiss()).toBeNull();
  });

  test("successful save never announces cancellation on unmount", () => {
    const state = new FoodLoggerDismissal();
    state.markSaved();
    expect(state.dismiss()).toBeNull();
  });
});
