import { describe, expect, test } from "bun:test";

import { describeMcpIntegration, parseMcpConfig } from "./config";
import {
  bearerToken,
  expiryFrom,
  generatePersonalKey,
  hashPersonalKey,
  isPersonalKeyFormat,
} from "./keys";
import { normalizeScopes, RESERVED_SCOPES, WRITE_SCOPES } from "./scopes";
import { parseAiAppsSetting } from "./settings";

describe("parseMcpConfig", () => {
  test("is off on a self-hosted server until MCP_ENABLED=true", () => {
    expect(parseMcpConfig({}).enabled).toBe(false);
    expect(parseMcpConfig({ DEPLOYMENT_MODE: "self-hosted" }).enabled).toBe(false);
    expect(parseMcpConfig({ DEPLOYMENT_MODE: "self-hosted", MCP_ENABLED: true }).enabled).toBe(
      true,
    );
    expect(parseMcpConfig({ MCP_ENABLED: "true" }).enabled).toBe(true);
  });

  test("is on in Cloud unless MCP_ENABLED=false", () => {
    expect(parseMcpConfig({ DEPLOYMENT_MODE: "cloud" }).enabled).toBe(true);
    expect(parseMcpConfig({ DEPLOYMENT_MODE: "cloud", MCP_ENABLED: false }).enabled).toBe(false);
    expect(parseMcpConfig({ DEPLOYMENT_MODE: "cloud", MCP_ENABLED: "false" }).enabled).toBe(false);
  });

  test("rate limits default to 60 per grant and 120 per member, and are env-configurable", () => {
    expect(parseMcpConfig({}).rateLimits).toEqual({
      perGrantPerMinute: 60,
      perMemberPerMinute: 120,
    });
    expect(
      parseMcpConfig({
        MCP_RATE_LIMIT_PER_GRANT_PER_MINUTE: 5,
        MCP_RATE_LIMIT_PER_MEMBER_PER_MINUTE: "7",
      }).rateLimits,
    ).toEqual({ perGrantPerMinute: 5, perMemberPerMinute: 7 });
    expect(
      parseMcpConfig({ MCP_RATE_LIMIT_PER_GRANT_PER_MINUTE: 0 }).rateLimits.perGrantPerMinute,
    ).toBe(60);
  });

  test("write limits default to 100 entries a call and 1,000 a day, and are env-configurable", () => {
    expect(parseMcpConfig({}).writeLimits).toEqual({ entriesPerCall: 100, entriesPerDay: 1000 });
    expect(
      parseMcpConfig({ MCP_WRITE_ENTRIES_PER_CALL: "5", MCP_WRITE_ENTRIES_PER_DAY: 12 })
        .writeLimits,
    ).toEqual({ entriesPerCall: 5, entriesPerDay: 12 });
    expect(parseMcpConfig({ MCP_WRITE_ENTRIES_PER_CALL: -1 }).writeLimits.entriesPerCall).toBe(100);
  });

  test("readiness status is value-free", () => {
    expect(describeMcpIntegration(parseMcpConfig({}))).toEqual({ provider: null, state: "off" });
    expect(describeMcpIntegration(parseMcpConfig({ MCP_ENABLED: true }))).toEqual({
      provider: "openvalens",
      state: "configured",
    });
  });
});

describe("personal keys", () => {
  test("have the ov_ prefix, 32 random bytes and a SHA-256 digest", () => {
    const generated = generatePersonalKey();
    expect(generated.key).toMatch(/^ov_[A-Za-z0-9_-]{43}$/);
    expect(isPersonalKeyFormat(generated.key)).toBe(true);
    expect(generated.hash).toBe(hashPersonalKey(generated.key));
    expect(generated.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(generated.hash).not.toContain(generated.key.slice(3));
    expect(generated.displayPrefix).toBe(generated.key.slice(0, 9));
    expect(generatePersonalKey().key).not.toBe(generated.key);
  });

  test("reads only the Bearer scheme", () => {
    expect(bearerToken("Bearer ov_abc")).toBe("ov_abc");
    expect(bearerToken("bearer  ov_abc ")).toBe("ov_abc");
    expect(bearerToken("Basic ov_abc")).toBeNull();
    expect(bearerToken(undefined)).toBeNull();
    expect(isPersonalKeyFormat("ov_short")).toBe(false);
  });

  test("expiry is 30, 90 or 365 days, or never", () => {
    const now = new Date("2026-11-12T00:00:00.000Z");
    expect(expiryFrom(now, 90)?.toISOString()).toBe("2027-02-10T00:00:00.000Z");
    expect(expiryFrom(now, null)).toBeNull();
  });
});

describe("scopes", () => {
  test("always include records:read and are sorted", () => {
    expect(normalizeScopes([])).toEqual({ ok: true, scopes: ["records:read"] });
    expect(normalizeScopes(["notes:read", "nutrition:read", "notes:read"])).toEqual({
      ok: true,
      scopes: ["notes:read", "nutrition:read", "records:read"],
    });
  });

  test("grant the M2 write scopes, which are opt-in", () => {
    expect(normalizeScopes([...WRITE_SCOPES])).toEqual({
      ok: true,
      scopes: [
        "body:write",
        "food:write",
        "labs:write",
        "pain:write",
        "records:read",
        "sleep:write",
        "supplements:write",
        "trackers:write",
        "vitals:write",
        "water:write",
        "workouts:write",
      ],
    });
    // Food and lab drafts (M2c) are grantable now: nothing is reserved.
    expect([...RESERVED_SCOPES]).toEqual([]);
    for (const scope of WRITE_SCOPES) expect(RESERVED_SCOPES).not.toContain(scope as never);
  });

  test("refuse reserved and unknown scopes instead of dropping them", () => {
    for (const reserved of RESERVED_SCOPES as readonly string[]) {
      expect(normalizeScopes([reserved]).ok).toBe(false);
    }
    expect(normalizeScopes(["cycle:read", "photos:read"])).toEqual({
      ok: false,
      invalid: ["cycle:read", "photos:read"],
    });
  });
});

describe("workspace setting", () => {
  test("is on by default and only an explicit false turns it off", () => {
    expect(parseAiAppsSetting(null).membersCanConnect).toBe(true);
    expect(parseAiAppsSetting({ aiConsent: false }).membersCanConnect).toBe(true);
    expect(parseAiAppsSetting({ aiApps: { membersCanConnect: false } }).membersCanConnect).toBe(
      false,
    );
    expect(
      parseAiAppsSetting(JSON.stringify({ aiApps: { membersCanConnect: false } }))
        .membersCanConnect,
    ).toBe(false);
  });
});
