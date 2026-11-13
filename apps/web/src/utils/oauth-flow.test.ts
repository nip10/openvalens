import { describe, expect, test } from "bun:test";

import { authorizeParamsFrom, authorizeUrl, saveResume, takeResume } from "./oauth-flow";

function memoryStore() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

const SIGNED =
  "response_type=code&client_id=https%3A%2F%2Fclaude.ai%2Foauth%2Fmcp&redirect_uri=https%3A%2F%2Fclaude.ai%2Fcb&state=s1&scope=records%3Aread+offline_access&ov_scope=records%3Aread&resource=https%3A%2F%2Fov.test%2Fapi%2Fmcp&exp=1&ba_iat=2&ba_pl=sess&ba_param=client_id&ba_param=scope&sig=abc";

describe("OAuth flow helpers", () => {
  test("keeps the app's parameters and drops Better Auth's signature and bookkeeping", () => {
    const params = authorizeParamsFrom(SIGNED)!;
    expect(params.get("client_id")).toBe("https://claude.ai/oauth/mcp");
    expect(params.get("ov_scope")).toBe("records:read");
    for (const key of ["sig", "exp", "ba_iat", "ba_pl", "ba_param"])
      expect(params.has(key)).toBe(false);
    expect(authorizeUrl("https://ov.test/", params)).toStartWith(
      "https://ov.test/api/auth/oauth2/authorize?response_type=code&client_id=",
    );
  });

  test("refuses a query without a client or redirect URI", () => {
    expect(authorizeParamsFrom("client_id=x")).toBeNull();
    expect(authorizeParamsFrom("")).toBeNull();
  });

  test("resumes once, within 30 minutes", () => {
    const store = memoryStore();
    saveResume(authorizeParamsFrom(SIGNED)!, 1_000, store);
    expect(takeResume(1_000 + 60_000, store)?.get("state")).toBe("s1");
    expect(takeResume(1_000 + 60_000, store)).toBeNull();

    saveResume(authorizeParamsFrom(SIGNED)!, 1_000, store);
    expect(takeResume(1_000 + 31 * 60_000, store)).toBeNull();
  });
});
