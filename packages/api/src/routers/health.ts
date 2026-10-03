import { sql, type Database } from "@openvalens/db";
import { createStructuredLogger } from "@openvalens/observability";
import { z } from "zod";

import { publicProcedure } from "../index";

/** Hard ceiling for the readiness DB ping. */
const DB_PING_TIMEOUT_MS = 5_000;

/** Minimum length for `CRON_SECRET` (mirrors `.env.schema`). */
const MIN_CRON_SECRET_LENGTH = 16;

// Issue #11 — PHI-safe structured logger for readiness events. The readiness
// body carries no PHI, but every line still goes through the shared logger so
// the correlation id and redaction posture are consistent.
const logger = createStructuredLogger({ level: "info" });

export const readinessOutput = z.object({
  status: z.enum(["ok", "degraded", "unready"]),
  checks: z.object({
    database: z.enum(["ok", "unreachable"]),
    secrets: z.object({
      betterAuthSecret: z.enum(["ok", "missing"]),
      cronSecret: z.enum(["ok", "missing"]),
    }),
    capabilities: z.record(z.string(), z.boolean()),
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
      };

      const status =
        database === "unreachable" ? "unready" : missingSecrets.length > 0 ? "degraded" : "ok";

      logger.info("health.readiness.checked", {
        correlationId: context.correlationId,
        status,
        databaseStatus: database,
        missingSecrets,
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
        },
        timestamp: new Date().toISOString(),
      };
    }),
};
