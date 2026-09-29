import { ORPCError } from "@orpc/server";

/**
 * Tenant-boundary guard (Issue #10).
 *
 * Every oRPC procedure that touches an org-scoped resource must prove that the
 * resource belongs to the actor's active organization. A mismatch is a hard
 * `403 TENANT_VIOLATION` and is never allowed to leak resource data.
 */

export const TENANT_VIOLATION_CODE = "TENANT_VIOLATION" as const;
export const TENANT_VIOLATION_STATUS = 403 as const;

export type TenantViolationErrorData = {
  actorOrganizationId: string | null;
  resourceOrganizationId: string | null;
};

/**
 * Typed error raised when an actor attempts to reach another tenant's data.
 *
 * Carries a stable `code`/`status` pair so the oRPC layer can map it without
 * parsing the message, and {@link TenantViolationError.toApiError} converts it
 * to the shared `ORPCError` envelope.
 */
export class TenantViolationError extends Error {
  readonly code = TENANT_VIOLATION_CODE;
  readonly status = TENANT_VIOLATION_STATUS;
  readonly actorOrganizationId: string | null;
  readonly resourceOrganizationId: string | null;

  constructor(
    actorOrganizationId: string | null | undefined,
    resourceOrganizationId: string | null | undefined,
    message = "Cross-tenant access denied.",
  ) {
    super(message);
    this.name = "TenantViolationError";
    this.actorOrganizationId = actorOrganizationId ?? null;
    this.resourceOrganizationId = resourceOrganizationId ?? null;
  }

  toApiError(): ORPCError<typeof TENANT_VIOLATION_CODE, TenantViolationErrorData> {
    return new ORPCError(TENANT_VIOLATION_CODE, {
      status: TENANT_VIOLATION_STATUS,
      message: this.message,
      data: {
        actorOrganizationId: this.actorOrganizationId,
        resourceOrganizationId: this.resourceOrganizationId,
      },
    });
  }
}

/**
 * Throws {@link TenantViolationError} unless the actor's organization owns the
 * resource. A missing actor organization is treated as a violation — an
 * unbound actor must never fall through to another tenant's data.
 */
export function assertTenantBoundary(
  actorOrgId: string | null | undefined,
  resourceOrgId: string | null | undefined,
): void {
  if (actorOrgId && actorOrgId === resourceOrgId) {
    return;
  }

  throw new TenantViolationError(actorOrgId, resourceOrgId);
}
