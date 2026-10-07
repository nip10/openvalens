/**
 * Side-effect preload for the server process (Issue #58).
 *
 * Resolves every sensitive `*_FILE` variant into `process.env` at module
 * evaluation time, BEFORE `varlock/auto-load` validates the schema. Import this
 * module first in `apps/server/src/env.server.ts`; static ESM imports evaluate in
 * source order, so no top-level await is required (which keeps the Drizzle
 * esbuild/CJS config loader working).
 */
import { FILE_SECRET_KEYS, resolveFileSecrets } from "./file-secrets";
import { installVarlockSafeErrorHook } from "./varlock-safe-error";

installVarlockSafeErrorHook();
Object.assign(process.env, resolveFileSecrets(process.env, FILE_SECRET_KEYS));
