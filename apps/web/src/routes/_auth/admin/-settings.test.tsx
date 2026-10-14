import "@/testing/varlock-test-setup";

import { describe, expect, test } from "bun:test";

import { createOwnerEpoch } from "./settings";

describe("createOwnerEpoch", () => {
  test("rejects a stale response after an A→B→A principal transition", () => {
    const epoch = createOwnerEpoch();
    const generationA1 = epoch.capture();

    // Principal changes to B, then back to A.
    epoch.advance();
    epoch.advance();

    const generationA2 = epoch.capture();

    expect(epoch.isLive(generationA1)).toBe(false);
    expect(epoch.isLive(generationA2)).toBe(true);
  });

  test("rejects a response captured before unmount", () => {
    const epoch = createOwnerEpoch();
    const generation = epoch.capture();

    epoch.advance();

    expect(epoch.isLive(generation)).toBe(false);
  });

  test("accepts a response captured in the current generation", () => {
    const epoch = createOwnerEpoch();
    epoch.advance();
    const generation = epoch.capture();

    expect(epoch.isLive(generation)).toBe(true);
  });
});
