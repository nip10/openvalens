import { describe, expect, test } from "bun:test";
import { ParsedEnvSpecStaticValue, parseEnvSpecDotEnvFile } from "@env-spec/parser";
import { FILE_SECRET_KEYS } from "@openvalens/config/file-secrets";

import { ADMIN_CONFIG_KEYS, buildAdminConfigInventory } from "./admin-config-inventory";

const SCHEMA_URL = new URL("../.env.schema", import.meta.url);

function readBoolean(value: unknown, fallback: boolean): boolean {
  return value instanceof ParsedEnvSpecStaticValue && typeof value.value === "boolean"
    ? value.value
    : fallback;
}

/** Resolves `key -> sensitive` from the committed server schema (pure parse). */
async function schemaSensitivity(): Promise<Map<string, boolean>> {
  const text = await Bun.file(SCHEMA_URL).text();
  const file = parseEnvSpecDotEnvFile(text);
  const header = file.decoratorsObject ?? {};
  const defaultSensitive = readBoolean(header.defaultSensitive?.value, true);

  const result = new Map<string, boolean>();
  for (const item of file.configItems) {
    const decorators = item.decoratorsObject ?? {};
    let sensitive = defaultSensitive;
    if (decorators.public) {
      sensitive = !readBoolean(decorators.public.value, true);
    } else if (decorators.sensitive) {
      sensitive = readBoolean(decorators.sensitive.value, true);
    }
    result.set(item.key, sensitive);
  }
  return result;
}

describe("buildAdminConfigInventory", () => {
  test("returns all 65 allowlisted keys in schema order", () => {
    const entries = buildAdminConfigInventory({});
    expect(entries).toHaveLength(65);
    expect(entries.map((entry) => entry.key)).toEqual([...ADMIN_CONFIG_KEYS]);
  });

  test("every entry carries exactly key/configured/sensitive", () => {
    const entries = buildAdminConfigInventory({});
    for (const entry of entries) {
      expect(Object.keys(entry).sort()).toEqual(["configured", "key", "sensitive"]);
      expect(typeof entry.key).toBe("string");
      expect(typeof entry.configured).toBe("boolean");
      expect(typeof entry.sensitive).toBe("boolean");
    }
  });

  test("marks unset optional keys as configured:false", () => {
    const entries = buildAdminConfigInventory({ NODE_ENV: "production" });
    const byKey = new Map(entries.map((entry) => [entry.key, entry]));
    for (const key of ["RESEND_API_KEY", "EMAIL_REPLY_TO", "ANTHROPIC_API_KEY", "AI_MODEL"]) {
      expect(byKey.get(key)?.configured).toBe(false);
    }
    expect(byKey.get("NODE_ENV")?.configured).toBe(true);
  });

  test("treats false and 0 as configured values", () => {
    const entries = buildAdminConfigInventory({
      EMAIL_DRY_RUN: false,
      AUTH_DEV_MAGIC_LINK_CONSOLE: false,
      AI_RATE_LIMIT_PER_MINUTE: 0,
    });
    const byKey = new Map(entries.map((entry) => [entry.key, entry]));
    expect(byKey.get("EMAIL_DRY_RUN")?.configured).toBe(true);
    expect(byKey.get("AUTH_DEV_MAGIC_LINK_CONSOLE")?.configured).toBe(true);
    expect(byKey.get("AI_RATE_LIMIT_PER_MINUTE")?.configured).toBe(true);
  });

  test("treats empty string, null and undefined as not configured", () => {
    const entries = buildAdminConfigInventory({
      BETTER_AUTH_URL: "",
      CORS_ORIGIN: null,
      DATABASE_URL: undefined,
    });
    const byKey = new Map(entries.map((entry) => [entry.key, entry]));
    expect(byKey.get("BETTER_AUTH_URL")?.configured).toBe(false);
    expect(byKey.get("CORS_ORIGIN")?.configured).toBe(false);
    expect(byKey.get("DATABASE_URL")?.configured).toBe(false);
  });

  test("ignores extra environment properties and never enumerates the env", () => {
    const env = { NODE_ENV: "test", TOTALLY_EXTRA: "ignored", ANOTHER: 1 };
    const entries = buildAdminConfigInventory(env);
    expect(entries.map((entry) => entry.key)).toEqual([...ADMIN_CONFIG_KEYS]);
    expect(entries.map((entry) => entry.key)).not.toContain("TOTALLY_EXTRA");

    // A Proxy that throws on any enumeration proves the helper only reads the
    // explicit allowlist keys, never `Object.keys`/spread of the environment.
    const guarded = new Proxy(
      { ...env },
      {
        ownKeys() {
          throw new Error("environment enumeration is forbidden");
        },
        getOwnPropertyDescriptor() {
          throw new Error("environment enumeration is forbidden");
        },
      },
    );
    expect(() => buildAdminConfigInventory(guarded)).not.toThrow();
  });

  test("never serializes secret, URL or API-key values", () => {
    const canaries = {
      BETTER_AUTH_SECRET: "canary-better-auth-secret",
      BETTER_AUTH_URL: "canary-better-auth-url",
      CORS_ORIGIN: "canary-cors-origin",
      DATABASE_URL: "canary-database-url",
      CRON_SECRET: "canary-cron-secret",
      TELEGRAM_WEBHOOK_SECRET: "canary-telegram-webhook",
      RESEND_API_KEY: "canary-resend-api-key",
      EMAIL_AUDIT_BCC: "canary-audit-bcc",
      TELEGRAM_BOT_TOKEN: "canary-telegram-bot-token",
      ANTHROPIC_API_KEY: "canary-anthropic-api-key",
    };
    const entries = buildAdminConfigInventory(canaries);
    const serialized = JSON.stringify(entries);
    for (const canary of Object.values(canaries)) {
      expect(serialized).not.toContain(canary);
    }
  });

  test("classifies sensitivity from the shared FILE_SECRET_KEYS list", () => {
    const entries = buildAdminConfigInventory({});
    const sensitive = entries.filter((entry) => entry.sensitive).map((entry) => entry.key);
    expect(sensitive.sort()).toEqual([...FILE_SECRET_KEYS].sort());
    expect(sensitive).toHaveLength(21);
  });

  test("parity: keys and sensitivity match the committed server schema", async () => {
    const expected = await schemaSensitivity();
    expect([...expected.keys()]).toEqual([...ADMIN_CONFIG_KEYS]);

    const entries = buildAdminConfigInventory({});
    for (const entry of entries) {
      expect(expected.has(entry.key)).toBe(true);
      expect(entry.sensitive).toBe(expected.get(entry.key) ?? false);
    }
  });
});
