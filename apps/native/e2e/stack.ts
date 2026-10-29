/**
 * Issue #302 — brings up the local stack the suite runs against: a throwaway
 * Postgres container, the deterministic demo seed (#301), the server in Cloud
 * mode, the helper and Metro. Every run starts from a clean seed.
 */
import { mkdirSync, createWriteStream } from "node:fs";
import { join } from "node:path";

import { E2E, NATIVE_DIR, REPO_ROOT, databaseUrl, helperUrl, serverUrl } from "./config";
import { startHelper, type Helper } from "./helper";
import { serverEnv } from "./server-env";

type Proc = ReturnType<typeof Bun.spawn>;

export type Stack = { stop(): Promise<void> };

function log(message: string) {
  console.log(`[e2e] ${message}`);
}

async function run(cmd: string[], options: { env?: Record<string, string>; cwd?: string } = {}) {
  const proc = Bun.spawn(cmd, {
    cwd: options.cwd ?? REPO_ROOT,
    env: { ...process.env, ...options.env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`${cmd.join(" ")} failed (${code}):\n${out}\n${err}`);
  return out;
}

async function waitFor(what: string, check: () => Promise<boolean>, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch {
      // not up yet
    }
    await Bun.sleep(500);
  }
  throw new Error(`${what} did not come up within ${timeoutMs / 1000}s`);
}

async function startPostgres() {
  const running = await run(["docker", "ps", "-q", "-f", `name=^${E2E.pgContainer}$`]);
  if (!running.trim()) {
    log(`starting Postgres (${E2E.pgContainer}) on 127.0.0.1:${E2E.pgPort}`);
    await run([
      "docker",
      "run",
      "-d",
      "--rm",
      "--name",
      E2E.pgContainer,
      "-e",
      "POSTGRES_PASSWORD=pw",
      "-p",
      `127.0.0.1:${E2E.pgPort}:5432`,
      "postgres:17",
    ]);
  }
  await waitFor("Postgres", async () => {
    await run(["docker", "exec", E2E.pgContainer, "pg_isready", "-U", "postgres"]);
    return true;
  });
  const exists = await run([
    "docker",
    "exec",
    E2E.pgContainer,
    "psql",
    "-U",
    "postgres",
    "-tAc",
    `select 1 from pg_database where datname = '${E2E.database}'`,
  ]);
  if (!exists.trim()) {
    await run(["docker", "exec", E2E.pgContainer, "createdb", "-U", "postgres", E2E.database]);
  }
}

/** The local calendar day, so "today" in the app matches the seeded data. */
function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

async function seed() {
  log("seeding the demo database (reset + migrate + seed, --cloud)");
  await run(["bun", "run", "demo:seed", "--today", today(), "--cloud"], {
    env: { DEMO_DATABASE_URL: databaseUrl() },
  });
}

async function pipeLines(stream: ReadableStream<Uint8Array>, onLine: (line: string) => void) {
  const decoder = new TextDecoder();
  let buffered = "";
  for await (const chunk of stream) {
    buffered += decoder.decode(chunk, { stream: true });
    let index: number;
    while ((index = buffered.indexOf("\n")) >= 0) {
      onLine(buffered.slice(0, index));
      buffered = buffered.slice(index + 1);
    }
  }
}

function startServer(helper: Helper, logDir: string): Proc {
  log(`starting the server on ${serverUrl()} (DEPLOYMENT_MODE=cloud)`);
  const file = createWriteStream(join(logDir, "server.log"));
  const proc = Bun.spawn(["bun", "src/index.ts"], {
    cwd: join(REPO_ROOT, "apps", "server"),
    env: { ...process.env, ...serverEnv() },
    stdout: "pipe",
    stderr: "pipe",
  });
  const onLine = (line: string) => {
    helper.onServerLine(line);
    // The log is kept for debugging; a magic link is a credential for the
    // throwaway seed only, but it is still left out.
    file.write(`${line.replace(/token=[^&\s]+/g, "token=<redacted>")}\n`);
  };
  void pipeLines(proc.stdout as ReadableStream<Uint8Array>, onLine);
  void pipeLines(proc.stderr as ReadableStream<Uint8Array>, onLine);
  return proc;
}

function startMetro(logDir: string): Proc {
  log(`starting Metro on port ${E2E.metroPort}`);
  const file = createWriteStream(join(logDir, "metro.log"));
  const proc = Bun.spawn(
    ["bunx", "expo", "start", "--dev-client", "--port", String(E2E.metroPort), "--clear"],
    {
      cwd: NATIVE_DIR,
      // EXPO_PUBLIC_E2E hides LogBox toasts so they do not cover screenshots.
      env: { ...process.env, CI: "1", EXPO_PUBLIC_E2E: "1", EXPO_PUBLIC_SERVER_URL: "" },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const onLine = (line: string) => file.write(`${line}\n`);
  void pipeLines(proc.stdout as ReadableStream<Uint8Array>, onLine);
  void pipeLines(proc.stderr as ReadableStream<Uint8Array>, onLine);
  return proc;
}

export async function startStack(options: {
  metro: boolean;
  logDir: string;
  platform?: "ios" | "android";
}): Promise<Stack> {
  mkdirSync(options.logDir, { recursive: true });
  await startPostgres();
  await seed();
  const helper = startHelper();
  const server = startServer(helper, options.logDir);
  await waitFor(
    "the server",
    async () => (await fetch(`${serverUrl()}/.well-known/openvalens`)).ok,
  );
  await waitFor("the helper", async () => (await fetch(`${helperUrl()}/health`)).ok);
  const metro = options.metro ? startMetro(options.logDir) : null;
  if (metro) {
    await waitFor(
      "Metro",
      async () => (await fetch(`http://localhost:${E2E.metroPort}/status`)).ok,
      180_000,
    );
    // Build the bundle once up front, so the first flow does not time out on it.
    const platform = options.platform ?? "ios";
    log(`warming the ${platform} bundle`);
    await fetch(
      `http://localhost:${E2E.metroPort}/node_modules/expo-router/entry.bundle?platform=${platform}&dev=true&minify=false`,
    ).then((r) => r.arrayBuffer());
  }
  log("stack is up");
  return {
    async stop() {
      metro?.kill();
      server.kill();
      await helper.stop();
      await Promise.all([metro?.exited, server.exited]);
    },
  };
}
