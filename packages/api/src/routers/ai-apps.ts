import { requireTrustedIdentity } from "@openvalens/auth/authz/trusted-session";
import {
  AI_APP_CONSENT_VERSION,
  AiAppGrantError,
  BASE_SCOPE,
  DEFAULT_PERSONAL_KEY_EXPIRY_DAYS,
  MAX_ACTIVE_PERSONAL_KEYS,
  OPT_IN_SCOPES,
  PERSONAL_KEY_EXPIRY_DAYS,
  type AiAppsService,
} from "@openvalens/mcp";
import { z } from "zod";

import type { Context } from "../context";
import { permissionedProcedure, raiseApiError, validateInput } from "../index";

/**
 * Connected AI apps (Issue #439, M1a): grants and personal API keys for the
 * MCP server and the REST tool API. Workspace and member always come from the
 * session; inputs never name a workspace or person. A key is returned once, by
 * `createKey`, and never again: lists carry its `ov_xxxxxx` prefix only.
 *
 * Every procedure answers `NOT_FOUND` while the operator has not enabled the
 * MCP server, except `status`, which reports `enabled: false`.
 */

const emptyInput = z.object({}).strict();

const grantShape = z.object({
  id: z.string(),
  kind: z.enum(["personal_key", "oauth"]),
  label: z.string(),
  scopes: z.array(z.string()),
  consentVersion: z.string(),
  status: z.enum(["active", "revoked", "expired"]),
  displayPrefix: z.string().nullable(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
});

const statusOutput = z.object({
  enabled: z.boolean(),
  consentVersion: z.string(),
  membersCanConnect: z.boolean(),
  isOwner: z.boolean(),
  canCreate: z.boolean(),
  /** Why `canCreate` is false: `NOT_OWNER`, `WORKSPACE_DISABLED` or `null`. */
  blockedReason: z.enum(["NOT_OWNER", "WORKSPACE_DISABLED"]).nullable(),
  baseScope: z.string(),
  optInScopes: z.array(z.string()),
  expiryDays: z.array(z.number().nullable()),
  defaultExpiryDays: z.number().nullable(),
  maxActiveKeys: z.number(),
});

const createKeyInput = z
  .object({
    label: z.string().trim().min(1).max(80),
    /** Opt-in scopes to add to `records:read`. Reserved or unknown scopes fail. */
    scopes: z.array(z.string().min(1).max(40)).max(10).default([]),
    expiresInDays: z
      .union([z.literal(30), z.literal(90), z.literal(365), z.null()])
      .default(DEFAULT_PERSONAL_KEY_EXPIRY_DAYS),
    /** The AI-app consent text the member agreed to; must be the current one. */
    consentVersion: z.string().min(1).max(32),
  })
  .strict();

const grantIdInput = z.object({ grantId: z.uuid() }).strict();
const activityInput = z.object({ limit: z.number().int().min(1).max(100).default(50) }).strict();
const settingInput = z.object({ membersCanConnect: z.boolean() }).strict();

function requireService(context: Context): AiAppsService {
  if (!context.aiApps) {
    throw raiseApiError("NOT_FOUND", "Connected AI apps are not enabled on this server.");
  }
  return context.aiApps;
}

function trustedUserId(context: Context): string {
  try {
    return requireTrustedIdentity(context.session).userId;
  } catch {
    throw raiseApiError("PERMISSION_DENIED", "You do not have permission to perform this action.");
  }
}

function toApiError(error: unknown) {
  if (error instanceof AiAppGrantError) {
    switch (error.code) {
      case "INVALID_SCOPE":
      case "CONSENT_REQUIRED":
        return raiseApiError("INVALID_INPUT", error.message, {
          reason: error.code,
          ...error.details,
        });
      case "KEY_LIMIT_REACHED":
        return raiseApiError("CONFLICT", error.message, { reason: error.code, ...error.details });
      case "NOT_OWNER":
      case "WORKSPACE_DISABLED":
        return raiseApiError("PERMISSION_DENIED", error.message, { reason: error.code });
    }
  }
  return raiseApiError("INTERNAL", "Something went wrong.");
}

const readProcedure = permissionedProcedure({ resource: "records", action: "read" });

export const aiAppsRouter = {
  /** Whether AI apps are on here and whether this member may create a key now. */
  status: readProcedure
    .use(validateInput(emptyInput))
    .input(emptyInput)
    .output(statusOutput)
    .handler(async ({ context }) => {
      const organizationId = context.authz.activeOrganizationId;
      const base = {
        consentVersion: AI_APP_CONSENT_VERSION,
        isOwner: context.authz.role === "owner",
        baseScope: BASE_SCOPE,
        optInScopes: [...OPT_IN_SCOPES],
        expiryDays: [...PERSONAL_KEY_EXPIRY_DAYS],
        defaultExpiryDays: DEFAULT_PERSONAL_KEY_EXPIRY_DAYS,
        maxActiveKeys: MAX_ACTIVE_PERSONAL_KEYS,
      };
      if (!context.aiApps) {
        return {
          ...base,
          enabled: false,
          membersCanConnect: false,
          canCreate: false,
          blockedReason: null,
        };
      }
      const [setting, eligibility] = await Promise.all([
        context.aiApps.readWorkspaceSetting(organizationId),
        context.aiApps.canCreate({ userId: context.authz.user.id, organizationId }),
      ]);
      return {
        ...base,
        enabled: true,
        membersCanConnect: setting.membersCanConnect,
        canCreate: eligibility.allowed,
        blockedReason: eligibility.reason,
      };
    }),

  /** The member's grants (keys now, connections later) in the active workspace. */
  listGrants: readProcedure
    .use(validateInput(emptyInput))
    .input(emptyInput)
    .output(z.object({ grants: z.array(grantShape) }))
    .handler(async ({ context }) => ({
      grants: await requireService(context).listGrants({
        userId: context.authz.user.id,
        organizationId: context.authz.activeOrganizationId,
      }),
    })),

  /** Recent tool calls: grant, tool, time, status and row count only. */
  recentActivity: readProcedure
    .use(validateInput(activityInput))
    .input(activityInput)
    .output(
      z.object({
        calls: z.array(
          z.object({
            grantId: z.string(),
            tool: z.string(),
            transport: z.enum(["mcp", "rest"]),
            status: z.string(),
            rowCount: z.number().nullable(),
            createdAt: z.string(),
          }),
        ),
      }),
    )
    .handler(async ({ input, context }) => ({
      calls: await requireService(context).listRecentCalls({
        userId: context.authz.user.id,
        organizationId: context.authz.activeOrganizationId,
        limit: input.limit,
      }),
    })),

  /**
   * Creates a personal API key and returns it **once**. Refused for an
   * impersonated session, for a member who does not own the workspace, when
   * the owner turned AI apps off, and past ten active keys.
   */
  createKey: readProcedure
    .use(validateInput(createKeyInput))
    .input(createKeyInput)
    .output(z.object({ key: z.string(), grant: grantShape }))
    .handler(async ({ input, context }) => {
      const service = requireService(context);
      const userId = trustedUserId(context);
      try {
        return await service.createPersonalKey({
          userId,
          organizationId: context.authz.activeOrganizationId,
          label: input.label,
          scopes: input.scopes,
          expiresInDays: input.expiresInDays,
          consentVersion: input.consentVersion,
          correlationId: context.correlationId,
        });
      } catch (error) {
        throw toApiError(error);
      }
    }),

  /** Revokes one of the member's grants; the next call with it fails. Idempotent. */
  revokeGrant: readProcedure
    .use(validateInput(grantIdInput))
    .input(grantIdInput)
    .output(z.object({ revoked: z.boolean() }))
    .handler(async ({ input, context }) => {
      const service = requireService(context);
      const result = await service.revokeGrant({
        userId: context.authz.user.id,
        organizationId: context.authz.activeOrganizationId,
        grantId: input.grantId,
        correlationId: context.correlationId,
      });
      if (!result.found) throw raiseApiError("NOT_FOUND", "This key or connection was not found.");
      return { revoked: result.revoked };
    }),

  /** Workspace setting "Members can connect AI apps" (default on; owner only to change). */
  workspaceSetting: {
    get: readProcedure
      .use(validateInput(emptyInput))
      .input(emptyInput)
      .output(z.object({ membersCanConnect: z.boolean(), canManage: z.boolean() }))
      .handler(async ({ context }) => {
        const setting = await requireService(context).readWorkspaceSetting(
          context.authz.activeOrganizationId,
        );
        return { ...setting, canManage: context.authz.role === "owner" };
      }),

    set: readProcedure
      .use(validateInput(settingInput))
      .input(settingInput)
      .output(z.object({ membersCanConnect: z.boolean(), canManage: z.boolean() }))
      .handler(async ({ input, context }) => {
        const service = requireService(context);
        const userId = trustedUserId(context);
        try {
          const after = await service.setWorkspaceSetting({
            userId,
            organizationId: context.authz.activeOrganizationId,
            membersCanConnect: input.membersCanConnect,
            correlationId: context.correlationId,
          });
          return { ...after, canManage: true };
        } catch (error) {
          throw toApiError(error);
        }
      }),
  },
};
