/**
 * Readiness verification (Issues #129, #128) against an in-process mock of the
 * OpenValens web and API surface. No real deployment or provider is touched.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  compareIntegrations,
  parseArgs,
  parseExpect,
  readSessionCookie,
  runReadinessChecks,
  type ReadinessOptions,
} from "./verify-readiness";

const SESSION = "better-auth.session_token=synthetic-session-value";

type MockState = {
  status: "ok" | "degraded" | "unready";
  protectedStatus: number;
  email: "configured" | "dry-run" | "off";
};

const state: MockState = { status: "ok", protectedStatus: 401, email: "dry-run" };
const seen: { path: string; cookie: string | null }[] = [];

function readiness() {
  return {
    status: state.status,
    checks: {
      database: state.status === "unready" ? "unreachable" : "ok",
      secrets: { betterAuthSecret: "ok", cronSecret: "ok" },
      capabilities: { resend: state.email === "configured" },
      integrations: {
        email: { provider: "resend", state: state.email },
        ai: { provider: null, state: "off" },
        messaging: { provider: null, state: "off" },
      },
    },
    timestamp: "2026-10-14T00:00:00.000Z",
  };
}

let server: ReturnType<typeof Bun.serve>;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(request) {
      const path = new URL(request.url).pathname;
      seen.push({ path, cookie: request.headers.get("cookie") });
      if (request.method === "GET" && path === "/") {
        return new Response("<!doctype html><title>OpenValens</title>", {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      if (path === "/api-reference/health/readiness") return Response.json(readiness());
      if (path === "/rpc/health/readiness") return Response.json({ json: readiness() });
      if (path === "/rpc/admission/status") {
        return Response.json({ json: { setupAvailable: false } });
      }
      if (path === "/rpc/adminSettings/access") {
        if (request.headers.get("cookie") === SESSION) {
          return Response.json({ json: { isInstanceAdmin: true } });
        }
        return Response.json(
          { json: { defined: true, code: "UNAUTHENTICATED", status: state.protectedStatus } },
          { status: state.protectedStatus },
        );
      }
      return new Response("not found", { status: 404 });
    },
  });
});

afterAll(() => {
  server.stop(true);
});

function options(overrides: Partial<ReadinessOptions> = {}): ReadinessOptions {
  const origin = `http://127.0.0.1:${server.port}`;
  return {
    webUrl: origin,
    apiUrl: origin,
    expect: [],
    sessionCookie: null,
    insecure: false,
    timeoutMs: 5_000,
    ...overrides,
  };
}

function reset() {
  state.status = "ok";
  state.protectedStatus = 401;
  state.email = "dry-run";
  seen.length = 0;
}

describe("runReadinessChecks", () => {
  test("passes against a healthy deployment and covers anonymous and protected RPC", async () => {
    reset();
    const results = await runReadinessChecks(
      options({ expect: parseExpect("email=dry-run:resend,ai=off,messaging=off") }),
    );
    expect(results.map((result) => [result.name, result.ok])).toEqual([
      ["web", true],
      ["api-readiness", true],
      ["rpc-anonymous-readiness", true],
      ["rpc-anonymous-admission", true],
      ["rpc-protected-anonymous", true],
      ["integrations", true],
    ]);
  });

  test("fails when readiness is degraded", async () => {
    reset();
    state.status = "degraded";
    const results = await runReadinessChecks(options());
    expect(results.find((result) => result.name === "api-readiness")?.ok).toBe(false);
    expect(results.find((result) => result.name === "rpc-anonymous-readiness")?.ok).toBe(false);
  });

  test("fails when a protected procedure answers without a session", async () => {
    reset();
    state.protectedStatus = 200;
    const results = await runReadinessChecks(options());
    expect(results.find((result) => result.name === "rpc-protected-anonymous")?.ok).toBe(false);
  });

  test("checks the protected path with a session cookie and never prints it", async () => {
    reset();
    const results = await runReadinessChecks(options({ sessionCookie: SESSION }));
    const session = results.find((result) => result.name === "rpc-protected-session");
    expect(session).toEqual({
      name: "rpc-protected-session",
      ok: true,
      detail: "HTTP 200 authenticated=true",
    });
    expect(JSON.stringify(results)).not.toContain("synthetic-session-value");
    // The cookie is sent only on the session check, never on anonymous calls.
    expect(seen.filter((request) => request.cookie !== null)).toEqual([
      { path: "/rpc/adminSettings/access", cookie: SESSION },
    ]);
  });

  test("reports an integration state mismatch", async () => {
    reset();
    state.email = "configured";
    const results = await runReadinessChecks(options({ expect: parseExpect("email=dry-run") }));
    const integrations = results.find((result) => result.name === "integrations");
    expect(integrations?.ok).toBe(false);
    expect(integrations?.detail).toContain("email is configured, expected dry-run");
  });

  test("reports an unreachable host as a value-free failure", async () => {
    const results = await runReadinessChecks(
      options({ webUrl: "http://127.0.0.1:9", apiUrl: "http://127.0.0.1:9", timeoutMs: 1_000 }),
    );
    expect(results.every((result) => !result.ok)).toBe(true);
    expect(JSON.stringify(results)).not.toContain("127.0.0.1");
  });
});

describe("compareIntegrations", () => {
  const actual = {
    email: { provider: "resend", state: "configured" },
    ai: { provider: "anthropic", state: "configured" },
    messaging: { provider: null, state: "off" },
  };

  test("matches state and optional provider", () => {
    expect(
      compareIntegrations(actual, parseExpect("email=configured:resend,messaging=off")).ok,
    ).toBe(true);
    expect(compareIntegrations(actual, parseExpect("ai=configured:openai")).ok).toBe(false);
    expect(compareIntegrations(actual, parseExpect("storage=off")).detail).toContain(
      "storage not reported",
    );
  });

  test("fails when the probe has no integrations block", () => {
    expect(compareIntegrations(undefined, []).ok).toBe(false);
  });
});

describe("parseArgs", () => {
  test("uses --base-url for both origins", () => {
    expect(parseArgs(["--base-url", "https://health.example.org"])).toMatchObject({
      command: "run",
      webUrl: "https://health.example.org",
      apiUrl: "https://health.example.org",
    });
  });

  test("refuses plain http and --insecure for non-loopback hosts", () => {
    expect(() => parseArgs(["--base-url", "http://health.example.org"])).toThrow(/https/);
    expect(() => parseArgs(["--base-url", "https://health.example.org", "--insecure"])).toThrow(
      /loopback/,
    );
    expect(parseArgs(["--base-url", "https://localhost:18443", "--insecure"])).toMatchObject({
      insecure: true,
    });
  });

  test("rejects credentials, paths and unknown flags without echoing them", () => {
    expect(() => parseArgs(["--base-url", "https://user:s3cr3t@example.org"])).toThrow(
      /credentials/,
    );
    expect(() => parseArgs(["--base-url", "https://example.org/app"])).toThrow(/bare origin/);
    try {
      parseArgs(["--cookie=s3cr3t"]);
      throw new Error("expected a rejection");
    } catch (error) {
      expect((error as Error).message).not.toContain("s3cr3t");
    }
  });

  test("rejects a malformed --expect entry", () => {
    expect(() => parseExpect("email=enabled")).toThrow(/family=state/);
  });
});

describe("readSessionCookie", () => {
  test("requires a private file and strips the trailing newline", () => {
    const dir = mkdtempSync(join(tmpdir(), "ov-verify-readiness-"));
    try {
      const file = join(dir, "cookie");
      writeFileSync(file, `${SESSION}\n`);
      chmodSync(file, 0o644);
      expect(() => readSessionCookie(file)).toThrow(/chmod 600/);
      chmodSync(file, 0o600);
      expect(readSessionCookie(file)).toBe(SESSION);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
