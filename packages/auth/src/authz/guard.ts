import type { Action, Resource } from "../access/permissions";
import type { Auth } from "../index";
import { getRegisteredAuth } from "../index";
import {
  getAuthContext,
  resolveAuthzApi,
  type AuthContext,
  type AuthzMember,
  type AuthzRequestContext,
  type AuthzSession,
  type AuthzUser,
} from "./context";

export type AuthzErrorCode = "UNAUTHENTICATED" | "NO_MEMBERSHIP" | "PERMISSION_DENIED";

/**
 * HTTP-shaped authorization error. Carries a stable machine `code` so the
 * Hono server can map it to a JSON envelope without parsing the message.
 */
export class AuthzHttpError extends Error {
  readonly status: 401 | 403;
  readonly code: AuthzErrorCode;

  constructor(status: 401 | 403, code: AuthzErrorCode, message: string) {
    super(message);
    this.name = "AuthzHttpError";
    this.status = status;
    this.code = code;
  }
}

export type SessionAuthContext = AuthContext & {
  user: AuthzUser;
  session: AuthzSession;
};

export type OrgAuthContext = SessionAuthContext & {
  activeOrganizationId: string;
  member: AuthzMember;
  role: string;
};

export type PermissionGuardInput = {
  resource: Resource;
  action: Action;
};

function unauthenticated(): AuthzHttpError {
  return new AuthzHttpError(401, "UNAUTHENTICATED", "Authentication required.");
}

function noMembership(): AuthzHttpError {
  return new AuthzHttpError(403, "NO_MEMBERSHIP", "An active organization membership is required.");
}

function permissionDenied(): AuthzHttpError {
  return new AuthzHttpError(
    403,
    "PERMISSION_DENIED",
    "You do not have permission to perform this action.",
  );
}

export async function requireSession(
  context: AuthzRequestContext,
  auth: Auth = getRegisteredAuth(),
): Promise<SessionAuthContext> {
  const authContext = await getAuthContext(context, auth);

  if (!authContext.user || !authContext.session) {
    throw unauthenticated();
  }

  return authContext as SessionAuthContext;
}

export async function requireOrgMembership(
  context: AuthzRequestContext,
  auth: Auth = getRegisteredAuth(),
): Promise<OrgAuthContext> {
  const sessionContext = await requireSession(context, auth);

  if (!sessionContext.activeOrganizationId || !sessionContext.member || !sessionContext.role) {
    throw noMembership();
  }

  return sessionContext as OrgAuthContext;
}

/**
 * Resolves the active org membership, then asks Better Auth
 * `hasPermission` whether the member's role grants `resource:action`.
 *
 * Throws `AuthzHttpError` with `401 UNAUTHENTICATED`, `403 NO_MEMBERSHIP` or
 * `403 PERMISSION_DENIED`.
 */
export async function requirePermission(
  context: AuthzRequestContext,
  input: PermissionGuardInput,
  auth: Auth = getRegisteredAuth(),
): Promise<OrgAuthContext> {
  const orgContext = await requireOrgMembership(context, auth);

  let result: unknown;
  try {
    result = await resolveAuthzApi(auth).hasPermission({
      headers: context.req.raw.headers,
      body: {
        organizationId: orgContext.activeOrganizationId,
        permissions: {
          [input.resource]: [input.action],
        },
      },
    });
  } catch (error) {
    if (error instanceof AuthzHttpError) {
      throw error;
    }

    throw permissionDenied();
  }

  if (!result || (result as { success?: unknown }).success !== true) {
    throw permissionDenied();
  }

  return orgContext;
}
