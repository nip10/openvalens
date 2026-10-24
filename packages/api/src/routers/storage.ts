import { writeAuditLog } from "@openvalens/audit-security";
import type { AuthzRequestContext } from "@openvalens/auth/authz/context";
import { requireTrustedIdentity } from "@openvalens/auth/authz/trusted-session";
import {
  AuthzHttpError,
  requireOrgMembership,
  requirePermission,
  type OrgAuthContext,
} from "@openvalens/auth/authz/guard";
import { createStructuredLogger } from "@openvalens/observability";
import {
  describeStorageError,
  PURPOSE_POLICIES,
  type StorageService,
  type StoredObjectRecord,
} from "@openvalens/storage";
import { z } from "zod";

import type { Context } from "../context";
import { protectedProcedure, raiseApiError, validateInput } from "../index";

/**
 * Object storage procedures (Issue #62).
 *
 * Objects are private. A client never receives a storage key or a permanent
 * URL: it asks for a short-lived signed download URL here, after the server
 * has checked that the object belongs to the caller's *active* organization
 * (from the session, never from input) and that the caller's role grants
 * `read` on the object's purpose resource (`PURPOSE_POLICIES`). Progress
 * photos additionally require the authenticated uploader; organization roles
 * do not grant access to another member's photos. An object in another
 * organization or a non-owned photo is indistinguishable from a missing one.
 *
 * Uploads are not a generic endpoint: a feature writes through its own
 * procedure with its own validation. Today the only writer is #85 progress
 * photos (`privateBody.uploadPhoto` → `reservePhoto`/`writePhoto`); no
 * procedure calls `StorageService.putObject`, and the clinical PDF export
 * returns its file in the response instead of storing it.
 */

const logger = createStructuredLogger({ level: "info" });

const objectInput = z.strictObject({ objectId: z.uuid() });

const downloadUrlOutput = z.object({
  url: z.string(),
  expiresAt: z.string(),
  contentType: z.string(),
  sizeBytes: z.number(),
});

function requireStorage(context: Context): StorageService {
  if (!context.storage) throw raiseApiError("INTERNAL", "Storage is not available.");
  return context.storage;
}

function requestContext(context: Context): AuthzRequestContext {
  return { req: { raw: { headers: context.honoContext.req.raw.headers } } };
}

function isTrustedPhotoOwner(context: Context, uploaderId: string | null): boolean {
  if (!uploaderId) return false;
  try {
    return requireTrustedIdentity(context.session).userId === uploaderId;
  } catch {
    return false;
  }
}

async function authorized<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof AuthzHttpError) throw raiseApiError(error.code, error.message);
    throw error;
  }
}

/**
 * Resolves the object inside the active organization, then checks the role
 * permission its purpose requires. Not found (including another tenant's id)
 * is reported before any permission detail is revealed.
 */
async function loadAuthorizedObject(
  context: Context,
  storage: StorageService,
  objectId: string,
  action: "read" | "write",
): Promise<{ object: StoredObjectRecord; authz: OrgAuthContext }> {
  const membership = await authorized(() => requireOrgMembership(requestContext(context)));
  const object = await storage.findObject({
    organizationId: membership.activeOrganizationId,
    objectId,
  });
  if (!object) throw raiseApiError("NOT_FOUND", "Object not found.");
  const authz = await authorized(() =>
    requirePermission(requestContext(context), {
      resource: PURPOSE_POLICIES[object.purpose].resource,
      action,
    }),
  );
  if (authz.activeOrganizationId !== object.organizationId)
    throw raiseApiError("NOT_FOUND", "Object not found.");
  // Progress photos are intrinsically member-private. This check deliberately
  // does not special-case owners or admins. A missing creator is not
  // attributable and therefore fails closed. Other purposes retain their
  // existing organization-RBAC semantics.
  if (object.purpose === "progress_photo" && object.createdByUserId !== authz.user.id)
    throw raiseApiError("NOT_FOUND", "Object not found.");
  return { object, authz };
}

async function loadAuthorizedDeleteObject(
  context: Context,
  storage: StorageService,
  objectId: string,
): Promise<{ object: StoredObjectRecord; authz: OrgAuthContext }> {
  const membership = await authorized(() => requireOrgMembership(requestContext(context)));
  const ref = { organizationId: membership.activeOrganizationId, objectId };
  const object = await storage.findObjectForDeletion(ref);
  if (!object) throw raiseApiError("NOT_FOUND", "Object not found.");
  const authz = await authorized(() =>
    requirePermission(requestContext(context), {
      resource: PURPOSE_POLICIES[object.purpose].resource,
      action: "write",
    }),
  );
  if (authz.activeOrganizationId !== object.organizationId)
    throw raiseApiError("NOT_FOUND", "Object not found.");
  if (object.purpose === "progress_photo") {
    if (!isTrustedPhotoOwner(context, object.createdByUserId))
      throw raiseApiError("NOT_FOUND", "Object not found.");
  }
  return { object, authz };
}

export const storageRouter = {
  downloadUrl: protectedProcedure
    .use(validateInput(objectInput))
    .input(objectInput)
    .output(downloadUrlOutput)
    .handler(async ({ context, input }) => {
      const storage = requireStorage(context);
      const { object } = await loadAuthorizedObject(context, storage, input.objectId, "read");
      if (object.purpose === "progress_photo") {
        if (!isTrustedPhotoOwner(context, object.createdByUserId))
          throw raiseApiError("NOT_FOUND", "Object not found.");
      }
      const link = await storage.createDownloadUrl({
        organizationId: object.organizationId,
        objectId: object.id,
      });
      if (!link) throw raiseApiError("NOT_FOUND", "Object not found.");
      return {
        url: link.url,
        expiresAt: link.expiresAt.toISOString(),
        contentType: object.contentType,
        sizeBytes: object.sizeBytes,
      };
    }),

  delete: protectedProcedure
    .use(validateInput(objectInput))
    .input(objectInput)
    .output(
      z.union([
        z.object({ deleted: z.literal(true) }),
        z.object({ deleted: z.literal(false), pending: z.literal(true) }),
      ]),
    )
    .handler(async ({ context, input }) => {
      const storage = requireStorage(context);
      const { object, authz } = await loadAuthorizedDeleteObject(context, storage, input.objectId);
      let deletion: "deleted" | "pending" | "not_found";
      try {
        deletion = await storage.deleteObject({
          organizationId: object.organizationId,
          objectId: object.id,
        });
      } catch (error) {
        logger.error("storage.object.delete_failed", {
          correlationId: context.correlationId,
          organizationId: object.organizationId,
          objectId: object.id,
          ...describeStorageError(error),
        });
        throw raiseApiError("INTERNAL", "Something went wrong.");
      }
      if (deletion === "not_found") throw raiseApiError("NOT_FOUND", "Object not found.");
      await writeAuditLog({
        db: context.db,
        organizationId: object.organizationId,
        actorUserId: authz.user.id,
        eventType: "RECORD_DELETED",
        targetType: "stored_object",
        targetId: object.id,
        correlationId: context.correlationId,
        metadata: { purpose: object.purpose },
      });
      return deletion === "pending"
        ? { deleted: false as const, pending: true as const }
        : { deleted: true as const };
    }),
};
