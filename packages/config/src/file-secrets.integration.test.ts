import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";
import { internal } from "varlock";
import { FILE_SECRET_KEYS } from "./file-secrets";
import { safeVarlockErrorMessage, VARLOCK_LOAD_ERROR_DOCS_LINK } from "./varlock-safe-error";

const serverSchemaPath = fileURLToPath(
  new URL("../../../apps/server/.env.schema", import.meta.url),
);
const envServerUrl = new URL("../../../apps/server/src/env.server.ts", import.meta.url).href;

/** Synthetic `*_FILE` contents. Never real credentials. */
const SYNTHETIC_SECRETS: Record<string, string> = {
  BETTER_AUTH_SECRET: "a".repeat(64),
  BETTER_AUTH_URL: "https://api.example.invalid",
  CORS_ORIGIN: "https://web.example.invalid",
  DATABASE_URL: "postgresql://file_user:file_pass@file-db.invalid:5432/file_db",
  CRON_SECRET: "b".repeat(32),
  TELEGRAM_WEBHOOK_SECRET: "c".repeat(32),
  RESEND_API_KEY: "synthetic-resend-key",
  EMAIL_AUDIT_BCC: "audit@example.com",
  TELEGRAM_BOT_TOKEN: "123456:synthetic-telegram-token",
  AI_API_KEY: "synthetic-ai-provider-key",
  ANTHROPIC_API_KEY: "sk-ant-synthetic",
  STORAGE_S3_ACCESS_KEY_ID: "synthetic-storage-access-key",
  STORAGE_S3_SECRET_ACCESS_KEY: "synthetic-storage-secret-key",
};

const REQUIRED_SECRET_KEYS = [
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "CORS_ORIGIN",
  "DATABASE_URL",
  "CRON_SECRET",
  "TELEGRAM_WEBHOOK_SECRET",
] as const;

type ChildResult = { code: number; stdout: string; stderr: string; output: string };

async function runEnvServerChild(
  schemaDir: string,
  env: Record<string, string>,
): Promise<ChildResult> {
  const code = [
    `const mod = await import(${JSON.stringify(envServerUrl)});`,
    "const e = mod.ENV;",
    "process.stdout.write(JSON.stringify({",
    `  auth: e.BETTER_AUTH_SECRET.length === ${SYNTHETIC_SECRETS.BETTER_AUTH_SECRET!.length},`,
    `  authUrl: e.BETTER_AUTH_URL === ${JSON.stringify(SYNTHETIC_SECRETS.BETTER_AUTH_URL)},`,
    `  cors: e.CORS_ORIGIN === ${JSON.stringify(SYNTHETIC_SECRETS.CORS_ORIGIN)},`,
    `  db: e.DATABASE_URL === ${JSON.stringify(SYNTHETIC_SECRETS.DATABASE_URL)},`,
    `  cron: e.CRON_SECRET.length === ${SYNTHETIC_SECRETS.CRON_SECRET!.length},`,
    `  webhook: e.TELEGRAM_WEBHOOK_SECRET.length === ${SYNTHETIC_SECRETS.TELEGRAM_WEBHOOK_SECRET!.length},`,
    `  resend: e.RESEND_API_KEY === ${JSON.stringify(SYNTHETIC_SECRETS.RESEND_API_KEY)},`,
    `  auditBcc: e.EMAIL_AUDIT_BCC === ${JSON.stringify(SYNTHETIC_SECRETS.EMAIL_AUDIT_BCC)},`,
    `  telegram: e.TELEGRAM_BOT_TOKEN === ${JSON.stringify(SYNTHETIC_SECRETS.TELEGRAM_BOT_TOKEN)},`,
    `  aiKey: e.AI_API_KEY === ${JSON.stringify(SYNTHETIC_SECRETS.AI_API_KEY)},`,
    `  anthropic: e.ANTHROPIC_API_KEY === ${JSON.stringify(SYNTHETIC_SECRETS.ANTHROPIC_API_KEY)},`,
    `  storageKeyId: e.STORAGE_S3_ACCESS_KEY_ID === ${JSON.stringify(SYNTHETIC_SECRETS.STORAGE_S3_ACCESS_KEY_ID)},`,
    `  storageSecret: e.STORAGE_S3_SECRET_ACCESS_KEY === ${JSON.stringify(SYNTHETIC_SECRETS.STORAGE_S3_SECRET_ACCESS_KEY)},`,
    "  resendAbsent: e.RESEND_API_KEY == null,",
    "}));",
  ].join("\n");

  const child = Bun.spawnSync({
    cmd: ["bun", "-e", code],
    cwd: schemaDir,
    stdout: "pipe",
    stderr: "pipe",
    env,
  });
  const stdout = child.stdout.toString();
  const stderr = child.stderr.toString();
  return { code: child.exitCode ?? -1, stdout, stderr, output: `${stdout}\n${stderr}` };
}

async function withSchemaFixture(
  run: (
    dir: string,
    writeSecrets: (keys?: readonly string[]) => Promise<Record<string, string>>,
  ) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "file-secrets-integration-"));
  try {
    // Copy the actual server schema into an isolated directory so no real `.env`
    // or user credential file can be read.
    const schema = await readFile(serverSchemaPath, "utf8");
    await writeFile(join(dir, ".env.schema"), schema);

    const writeSecrets = async (keys: readonly string[] = FILE_SECRET_KEYS) => {
      const env: Record<string, string> = {};
      for (const key of keys) {
        const file = join(dir, `${key}.secret`);
        await writeFile(file, `${SYNTHETIC_SECRETS[key]!}\n`);
        env[`${key}_FILE`] = file;
      }
      return env;
    };

    await run(dir, writeSecrets);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function controlledEnv(
  extra: Record<string, string> = {},
  options: { throwFlag?: boolean } = {},
): Record<string, string> {
  // Explicit whitelist: never inherit user `*_FILE`, `__VARLOCK_ENV`, or keys.
  return {
    PATH: process.env.PATH ?? "",
    ...(options.throwFlag === false ? {} : { _VARLOCK_THROW_ON_LOAD_ERROR: "1" }),
    NODE_ENV: "development",
    EMAIL_FROM: "Smoke <smoke@example.invalid>",
    ...extra,
  };
}

describe("file secrets boot ordering (real Varlock cold start)", () => {
  test("resolves all ten sensitive keys from *_FILE before Varlock validates", async () => {
    await withSchemaFixture(async (dir, writeSecrets) => {
      const result = await runEnvServerChild(dir, controlledEnv(await writeSecrets()));
      expect(result.output).not.toContain(dir);
      expect(result.code).toBe(0);
      const flags = JSON.parse(result.stdout) as Record<string, boolean>;
      for (const key of [
        "auth",
        "authUrl",
        "cors",
        "db",
        "cron",
        "webhook",
        "resend",
        "auditBcc",
        "telegram",
        "aiKey",
        "anthropic",
        "storageKeyId",
        "storageSecret",
      ]) {
        expect(flags[key]).toBe(true);
      }
      // No raw synthetic value or file path leaked to stdout.
      for (const value of Object.values(SYNTHETIC_SECRETS)) {
        expect(result.stdout).not.toContain(value);
      }
    });
  });

  test("ignores absent optional *_FILE and unrelated provider files", async () => {
    await withSchemaFixture(async (dir, writeSecrets) => {
      const requiredOnly = await writeSecrets(REQUIRED_SECRET_KEYS);
      const result = await runEnvServerChild(dir, controlledEnv(requiredOnly));
      expect(result.code).toBe(0);
      const flags = JSON.parse(result.stdout) as Record<string, boolean>;
      expect(flags.auth).toBe(true);
      expect(flags.db).toBe(true);
      expect(flags.resendAbsent).toBe(true);
    });
  });

  test("leaves direct-value boot behavior unchanged when no *_FILE is provided", async () => {
    await withSchemaFixture(async (dir) => {
      const direct: Record<string, string> = {};
      for (const key of REQUIRED_SECRET_KEYS) direct[key] = SYNTHETIC_SECRETS[key]!;
      const result = await runEnvServerChild(dir, controlledEnv(direct));
      expect(result.code).toBe(0);
      const flags = JSON.parse(result.stdout) as Record<string, boolean>;
      expect(flags.auth).toBe(true);
      expect(flags.db).toBe(true);
    });
  });

  test("fails closed on an ambiguous direct + *_FILE value without echoing either", async () => {
    await withSchemaFixture(async (dir, writeSecrets) => {
      const fileEnv = await writeSecrets(["RESEND_API_KEY"]);
      const result = await runEnvServerChild(
        dir,
        controlledEnv({ ...fileEnv, RESEND_API_KEY: "direct-canary-value" }),
      );
      expect(result.code).not.toBe(0);
      expect(result.output).toContain("RESEND_API_KEY");
      expect(result.output).not.toContain("direct-canary-value");
      expect(result.output).not.toContain(fileEnv.RESEND_API_KEY_FILE!);
    });
  });
});

describe("actual server schema sensitive coverage", () => {
  test("the file-resolved key set matches every sensitive-by-default schema key", async () => {
    const dir = await mkdtemp(join(tmpdir(), "file-secrets-schema-"));
    try {
      const schema = await readFile(serverSchemaPath, "utf8");
      await writeFile(join(dir, ".env.schema"), schema);
      const graph = await internal.loadEnvGraph({
        entryFilePaths: [join(dir, ".env.schema")],
        basePath: dir,
        processEnvOverride: { NODE_ENV: "test" },
        skipCache: true,
        checkGitIgnored: false,
      });

      type Decorated = {
        parsedDecorators?: Array<{ name?: string; value?: { value?: unknown } }>;
      };
      // `configSchema` resolves sensitivity lazily; the explicit decorators live
      // on the root data source's item definitions.
      const schemaItems = (
        graph.rootDataSource as unknown as { configItemDefs: Record<string, Decorated> }
      ).configItemDefs;
      const decoratorValue = (item: Decorated, name: string): unknown =>
        item.parsedDecorators?.find((decorator) => decorator.name === name)?.value?.value;

      const sensitiveByDefault: string[] = [];
      const explicitlyPublic: string[] = [];
      for (const [key, item] of Object.entries(schemaItems)) {
        const explicitSensitive = decoratorValue(item, "sensitive");
        const isPublic = decoratorValue(item, "public") === true;
        if (isPublic || explicitSensitive === false) {
          explicitlyPublic.push(key);
        } else {
          sensitiveByDefault.push(key);
        }
      }

      expect([...sensitiveByDefault].sort()).toEqual([...FILE_SECRET_KEYS].sort());
      // The schema keys that must NOT be file-resolved.
      expect([...explicitlyPublic].sort()).toEqual(
        [
          "AI_BASE_URL",
          "AI_MODEL",
          "AI_PROVIDER",
          "AI_RATE_LIMIT_PER_MINUTE",
          "AI_SUPPORTS_STRUCTURED_OUTPUTS",
          "ANALYTICS_ENABLED",
          "API_MAX_BODY_BYTES",
          "APPLE_APP_BUNDLE_ID",
          "APPLE_CLIENT_ID",
          "APPLE_KEY_ID",
          "APPLE_TEAM_ID",
          "AUTH_DEV_MAGIC_LINK_CONSOLE",
          "CSP_MODE",
          "DEPLOYMENT_MODE",
          "EMAIL_DRY_RUN",
          "EMAIL_FROM",
          "EMAIL_REPLY_TO",
          "EXERCISE_CATALOG_ASSETS_ENABLED",
          "FOOD_LOOKUP_BASE_URL",
          "FOOD_LOOKUP_PROVIDER",
          "FOOD_LOOKUP_USER_AGENT",
          "GOOGLE_CLIENT_ID",
          "LEGAL_PRIVACY_URL",
          "LEGAL_PRIVACY_VERSION",
          "LEGAL_TERMS_URL",
          "LEGAL_TERMS_VERSION",
          "NODE_ENV",
          "OIDC_CLIENT_ID",
          "OIDC_DISCOVERY_URL",
          "OIDC_DISPLAY_NAME",
          "OIDC_PROVIDER_ID",
          "POSTHOG_IP_CAPTURE_DISABLED",
          "PUSH_PROVIDER",
          "SENTRY_DSN",
          "SENTRY_ENVIRONMENT",
          "SENTRY_RELEASE",
          "SOURCE_CODE_URL",
          "STORAGE_LOCAL_DIR",
          "STORAGE_MAX_OBJECT_BYTES",
          "STORAGE_PROVIDER",
          "STORAGE_S3_BUCKET",
          "STORAGE_S3_ENDPOINT",
          "STORAGE_S3_FORCE_PATH_STYLE",
          "STORAGE_S3_REGION",
          "STORAGE_S3_SSE",
          "STORAGE_SIGNED_URL_TTL_SECONDS",
          "TELEGRAM_API_BASE_URL",
          "TELEGRAM_CONNECT_TOKEN_TTL_SECONDS",
          "WEARABLES_WEBHOOKS",
          "WEARABLES_OURA_CLIENT_ID",
          "WEARABLES_WHOOP_CLIENT_ID",
          "WEARABLES_POLAR_CLIENT_ID",
          "WEARABLES_WITHINGS_CLIENT_ID",
          "WEARABLES_GOOGLE_HEALTH_ENABLED",
          "WEARABLES_GOOGLE_HEALTH_CLIENT_ID",
        ].sort(),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

const REVIEW_CANARY = "SYNTHETIC-INVALID-URL-REVIEW-CANARY";
const RAW_JSON_MARKERS = ["isSensitive", "basePath", "overrideKeys", "json-full"];

async function runEnvServerImportRaw(
  schemaDir: string,
  env: Record<string, string>,
): Promise<ChildResult> {
  const child = Bun.spawnSync({
    cmd: ["bun", "-e", `await import(${JSON.stringify(envServerUrl)});`],
    cwd: schemaDir,
    stdout: "pipe",
    stderr: "pipe",
    env,
  });
  const stdout = child.stdout.toString();
  const stderr = child.stderr.toString();
  return { code: child.exitCode ?? -1, stdout, stderr, output: `${stdout}\n${stderr}` };
}

describe("Varlock load-error boundary never prints raw resolved values", () => {
  test("invalid BETTER_AUTH_URL_FILE leaks no raw value/JSON with _VARLOCK_THROW_ON_LOAD_ERROR", async () => {
    await withSchemaFixture(async (dir, writeSecrets) => {
      const required = await writeSecrets(REQUIRED_SECRET_KEYS);
      const badUrl = join(dir, "bad-url.secret");
      await writeFile(badUrl, `${REVIEW_CANARY}\n`);

      const result = await runEnvServerImportRaw(dir, {
        ...controlledEnv(required),
        BETTER_AUTH_URL_FILE: badUrl,
      });

      expect(result.code).not.toBe(0);
      expect(result.output).toContain("BETTER_AUTH_URL");
      expect(result.output).toContain("CONTRIBUTING.md#file-based-secrets");
      expect(result.output).not.toContain(REVIEW_CANARY);
      expect(result.output).not.toContain(badUrl);
      for (const marker of RAW_JSON_MARKERS) expect(result.output).not.toContain(marker);
    });
  });

  test("invalid BETTER_AUTH_URL_FILE leaks no raw value in the default (no throw flag) mode", async () => {
    await withSchemaFixture(async (dir, writeSecrets) => {
      const required = await writeSecrets(REQUIRED_SECRET_KEYS);
      const badUrl = join(dir, "bad-url-default.secret");
      await writeFile(badUrl, `${REVIEW_CANARY}\n`);

      const env = {
        ...controlledEnv(required, { throwFlag: false }),
        BETTER_AUTH_URL_FILE: badUrl,
      };

      const result = await runEnvServerImportRaw(dir, env);

      expect(result.code).not.toBe(0);
      expect(result.output).toContain("BETTER_AUTH_URL");
      expect(result.output).not.toContain(REVIEW_CANARY);
      for (const marker of RAW_JSON_MARKERS) expect(result.output).not.toContain(marker);
    });
  });

  test("invalid EMAIL_AUDIT_BCC_FILE leaks no raw value/JSON with _VARLOCK_THROW_ON_LOAD_ERROR", async () => {
    await withSchemaFixture(async (dir, writeSecrets) => {
      const required = await writeSecrets(REQUIRED_SECRET_KEYS);
      const badEmail = join(dir, "bad-email.secret");
      await writeFile(badEmail, `not-an-email-${REVIEW_CANARY}\n`);

      const result = await runEnvServerImportRaw(dir, {
        ...controlledEnv(required),
        EMAIL_AUDIT_BCC_FILE: badEmail,
      });

      expect(result.code).not.toBe(0);
      expect(result.output).toContain("EMAIL_AUDIT_BCC");
      expect(result.output).toContain("CONTRIBUTING.md#file-based-secrets");
      expect(result.output).not.toContain(REVIEW_CANARY);
      expect(result.output).not.toContain(badEmail);
      for (const marker of RAW_JSON_MARKERS) expect(result.output).not.toContain(marker);
    });
  });

  test("invalid direct value (no *_FILE) leaks no raw value/JSON with the throw flag", async () => {
    await withSchemaFixture(async (dir, writeSecrets) => {
      const required = await writeSecrets(
        REQUIRED_SECRET_KEYS.filter((key) => key !== "BETTER_AUTH_URL"),
      );

      const result = await runEnvServerImportRaw(dir, {
        ...controlledEnv(required),
        BETTER_AUTH_URL: REVIEW_CANARY,
      });

      expect(result.code).not.toBe(0);
      expect(result.output).toContain("BETTER_AUTH_URL");
      expect(result.output).toContain("CONTRIBUTING.md#file-based-secrets");
      expect(result.output).not.toContain(REVIEW_CANARY);
      for (const marker of RAW_JSON_MARKERS) expect(result.output).not.toContain(marker);
    });
  });

  test("NUL in BETTER_AUTH_URL_FILE is rejected before boot without leaking contents (throw flag)", async () => {
    await withSchemaFixture(async (dir, writeSecrets) => {
      const required = await writeSecrets(REQUIRED_SECRET_KEYS);
      const nulFile = join(dir, "nul-url.secret");
      await writeFile(nulFile, Buffer.from(`https://app.example.invalid\u0000${REVIEW_CANARY}`));

      const result = await runEnvServerImportRaw(dir, {
        ...controlledEnv(required),
        BETTER_AUTH_URL_FILE: nulFile,
      });

      expect(result.code).not.toBe(0);
      expect(result.output).toContain("BETTER_AUTH_URL");
      expect(result.output).toContain("CONTRIBUTING.md#file-based-secrets");
      expect(result.output).not.toContain(REVIEW_CANARY);
      expect(result.output).not.toContain(nulFile);
      expect(result.output).not.toContain("Started server");
      for (const marker of RAW_JSON_MARKERS) expect(result.output).not.toContain(marker);
    });
  });

  test("NUL in BETTER_AUTH_URL_FILE is rejected before boot in the default (no throw flag) mode", async () => {
    await withSchemaFixture(async (dir, writeSecrets) => {
      const required = await writeSecrets(REQUIRED_SECRET_KEYS);
      const nulFile = join(dir, "nul-url-default.secret");
      await writeFile(nulFile, Buffer.from(`https://app.example.invalid\u0000${REVIEW_CANARY}`));

      const result = await runEnvServerImportRaw(dir, {
        ...controlledEnv(required, { throwFlag: false }),
        BETTER_AUTH_URL_FILE: nulFile,
      });

      expect(result.code).not.toBe(0);
      expect(result.output).toContain("BETTER_AUTH_URL");
      expect(result.output).toContain("CONTRIBUTING.md#file-based-secrets");
      expect(result.output).not.toContain(REVIEW_CANARY);
      expect(result.output).not.toContain(nulFile);
      expect(result.output).not.toContain("Started server");
      for (const marker of RAW_JSON_MARKERS) expect(result.output).not.toContain(marker);
    });
  });
});

describe("safeVarlockErrorMessage", () => {
  test("names allowlisted keys from masked stderr and drops unknown names/values", () => {
    const masked =
      "🚨 Configuration is currently invalid\n❌ BETTER_AUTH_URL*  🔐sensitive\n   └ SY▒▒▒▒▒  🟡 process.env\n   - Invalid URL\n";
    const message = safeVarlockErrorMessage(masked);
    expect(message).toContain("BETTER_AUTH_URL");
    expect(message).toContain(VARLOCK_LOAD_ERROR_DOCS_LINK);
    expect(message).not.toContain("SY");

    // Unknown identifiers and values are never echoed.
    const unknown = safeVarlockErrorMessage("SOMETHING_ELSE=super-secret-value");
    expect(unknown).not.toContain("SOMETHING_ELSE");
    expect(unknown).not.toContain("super-secret-value");
    expect(unknown).toContain(VARLOCK_LOAD_ERROR_DOCS_LINK);
  });
});
