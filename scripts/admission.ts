#!/usr/bin/env bun
/**
 * Admission operator CLI (Issue #63).
 *
 * `mint` issues the one-time setup token; `prune` runs the bounded, expiry-only
 * grant cleanup. This tool is run by a human operator on a host that already
 * has database access — it is never invoked by the agent or a production
 * request path. It requires an explicit `DATABASE_URL` (or `DATABASE_URL_FILE`)
 * in the process environment so it can never silently fall back to an ambient
 * developer database.
 *
 * Secrets: the setup token is written once, to a private file (`O_EXCL`,
 * `0600`, verified with `fstat`) or, on explicit `--stdout`, to stdout. It is
 * never accepted as an argument, never logged, and never echoed in an error.
 */

import { closeSync, fstatSync, openSync, unlinkSync, writeSync } from "node:fs";

import {
  createAdmissionService,
  type AdmissionService,
} from "../packages/auth/src/admission/index.ts";
import { createDb } from "../packages/db/src/index.ts";

const PRUNE_LIMIT_MAX = 500;
const PRUNE_LIMIT_DEFAULT = 100;

/** Flags that would carry a secret on the command line; always rejected. */
const SECRET_LIKE_FLAGS = [
  "--token",
  "--secret",
  "--credential",
  "--password",
  "--key",
  "--email",
  "--code",
  "--invitation",
];

export type AdmissionCommand =
  | { action: "mint"; toStdout: boolean; outputPath: string | null; allowRemote: boolean }
  | { action: "prune"; limit: number; allowRemote: boolean };

export type ParseResult = { ok: true; command: AdmissionCommand } | { ok: false; message: string };

const GENERIC_USAGE =
  "Usage: admission mint (--output <path> | --stdout) | admission prune [--limit n]";

/**
 * Pure argument parser. Every failure message is generic — a rejected flag or
 * value is never echoed back.
 */
export function parseArgs(argv: readonly string[]): ParseResult {
  const [command, ...rest] = argv;

  if (command !== "mint" && command !== "prune") {
    return { ok: false, message: `Unknown command.\n${GENERIC_USAGE}` };
  }

  let outputPath: string | null = null;
  let toStdout = false;
  let allowRemote = false;
  let limit = PRUNE_LIMIT_DEFAULT;

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i]!;

    if (SECRET_LIKE_FLAGS.some((flag) => arg === flag || arg.startsWith(`${flag}=`))) {
      return { ok: false, message: `Unknown option.\n${GENERIC_USAGE}` };
    }

    if (arg === "--allow-remote") {
      allowRemote = true;
      continue;
    }

    if (arg === "--stdout") {
      if (command !== "mint") return { ok: false, message: `Unknown option.\n${GENERIC_USAGE}` };
      toStdout = true;
      continue;
    }

    if (arg === "--output") {
      if (command !== "mint") return { ok: false, message: `Unknown option.\n${GENERIC_USAGE}` };
      const value = rest[i + 1];
      if (!value || value.startsWith("--")) {
        return { ok: false, message: `Missing output path.\n${GENERIC_USAGE}` };
      }
      outputPath = value;
      i += 1;
      continue;
    }

    if (arg === "--limit") {
      if (command !== "prune") return { ok: false, message: `Unknown option.\n${GENERIC_USAGE}` };
      const value = rest[i + 1];
      if (!value || !/^\d+$/.test(value)) {
        return { ok: false, message: `Invalid limit.\n${GENERIC_USAGE}` };
      }
      limit = Number(value);
      i += 1;
      continue;
    }

    return { ok: false, message: `Unknown option.\n${GENERIC_USAGE}` };
  }

  if (command === "mint") {
    const selectors = (toStdout ? 1 : 0) + (outputPath ? 1 : 0);
    if (selectors !== 1) {
      return { ok: false, message: `Exactly one output selector is required.\n${GENERIC_USAGE}` };
    }
    return { ok: true, command: { action: "mint", toStdout, outputPath, allowRemote } };
  }

  if (limit < 1 || limit > PRUNE_LIMIT_MAX) {
    return { ok: false, message: `Limit must be between 1 and ${PRUNE_LIMIT_MAX}.` };
  }
  return { ok: true, command: { action: "prune", limit, allowRemote } };
}

/** Loopback-only by default; anything else needs explicit `--allow-remote`. */
export function isLoopbackDatabaseUrl(raw: string): boolean {
  try {
    const host = new URL(raw).hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
}

export type CliIo = {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export type MintFileOps = {
  /** Reserves the path (`O_EXCL`, `0600`); throws if it already exists. */
  reserve: (path: string) => number;
  /** Confirms the open handle is exactly `0600`. */
  verifyPrivate: (fd: number) => boolean;
  write: (fd: number, text: string) => void;
  close: (fd: number) => void;
  remove: (path: string) => void;
};

export type RunDeps = CliIo & {
  loadService: () => Promise<AdmissionService>;
  fileOps?: MintFileOps;
};

export const realFileOps: MintFileOps = {
  reserve: (path) => openSync(path, "wx", 0o600),
  verifyPrivate: (fd) => (fstatSync(fd).mode & 0o777) === 0o600,
  write: (fd, text) => {
    writeSync(fd, text);
  },
  close: (fd) => {
    closeSync(fd);
  },
  remove: (path) => {
    unlinkSync(path);
  },
};

/**
 * Runs one parsed command. Returns a process exit code. All failure output is
 * generic: no token, path, DSN, email or provider detail is ever printed.
 */
export async function runAdmissionCli(command: AdmissionCommand, deps: RunDeps): Promise<number> {
  const fileOps = deps.fileOps ?? realFileOps;

  if (command.action === "prune") {
    let service: AdmissionService;
    try {
      service = await deps.loadService();
    } catch {
      deps.stderr("Admission prune failed.");
      return 1;
    }
    try {
      await service.pruneExpiredGrants({ limit: command.limit });
    } catch {
      deps.stderr("Admission prune failed.");
      return 1;
    }
    deps.stdout("Pruned expired admission grants.");
    return 0;
  }

  // mint: reserve the destination BEFORE rotating the token so an existing file
  // can never advance the generation without a delivered secret.
  let fd: number | null = null;
  if (!command.toStdout && command.outputPath) {
    try {
      fd = fileOps.reserve(command.outputPath);
    } catch {
      deps.stderr("Output file already exists or cannot be created.");
      return 1;
    }
    if (!fileOps.verifyPrivate(fd)) {
      fileOps.close(fd);
      try {
        fileOps.remove(command.outputPath);
      } catch {
        // Best-effort cleanup; the handle was ours and is closed.
      }
      deps.stderr("Output file permissions are not private.");
      return 1;
    }
  }

  const cleanupReserved = () => {
    if (fd !== null && command.outputPath) {
      try {
        fileOps.close(fd);
      } catch {
        // ignore
      }
      try {
        fileOps.remove(command.outputPath);
      } catch {
        // ignore
      }
    }
  };

  let minted: { token: string };
  try {
    minted = await (await deps.loadService()).mintSetupToken();
  } catch {
    cleanupReserved();
    deps.stderr("Setup token mint failed.");
    return 1;
  }

  if (command.toStdout) {
    deps.stdout(minted.token);
    return 0;
  }

  try {
    fileOps.write(fd!, `${minted.token}\n`);
    fileOps.close(fd!);
  } catch {
    try {
      fileOps.remove(command.outputPath!);
    } catch {
      // ignore
    }
    deps.stderr("Setup token write failed.");
    return 1;
  }

  deps.stdout("Setup token written.");
  return 0;
}

/** Resolves the explicit database URL, or `null` when none was supplied. */
export function resolveDatabaseUrl(env: Record<string, string | undefined>): string | null {
  const direct = env.DATABASE_URL;
  if (typeof direct === "string" && direct.length > 0) return direct;
  return null;
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.ok) {
    process.stderr.write(`${parsed.message}\n`);
    process.exitCode = 1;
    return;
  }

  const command = parsed.command;
  const env = process.env;

  // Require an explicit database input BEFORE any profile/env loader runs, so
  // an ambient developer `.env` can never be used implicitly.
  if (!env.DATABASE_URL && !env.DATABASE_URL_FILE) {
    process.stderr.write("An explicit DATABASE_URL or DATABASE_URL_FILE is required.\n");
    process.exitCode = 1;
    return;
  }

  // Resolve only `DATABASE_URL_FILE` (database profile) into `process.env`.
  await import("@openvalens/config/file-secrets-preload.database");

  const url = resolveDatabaseUrl(process.env);
  if (!url) {
    process.stderr.write("An explicit DATABASE_URL or DATABASE_URL_FILE is required.\n");
    process.exitCode = 1;
    return;
  }

  if (!isLoopbackDatabaseUrl(url) && !command.allowRemote) {
    process.stderr.write("Refusing a remote database without --allow-remote.\n");
    process.exitCode = 1;
    return;
  }

  const exitCode = await (async () => {
    const db = createDb({ DATABASE_URL: url });
    try {
      return await runAdmissionCli(command, {
        stdout: (line) => process.stdout.write(`${line}\n`),
        stderr: (line) => process.stderr.write(`${line}\n`),
        loadService: async () => {
          // mint/prune never deliver email, so the callbacks are never invoked.
          const noDelivery = async () => {
            throw new Error("Admission delivery is not available from the operator CLI.");
          };
          return createAdmissionService({
            db,
            deliverVerification: noDelivery,
            deliverInvitation: noDelivery,
          });
        },
      });
    } finally {
      // Close the connection pool so the process can exit.
      const client = (db as unknown as { $client?: { end: () => Promise<void> } }).$client;
      if (client) await client.end();
    }
  })();
  process.exitCode = exitCode;
}

if (import.meta.main) {
  await main();
}
