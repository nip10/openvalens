import { describe, expect, test } from "bun:test";

import { InMemoryRateLimiter } from "./rate-limit";

describe("InMemoryRateLimiter", () => {
  test("allows up to the limit then denies with retryAfterMs", () => {
    let now = 1_000;
    const limiter = new InMemoryRateLimiter({ limitPerMinute: 3, now: () => now });

    expect(limiter.check("u:o").allowed).toBe(true);
    expect(limiter.check("u:o").allowed).toBe(true);
    expect(limiter.check("u:o").allowed).toBe(true);

    const denied = limiter.check("u:o");
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBe(60_000);
  });

  test("isolates keys", () => {
    const limiter = new InMemoryRateLimiter({ limitPerMinute: 1, now: () => 1_000 });

    expect(limiter.check("user-a:org").allowed).toBe(true);
    expect(limiter.check("user-a:org").allowed).toBe(false);
    expect(limiter.check("user-b:org").allowed).toBe(true);
  });

  test("slides the window forward", () => {
    let now = 1_000;
    const limiter = new InMemoryRateLimiter({ limitPerMinute: 1, now: () => now });

    expect(limiter.check("k").allowed).toBe(true);
    expect(limiter.check("k").allowed).toBe(false);

    now += 60_001;
    expect(limiter.check("k").allowed).toBe(true);
  });

  test("does not record denied hits (no self-extending lockout)", () => {
    let now = 1_000;
    const limiter = new InMemoryRateLimiter({ limitPerMinute: 2, now: () => now });

    limiter.check("k");
    limiter.check("k");
    // Spam denied attempts; the original window must still expire on schedule.
    for (let i = 0; i < 10; i += 1) limiter.check("k");

    now += 60_001;
    const decision = limiter.check("k");
    expect(decision.allowed).toBe(true);
  });

  test("reset clears a key", () => {
    const limiter = new InMemoryRateLimiter({ limitPerMinute: 1, now: () => 1_000 });
    limiter.check("k");
    expect(limiter.check("k").allowed).toBe(false);
    limiter.reset("k");
    expect(limiter.check("k").allowed).toBe(true);
  });

  test("rejects a non-positive limit", () => {
    expect(() => new InMemoryRateLimiter({ limitPerMinute: 0 })).toThrow();
  });
});
