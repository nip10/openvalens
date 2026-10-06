import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";

// These tests exercise the real files (config + schema + backfill entrypoint) in
// an isolated replica root. The replica has no `.env` files, so Varlock cannot
// read any developer credential file while the import graph is identical to the
// committed one (`packages/db/.env.schema` imports `apps/server/`).
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const realDbDir = join(repoRoot, "packages/db");
const realServerSchema = join(repoRoot, "apps/server/.env.schema");

const DATABASE_URL_VALUE = "postgresql://file_user:file_pass@file-db.invalid:5432/file_db";

type Replica = {
  root: string;
  dbDir: string;
  secretPath: string;
};

async function withDbReplica(run: (replica: Replica) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "db-file-secrets-"));
  try {
    const dbDir = join(root, "packages/db");
    await mkdir(join(dbDir, "src"), { recursive: true });
    await mkdir(join(root, "apps/server"), { recursive: true });

    await symlink(join(repoRoot, "node_modules"), join(root, "node_modules"), "dir");
    await symlink(join(realDbDir, "node_modules"), join(dbDir, "node_modules"), "dir");

    for (const [source, target] of [
      [join(realDbDir, "drizzle.config.ts"), join(dbDir, "drizzle.config.ts")],
      [join(realDbDir, ".env.schema"), join(dbDir, ".env.schema")],
      [join(realDbDir, "src/env.ts"), join(dbDir, "src/env.ts")],
      [join(realDbDir, "src/backfill-org-id.ts"), join(dbDir, "src/backfill-org-id.ts")],
      [realServerSchema, join(root, "apps/server/.env.schema")],
    ] as const) {
      await writeFile(target, await readFile(source, "utf8"));
    }

    const secretPath = join(root, "database-url.secret");
    await writeFile(secretPath, `${DATABASE_URL_VALUE}\n`);

    await run({ root, dbDir, secretPath });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function controlledEnv(secretPath: string): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "",
    NODE_ENV: "test",
    _VARLOCK_THROW_ON_LOAD_ERROR: "1",
    DATABASE_URL_FILE: secretPath,
    // A missing unrelated provider file must be ignored by the database profile.
    RESEND_API_KEY_FILE: join(tmpdir(), "does-not-exist-resend.secret"),
  };
}

describe("database entrypoints resolve DATABASE_URL from a file", () => {
  test("the real drizzle config imports with FILE-only DATABASE_URL and ignores provider files", async () => {
    await withDbReplica(async ({ dbDir, secretPath }) => {
      const code =
        'const c = (await import("./drizzle.config.ts")).default;' +
        "process.stdout.write(JSON.stringify({ url: c.dbCredentials.url }));";
      const child = Bun.spawnSync({
        cmd: ["bun", "-e", code],
        cwd: dbDir,
        stdout: "pipe",
        stderr: "pipe",
        env: controlledEnv(secretPath),
      });
      const stdout = child.stdout.toString();
      const output = `${stdout}\n${child.stderr.toString()}`;
      expect(child.exitCode).toBe(0);
      expect(JSON.parse(stdout)).toEqual({ url: DATABASE_URL_VALUE });
      expect(output).not.toContain(secretPath);
    });
  });

  test("the real backfill entrypoint passes the resolved URL into the pg Client without connecting", async () => {
    await withDbReplica(async ({ dbDir, secretPath }) => {
      // Intercept connect in an isolated child before any network access. This
      // is a child preload, not a global `mock.module`, so the suite is clean.
      const intercept = [
        'import { Client } from "pg";',
        "Client.prototype.connect = function () {",
        "  const p = this.connectionParameters;",
        "  process.stdout.write(JSON.stringify({",
        "    host: p.host, port: p.port, database: p.database, user: p.user,",
        "  }));",
        "  process.exit(0);",
        "};",
      ].join("\n");
      const interceptPath = join(dbDir, "intercept.ts");
      await writeFile(interceptPath, intercept);

      const child = Bun.spawnSync({
        cmd: ["bun", "--preload", "./intercept.ts", "./src/backfill-org-id.ts"],
        cwd: dbDir,
        stdout: "pipe",
        stderr: "pipe",
        env: controlledEnv(secretPath),
      });
      const stdout = child.stdout.toString();
      expect(child.exitCode).toBe(0);
      expect(JSON.parse(stdout)).toEqual({
        host: "file-db.invalid",
        port: 5432,
        database: "file_db",
        user: "file_user",
      });
    });
  });

  test("the database profile installs the sanitized Varlock error boundary", async () => {
    await withDbReplica(async ({ dbDir, secretPath }) => {
      const child = Bun.spawnSync({
        cmd: ["bun", "-e", 'await import("./drizzle.config.ts");'],
        cwd: dbDir,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...controlledEnv(secretPath), NODE_ENV: "bogus" },
      });
      const output = `${child.stdout.toString()}\n${child.stderr.toString()}`;
      expect(child.exitCode).not.toBe(0);
      for (const marker of ["isSensitive", "basePath", "json-full", "overrideKeys"]) {
        expect(output).not.toContain(marker);
      }
    });
  });
});
