import { describe, expect, test } from "bun:test";

import { validateReturnUrl } from "./return-url";

describe("validateReturnUrl", () => {
  // Simulate same-web-origin base for the URL constructor.
  const origin = "https://app.openvalens.test";
  (globalThis as { window?: { location: { origin: string } } }).window = {
    location: { origin },
  };

  function v(raw: unknown, expectedInvitationId?: string) {
    return validateReturnUrl(raw, expectedInvitationId);
  }

  test("allows same-origin /setup and /join", () => {
    expect(v(`${origin}/setup`)).toBe("/setup");
    expect(v(`${origin}/join`)).toBe("/join");
  });

  test("allows same-origin /accept-invitation/<opaqueId>", () => {
    expect(v(`${origin}/accept-invitation/inv_123`)).toBe("/accept-invitation/inv_123");
  });

  test("allows relative invitation path", () => {
    expect(v("/accept-invitation/inv_123")).toBe("/accept-invitation/inv_123");
  });

  test("allows expected invitation id only when supplied", () => {
    expect(v(`${origin}/accept-invitation/inv_123`, "inv_123")).toBe("/accept-invitation/inv_123");
    expect(v(`${origin}/accept-invitation/inv_999`, "inv_123")).toBeNull();
  });

  test("rejects external origins", () => {
    expect(v("https://evil.com/setup")).toBeNull();
    expect(v("//evil.com/setup")).toBeNull();
  });

  test("rejects protocol-relative and backslash paths", () => {
    expect(v("//app.openvalens.test/setup")).toBeNull();
    expect(v(`${origin}\\evil.com`)).toBeNull();
    expect(v("/accept-invitation/inv_123\\../dashboard")).toBeNull();
  });

  test("rejects query, hash, and double-encoded fragments", () => {
    expect(v(`${origin}/setup?token=secret`)).toBeNull();
    expect(v(`${origin}/setup#section`)).toBeNull();
    expect(v(`${origin}/setup%3Ftoken=secret`)).toBeNull();
  });

  test("rejects path traversal and control characters", () => {
    expect(v(`${origin}/setup/../dashboard`)).toBeNull();
    expect(v(`${origin}/setup/..`)).toBeNull();
    expect(v(`${origin}/setup\x00`)).toBeNull();
  });

  test("rejects malformed and non-string input", () => {
    expect(v("not a url")).toBeNull();
    expect(v("")).toBeNull();
    expect(v(null)).toBeNull();
    expect(v(123)).toBeNull();
  });

  test("never admits arbitrary paths", () => {
    expect(v(`${origin}/dashboard`)).toBeNull();
    expect(v(`${origin}/admin/invitations`)).toBeNull();
    expect(v(`${origin}/accept-invitation/`)).toBeNull();
  });
});
