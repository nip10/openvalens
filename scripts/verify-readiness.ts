#!/usr/bin/env bun
/**
 * Post-deploy readiness verification (Issues #129, #128).
 *
 *   bun scripts/verify-readiness.ts --base-url https://health.example.org
 *   bun scripts/verify-readiness.ts --web-url https://app.example.org \
 *     --api-url https://api.example.org \
 *     [--expect email=configured:resend,ai=off,messaging=off] \
 *     [--session-cookie-file /path/to/private/cookie] [--insecure] [--json]
 *
 * Read-only checks against a deployed OpenValens:
 *
 *   web                       GET  <web>/                         200 text/html
 *   api-readiness             POST <api>/api-reference/health/readiness   status "ok"
 *   rpc-anonymous-readiness   POST <api>/rpc/health/readiness     200, status "ok"
 *   rpc-anonymous-admission   POST <api>/rpc/admission/status     200 (public)
 *   rpc-protected-anonymous   POST <api>/rpc/adminSettings/access 401 without a session
 *   rpc-protected-session     the same call WITH the session cookie: 200
 *                             (only with --session-cookie-file)
 *   integrations              checks.integrations matches every --expect entry
 *
 * The self-host install serves web and API on one origin (`--base-url`); a
 * platform deployment may use two (`--web-url` and `--api-url`).
 *
 * Output is value-free: status words, HTTP codes and the readiness
 * `{ provider, state }` pairs only. Response bodies, cookies and headers are
 * never printed. The session cookie is read from a private file (never an
 * argument) and sent only to the API origin. No call writes data or reaches an
 * email, AI or messaging provider.
 *
 * `--insecure` skips TLS verification and is accepted only for loopback hosts
 * (a local rehearsal stack behind Caddy's internal CA). Plain http is likewise
 * accepted only for loopback hosts. Exit status 0 means every check passed.
 */

import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type CheckResult = { name: string; ok: boolean; detail: string };

export type ExpectedIntegration = { family: string; state: string; provider?: string };

export type ReadinessOptions = {
  webUrl: string;
  apiUrl: string;
  expect: ExpectedIntegration[];
  sessionCookie: string | null;
  insecure: boolean;
  timeoutMs: number;
};

export type ParsedArgs =
  | { command: "help" }
  | {
      command: "run";
      webUrl: string;
      apiUrl: string;
      expect: ExpectedIntegration[];
      sessionCookieFile: string | null;
      insecure: boolean;
      json: boolean;
      timeoutMs: number;
    };

const VALUE_FLAGS = new Set([
  "--base-url",
  "--web-url",
  "--api-url",
  "--expect",
  "--session-cookie-file",
  "--timeout-ms",
]);
const BOOLEAN_FLAGS = new Set(["--insecure", "--json"]);

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/** Normalises a bare origin; refuses credentials, paths and non-loopback http. */
export function parseOrigin(value: string, flag: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${flag} must be an absolute URL`);
  }
  if (url.username || url.password) throw new Error(`${flag} must not contain credentials`);
  if (url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    throw new Error(`${flag} must be a bare origin (no path or query)`);
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback(url.hostname))) {
    throw new Error(`${flag} must use https (http is allowed only for loopback)`);
  }
  return url;
}

/** `email=configured:resend,ai=off` → expected `{ family, state, provider? }` entries. */
export function parseExpect(value: string): ExpectedIntegration[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const match = /^([a-z][a-z0-9-]*)=(configured|dry-run|off)(?::([a-z][a-z0-9-]*))?$/.exec(
        entry,
      );
      if (!match) {
        throw new Error("--expect entries must look like family=state[:provider]");
      }
      return match[3]
        ? { family: match[1]!, state: match[2]!, provider: match[3] }
        : { family: match[1]!, state: match[2]! };
    });
}

/** Parses CLI arguments; never echoes a rejected value (it may be a secret). */
export function parseArgs(argv: string[]): ParsedArgs {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--help" || arg === "-h") return { command: "help" };
    if (BOOLEAN_FLAGS.has(arg)) {
      flags.add(arg);
    } else if (VALUE_FLAGS.has(arg)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(`${arg} requires a value`);
      values.set(arg, value);
      i++;
    } else {
      throw new Error("unknown option (see --help)");
    }
  }

  const base = values.get("--base-url");
  const web = values.get("--web-url") ?? base;
  const api = values.get("--api-url") ?? base;
  if (!web || !api) throw new Error("pass --base-url, or both --web-url and --api-url");
  const webUrl = parseOrigin(web, "--web-url");
  const apiUrl = parseOrigin(api, "--api-url");

  const insecure = flags.has("--insecure");
  if (insecure && !(isLoopback(webUrl.hostname) && isLoopback(apiUrl.hostname))) {
    throw new Error("--insecure is allowed only for loopback hosts");
  }

  const timeoutRaw = values.get("--timeout-ms") ?? "10000";
  const timeoutMs = Number(timeoutRaw);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) {
    throw new Error("--timeout-ms must be an integer between 100 and 120000");
  }

  return {
    command: "run",
    webUrl: webUrl.origin,
    apiUrl: apiUrl.origin,
    expect: parseExpect(values.get("--expect") ?? ""),
    sessionCookieFile: values.get("--session-cookie-file") ?? null,
    insecure,
    json: flags.has("--json"),
    timeoutMs,
  };
}

/**
 * Reads the session cookie from a private local file. Refuses a file other
 * users can read, and never includes the contents in an error.
 */
export function readSessionCookie(path: string): string {
  const info = statSync(path);
  if (!info.isFile()) throw new Error("--session-cookie-file must be a regular file");
  if ((info.mode & 0o077) !== 0) {
    throw new Error("--session-cookie-file must not be readable by group or others (chmod 600)");
  }
  const cookie = readFileSync(path, "utf8").replace(/[\r\n]+$/, "");
  if (cookie.length === 0 || /[\r\n]/.test(cookie)) {
    throw new Error("--session-cookie-file must contain one Cookie header value");
  }
  return cookie;
}

type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

async function request(
  fetcher: Fetcher,
  options: ReadinessOptions,
  url: string,
  init: RequestInit,
): Promise<{ status: number; contentType: string; body: unknown } | { error: string }> {
  try {
    const response = await fetcher(url, {
      ...init,
      redirect: "manual",
      signal: AbortSignal.timeout(options.timeoutMs),
      ...(options.insecure ? { tls: { rejectUnauthorized: false } } : {}),
    } as RequestInit);
    const contentType = response.headers.get("content-type") ?? "";
    const text = await response.text();
    let body: unknown = null;
    if (contentType.includes("json")) {
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
    }
    return { status: response.status, contentType, body };
  } catch (error) {
    // Value-free: the error class only, never a message that may echo a URL.
    const name = (error as Error)?.name ?? "Error";
    return { error: name === "TimeoutError" ? "timeout" : `request failed (${name})` };
  }
}

function rpcPost(cookie?: string | null): RequestInit {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cookie) headers.Cookie = cookie;
  return { method: "POST", headers, body: JSON.stringify({ json: {} }) };
}

type Readiness = {
  status?: string;
  checks?: {
    database?: string;
    secrets?: Record<string, string>;
    integrations?: Record<string, { provider: string | null; state: string }>;
  };
};

function readinessDetail(body: Readiness): string {
  const secrets = Object.entries(body.checks?.secrets ?? {})
    .map(([key, value]) => `${key}=${value}`)
    .join(",");
  return `status=${body.status ?? "?"} database=${body.checks?.database ?? "?"} secrets=${secrets || "?"}`;
}

/** Compares `checks.integrations` against the expected states. */
export function compareIntegrations(
  actual: Record<string, { provider: string | null; state: string }> | undefined,
  expected: ExpectedIntegration[],
): CheckResult {
  const reported = Object.entries(actual ?? {})
    .map(([family, status]) => `${family}=${status.state}:${status.provider ?? "none"}`)
    .sort()
    .join(",");
  if (actual === undefined) {
    return { name: "integrations", ok: false, detail: "readiness has no checks.integrations" };
  }
  const mismatches: string[] = [];
  for (const entry of expected) {
    const status = actual[entry.family];
    if (!status) {
      mismatches.push(`${entry.family} not reported`);
    } else if (status.state !== entry.state) {
      mismatches.push(`${entry.family} is ${status.state}, expected ${entry.state}`);
    } else if (entry.provider !== undefined && status.provider !== entry.provider) {
      mismatches.push(`${entry.family} provider is ${status.provider ?? "none"}`);
    }
  }
  if (expected.length === 0) {
    return { name: "integrations", ok: true, detail: `reported ${reported} (no --expect given)` };
  }
  return mismatches.length === 0
    ? { name: "integrations", ok: true, detail: `reported ${reported}` }
    : {
        name: "integrations",
        ok: false,
        detail: `${mismatches.join("; ")} (reported ${reported})`,
      };
}

export async function runReadinessChecks(
  options: ReadinessOptions,
  fetcher: Fetcher = (input, init) => fetch(input, init),
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const api = options.apiUrl;

  const web = await request(fetcher, options, `${options.webUrl}/`, { method: "GET" });
  if ("error" in web) {
    results.push({ name: "web", ok: false, detail: web.error });
  } else {
    const ok = web.status === 200 && web.contentType.includes("text/html");
    results.push({ name: "web", ok, detail: `HTTP ${web.status} ${web.contentType || "-"}` });
  }

  const openapi = await request(fetcher, options, `${api}/api-reference/health/readiness`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  let readiness: Readiness | null = null;
  if ("error" in openapi) {
    results.push({ name: "api-readiness", ok: false, detail: openapi.error });
  } else {
    readiness = (openapi.body ?? {}) as Readiness;
    results.push({
      name: "api-readiness",
      ok: openapi.status === 200 && readiness.status === "ok",
      detail: `HTTP ${openapi.status} ${readinessDetail(readiness)}`,
    });
  }

  const rpcReadiness = await request(fetcher, options, `${api}/rpc/health/readiness`, rpcPost());
  if ("error" in rpcReadiness) {
    results.push({ name: "rpc-anonymous-readiness", ok: false, detail: rpcReadiness.error });
  } else {
    const body = ((rpcReadiness.body as { json?: Readiness } | null)?.json ?? {}) as Readiness;
    results.push({
      name: "rpc-anonymous-readiness",
      ok: rpcReadiness.status === 200 && body.status === "ok",
      detail: `HTTP ${rpcReadiness.status} status=${body.status ?? "?"}`,
    });
  }

  const admission = await request(fetcher, options, `${api}/rpc/admission/status`, rpcPost());
  if ("error" in admission) {
    results.push({ name: "rpc-anonymous-admission", ok: false, detail: admission.error });
  } else {
    const body = (admission.body as { json?: { setupAvailable?: unknown } } | null)?.json;
    const setup = typeof body?.setupAvailable === "boolean" ? body.setupAvailable : "?";
    results.push({
      name: "rpc-anonymous-admission",
      ok: admission.status === 200 && typeof body?.setupAvailable === "boolean",
      detail: `HTTP ${admission.status} setupAvailable=${setup}`,
    });
  }

  const anonymous = await request(fetcher, options, `${api}/rpc/adminSettings/access`, rpcPost());
  if ("error" in anonymous) {
    results.push({ name: "rpc-protected-anonymous", ok: false, detail: anonymous.error });
  } else {
    results.push({
      name: "rpc-protected-anonymous",
      ok: anonymous.status === 401,
      detail: `HTTP ${anonymous.status} (expected 401 without a session)`,
    });
  }

  if (options.sessionCookie !== null) {
    const session = await request(
      fetcher,
      options,
      `${api}/rpc/adminSettings/access`,
      rpcPost(options.sessionCookie),
    );
    if ("error" in session) {
      results.push({ name: "rpc-protected-session", ok: false, detail: session.error });
    } else {
      const body = (session.body as { json?: { isInstanceAdmin?: unknown } } | null)?.json;
      results.push({
        name: "rpc-protected-session",
        ok: session.status === 200 && typeof body?.isInstanceAdmin === "boolean",
        detail: `HTTP ${session.status} authenticated=${session.status === 200}`,
      });
    }
  }

  if (readiness !== null) {
    results.push(compareIntegrations(readiness.checks?.integrations, options.expect));
  } else {
    results.push({ name: "integrations", ok: false, detail: "readiness unavailable" });
  }

  return results;
}

const USAGE = readFileSync(fileURLToPath(import.meta.url), "utf8")
  .split("\n")
  .slice(2)
  .join("\n")
  .split("\n */")[0]!
  .replace(/^ \* ?/gm, "");

if (import.meta.main) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.command === "help") {
      console.log(USAGE);
      process.exit(0);
    }
    const results = await runReadinessChecks({
      webUrl: args.webUrl,
      apiUrl: args.apiUrl,
      expect: args.expect,
      sessionCookie: args.sessionCookieFile ? readSessionCookie(args.sessionCookieFile) : null,
      insecure: args.insecure,
      timeoutMs: args.timeoutMs,
    });
    const passed = results.every((result) => result.ok);
    if (args.json) {
      console.log(
        JSON.stringify(
          {
            checkedAt: new Date().toISOString(),
            webUrl: args.webUrl,
            apiUrl: args.apiUrl,
            passed,
            results,
          },
          null,
          2,
        ),
      );
    } else {
      console.log(`verify-readiness: web ${args.webUrl} api ${args.apiUrl}`);
      for (const result of results) {
        console.log(`${result.ok ? "PASS" : "FAIL"} ${result.name.padEnd(24)} ${result.detail}`);
      }
      console.log(`verify-readiness: ${passed ? "all checks passed" : "FAILED"}`);
    }
    process.exit(passed ? 0 : 1);
  } catch (error) {
    console.error(`verify-readiness: ERROR: ${(error as Error).message}`);
    process.exit(2);
  }
}
