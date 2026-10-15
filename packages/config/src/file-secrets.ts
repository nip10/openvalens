/**
 * Bounded `*_FILE` resolution for sensitive environment variables (Issue #58).
 *
 * Every sensitive key from `apps/server/.env.schema` accepts an optional
 * `<KEY>_FILE` companion that points at a file whose contents become the value
 * (Docker/Kubernetes secrets, systemd `LoadCredential`, etc.). This module is
 * intentionally pure and synchronous: it must run before Varlock's auto-load so
 * that the resolved values are part of `process.env` when the schema is
 * validated, coerced and redacted.
 *
 * Guarantees (see `CONTRIBUTING.md`, "File-based secrets"):
 *
 * - `_FILE` inputs are read from the runtime environment only; Varlock alone
 *   does not resolve them.
 * - An empty `<KEY>_FILE` path is treated as unset. A non-empty `<KEY>_FILE`
 *   path together with a non-empty direct `<KEY>` fails before any file is
 *   opened.
 * - Relative paths resolve against `process.cwd()`; absolute paths such as those
 *   under `/run/secrets` are recommended in containers.
 * - Symlinks to regular files are followed (Kubernetes secret mounts). Directory,
 *   FIFO and other non-regular targets are rejected without opening a blocking
 *   read (the descriptor is opened with `O_NONBLOCK`).
 * - Only a bounded number of bytes (64 KiB + 1) is read, so a file that grows
 *   after `fstat` cannot cause an unbounded read.
 * - Values must decode as strict UTF-8 and must not be empty or whitespace-only.
 *   Only trailing CR/LF bytes are removed (to support `echo`-style files); other
 *   internal, leading or trailing whitespace is preserved.
 * - All selected files are validated before any value is returned, so a failure
 *   cannot leave a half-applied configuration. Errors name keys only — never the
 *   path, contents, filesystem cause or raw stack.
 */

import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

/** Sensitive keys that accept a `*_FILE` variant, in schema order. */
export const FILE_SECRET_KEYS = [
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
  "OIDC_CLIENT_SECRET",
] as const;

export type FileSecretKey = (typeof FILE_SECRET_KEYS)[number];

/**
 * Safe subset for the database CLI entrypoints: only `DATABASE_URL` is resolved,
 * so a missing unrelated `RESEND_API_KEY_FILE` cannot break `db:migrate`.
 */
export const DATABASE_FILE_SECRET_KEYS = [
  "DATABASE_URL",
] as const satisfies readonly FileSecretKey[];

/** Maximum accepted file size for a single secret value. */
export const MAX_FILE_SECRET_BYTES = 64 * 1024;

/** Configuration help linked from every resolution failure. */
export const FILE_SECRET_DOCS_LINK =
  "https://github.com/nip10/openvalens/blob/main/CONTRIBUTING.md#file-based-secrets";

/**
 * Reads a single file-based secret. Any failure is reported to the caller as a
 * thrown `Error` whose message contains no sensitive detail; callers aggregate
 * only the key names.
 */
function readSecretFile(filePath: string): string {
  const absolutePath = resolvePath(filePath);
  let fd: number | undefined;
  try {
    fd = openSync(absolutePath, constants.O_RDONLY | constants.O_NONBLOCK);
    const stats = fstatSync(fd);
    if (!stats.isFile()) {
      throw new Error("not-a-regular-file");
    }

    const buffer = Buffer.allocUnsafe(MAX_FILE_SECRET_BYTES + 1);
    let total = 0;
    while (total < buffer.length) {
      const bytesRead = readSync(fd, buffer, total, buffer.length - total, total);
      if (bytesRead === 0) break;
      total += bytesRead;
    }

    if (total > MAX_FILE_SECRET_BYTES) {
      throw new Error("too-large");
    }

    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, total));
    // Remove only trailing CR/LF so `echo value > file` works; preserve every
    // other space exactly as written.
    const value = decoded.replace(/[\r\n]+$/, "");
    // NUL is valid UTF-8 but cannot be represented in an OS environment value;
    // reject it here so it never reaches `process.env` (where it would surface as
    // a low-level child_process error carrying the raw value).
    if (value.includes("\0")) {
      throw new Error("nul");
    }
    if (value.trim().length === 0) {
      throw new Error("empty");
    }
    return value;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // The descriptor is best-effort; a close failure must not mask the result.
      }
    }
  }
}

function resolutionErrorMessage(keys: readonly string[]): string {
  return (
    `Unable to load file-based secret(s) for: ${keys.join(", ")}. ` +
    "Each *_FILE path must reference a readable regular file containing a non-empty " +
    "UTF-8 value without NUL bytes of at most 64 KiB. Configure secrets before deploying: " +
    FILE_SECRET_DOCS_LINK
  );
}

function ambiguityErrorMessage(keys: readonly string[]): string {
  return (
    `Do not set both KEY and KEY_FILE for: ${keys.join(", ")}. ` +
    "Set exactly one of the direct value or its *_FILE path. Configure secrets before " +
    `deploying: ${FILE_SECRET_DOCS_LINK}`
  );
}

/**
 * Resolves `<KEY>_FILE` values for the selected `keys` into an explicit map of
 * overrides. The supplied `env` object is never mutated; callers apply the
 * result themselves. Throws before returning when any selected key fails,
 * listing key names only.
 *
 * @param env source environment (defaults to `process.env`)
 * @param keys sensitive keys to consider; pass `DATABASE_FILE_SECRET_KEYS` for
 *   the database profile so only `DATABASE_URL` is resolved
 */
export function resolveFileSecrets(
  env: Record<string, string | undefined> = process.env,
  keys: readonly FileSecretKey[] = FILE_SECRET_KEYS,
): Record<string, string> {
  const selected: Array<{ key: FileSecretKey; filePath: string }> = [];
  const ambiguous: FileSecretKey[] = [];

  // Pass 1: detect ambiguity before opening any file.
  for (const key of keys) {
    const filePath = env[`${key}_FILE`];
    if (filePath === undefined || filePath === "") continue;
    const direct = env[key];
    if (direct !== undefined && direct !== "") {
      ambiguous.push(key);
      continue;
    }
    selected.push({ key, filePath });
  }

  if (ambiguous.length > 0) {
    throw new Error(ambiguityErrorMessage(ambiguous));
  }

  // Pass 2: read and validate every selected file before applying anything.
  const resolved: Record<string, string> = {};
  const failed: FileSecretKey[] = [];
  for (const { key, filePath } of selected) {
    try {
      resolved[key] = readSecretFile(filePath);
    } catch {
      failed.push(key);
    }
  }

  if (failed.length > 0) {
    throw new Error(resolutionErrorMessage(failed));
  }

  return resolved;
}
