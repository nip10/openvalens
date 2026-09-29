import type { Action, Resource } from "@openhealth/auth/access/permissions";
import type { AuthzRequestContext } from "@openhealth/auth/authz/context";
import { AuthzHttpError, requirePermission } from "@openhealth/auth/authz/guard";
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

  if (error instanceof ORPCError) {
    return error as ORPCError<ORPCErrorCode, unknown>;
  }

  return raiseApiError("INTERNAL", "Something went wrong.");
}

/**
 * Authenticated + RBAC-guarded procedure.
 *
 * Delegates to `requirePermission` from `@openhealth/auth/authz/guard` and
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
