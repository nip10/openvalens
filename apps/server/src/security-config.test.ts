import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, test } from "bun:test";

/**
 * Cold-boot coverage for the schema-validated security configuration (Issue #58
 * server env cleanup).
 *
 * Each case spawns an isolated Bun child in a private fixture that contains a
 * copy of the **actual** committed `apps/server/.env.schema` and a `src/`
 * directory for Varlock's auto-codegen. The child imports the real
 * `src/index.ts` default app and `src/services.ts`, issues a `GET /` through
 * Hono's `app.request` (no `listen`, no DB routes, no provider calls) and emits
 * one JSON line of header/capability facts. Required values are synthetic and
 * passed through a whitelisted child environment — the child never inherits the
 * ambient `process.env`, so no real credentials, `.env` files or provider keys
 * can leak in.
 */

const SRC_DIR = dirname(fileURLToPath(import.meta.url));
const INDEX_URL = pathToFileURL(join(SRC_DIR, "index.ts")).href;
const SERVICES_URL = pathToFileURL(join(SRC_DIR, "services.ts")).href;
const SERVER_SCHEMA_PATH = join(SRC_DIR, "..", ".env.schema");

const RESULT_MARKER = "SECURITY_CONFIG_RESULT ";

const CHILD_SCRIPT = `
const app = (await import(${JSON.stringify(INDEX_URL)})).default;
const services = await import(${JSON.stringify(SERVICES_URL)});
const response = await app.request("/");
const headers = response.headers;
const csp = headers.get("content-security-policy");
const cspReportOnly = headers.get("content-security-policy-report-only");
// Issue #57 — the public readiness probe over HTTP. The database is unroutable,
// so the status is "unready"; only the integration statuses are asserted.
const readinessResponse = await app.request("/rpc/health/readiness", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ json: {} }),
});
const readiness = await readinessResponse.json();
console.log(
  ${JSON.stringify(RESULT_MARKER)} +
    JSON.stringify({
      status: response.status,
      enforce: Boolean(csp),
      reportOnly: Boolean(cspReportOnly),
      csp: csp ?? cspReportOnly ?? "",
      reportTo: headers.get("report-to"),
      resend: services.capabilities.resend,
      integrations: services.integrations,
      readinessIntegrations: readiness?.json?.checks?.integrations ?? null,
    }),
);
`;

/** Synthetic, non-secret required values. Never a real credential. */
const BASE_ENV: Record<string, string> = {
  NODE_ENV: "development",
  BETTER_AUTH_SECRET: "synthetic-better-auth-secret-0123456789abcdef",
  BETTER_AUTH_URL: "http://localhost:3000",
  CORS_ORIGIN: "http://localhost:3000",
  // Unroutable on purpose: a lazy Pool may be created, but no query is issued.
  DATABASE_URL: "postgres://openvalens:openvalens@127.0.0.1:1/openvalens",
  CRON_SECRET: "synthetic-cron-secret-0123456789",
  EMAIL_FROM: "Health <noreply@health.example>",
  EMAIL_DRY_RUN: "true",
  AUTH_DEV_MAGIC_LINK_CONSOLE: "false",
  TELEGRAM_WEBHOOK_SECRET: "synthetic-telegram-webhook-secret",
};

type SecurityResult = {
  status: number;
  enforce: boolean;
  reportOnly: boolean;
  csp: string;
  reportTo: string | null;
  resend: boolean;
  integrations: Record<string, { provider: string | null; state: string }>;
  readinessIntegrations: Record<string, { provider: string | null; state: string }> | null;
};

type ColdRun = { exitCode: number | null; output: string; result?: SecurityResult };

/** Hard bound on a single cold child; the enclosing test timeout is larger. */
const CHILD_TIMEOUT_MS = 25_000;
const TEST_TIMEOUT_MS = 40_000;

async function runColdChild(extraEnv: Record<string, string>): Promise<ColdRun> {
  const fixtureDir = await mkdtemp(join(tmpdir(), "security-config-"));
  const homeDir = join(fixtureDir, "home");
  const xdgDir = join(fixtureDir, "xdg");
  const binDir = join(fixtureDir, "bin");
  await mkdir(join(fixtureDir, "src"), { recursive: true });
  await mkdir(homeDir, { recursive: true });
  await mkdir(xdgDir, { recursive: true });
  await mkdir(binDir, { recursive: true });

  // Varlock's auto-load shells out to its `varlock` CLI, whose `#!/usr/bin/env
  // node` shebang would otherwise pick up the ambient PATH (a Volta shim breaks
  // under the fixture HOME, and a global node is exactly what we are isolating
  // away from). This fixture-local `node` shim re-enters the same Bun runtime
  // that runs the child, so the CLI executes without any ambient toolchain.
  const nodeShim = join(binDir, "node");
  await writeFile(nodeShim, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} "$@"\n`);
  await chmod(nodeShim, 0o755);

  await writeFile(join(fixtureDir, ".env.schema"), readFileSync(SERVER_SCHEMA_PATH, "utf8"));
  const childPath = join(fixtureDir, "child.ts");
  await writeFile(childPath, CHILD_SCRIPT);

  const child = spawn(process.execPath, ["run", childPath], {
    cwd: fixtureDir,
    env: {
      PATH: `${binDir}:/usr/bin:/bin`,
      HOME: homeDir,
      XDG_CONFIG_HOME: xdgDir,
      _VARLOCK_FORCE_FILE_ENCRYPTION_FALLBACK: "1",
      VARLOCK_TELEMETRY_DISABLED: "1",
      DO_NOT_TRACK: "1",
      ...BASE_ENV,
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));

  try {
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("cold server child timed out"));
      }, CHILD_TIMEOUT_MS);
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });

    const output = `${stdout}\n${stderr}`;
    const line = output.split("\n").find((entry) => entry.startsWith(RESULT_MARKER));
    return {
      exitCode,
      output,
      result: line ? (JSON.parse(line.slice(RESULT_MARKER.length)) as SecurityResult) : undefined,
    };
  } finally {
    await rm(fixtureDir, { recursive: true, force: true });
  }
}

describe("schema-validated security configuration (cold boot)", () => {
  test(
    "defaults to the report-only header and allows eval only in development",
    async () => {
      const run = await runColdChild({ NODE_ENV: "development" });
      expect(run.exitCode).toBe(0);
      expect(run.result).toBeDefined();
      expect(run.result?.status).toBe(200);
      expect(run.result?.reportOnly).toBe(true);
      expect(run.result?.enforce).toBe(false);
      expect(run.result?.csp).toContain("'unsafe-eval'");
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "CSP_MODE=enforce emits only the enforced header in development",
    async () => {
      const run = await runColdChild({ NODE_ENV: "development", CSP_MODE: "enforce" });
      expect(run.exitCode).toBe(0);
      expect(run.result?.enforce).toBe(true);
      expect(run.result?.reportOnly).toBe(false);
      expect(run.result?.csp).toContain("'unsafe-eval'");
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "production never allows unsafe-eval",
    async () => {
      const run = await runColdChild({ NODE_ENV: "production", CSP_MODE: "enforce" });
      expect(run.exitCode).toBe(0);
      expect(run.result?.enforce).toBe(true);
      expect(run.result?.reportOnly).toBe(false);
      expect(run.result?.csp).not.toContain("'unsafe-eval'");
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "test never allows unsafe-eval",
    async () => {
      const run = await runColdChild({ NODE_ENV: "test", CSP_MODE: "report-only" });
      expect(run.exitCode).toBe(0);
      expect(run.result?.reportOnly).toBe(true);
      expect(run.result?.enforce).toBe(false);
      expect(run.result?.csp).not.toContain("'unsafe-eval'");
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "production defaults to the enforced header when CSP_MODE is unset",
    async () => {
      const run = await runColdChild({ NODE_ENV: "production" });
      expect(run.exitCode).toBe(0);
      expect(run.result?.enforce).toBe(true);
      expect(run.result?.reportOnly).toBe(false);
      expect(run.result?.csp).toContain("report-to csp-endpoint");
      expect(run.result?.reportTo).not.toBeNull();
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "an explicit CSP_MODE=report-only overrides the production default",
    async () => {
      const run = await runColdChild({ NODE_ENV: "production", CSP_MODE: "report-only" });
      expect(run.exitCode).toBe(0);
      expect(run.result?.enforce).toBe(false);
      expect(run.result?.reportOnly).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "an explicit CSP_MODE=enforce in production advertises the Report-To destination",
    async () => {
      const run = await runColdChild({ NODE_ENV: "production", CSP_MODE: "enforce" });
      expect(run.exitCode).toBe(0);
      expect(run.result?.enforce).toBe(true);
      expect(run.result?.reportOnly).toBe(false);
      expect(run.result?.csp).toContain("report-to csp-endpoint");
      expect(run.result?.csp).not.toContain("report-to /api/security/csp-report");
      expect(run.result?.reportTo).toBeTruthy();
      const parsed = JSON.parse(run.result?.reportTo ?? "{}") as {
        group?: string;
        max_age?: number;
        endpoints?: Array<{ url?: string }>;
      };
      expect(parsed.group).toBe("csp-endpoint");
      expect(parsed.max_age).toBe(10886400);
      expect(parsed.endpoints?.[0]?.url).toBe("/api/security/csp-report");
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "an invalid CSP_MODE fails startup naming the key and docs, without leaking secrets",
    async () => {
      const canary = "CANARY_CSP_MODE_SECRET_0123456789abcdef";
      const run = await runColdChild({
        NODE_ENV: "development",
        CSP_MODE: "bogus",
        BETTER_AUTH_SECRET: canary,
      });
      expect(run.exitCode).not.toBe(0);
      expect(run.output).toContain("CSP_MODE");
      expect(run.output).toContain(
        "https://github.com/nip10/openvalens/blob/main/CONTRIBUTING.md#file-based-secrets",
      );
      expect(run.output).not.toContain(canary);
      expect(run.output).not.toContain(RESULT_MARKER);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "production placeholder guard still fails closed on cold boot",
    async () => {
      const placeholder = "changeme".repeat(4);
      const run = await runColdChild({
        NODE_ENV: "production",
        CSP_MODE: "enforce",
        BETTER_AUTH_SECRET: placeholder,
      });
      expect(run.exitCode).not.toBe(0);
      expect(run.output).toContain("BETTER_AUTH_SECRET");
      expect(run.output).toContain(
        "https://github.com/nip10/openvalens/blob/main/CONTRIBUTING.md#development-setup",
      );
      expect(run.output).not.toContain(placeholder);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "capabilities.resend reflects RESEND_API_KEY without exposing the value",
    async () => {
      const key = "synthetic-resend-api-key-0123456789";
      const run = await runColdChild({
        NODE_ENV: "development",
        CSP_MODE: "report-only",
        RESEND_API_KEY: key,
        EMAIL_DRY_RUN: "false",
      });
      expect(run.exitCode).toBe(0);
      expect(run.result?.resend).toBe(true);
      expect(run.output).not.toContain(key);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "capabilities.resend reflects RESEND_API_KEY_FILE without exposing value or path",
    async () => {
      const secret = "synthetic-resend-file-secret-0123456789";
      const fixtureDir = await mkdtemp(join(tmpdir(), "security-config-file-"));
      const secretPath = join(fixtureDir, "resend.secret");
      await writeFile(secretPath, `${secret}\n`);
      try {
        const run = await runColdChild({
          NODE_ENV: "development",
          CSP_MODE: "report-only",
          RESEND_API_KEY_FILE: secretPath,
          EMAIL_DRY_RUN: "false",
        });
        expect(run.exitCode).toBe(0);
        expect(run.result?.resend).toBe(true);
        expect(run.output).not.toContain(secret);
        expect(run.output).not.toContain(secretPath);
      } finally {
        await rm(fixtureDir, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "capabilities.resend is false when a key is set but EMAIL_DRY_RUN is on",
    async () => {
      const key = "synthetic-resend-api-key-0123456789";
      const run = await runColdChild({
        NODE_ENV: "development",
        CSP_MODE: "report-only",
        RESEND_API_KEY: key,
        EMAIL_DRY_RUN: "true",
      });
      expect(run.exitCode).toBe(0);
      expect(run.result?.resend).toBe(false);
      expect(run.output).not.toContain(key);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "capabilities.resend is false when no Resend key is configured",
    async () => {
      const run = await runColdChild({ NODE_ENV: "development", CSP_MODE: "report-only" });
      expect(run.exitCode).toBe(0);
      expect(run.result?.resend).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  // Issue #57 — zero vendor accounts by default.
  test(
    "boots with no vendor credentials and every integration family at its safe default",
    async () => {
      // The empty STORAGE_S3_* values mirror what deploy/compose.yml passes
      // when the operator has not configured a bucket.
      const run = await runColdChild({
        NODE_ENV: "production",
        CSP_MODE: "report-only",
        STORAGE_PROVIDER: "local",
        STORAGE_S3_ENDPOINT: "",
        STORAGE_S3_REGION: "",
        STORAGE_S3_BUCKET: "",
        STORAGE_S3_ACCESS_KEY_ID_FILE: "",
        STORAGE_S3_SECRET_ACCESS_KEY_FILE: "",
      });
      const safeDefaults = {
        email: { provider: "resend", state: "dry-run" },
        ai: { provider: null, state: "off" },
        messaging: { provider: null, state: "off" },
        storage: { provider: "local", state: "configured" },
        foodLookup: { provider: null, state: "off" },
        oidc: { provider: null, state: "off" },
        push: { provider: null, state: "off" },
        // Issue #60 — cloud wearables stay off with no vendor env.
        wearablesOura: { provider: null, state: "off" },
        wearablesWhoop: { provider: null, state: "off" },
        wearablesPolar: { provider: null, state: "off" },
        wearablesWithings: { provider: null, state: "off" },
        wearablesGoogleHealth: { provider: null, state: "off" },
      };
      expect(run.exitCode).toBe(0);
      expect(run.result?.integrations).toEqual(safeDefaults);
      expect(run.result?.readinessIntegrations).toEqual(safeDefaults);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "switching adapters on is an env change only, and readiness never exposes the secrets",
    async () => {
      const secrets = {
        RESEND_API_KEY: "synthetic-resend-api-key-0123456789",
        ANTHROPIC_API_KEY: "sk-ant-synthetic-0123456789",
        TELEGRAM_BOT_TOKEN: "123456:synthetic-telegram-token",
        OIDC_CLIENT_SECRET: "synthetic-oidc-client-secret-0123456789",
      };
      const run = await runColdChild({
        NODE_ENV: "development",
        CSP_MODE: "report-only",
        EMAIL_DRY_RUN: "false",
        FOOD_LOOKUP_PROVIDER: "openfoodfacts",
        FOOD_LOOKUP_USER_AGENT: "OpenValens-Test/0.0 (ops@example.test)",
        PUSH_PROVIDER: "expo",
        // Issue #65 — an unreachable loopback IdP: the provider is skipped at
        // discovery time, never a boot failure.
        OIDC_PROVIDER_ID: "synthetic-idp",
        OIDC_CLIENT_ID: "synthetic-client",
        OIDC_DISCOVERY_URL: "http://127.0.0.1:9/.well-known/openid-configuration",
        ...secrets,
      });
      const configured = {
        email: { provider: "resend", state: "configured" },
        ai: { provider: "anthropic", state: "configured" },
        messaging: { provider: "telegram", state: "configured" },
        storage: { provider: "local", state: "configured" },
        foodLookup: { provider: "openfoodfacts", state: "configured" },
        oidc: { provider: "generic", state: "configured" },
        push: { provider: "expo", state: "configured" },
        wearablesOura: { provider: null, state: "off" },
        wearablesWhoop: { provider: null, state: "off" },
        wearablesPolar: { provider: null, state: "off" },
        wearablesWithings: { provider: null, state: "off" },
        wearablesGoogleHealth: { provider: null, state: "off" },
      };
      expect(run.exitCode).toBe(0);
      expect(run.result?.integrations).toEqual(configured);
      expect(run.result?.readinessIntegrations).toEqual(configured);
      for (const secret of Object.values(secrets)) {
        expect(run.output).not.toContain(secret);
      }
    },
    TEST_TIMEOUT_MS,
  );

  // Issue #59 — a local OpenAI-compatible endpoint boots AI with no cloud
  // credential; readiness names the provider but never the URL or key.
  test(
    "boots an OpenAI-compatible AI provider with no cloud credentials",
    async () => {
      const key = "synthetic-local-ai-key-0123456789";
      const run = await runColdChild({
        NODE_ENV: "development",
        CSP_MODE: "report-only",
        AI_PROVIDER: "openai-compatible",
        AI_BASE_URL: "http://127.0.0.1:11434/v1",
        AI_MODEL: "synthetic-local-model",
        AI_API_KEY: key,
      });
      const ai = { provider: "openai-compatible", state: "configured" };
      expect(run.exitCode).toBe(0);
      expect(run.result?.integrations.ai).toEqual(ai);
      expect(run.result?.readinessIntegrations?.ai).toEqual(ai);
      expect(run.output).not.toContain(key);
      expect(run.output).not.toContain("127.0.0.1:11434");
    },
    TEST_TIMEOUT_MS,
  );

  // Issue #62 — S3-compatible storage is an env change; readiness names the
  // provider but never the endpoint, bucket or keys. Incomplete S3 config is
  // `off`, never a boot failure.
  test(
    "switches object storage to S3 by env, and S3 without credentials is off",
    async () => {
      const secrets = {
        STORAGE_S3_ACCESS_KEY_ID: "synthetic-storage-access-key-0123",
        STORAGE_S3_SECRET_ACCESS_KEY: "synthetic-storage-secret-key-0123456789",
      };
      const s3Env = {
        NODE_ENV: "development",
        CSP_MODE: "report-only",
        STORAGE_PROVIDER: "s3",
        STORAGE_S3_ENDPOINT: "http://127.0.0.1:1",
        STORAGE_S3_BUCKET: "synthetic-private-bucket",
        STORAGE_S3_FORCE_PATH_STYLE: "true",
      };
      const configured = await runColdChild({ ...s3Env, ...secrets });
      expect(configured.exitCode).toBe(0);
      expect(configured.result?.integrations.storage).toEqual({
        provider: "s3",
        state: "configured",
      });
      expect(configured.result?.readinessIntegrations?.storage).toEqual({
        provider: "s3",
        state: "configured",
      });
      for (const value of [...Object.values(secrets), "synthetic-private-bucket", "127.0.0.1:1"]) {
        expect(configured.output).not.toContain(value);
      }

      const off = await runColdChild(s3Env);
      expect(off.exitCode).toBe(0);
      expect(off.result?.integrations.storage).toEqual({ provider: null, state: "off" });
    },
    TEST_TIMEOUT_MS,
  );
});
