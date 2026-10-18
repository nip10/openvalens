import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import * as auditSecurity from "@openvalens/audit-security";
import * as authzGuard from "@openvalens/auth/authz/guard";
import type { StorageService, StoredObjectRecord } from "@openvalens/storage";

import type { Context } from "../context";

const actualGuard = { ...authzGuard };
const actualAudit = { ...auditSecurity };

class AuthzHttpError extends Error {
  constructor(
    readonly code: "NO_MEMBERSHIP" | "PERMISSION_DENIED",
    readonly status = 403,
  ) {
    super("denied");
  }
}

let activeOrg: string | null = "org-a";
let activeUserId = "user-a";
let activeRole = "viewer";
let denied = false;
const membership = () => ({
  user: { id: activeUserId },
  activeOrganizationId: activeOrg,
  role: activeRole,
  member: { role: activeRole },
});
const requireOrgMembership = mock(async () => {
  if (!activeOrg) throw new AuthzHttpError("NO_MEMBERSHIP");
  return membership();
});
const requirePermission = mock(async (_request: unknown, _permission: unknown) => {
  if (denied) throw new AuthzHttpError("PERMISSION_DENIED");
  return membership();
});
const audit = mock(async (_input: unknown) => {});
mock.module("@openvalens/auth/authz/guard", () => ({
  ...actualGuard,
  AuthzHttpError,
  requireOrgMembership,
  requirePermission,
}));
mock.module("@openvalens/audit-security", () => ({ ...actualAudit, writeAuditLog: audit }));

const { storageRouter } = await import("./storage");
const { appRouter } = await import("./index");
afterAll(() => {
  mock.module("@openvalens/auth/authz/guard", () => actualGuard);
  mock.module("@openvalens/audit-security", () => actualAudit);
});

const OBJECT_ID = "0b6f3a52-9b5e-4c1e-8d7a-1f2e3d4c5b6a";
const object: StoredObjectRecord = {
  id: OBJECT_ID,
  organizationId: "org-a",
  createdByUserId: "user-a",
  purpose: "progress_photo",
  contentType: "image/jpeg",
  sizeBytes: 10,
  sha256: "a".repeat(64),
  createdAt: new Date("2026-10-15T12:00:00Z"),
};

const findObject = mock(async (ref: { organizationId: string; objectId: string }) =>
  ref.organizationId === object.organizationId && ref.objectId === object.id ? object : null,
);
const createDownloadUrl = mock(async () => ({
  url: `/api/storage/objects/${OBJECT_ID}?e=1&s=sig`,
  expiresAt: new Date("2026-10-15T12:05:00Z"),
}));
const deleteObject = mock(async (_ref: { organizationId: string; objectId: string }) => true);
const storage = { findObject, createDownloadUrl, deleteObject } as unknown as StorageService;

function context(options: { authenticated?: boolean; withStorage?: boolean } = {}): Context {
  const { authenticated = true, withStorage = true } = options;
  return {
    db: {},
    session: authenticated ? { user: { id: "actor" } } : null,
    correlationId: "test",
    storage: withStorage ? storage : null,
    honoContext: { req: { raw: { headers: new Headers() } } },
  } as unknown as Context;
}

async function code(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

beforeEach(() => {
  activeOrg = "org-a";
  activeUserId = "user-a";
  activeRole = "viewer";
  denied = false;
  object.createdByUserId = "user-a";
  object.purpose = "progress_photo";
  for (const fn of [
    requireOrgMembership,
    requirePermission,
    audit,
    findObject,
    createDownloadUrl,
    deleteObject,
  ])
    fn.mockClear();
});

describe("storage.downloadUrl", () => {
  const call = (ctx: Context, input: unknown) =>
    storageRouter.downloadUrl.callable({ context: ctx })(input as { objectId: string });

  test("is mounted and returns a short-lived signed URL for an authorized reader", async () => {
    expect(appRouter.storage.downloadUrl).toBe(storageRouter.downloadUrl);
    expect(await call(context(), { objectId: OBJECT_ID })).toEqual({
      url: `/api/storage/objects/${OBJECT_ID}?e=1&s=sig`,
      expiresAt: "2026-10-15T12:05:00.000Z",
      contentType: "image/jpeg",
      sizeBytes: 10,
    });
    expect(findObject.mock.calls[0]![0]).toEqual({ organizationId: "org-a", objectId: OBJECT_ID });
    expect(requirePermission.mock.calls[0]![1]).toEqual({ resource: "weight", action: "read" });
  });

  test("another organization's object is not found, before any permission check", async () => {
    activeOrg = "org-b";
    expect(await code(call(context(), { objectId: OBJECT_ID }))).toBe("NOT_FOUND");
    expect(requirePermission).not.toHaveBeenCalled();
    expect(createDownloadUrl).not.toHaveBeenCalled();
  });

  test("progress photos are private to the uploader, including from workspace owners", async () => {
    activeUserId = "another-member";
    expect(await code(call(context(), { objectId: OBJECT_ID }))).toBe("NOT_FOUND");
    expect(requirePermission.mock.calls[0]![1]).toEqual({ resource: "weight", action: "read" });
    expect(createDownloadUrl).not.toHaveBeenCalled();

    requirePermission.mockClear();
    activeRole = "owner";
    expect(await code(call(context(), { objectId: OBJECT_ID }))).toBe("NOT_FOUND");
    expect(requirePermission.mock.calls[0]![1]).toEqual({ resource: "weight", action: "read" });
    expect(createDownloadUrl).not.toHaveBeenCalled();
  });

  test("an unattributed progress photo fails closed; its uploader may mint a link", async () => {
    object.createdByUserId = null;
    expect(await code(call(context(), { objectId: OBJECT_ID }))).toBe("NOT_FOUND");
    expect(createDownloadUrl).not.toHaveBeenCalled();

    object.createdByUserId = "user-a";
    expect((await call(context(), { objectId: OBJECT_ID })).url).toContain(OBJECT_ID);
    expect(createDownloadUrl).toHaveBeenCalledTimes(1);
  });

  test("same-organization members retain access to non-photo purposes under RBAC", async () => {
    object.purpose = "lab_document";
    activeUserId = "another-member";
    activeRole = "owner";
    expect((await call(context(), { objectId: OBJECT_ID })).url).toContain(OBJECT_ID);
    expect(requirePermission.mock.calls[0]![1]).toEqual({ resource: "blood", action: "read" });
  });

  test("a role without read permission is denied", async () => {
    denied = true;
    expect(await code(call(context(), { objectId: OBJECT_ID }))).toBe("PERMISSION_DENIED");
    expect(createDownloadUrl).not.toHaveBeenCalled();
  });

  test("requires a session and an active membership", async () => {
    expect(await code(call(context({ authenticated: false }), { objectId: OBJECT_ID }))).toBe(
      "UNAUTHENTICATED",
    );
    activeOrg = null;
    expect(await code(call(context(), { objectId: OBJECT_ID }))).toBe("NO_MEMBERSHIP");
    expect(findObject).not.toHaveBeenCalled();
  });

  test("rejects non-uuid ids and any organization override in the input", async () => {
    expect(await code(call(context(), { objectId: "../etc/passwd" }))).toBe("INVALID_INPUT");
    expect(await code(call(context(), { objectId: OBJECT_ID, organizationId: "org-a" }))).toBe(
      "INVALID_INPUT",
    );
    expect(findObject).not.toHaveBeenCalled();
  });

  test("fails closed when storage is off", async () => {
    expect(await code(call(context({ withStorage: false }), { objectId: OBJECT_ID }))).toBe(
      "INTERNAL",
    );
  });
});

describe("storage.delete", () => {
  const call = (ctx: Context, input: unknown) =>
    storageRouter.delete.callable({ context: ctx })(input as { objectId: string });

  test("needs write permission, deletes within the tenant and audits", async () => {
    expect(await call(context(), { objectId: OBJECT_ID })).toEqual({ deleted: true });
    expect(requirePermission.mock.calls[0]![1]).toEqual({ resource: "weight", action: "write" });
    expect(deleteObject.mock.calls[0]).toEqual([{ organizationId: "org-a", objectId: OBJECT_ID }]);
    expect(audit.mock.calls[0]![0]).toMatchObject({
      organizationId: "org-a",
      eventType: "RECORD_DELETED",
      targetType: "stored_object",
      targetId: OBJECT_ID,
    });
  });

  test("denied or cross-tenant deletes touch nothing", async () => {
    denied = true;
    expect(await code(call(context(), { objectId: OBJECT_ID }))).toBe("PERMISSION_DENIED");
    denied = false;
    activeOrg = "org-b";
    expect(await code(call(context(), { objectId: OBJECT_ID }))).toBe("NOT_FOUND");
    expect(deleteObject).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  test("another member and workspace owner cannot delete a private photo", async () => {
    activeUserId = "another-member";
    expect(await code(call(context(), { objectId: OBJECT_ID }))).toBe("NOT_FOUND");
    activeRole = "owner";
    expect(await code(call(context(), { objectId: OBJECT_ID }))).toBe("NOT_FOUND");
    expect(deleteObject).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  test("unattributed photos cannot be deleted by an organization owner", async () => {
    activeRole = "owner";
    object.createdByUserId = null;
    expect(await code(call(context(), { objectId: OBJECT_ID }))).toBe("NOT_FOUND");
    expect(deleteObject).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  test("the matching uploader can delete their photo", async () => {
    expect(await call(context(), { objectId: OBJECT_ID })).toEqual({ deleted: true });
    expect(deleteObject).toHaveBeenCalledTimes(1);
  });
});
