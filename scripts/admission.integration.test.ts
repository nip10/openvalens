import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readdir } from "node:fs/promises";

import { createDb, sql, type Database } from "../packages/db/src/index.ts";

/**
 * Operator CLI evidence (Issue #63): spawns the real `scripts/admission.ts` as
 * a child process against a disposable PostgreSQL, with an explicit, isolated
 * environment. Canary tokens are asserted through file contents / stdout but
 * are never echoed into the parent test log.
 */

const url = process.env.ADMISSION_AUTH_TEST_DATABASE_URL;

function assertDisposable(candidate: string | undefined, database: string): void {
  if (!candidate) return;
  const parsed = new URL(candidate);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.pathname !== `/${database}`)
    throw new Error(`Empty disposable loopback ${database} database required.`);
}
assertDisposable(url, "admission_cli_test");

async function migrate(db: Database): Promise<void> {
  const root = new URL("../packages/db/src/migrations/", import.meta.url);
  for (const directory of (await readdir(root)).sort()) {
    if (!/^\d/.test(directory)) continue;
    const text = await Bun.file(new URL(`${directory}/migration.sql`, root)).text();
    for (const statement of text.split("--> statement-breakpoint"))
      if (statement.trim()) await db.execute(sql.raw(statement));
  }
}

async function runCli(
  args: string[],
  env: Record<string, string | undefined>,
  cwd?: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const launcher = new URL("admission.sh", import.meta.url).pathname;
  const child = Bun.spawn(["bash", launcher, ...args], {
    cwd: cwd ?? new URL("..", import.meta.url).pathname,
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { code, stdout, stderr };
}

describe.skipIf(!url)("admission CLI against disposable PostgreSQL", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/admission_cli_test" });

  beforeAll(async () => {
    const tables = await db.execute(
      sql`select tablename from pg_tables where schemaname = 'public'`,
    );
    if (tables.rows.length) throw new Error("Integration database must be empty.");
    await migrate(db);
  });

  const generation = async () =>
    Number(
      (
        (await db.execute(sql`select generation from instance_admission where id = 'instance'`))
          .rows[0] as { generation: number }
      ).generation,
    );

  test("mint --output writes a private token file without printing it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "admission-cli-"));
    const path = join(dir, "setup-token");
    const before = await generation();

    const result = await runCli(["mint", "--output", path], { DATABASE_URL: url });
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");

    const mode = (await stat(path)).mode & 0o777;
    expect(mode).toBe(0o600);
    const token = (await readFile(path, "utf8")).trim();
    expect(token.length).toBeGreaterThan(20);
    expect(result.stdout).not.toContain(token);
    expect(await generation()).toBeGreaterThan(before);
  });

  test("mint refuses an existing output file and never rotates the token", async () => {
    const dir = await mkdtemp(join(tmpdir(), "admission-cli-"));
    const path = join(dir, "setup-token");
    await writeFile(path, "already-there\n", { mode: 0o600 });
    const before = await generation();

    const result = await runCli(["mint", "--output", path], { DATABASE_URL: url });
    expect(result.code).toBe(1);
    expect(result.stderr).not.toContain(path);
    expect(await readFile(path, "utf8")).toBe("already-there\n");
    expect(await generation()).toBe(before);
  });

  test("mint --stdout prints the token (manual opt-in)", async () => {
    const result = await runCli(["mint", "--stdout"], { DATABASE_URL: url });
    expect(result.code).toBe(0);
    expect(result.stdout.trim().length).toBeGreaterThan(20);
    expect(result.stdout.trim()).not.toContain(" ");
  });

  test("rejects unknown flags, missing credentials and remote hosts without echoing values", async () => {
    const unknown = await runCli(["mint", "--stdout", "--bogus"], { DATABASE_URL: url });
    expect(unknown.code).toBe(1);

    const noCreds = await runCli(["mint", "--stdout"], {});
    expect(noCreds.code).toBe(1);
    expect(noCreds.stderr).not.toContain("postgres://");

    const remote = await runCli(["mint", "--stdout"], {
      DATABASE_URL: "postgres://user:secret@db.example.com:5432/openvalens",
    });
    expect(remote.code).toBe(1);
    expect(remote.stderr).not.toContain("db.example.com");
    expect(remote.stderr).not.toContain("secret");
  });

  test("prune runs bounded and reports generically", async () => {
    const result = await runCli(["prune", "--limit", "50"], { DATABASE_URL: url });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Pruned");
  });

  test("an ambient .env never supplies the database (supported launcher)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "admission-dotenv-"));
    await writeFile(join(dir, ".env"), `DATABASE_URL=${url}\n`, { mode: 0o600 });
    const before = await generation();

    // No DATABASE_URL / DATABASE_URL_FILE in the environment; only an ambient
    // `.env` (which `--no-env-file` must ignore).
    const result = await runCli(["mint", "--stdout"], {}, dir);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("explicit DATABASE_URL");
    expect(await generation()).toBe(before);
  });
});
