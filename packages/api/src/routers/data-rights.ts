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
