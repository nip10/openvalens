#!/usr/bin/env bun
/**
 * Erasure-ledger replay CLI (Issue #64). `deploy/setup.sh restore` runs it in a
 * one-off `server` container after the restored database has been migrated and
 * its erasure ledger merged with the ledger of the database it replaced:
 *
 *   DATABASE_URL_FILE=/run/secrets/DATABASE_URL \
 *     bun --no-env-file scripts/erasure-replay.ts --allow-remote
 *
 * Every person in the ledger is erased again (see
 * `packages/data-rights/src/replay.ts`), so a restore never brings back data
 * that was deleted through "Delete everything" after the backup was taken.
 * Their stored objects are deleted from the configured storage (the same
 * `STORAGE_*` settings as the server).
 *
 * Platform deployments (Coolify/Dokploy, docs/deployment.md) restore a dump
 * into a side database instead. Run this against the restored database before
 * it takes traffic, with the replaced database's URL in an environment
 * variable (never on the command line), to copy that database's ledger first:
 *
 *   OLD_DATABASE_URL=... DATABASE_URL=<restored> \
 *     bun --no-env-file scripts/erasure-replay.ts --merge-from-env OLD_DATABASE_URL --allow-remote
 *
 * Operator tool, never a request path. It needs an explicit `DATABASE_URL` (or
 * `DATABASE_URL_FILE`), refuses a non-loopback database without
 * `--allow-remote`, and prints counts only — never ids or record contents.
 * Exits non-zero when any step fails, including an object it could not delete.
 */

import { resolveFileSecrets } from "../packages/config/src/file-secrets.ts";
import {
  mergeErasureLedger,
  readErasureLedgerRows,
  replayErasureLedger,
} from "../packages/data-rights/src/replay.ts";
import { createDb } from "../packages/db/src/index.ts";
import { createObjectStorage } from "../packages/storage/src/adapter.ts";
import { parseStorageConfig } from "../packages/storage/src/config.ts";
import { isLoopbackDatabaseUrl } from "./admission.ts";

const USAGE = "Usage: erasure-replay [--merge-from-env <VARIABLE>] [--allow-remote]";

export type ReplayArgs = { allowRemote: boolean; mergeFromEnv: string | null };

export function parseArgs(argv: readonly string[]): ReplayArgs | null {
  let allowRemote = false;
  let mergeFromEnv: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--allow-remote") allowRemote = true;
    else if (arg === "--merge-from-env" && mergeFromEnv === null) {
      const name = argv[i + 1];
      if (!name || !/^[A-Z][A-Z0-9_]*$/.test(name)) return null;
      mergeFromEnv = name;
      i += 1;
    } else return null;
  }
  return { allowRemote, mergeFromEnv };
}

export function describeReport(report: Awaited<ReturnType<typeof replayErasureLedger>>): string {
  return [
    `Erasure ledger replayed: ${report.subjects} erased ${report.subjects === 1 ? "person" : "people"},`,
    `${report.subjectsWithRows} brought back by the restore and erased again,`,
    `${report.rowsRemoved} rows removed, ${report.objects.deleted} stored objects deleted,`,
    `${report.objects.failed} objects not deleted.`,
  ].join(" ");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    process.stderr.write(`Invalid arguments.\n${USAGE}\n`);
    process.exitCode = 2;
    return;
  }
  if (!process.env.DATABASE_URL && !process.env.DATABASE_URL_FILE) {
    process.stderr.write("An explicit DATABASE_URL or DATABASE_URL_FILE is required.\n");
    process.exitCode = 1;
    return;
  }
  Object.assign(
    process.env,
    resolveFileSecrets(process.env, [
      "DATABASE_URL",
      "STORAGE_S3_ACCESS_KEY_ID",
      "STORAGE_S3_SECRET_ACCESS_KEY",
    ]),
  );
  const url = process.env.DATABASE_URL;
  if (!url) {
    process.stderr.write("An explicit DATABASE_URL or DATABASE_URL_FILE is required.\n");
    process.exitCode = 1;
    return;
  }
  if (!isLoopbackDatabaseUrl(url) && !args.allowRemote) {
    process.stderr.write("Refusing a remote database without --allow-remote.\n");
    process.exitCode = 1;
    return;
  }

  const objectStorage = createObjectStorage(parseStorageConfig(process.env));
  const storage = objectStorage
    ? {
        async deleteKeys(keys: readonly string[]) {
          let deleted = 0;
          let failed = 0;
          for (const key of keys) {
            try {
              await objectStorage.delete(key);
              deleted += 1;
            } catch {
              failed += 1;
            }
          }
          return { deleted, failed };
        },
      }
    : null;

  let sourceUrl: string | null = null;
  if (args.mergeFromEnv) {
    sourceUrl = process.env[args.mergeFromEnv] ?? null;
    if (!sourceUrl) {
      process.stderr.write(
        `${args.mergeFromEnv} is empty; it must hold the replaced database's URL.\n`,
      );
      process.exitCode = 1;
      return;
    }
    if (!isLoopbackDatabaseUrl(sourceUrl) && !args.allowRemote) {
      process.stderr.write("Refusing a remote database without --allow-remote.\n");
      process.exitCode = 1;
      return;
    }
  }

  const db = createDb({ DATABASE_URL: url });
  try {
    if (sourceUrl) {
      const source = createDb({ DATABASE_URL: sourceUrl });
      try {
        const added = await mergeErasureLedger(db, await readErasureLedgerRows(source));
        process.stdout.write(`Merged ${added} erasure-ledger rows from the replaced database.\n`);
      } finally {
        const client = (source as unknown as { $client?: { end: () => Promise<void> } }).$client;
        if (client) await client.end();
      }
    }
    const report = await replayErasureLedger(db, storage);
    process.stdout.write(`${describeReport(report)}\n`);
    if (report.objects.failed > 0) {
      process.stderr.write(
        "Some stored objects of erased people could not be deleted; check storage and re-run.\n",
      );
      process.exitCode = 1;
    }
  } catch {
    process.stderr.write("Erasure-ledger replay failed; re-run it before starting the server.\n");
    process.exitCode = 1;
  } finally {
    const client = (db as unknown as { $client?: { end: () => Promise<void> } }).$client;
    if (client) await client.end();
  }
}

if (import.meta.main) {
  await main();
}
