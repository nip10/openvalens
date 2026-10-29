import {
  DELETE_CONFIRMATION,
  deleteSelfSubjectData,
  PhotoErasureBlockedError,
  SelfErasureError,
  isFreshSession,
  previewSubjectData,
  resolveSubject,
} from "@openvalens/data-rights";
import type { PendingRevocation, SocialTokenRevocation } from "@openvalens/auth/social";
import { createStructuredLogger } from "@openvalens/observability";
import { sql } from "@openvalens/db";
import { z } from "zod";

import { protectedProcedure, raiseApiError, validateInput } from "../index";

/**
 * Data-rights procedures (Issue #89): preview and perform "delete everything".
 *
 * The subject is always the signed-in user and the health records they own;
 * inputs are `strictObject` so no user or organization id can be supplied.
 * Deleting requires a sign-in within the last 10 minutes, the typed phrase
 * "DELETE", and no owned record shared with another owner. Logs carry counts
 * only; the erasure ledger keeps the ids.
 *
 * Stored objects (#62): their keys are collected before the database
 * transaction and the bytes are deleted from object storage after it commits,
 * so a failed transaction never loses an object that is still indexed. If the
 * subject has objects but storage is off, deletion is refused rather than
 * orphaning their bytes.
 *
 * Sign in with Apple (#296): the account's Apple tokens are read before the
 * erasure and revoked through Apple's API after it commits (App Store Review
 * Guideline 5.1.1(v)). A failed revocation is logged as a count and never
 * undoes the deletion.
 *
 * Cloud billing (#297): erasing a subscription row that reached Stripe queues
 * its customer (a database trigger, in the same transaction). Right after the
 * commit the billing service cancels the Stripe subscription immediately and
 * deletes the customer; a failure is retried by the billing job.
 */

const logger = createStructuredLogger({ level: "info" });

const previewInput = z.strictObject({});
const deleteInput = z.strictObject({ confirmation: z.string().max(32) });

const previewOutput = z.object({
  organizations: z.array(z.object({ id: z.string(), name: z.string() })),
  blockers: z.array(
    z.object({
      organizationId: z.string(),
      organizationName: z.string(),
      reason: z.literal("OTHER_OWNER"),
    }),
  ),
  rowCounts: z.record(z.string(), z.number()),
  totalRows: z.number(),
  reauthRequired: z.boolean(),
  confirmationPhrase: z.string(),
});

const deleteOutput = z.object({
  erasedAt: z.string(),
  totalRows: z.number(),
});

const exportStatusOutput = z.object({
  id: z.string(),
  state: z.enum(["queued", "running", "ready", "failed", "cancelled", "expired"]),
  createdAt: z.string(),
  expiresAt: z.string().nullable(),
  bytes: z.number().nullable(),
  failure: z
    .enum([
      "LIMIT_EXCEEDED",
      "ATTACHMENT_UNAVAILABLE",
      "STORAGE_UNAVAILABLE",
      "INTERRUPTED",
      "INTERNAL",
    ])
    .nullable(),
});

type ExportJobRow = {
  id: string;
  state: "queued" | "running" | "ready" | "failed" | "cancelled" | "expired";
  created_at: Date | string;
  expires_at: Date | string | null;
  bytes: number | null;
  failure:
    | "LIMIT_EXCEEDED"
    | "ATTACHMENT_UNAVAILABLE"
    | "STORAGE_UNAVAILABLE"
    | "INTERRUPTED"
    | "INTERNAL"
    | null;
};
function exportStatus(row: ExportJobRow) {
  return {
    id: row.id,
    state: row.state,
    createdAt: new Date(row.created_at).toISOString(),
    expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    bytes: row.bytes == null ? null : Number(row.bytes),
    failure: row.failure,
  };
}

function sessionCreatedAt(session: { session?: { createdAt?: Date | string } }): Date {
  const value = session.session?.createdAt;
  return value instanceof Date ? value : new Date(value ?? 0);
}

function assertSelfServiceSession(context: {
  session: {
    user: { id?: string };
    session?: { id?: string; impersonatedBy?: string | null };
  };
}): { userId: string; sessionId: string } {
  const userId = context.session.user.id;
  const sessionId = context.session.session?.id;
  if (!userId || !sessionId) throw new SelfErasureError("REAUTH_REQUIRED");
  if (context.session.session?.impersonatedBy != null)
    throw new SelfErasureError("PERMISSION_DENIED");
  return { userId, sessionId };
}

function raiseSelfErasureError(error: unknown): never {
  if (error instanceof PhotoErasureBlockedError)
    throw raiseApiError("CONFLICT", "Progress-photo cleanup must finish before account erasure.");
  if (!(error instanceof SelfErasureError)) throw error;
  switch (error.code) {
    case "PERMISSION_DENIED":
      throw raiseApiError("PERMISSION_DENIED", error.message);
    case "REAUTH_REQUIRED":
      throw raiseApiError("REAUTH_REQUIRED", error.message);
    case "CONFLICT":
      throw raiseApiError("CONFLICT", error.message);
    case "STORAGE_UNAVAILABLE":
      throw raiseApiError("INTERNAL", "Storage is not available.");
  }
}

async function collectRevocation(
  revocation: SocialTokenRevocation | undefined,
  userId: string,
): Promise<PendingRevocation | null> {
  if (!revocation) return null;
  try {
    return await revocation.collect(userId);
  } catch {
    // Never block a deletion on reading provider tokens.
    logger.warn("data_rights.provider_tokens_unreadable", {});
    return null;
  }
}

async function revokeAfterErasure(
  revocation: SocialTokenRevocation | undefined,
  pending: PendingRevocation | null,
): Promise<{ revoked: number; failed: number } | null> {
  if (!revocation || !pending || pending.apple.length === 0) return null;
  try {
    return await revocation.revoke(pending);
  } catch {
    return { revoked: 0, failed: pending.apple.length };
  }
}

const sum = (counts: Record<string, number>) => Object.values(counts).reduce((a, b) => a + b, 0);

export const dataRightsRouter = {
  exportRequest: protectedProcedure
    .use(validateInput(previewInput))
    .input(previewInput)
    .output(exportStatusOutput)
    .handler(async ({ context }) => {
      let actor;
      try {
        actor = assertSelfServiceSession(context);
      } catch (error) {
        raiseSelfErasureError(error);
      }
      const result = await context.db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`data-export-request:${actor.userId}`}, 0))`,
        );
        const active =
          await tx.execute(sql`select id, state, created_at, expires_at, bytes, failure from data_export_job
          where subject_user_id = ${actor.userId} and state in ('queued','running','ready')
          and (state <> 'ready' or expires_at > now()) order by created_at desc limit 1`);
        const existing = active.rows[0] as ExportJobRow | undefined;
        if (existing) return existing;
        const rate = await tx.execute(sql`select count(*)::int as n from data_export_job
          where subject_user_id = ${actor.userId} and created_at > now() - interval '24 hours'`);
        if (Number((rate.rows[0] as { n: number }).n) >= 3)
          throw raiseApiError("CONFLICT", "Export request limit reached.");
        const scope = await resolveSubject(context.db, actor.userId);
        const created =
          await tx.execute(sql`insert into data_export_job (subject_user_id, organization_ids)
          values (${actor.userId}, ${JSON.stringify(scope.subject.organizationIds)}::jsonb)
          returning id, state, created_at, expires_at, bytes, failure`);
        return created.rows[0] as ExportJobRow;
      });
      return exportStatus(result);
    }),

  exportStatus: protectedProcedure
    .use(validateInput(previewInput))
    .input(previewInput)
    .output(exportStatusOutput.nullable())
    .handler(async ({ context }) => {
      let actor;
      try {
        actor = assertSelfServiceSession(context);
      } catch (error) {
        raiseSelfErasureError(error);
      }
      await context.db.execute(sql`update data_export_job set state = 'expired', cleanup_pending = 'job'
        where subject_user_id = ${actor.userId} and state = 'ready' and expires_at <= now()`);
      const result = await context.db
        .execute(sql`select id, state, created_at, expires_at, bytes, failure
        from data_export_job where subject_user_id = ${actor.userId} order by created_at desc limit 1`);
      const row = result.rows[0] as ExportJobRow | undefined;
      return row ? exportStatus(row) : null;
    }),

  exportCancel: protectedProcedure
    .use(validateInput(z.strictObject({ jobId: z.string().uuid() })))
    .input(z.strictObject({ jobId: z.string().uuid() }))
    .output(z.void())
    .handler(async ({ input, context }) => {
      let actor;
      try {
        actor = assertSelfServiceSession(context);
      } catch (error) {
        raiseSelfErasureError(error);
      }
      await context.db
        .execute(sql`update data_export_job set state = 'cancelled', attempt_id = null, cleanup_pending = 'job',
        lease_until = null where id = ${input.jobId} and subject_user_id = ${actor.userId}
        and state in ('queued','running','ready')`);
    }),

  deletionPreview: protectedProcedure
    .use(validateInput(previewInput))
    .input(previewInput)
    .output(previewOutput)
    .handler(async ({ context }) => {
      let actor;
      try {
        actor = assertSelfServiceSession(context);
      } catch (error) {
        raiseSelfErasureError(error);
      }
      const resolution = await resolveSubject(context.db, actor.userId);
      const rowCounts = await previewSubjectData(context.db, resolution.subject);
      return {
        organizations: resolution.organizations,
        blockers: resolution.blockers,
        rowCounts,
        totalRows: sum(rowCounts),
        reauthRequired: !isFreshSession(sessionCreatedAt(context.session)),
        confirmationPhrase: DELETE_CONFIRMATION,
      };
    }),

  deleteEverything: protectedProcedure
    .use(validateInput(deleteInput))
    .input(deleteInput)
    .output(deleteOutput)
    .handler(async ({ input, context }) => {
      if (input.confirmation !== DELETE_CONFIRMATION)
        throw raiseApiError("INVALID_INPUT", `Type ${DELETE_CONFIRMATION} to confirm.`);
      let result;
      let pendingRevocation: PendingRevocation | null = null;
      try {
        const actor = assertSelfServiceSession(context);
        pendingRevocation = await collectRevocation(context.socialTokenRevocation, actor.userId);
        result = await deleteSelfSubjectData(context.db, actor, context.storage ?? null);
      } catch (error) {
        raiseSelfErasureError(error);
      }
      const { report, objects } = result;
      const revocation = await revokeAfterErasure(context.socialTokenRevocation, pendingRevocation);
      if (context.billing) {
        try {
          await context.billing.processErasures();
        } catch {
          // Already queued; the billing job retries. Never blocks the erasure.
          logger.warn("data_rights.billing_erasure.deferred", {
            correlationId: context.correlationId,
          });
        }
      }
      const totalRows = sum(report.rowCounts);
      logger.info("data_rights.subject_erased", {
        correlationId: context.correlationId,
        organizations: report.organizationIds.length,
        tables: Object.keys(report.rowCounts).length,
        rows: totalRows,
        objectsDeleted: objects.deleted,
        objectsFailed: objects.failed,
        ...(revocation ? { appleTokensRevoked: revocation.revoked } : {}),
        ...(revocation ? { appleTokensFailed: revocation.failed } : {}),
      });
      return { erasedAt: report.erasedAt, totalRows };
    }),
};
