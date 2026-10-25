import type { IntegrationState } from "@openvalens/config/integrations";
import { sql, type Database } from "@openvalens/db";
import { createStructuredLogger } from "@openvalens/observability";
import { z } from "zod";

import { backupStateSchema, readBackupStatus, type BackupState } from "../backup-status";
import { publicProcedure } from "../index";

/** Hard ceiling for the readiness DB ping. */
const DB_PING_TIMEOUT_MS = 5_000;

/** Minimum length for `CRON_SECRET` (mirrors `.env.schema`). */
const MIN_CRON_SECRET_LENGTH = 16;

// Issue #11 — PHI-safe structured logger for readiness events. The readiness
// body carries no PHI, but every line still goes through the shared logger so
// the correlation id and redaction posture are consistent.
const logger = createStructuredLogger({ level: "info" });

/**
 * Issue #57 — one integration family's value-free status. Mirrors
 * `IntegrationStatus` from `@openvalens/config/integrations`: the provider id
 * (or `null` when off) and its state, never a credential or endpoint.
 */
const integrationStatusOutput = z.object({
  provider: z.string().nullable(),
  state: z.enum(["configured", "dry-run", "off"] satisfies IntegrationState[]),
});

export const readinessOutput = z.object({
  status: z.enum(["ok", "degraded", "unready"]),
  checks: z.object({
    database: z.enum(["ok", "unreachable"]),
    secrets: z.object({
      betterAuthSecret: z.enum(["ok", "missing"]),
      cronSecret: z.enum(["ok", "missing"]),
    }),
    capabilities: z.record(z.string(), z.boolean()),
    /**
     * Issue #62 — whether the selected object storage accepted a write/read/
     * delete round trip on a reserved key (`off` when storage is disabled).
     * Which storage is in use is `integrations.storage.provider`.
     */
    storage: z.enum(["ok", "unwritable", "off"]),
    /**
     * Issue #64 — the self-host backups: `failing` when the newest backup or
     * verify failed, `stale` when no good backup is under 48 hours old or the
     * scheduler is overdue, `off` when no backup service ever reported,
     * `unknown` when the status could not be read. Details: /admin/settings.
     */
    backups: backupStateSchema,
    integrations: z.record(z.string(), integrationStatusOutput),
  }),
  timestamp: z.string(),
});

/**
 * Pings the database with `SELECT 1`, bounded by {@link DB_PING_TIMEOUT_MS}.
 *
 * Any failure — a rejected query, a connection error, or the timeout — is
 * reported as `unreachable`; the underlying error is never surfaced (it could
 * echo connection details).
 */
async function pingDatabase(db: Database): Promise<"ok" | "unreachable"> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    await Promise.race([
      db.execute(sql`SELECT 1`),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("database readiness ping timed out")),
          DB_PING_TIMEOUT_MS,
        );
      }),
    ]);
    return "ok";
  } catch {
    return "unreachable";
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

/** Backup state, bounded like the DB ping; a timeout is `unknown`. */
async function backupState(db: Database): Promise<BackupState> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      readBackupStatus(db).then((status) => status.state),
      new Promise<BackupState>((resolve) => {
        timer = setTimeout(() => resolve("unknown"), DB_PING_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Public readiness probe (no auth) for monitoring.
 *
 * Mirrors `anchovy/apps/web/src/app/api/health/readiness/route.ts`: a DB ping,
 * a secret-presence check and capability flags. The response body carries the
 * status and is always HTTP 200 at the oRPC layer; `unready` is expressed in
 * the body rather than as a thrown error so monitoring can read the detail.
 */
export const healthRouter = {
  readiness: publicProcedure
    .input(z.object({}))
    .output(readinessOutput)
    .handler(async ({ context }) => {
      const database = await pingDatabase(context.db);
      // The probe result is cached by the service, so polling stays cheap.
      const storage = context.storage ? await context.storage.probe() : "off";
      const backups = database === "ok" ? await backupState(context.db) : "unknown";

      const betterAuthSecret = context.betterAuthSecretConfigured ? "ok" : "missing";
      const cronSecret =
        context.cronSecret.trim().length >= MIN_CRON_SECRET_LENGTH ? "ok" : "missing";

      const missingSecrets: string[] = [];
      if (betterAuthSecret === "missing") {
        missingSecrets.push("betterAuthSecret");
      }
      if (cronSecret === "missing") {
        missingSecrets.push("cronSecret");
      }

      const capabilities = {
        telegram: context.capabilities.telegram,
        anthropic: context.capabilities.anthropic,
        resend: context.capabilities.resend,
        mobilePairing: context.capabilities.mobilePairing,
        sentry: context.capabilities.sentry ?? false,
      };

      // Project each family to exactly `{ provider, state }` so no extra field
      // a future status might carry can reach the public probe.
      const integrations = Object.fromEntries(
        Object.entries(context.integrations ?? {}).map(([family, { provider, state }]) => [
          family,
          { provider, state },
        ]),
      );

      const status =
        database === "unreachable"
          ? "unready"
          : missingSecrets.length > 0 ||
              storage === "unwritable" ||
              backups === "failing" ||
              backups === "stale"
            ? "degraded"
            : "ok";

      logger.info("health.readiness.checked", {
        correlationId: context.correlationId,
        status,
        databaseStatus: database,
        missingSecrets,
        storageStatus: storage,
        backupStatus: backups,
      });

      return {
        status,
        checks: {
          database,
          secrets: {
            betterAuthSecret,
            cronSecret,
          },
          capabilities,
          storage,
          backups,
          integrations,
        },
        timestamp: new Date().toISOString(),
      };
    }),
};
