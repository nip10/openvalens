import {
  assertTenantBoundary,
  TenantViolationError,
  writeAuditLog,
  type AuditEventType,
} from "@openvalens/audit-security";
import type { Action, Resource } from "@openvalens/auth/access/permissions";
import type { AuthzRequestContext } from "@openvalens/auth/authz/context";
import {
  AuthzHttpError,
  requirePermission,
  type OrgAuthContext,
} from "@openvalens/auth/authz/guard";
import { ORPCError, os } from "@orpc/server";
import { z } from "zod";

import type { Context } from "./context";
import { raiseApiError, type ORPCErrorCode } from "./errors";

export * from "./errors";

export const o = os.$context<Context>();

export const publicProcedure = o;

const requireAuth = o.middleware(async ({ context, next }) => {
  if (!context.session?.user) {
    throw raiseApiError("UNAUTHENTICATED", "Authentication required.");
  }
  return next({
    context: {
      session: context.session,
    },
  });
});

export const protectedProcedure = publicProcedure.use(requireAuth);

/**
 * Validates the procedure input with a Zod schema and raises the stable
 * `INVALID_INPUT` envelope on failure.
 *
 * Declare it before `.input(schema)` so it runs ahead of oRPC's built-in
 * validator (which would otherwise surface a generic `BAD_REQUEST`).
 */
export function validateInput(schema: z.ZodType) {
  return o.middleware(async ({ next }, input) => {
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      throw raiseApiError("INVALID_INPUT", "Invalid input", parsed.error.flatten());
    }
    return next({});
  });
}

export type PermissionedProcedureInput = {
  resource: Resource;
  action: Action;
};

/**
 * Normalises guard + unknown failures into the stable error envelope so
 * downstream clients only ever see `ORPCError` with an `ORPCErrorCode`.
 */
function toApiError(error: unknown): ORPCError<ORPCErrorCode, unknown> {
  if (error instanceof AuthzHttpError) {
    return raiseApiError(error.code, error.message);
  }

  if (error instanceof TenantViolationError) {
    return raiseApiError("TENANT_VIOLATION", error.message);
  }

  if (error instanceof ORPCError) {
    return error as ORPCError<ORPCErrorCode, unknown>;
  }

  return raiseApiError("INTERNAL", "Something went wrong.");
}

/**
 * Authenticated + RBAC-guarded procedure.
 *
 * Delegates to `requirePermission` from `@openvalens/auth/authz/guard` and
 * exposes the resolved org context to the handler as `context.authz`.
 */
export function permissionedProcedure({ resource, action }: PermissionedProcedureInput) {
  return protectedProcedure.use(
    o.middleware(async ({ context, next }) => {
      const requestContext: AuthzRequestContext = {
        req: { raw: { headers: context.honoContext.req.raw.headers } },
      };

      let authz;
      try {
        authz = await requirePermission(requestContext, { resource, action });
      } catch (error) {
        throw toApiError(error);
      }

      return next({ context: { authz } });
    }),
  );
}

/**
 * Cron-only procedure guarded by `Authorization: Bearer ${CRON_SECRET}`.
 *
 * Mirrors the anchovy cron endpoint guard: missing or mismatched secret is
 * rejected with `401 UNAUTHENTICATED`.
 */
export const cronProcedure = publicProcedure.use(
  o.middleware(async ({ context, next }) => {
    const header = context.honoContext.req.raw.headers.get("authorization");

    if (!header || header !== `Bearer ${context.cronSecret}`) {
      throw raiseApiError("UNAUTHENTICATED", "Invalid or missing cron secret");
    }

    return next({});
  }),
);

export type TenantScopedProcedureInput = PermissionedProcedureInput & {
  /** Audit event written after a successful handler run. */
  auditAction: AuditEventType;
  /** Persisted as `access_audit_log.target_type` (e.g. `"record"`). */
  targetType?: string;
  /**
   * Resolves the organization that owns the resource being accessed.
   *
   * Defaults to reading `organizationId` (or `orgId`) off the procedure input.
   * When the resolved org differs from the actor's active organization the call
   * is rejected with `403 TENANT_VIOLATION` and a `TENANT_VIOLATION_BLOCKED`
   * audit entry is written before the error is raised.
   */
  resolveTenantOrgId?: (input: unknown) => string | null | undefined;
};

function defaultResolveTenantOrgId(input: unknown): string | undefined {
  if (!input || typeof input !== "object") {
    return undefined;
  }

  const candidate = input as { organizationId?: unknown; orgId?: unknown };
  if (typeof candidate.organizationId === "string") {
    return candidate.organizationId;
  }
  if (typeof candidate.orgId === "string") {
    return candidate.orgId;
  }

  return undefined;
}

function extractTargetId(output: unknown): string | undefined {
  if (!output || typeof output !== "object" || !("targetId" in output)) {
    return undefined;
  }

  const value = (output as { targetId?: unknown }).targetId;
  return typeof value === "string" ? value : undefined;
}

/**
 * Authenticated + RBAC-guarded + tenant-scoped procedure that writes an audit
 * entry per successful call.
 *
 * Composes the existing guards rather than reimplementing them:
 * `protectedProcedure` (session) → `permissionedProcedure`
 * (`requireOrgMembership` + `requirePermission`) → tenant boundary → audit.
 *
 * On success the handler output is scanned for a `targetId` field and the audit
 * row records `{ organizationId, actorUserId, eventType, targetType, targetId,
 * correlationId }`. A handler that throws writes no audit entry; audit-write
 * failures are logged and swallowed by `writeAuditLog` so they never fail the
 * request.
 */
export function tenantScopedProcedure({
  resource,
  action,
  auditAction,
  targetType,
  resolveTenantOrgId,
}: TenantScopedProcedureInput) {
  return permissionedProcedure({ resource, action }).use(
    o.middleware(async ({ context, next }, input) => {
      // `permissionedProcedure` ran upstream and injected `authz` via
      // `next({ context: { authz } })`; `o.middleware` only types the base
      // `Context`, so narrow the runtime value here.
      const { authz } = context as typeof context & { authz: OrgAuthContext };
      const tenantOrgId = authz.activeOrganizationId;
      const resourceOrgId = resolveTenantOrgId
        ? resolveTenantOrgId(input)
        : defaultResolveTenantOrgId(input);

      if (resourceOrgId) {
        try {
          assertTenantBoundary(tenantOrgId, resourceOrgId);
        } catch (error) {
          if (error instanceof TenantViolationError) {
            await writeAuditLog({
              db: context.db,
              organizationId: tenantOrgId,
              actorUserId: authz.user.id,
              eventType: "TENANT_VIOLATION_BLOCKED",
              targetType,
              targetId: resourceOrgId,
              correlationId: context.correlationId,
              metadata: { attemptedOrganizationId: resourceOrgId },
            });
          }
          throw toApiError(error);
        }
      }

      const result = await next({ context: { tenantOrgId } });

      await writeAuditLog({
        db: context.db,
        organizationId: tenantOrgId,
        actorUserId: authz.user.id,
        eventType: auditAction,
        targetType,
        targetId: extractTargetId(result.output),
        correlationId: context.correlationId,
        metadata: { resource, action },
      });

      return result;
    }),
  );
}
