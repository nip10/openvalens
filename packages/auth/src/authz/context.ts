import type { Auth } from "../index";
import { getRegisteredAuth } from "../index";

export type AuthzUser = {
  id: string;
  email: string;
  name: string | null;
};

export type AuthzSession = {
  id: string;
  userId: string;
  activeOrganizationId: string | null;
  expiresAt: Date | null;
};

export type AuthzMember = {
  id: string;
  userId: string;
  organizationId: string;
  role: string;
};

export type AuthContext = {
  user: AuthzUser | null;
  session: AuthzSession | null;
  activeOrganizationId: string | null;
  member: AuthzMember | null;
  role: string | null;
};

/**
 * Structural subset of a Hono `Context` (and a raw `Request`-bearing object).
 * Hono's `Context` satisfies this shape, so guards can be called as
 * `requirePermission(c, { resource, action })` without importing Hono here.
 */
export type AuthzRequestContext = {
  req: { raw: { headers: Headers } };
};

/**
 * Loosely-typed view of the Better Auth API surface used by the authz layer.
 * Kept narrow so `@openvalens/auth` does not depend on the generated plugin
 * endpoint types (which differ between web and future native call sites).
 */
export type AuthzAuthApi = {
  getSession: (input: { headers: Headers }) => Promise<unknown>;
  getActiveMember: (input: { headers: Headers }) => Promise<unknown>;
  getActiveMemberRole: (input: {
    headers: Headers;
    query?: { organizationId?: string };
  }) => Promise<unknown>;
  hasPermission: (input: {
    headers: Headers;
    body: { organizationId: string; permissions: Record<string, readonly string[]> };
  }) => Promise<unknown>;
  setActiveOrganization: (input: {
    headers: Headers;
    body: { organizationId: string };
  }) => Promise<unknown>;
};

export function resolveAuthzApi(auth: Auth): AuthzAuthApi {
  return auth.api as unknown as AuthzAuthApi;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseAuthzUser(sessionValue: unknown): AuthzUser | null {
  if (!isRecord(sessionValue) || !isRecord(sessionValue.user)) {
    return null;
  }

  const user = sessionValue.user;
  if (typeof user.id !== "string" || typeof user.email !== "string") {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    name: typeof user.name === "string" ? user.name : null,
  };
}

function parseAuthzSession(sessionValue: unknown): AuthzSession | null {
  if (!isRecord(sessionValue) || !isRecord(sessionValue.session)) {
    return null;
  }

  const session = sessionValue.session;
  if (typeof session.id !== "string" || typeof session.userId !== "string") {
    return null;
  }

  const activeOrganizationId =
    typeof session.activeOrganizationId === "string" ? session.activeOrganizationId : null;

  return {
    id: session.id,
    userId: session.userId,
    activeOrganizationId,
    expiresAt: session.expiresAt instanceof Date ? session.expiresAt : null,
  };
}

function parseAuthzMember(value: unknown): AuthzMember | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.id !== "string" ||
    typeof value.userId !== "string" ||
    typeof value.organizationId !== "string" ||
    typeof value.role !== "string"
  ) {
    return null;
  }

  return {
    id: value.id,
    userId: value.userId,
    organizationId: value.organizationId,
    role: value.role,
  };
}

function parseRole(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }

  return typeof value.role === "string" ? value.role : null;
}

export function emptyAuthContext(): AuthContext {
  return {
    user: null,
    session: null,
    activeOrganizationId: null,
    member: null,
    role: null,
  };
}

async function resolveActiveMember(auth: Auth, headers: Headers): Promise<AuthzMember | null> {
  const api = resolveAuthzApi(auth);

  try {
    return parseAuthzMember(await api.getActiveMember({ headers }));
  } catch {
    // Fall through to the role-only endpoint below.
  }

  return null;
}

async function resolveActiveMemberRole(
  auth: Auth,
  headers: Headers,
  organizationId: string,
): Promise<string | null> {
  const api = resolveAuthzApi(auth);

  try {
    return parseRole(await api.getActiveMemberRole({ headers, query: { organizationId } }));
  } catch {
    return null;
  }
}

/**
 * Resolves the authenticated user, session, active organization, member row
 * and role from the request headers. Never throws — returns an empty context
 * when the request is unauthenticated or Better Auth cannot be reached.
 */
export async function getAuthContext(
  context: AuthzRequestContext,
  auth: Auth = getRegisteredAuth(),
): Promise<AuthContext> {
  const headers = context.req.raw.headers;

  let sessionValue: unknown;
  try {
    sessionValue = await resolveAuthzApi(auth).getSession({ headers });
  } catch {
    return emptyAuthContext();
  }

  const user = parseAuthzUser(sessionValue);
  const session = parseAuthzSession(sessionValue);
  const activeOrganizationId = session?.activeOrganizationId ?? null;

  if (!user || !activeOrganizationId) {
    return {
      user,
      session,
      activeOrganizationId,
      member: null,
      role: null,
    };
  }

  const member = await resolveActiveMember(auth, headers);
  const role = member?.role ?? (await resolveActiveMemberRole(auth, headers, activeOrganizationId));

  return {
    user,
    session,
    activeOrganizationId,
    member,
    role,
  };
}
