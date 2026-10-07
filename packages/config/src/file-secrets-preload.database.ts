/**
 * Side-effect preload for database CLI entrypoints (Issue #58).
 *
 * Resolves only `DATABASE_URL_FILE` into `process.env` at module evaluation
 * time, BEFORE `varlock/auto-load`. Database commands run with the database
 * profile, so an unrelated provider `*_FILE` (for example `RESEND_API_KEY_FILE`)
 * is intentionally ignored and cannot fail `db:migrate`.
 *
 * Import this module before `varlock/auto-load` in `packages/db/drizzle.config.ts`
 * and `packages/db/src/backfill-org-id.ts`.
 */
import { DATABASE_FILE_SECRET_KEYS, resolveFileSecrets } from "./file-secrets";
import { installVarlockSafeErrorHook } from "./varlock-safe-error";

installVarlockSafeErrorHook();
Object.assign(process.env, resolveFileSecrets(process.env, DATABASE_FILE_SECRET_KEYS));
