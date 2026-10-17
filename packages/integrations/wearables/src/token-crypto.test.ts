import { describe, expect, test } from "bun:test";

import {
  deriveWearableTokenKey,
  openToken,
  sealToken,
  WearableTokenUnreadableError,
} from "./token-crypto";

const key = deriveWearableTokenKey("synthetic-better-auth-secret-0123456789abcdef");
const binding = {
  organizationId: "org-a",
  providerConnectionId: 7,
  field: "access_token",
} as const;

describe("wearable token crypto (Issue #60)", () => {
  test("round-trips and never stores the plaintext", () => {
    const sealed = sealToken(key, "synthetic-access-token", binding);
    expect(sealed).toStartWith("v1.");
    expect(sealed).not.toContain("synthetic-access-token");
    expect(openToken(key, sealed, binding)).toBe("synthetic-access-token");
    // Fresh IV each time.
    expect(sealToken(key, "synthetic-access-token", binding)).not.toBe(sealed);
  });

  test("a ciphertext is bound to its workspace, connection and field", () => {
    const sealed = sealToken(key, "synthetic-access-token", binding);
    for (const other of [
      { ...binding, organizationId: "org-b" },
      { ...binding, providerConnectionId: 8 },
      { ...binding, field: "refresh_token" as const },
    ])
      expect(() => openToken(key, sealed, other)).toThrow(WearableTokenUnreadableError);
  });

  test("a rotated server secret or tampering makes the token unreadable", () => {
    const sealed = sealToken(key, "synthetic-access-token", binding);
    const otherKey = deriveWearableTokenKey("another-synthetic-secret-0123456789abcdef");
    expect(() => openToken(otherKey, sealed, binding)).toThrow(WearableTokenUnreadableError);
    const parts = sealed.split(".");
    parts[2] = `${parts[2]!.startsWith("A") ? "B" : "A"}${parts[2]!.slice(1)}`;
    expect(() => openToken(key, parts.join("."), binding)).toThrow(WearableTokenUnreadableError);
    expect(() => openToken(key, "garbage", binding)).toThrow(WearableTokenUnreadableError);
    expect(() => deriveWearableTokenKey("short")).toThrow(TypeError);
  });
});
