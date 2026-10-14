import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  DATABASE_FILE_SECRET_KEYS,
  FILE_SECRET_DOCS_LINK,
  FILE_SECRET_KEYS,
  MAX_FILE_SECRET_BYTES,
  resolveFileSecrets,
} from "./file-secrets";

const isRoot = typeof process.getuid === "function" && process.getuid() === 0;

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "file-secrets-unit-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function writeSecret(dir: string, name: string, content: string | Buffer): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, content);
  return path;
}

describe("resolveFileSecrets", () => {
  test("exposes the file-secret key/profile contract", () => {
    expect([...FILE_SECRET_KEYS]).toEqual([
      "BETTER_AUTH_SECRET",
      "BETTER_AUTH_URL",
      "CORS_ORIGIN",
      "DATABASE_URL",
      "CRON_SECRET",
      "TELEGRAM_WEBHOOK_SECRET",
      "RESEND_API_KEY",
      "EMAIL_AUDIT_BCC",
      "TELEGRAM_BOT_TOKEN",
      "AI_API_KEY",
      "ANTHROPIC_API_KEY",
    ]);
    // The database profile resolves only DATABASE_URL; unrelated provider files
    // cannot fail database commands.
    expect([...DATABASE_FILE_SECRET_KEYS]).toEqual(["DATABASE_URL"]);
  });

  test("resolves every sensitive key from its *_FILE variant", async () => {
    await withTempDir(async (dir) => {
      const values: Record<string, string> = {};
      for (const key of FILE_SECRET_KEYS) {
        values[key] = `synthetic-${key.toLowerCase()}-value`;
      }
      const env: Record<string, string> = {};
      for (const [key, value] of Object.entries(values)) {
        env[`${key}_FILE`] = await writeSecret(dir, `${key}.txt`, value);
      }

      const resolved = resolveFileSecrets(env, FILE_SECRET_KEYS);

      expect(Object.keys(resolved).sort()).toEqual([...FILE_SECRET_KEYS].sort());
      for (const key of FILE_SECRET_KEYS) {
        expect(resolved[key]).toBe(values[key]);
      }
    });
  });

  test("leaves existing behavior unchanged when no *_FILE is present", () => {
    const env = {
      RESEND_API_KEY: "direct-provider-key",
      BETTER_AUTH_SECRET: "direct-auth-secret",
    };
    expect(resolveFileSecrets(env, FILE_SECRET_KEYS)).toEqual({});
  });

  test("treats an empty or missing *_FILE path as unset", async () => {
    await withTempDir(async () => {
      const env = {
        RESEND_API_KEY_FILE: "",
        ANTHROPIC_API_KEY_FILE: undefined,
        RESEND_API_KEY: "direct",
      };
      expect(resolveFileSecrets(env, FILE_SECRET_KEYS)).toEqual({});
      expect(resolveFileSecrets({}, FILE_SECRET_KEYS)).toEqual({});
    });
  });

  test("uses the file value when the direct key is present but empty", async () => {
    await withTempDir(async (dir) => {
      const path = await writeSecret(dir, "resend.txt", "from-file");
      const resolved = resolveFileSecrets(
        { RESEND_API_KEY: "", RESEND_API_KEY_FILE: path },
        FILE_SECRET_KEYS,
      );
      expect(resolved).toEqual({ RESEND_API_KEY: "from-file" });
    });
  });

  test("fails on a non-empty direct key plus non-empty key_file before any IO", async () => {
    await withTempDir(async (dir) => {
      // A FIFO would hang if the resolver attempted to open it; the ambiguity
      // must be detected first.
      const fifo = join(dir, "conflict.fifo");
      const mkfifo = spawnSync("mkfifo", [fifo]);
      const filePath = mkfifo.status === 0 ? fifo : join(dir, "does-not-exist");
      const env = { RESEND_API_KEY: "direct", RESEND_API_KEY_FILE: filePath };

      expect(() => resolveFileSecrets(env, FILE_SECRET_KEYS)).toThrow(
        /Do not set both.*RESEND_API_KEY.*CONTRIBUTING/s,
      );
    });
  });

  test("strips only trailing CR/LF and preserves other whitespace", async () => {
    await withTempDir(async (dir) => {
      const cases: Array<{ content: string; expected: string }> = [
        { content: "value\n", expected: "value" },
        { content: "value\r\n", expected: "value" },
        { content: "value\r", expected: "value" },
        { content: "value\n\n\n", expected: "value" },
        { content: "  value  ", expected: "  value  " },
        { content: "value \t", expected: "value \t" },
      ];
      for (const [index, entry] of cases.entries()) {
        const path = await writeSecret(dir, `trim-${index}.txt`, entry.content);
        const resolved = resolveFileSecrets({ CRON_SECRET_FILE: path }, FILE_SECRET_KEYS);
        expect(resolved.CRON_SECRET).toBe(entry.expected);
      }
    });
  });

  test("rejects missing files and names only the key with a docs link", async () => {
    await withTempDir(async (dir) => {
      const missing = join(dir, "missing-secret.txt");
      let message = "";
      try {
        resolveFileSecrets({ RESEND_API_KEY_FILE: missing }, FILE_SECRET_KEYS);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain("RESEND_API_KEY");
      expect(message).toContain(FILE_SECRET_DOCS_LINK);
      expect(message).not.toContain(missing);
      expect(message).not.toContain(dir);
    });
  });

  test("rejects directories, FIFOs, invalid UTF-8, empty and whitespace-only files", async () => {
    await withTempDir(async (dir) => {
      const directory = join(dir, "a-directory");
      await mkdir(directory);
      const fifo = join(dir, "a.fifo");
      const fifoReady = spawnSync("mkfifo", [fifo]).status === 0;
      const invalidUtf8 = await writeSecret(dir, "invalid.txt", Buffer.from([0xff, 0xfe, 0x00]));
      const empty = await writeSecret(dir, "empty.txt", "");
      const whitespace = await writeSecret(dir, "whitespace.txt", "   \n\t");

      const candidates = [directory, invalidUtf8, empty, whitespace];
      if (fifoReady) candidates.push(fifo);

      for (const path of candidates) {
        const startedAt = Date.now();
        expect(() => resolveFileSecrets({ RESEND_API_KEY_FILE: path }, FILE_SECRET_KEYS)).toThrow(
          /RESEND_API_KEY/,
        );
        // FIFO open must not hang.
        expect(Date.now() - startedAt).toBeLessThan(2_000);
      }
    });
  });

  test("rejects unreadable files without leaking paths", async () => {
    if (isRoot) {
      // Root can read mode-000 files; the assertion would not be meaningful.
      return;
    }
    await withTempDir(async (dir) => {
      const path = await writeSecret(dir, "unreadable.txt", "secret");
      await chmod(path, 0o000);
      let message = "";
      try {
        resolveFileSecrets({ RESEND_API_KEY_FILE: path }, FILE_SECRET_KEYS);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain("RESEND_API_KEY");
      expect(message).not.toContain(path);
    });
  });

  test("rejects files larger than the bounded maximum", async () => {
    await withTempDir(async (dir) => {
      const oversized = await writeSecret(
        dir,
        "oversized.txt",
        "a".repeat(MAX_FILE_SECRET_BYTES + 1),
      );
      expect(() =>
        resolveFileSecrets({ RESEND_API_KEY_FILE: oversized }, FILE_SECRET_KEYS),
      ).toThrow(/RESEND_API_KEY/);
      // Exactly at the bound is accepted.
      const exact = await writeSecret(dir, "exact.txt", "a".repeat(MAX_FILE_SECRET_BYTES));
      expect(resolveFileSecrets({ RESEND_API_KEY_FILE: exact }, FILE_SECRET_KEYS)).toEqual({
        RESEND_API_KEY: "a".repeat(MAX_FILE_SECRET_BYTES),
      });
    });
  });

  test("follows a symlink to a regular file (Kubernetes secret mount)", async () => {
    await withTempDir(async (dir) => {
      const target = await writeSecret(dir, "target.txt", "value-from-target\n");
      const link = join(dir, "link.txt");
      await symlink(target, link);
      expect(resolveFileSecrets({ TELEGRAM_BOT_TOKEN_FILE: link }, FILE_SECRET_KEYS)).toEqual({
        TELEGRAM_BOT_TOKEN: "value-from-target",
      });
    });
  });

  test("ignores unknown *_FILE variables such as NODE_ENV_FILE", async () => {
    await withTempDir(async (dir) => {
      const path = await writeSecret(dir, "public.txt", "not-a-secret");
      const env = { NODE_ENV_FILE: path, NODE_ENV: "production" };
      expect(resolveFileSecrets(env, FILE_SECRET_KEYS)).toEqual({});
    });
  });

  test("validates every selected file before returning, leaving env untouched on failure", async () => {
    await withTempDir(async (dir) => {
      const good = await writeSecret(dir, "good.txt", "good-value");
      const env = {
        RESEND_API_KEY_FILE: good,
        ANTHROPIC_API_KEY_FILE: join(dir, "missing.txt"),
      };
      const snapshot = { ...env };

      expect(() => resolveFileSecrets(env, FILE_SECRET_KEYS)).toThrow(/ANTHROPIC_API_KEY/);
      expect(env).toEqual(snapshot);
    });
  });

  test("never echoes file contents or paths in errors", async () => {
    await withTempDir(async (dir) => {
      const canary = "CANARY-VALUE-DO-NOT-PRINT";
      const invalid = await writeSecret(
        dir,
        "invalid.txt",
        Buffer.concat([Buffer.from(`${canary}\n`), Buffer.from([0xff, 0xfe])]),
      );
      let message = "";
      try {
        resolveFileSecrets({ RESEND_API_KEY_FILE: invalid }, FILE_SECRET_KEYS);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain("RESEND_API_KEY");
      expect(message).not.toContain(canary);
      expect(message).not.toContain(invalid);
    });
  });

  test("rejects NUL bytes for required and optional keys without leaking value or path", async () => {
    await withTempDir(async (dir) => {
      const canary = "NUL-UNIT-CANARY";
      for (const key of ["BETTER_AUTH_URL", "CRON_SECRET", "RESEND_API_KEY"] as const) {
        const path = join(dir, `${key}.nul`);
        await writeFile(path, Buffer.from(`https://app.example.invalid\u0000${canary}`));
        const env = { [`${key}_FILE`]: path };
        const snapshot = { ...env };

        let message = "";
        try {
          resolveFileSecrets(env, FILE_SECRET_KEYS);
        } catch (error) {
          message = (error as Error).message;
        }
        expect(message).toContain(key);
        expect(message).toContain(FILE_SECRET_DOCS_LINK);
        expect(message).toContain("NUL");
        expect(message).not.toContain(canary);
        expect(message).not.toContain(path);
        expect(env).toEqual(snapshot);
      }
    });
  });

  test("a NUL in one file prevents any value from being applied (atomic)", async () => {
    await withTempDir(async (dir) => {
      const good = await writeSecret(dir, "good.txt", "good-value");
      const nul = join(dir, "nul.txt");
      await writeFile(nul, Buffer.from("x\u0000y"));
      const env = { RESEND_API_KEY_FILE: good, ANTHROPIC_API_KEY_FILE: nul };
      const snapshot = { ...env };

      expect(() => resolveFileSecrets(env, FILE_SECRET_KEYS)).toThrow(/ANTHROPIC_API_KEY/);
      expect(env).toEqual(snapshot);
    });
  });
});
