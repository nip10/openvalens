import { describe, expect, test } from "bun:test";

import { isFreshSession, REAUTH_WINDOW_MS } from "./policy";

describe("isFreshSession", () => {
  const now = new Date("2026-10-04T12:00:00.000Z");
  test("fresh within the window, stale after it", () => {
    expect(isFreshSession(new Date(now.getTime() - 60_000), now)).toBe(true);
    expect(isFreshSession(new Date(now.getTime() - REAUTH_WINDOW_MS), now)).toBe(true);
    expect(isFreshSession(new Date(now.getTime() - REAUTH_WINDOW_MS - 1), now)).toBe(false);
  });
  test("a session dated in the future is not trusted", () => {
    expect(isFreshSession(new Date(now.getTime() + 60_000), now)).toBe(false);
  });
});
