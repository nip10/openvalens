import { describe, expect, test } from "bun:test";

import {
  isSessionLive,
  requireTrustedIdentity,
  resolveSessionIdentity,
  toDate,
} from "./trusted-session";

/**
 * Issue #58 — reusable trusted-session helper unit suite. Pure, no database.
 */

const LIVE = new Date(Date.now() + 60 * 60 * 1000);

function session(overrides: Record<string, unknown> = {}): unknown {
  return {
    user: { id: "user-1", email: "user@example.test", name: null },
    session: { id: "sess-1", userId: "user-1", impersonatedBy: null, expiresAt: LIVE },
    ...overrides,
  };
}

describe("trusted-session helpers", () => {
  test("toDate coerces values and rejects an invalid Date", () => {
    expect(toDate(new Date("2026-01-01T00:00:00.000Z"))?.toISOString()).toBe(
      "2026-01-01T00:00:00.000Z",
    );
    expect(toDate("2026-01-01T00:00:00.000Z")?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(toDate(new Date(Number.NaN))).toBeNull();
    expect(toDate(undefined)).toBeNull();
    expect(toDate({})).toBeNull();
  });

  test("resolveSessionIdentity returns null without a usable user id", () => {
    expect(resolveSessionIdentity(null)).toBeNull();
    expect(resolveSessionIdentity({})).toBeNull();
    expect(resolveSessionIdentity({ user: {} })).toBeNull();
    expect(resolveSessionIdentity({ user: { id: "" } })).toBeNull();
  });

  test("resolveSessionIdentity extracts id, impersonation and expiry", () => {
    expect(resolveSessionIdentity(session())).toEqual({
      userId: "user-1",
      sessionId: "sess-1",
      impersonated: false,
      expiresAt: LIVE,
    });
  });

  test("resolveSessionIdentity tolerates a missing session id", () => {
    expect(resolveSessionIdentity(session({ session: { userId: "user-1" } }))).toEqual({
      userId: "user-1",
      sessionId: null,
      impersonated: false,
      expiresAt: null,
    });
  });

  test("requireTrustedIdentity accepts a live non-impersonated session", () => {
    expect(requireTrustedIdentity(session())).toEqual({
      userId: "user-1",
      sessionId: "sess-1",
      expiresAt: LIVE,
    });
  });

  test("requireTrustedIdentity rejects missing, impersonated and malformed sessions", () => {
    expect(() => requireTrustedIdentity(null)).toThrow();
    expect(() => requireTrustedIdentity(session({ user: {} }))).toThrow();
    expect(() =>
      requireTrustedIdentity(
        session({ session: { id: "s", userId: "user-1", impersonatedBy: "admin-1" } }),
      ),
    ).toThrow();
    expect(() =>
      requireTrustedIdentity(session({ session: { id: "s", userId: "user-1", expiresAt: null } })),
    ).toThrow();
    expect(() =>
      requireTrustedIdentity(
        session({ session: { id: "s", userId: "user-1", expiresAt: new Date(Number.NaN) } }),
      ),
    ).toThrow();
  });

  test("isSessionLive only accepts a finite expiry strictly after now", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    expect(isSessionLive({ expiresAt: new Date("2026-01-01T00:00:01.000Z") }, now)).toBe(true);
    expect(isSessionLive({ expiresAt: now }, now)).toBe(false);
    expect(isSessionLive({ expiresAt: new Date("2025-12-31T23:59:59.000Z") }, now)).toBe(false);
    expect(isSessionLive({ expiresAt: new Date(Number.NaN) }, now)).toBe(false);
  });
});
