import { requireTrustedIdentity } from "@openvalens/auth/authz/trusted-session";
import { McpOAuthConsentError, type McpOAuthConsent } from "@openvalens/auth/mcp-oauth";
import { organization } from "@openvalens/db/schema/auth";
import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";
import {
  AI_APP_CONSENT_VERSION,
  AiAppGrantError,
  BASE_SCOPE,
  DEFAULT_PERSONAL_KEY_EXPIRY_DAYS,
  GRANTABLE_SCOPES,
  MAX_ACTIVE_PERSONAL_KEYS,
  OPT_IN_SCOPES,
  PERSONAL_KEY_EXPIRY_DAYS,
  WRITE_SCOPES,
  type AiAppsService,
} from "@openvalens/mcp";
import { z } from "zod";

import { AiAppDraftReviewError, createAiAppDraftReview } from "../ai-app-writes";
import type { Context } from "../context";
import { foodDraftCandidate } from "../contracts/nutrition-food-drafts";
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
  /** Host of an OAuth app's metadata-document client id; `null` otherwise. */
  clientIdHost: z.string().nullable(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  /** Entries this grant wrote that are still recorded as its own (M2). */
  entryCount: z.number().int().nonnegative(),
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
  /** Opt-in write scopes (M2), one per domain; off by default. */
  writeScopes: z.array(z.string()),
  /** Most entries one write call may hold, and one grant may add a day. */
  writeLimits: z.object({ entriesPerCall: z.number(), entriesPerDay: z.number() }).nullable(),
  expiryDays: z.array(z.number().nullable()),
  defaultExpiryDays: z.number().nullable(),
  maxActiveKeys: z.number(),
  /** The active workspace's name: grants are listed and created there. */
  workspaceName: z.string(),
  /** `https://<server>/api/mcp`, for the ready-to-paste client commands; `null` when off. */
  mcpUrl: z.string().nullable(),
  /** Whether apps can sign in with OAuth here (off on a plain-HTTP server URL). */
  oauthEnabled: z.boolean(),
});

const createKeyInput = z
  .object({
    label: z.string().trim().min(1).max(80),
    /** Opt-in scopes to add to `records:read`. Reserved or unknown scopes fail. */
    scopes: z.array(z.string().min(1).max(40)).max(20).default([]),
    expiresInDays: z
      .union([z.literal(30), z.literal(90), z.literal(365), z.null()])
      .default(DEFAULT_PERSONAL_KEY_EXPIRY_DAYS),
    /** The AI-app consent text the member agreed to; must be the current one. */
    consentVersion: z.string().min(1).max(32),
  })
  .strict();

const grantIdInput = z.object({ grantId: z.uuid() }).strict();
const activityInput = z
  .object({
    limit: z.number().int().min(1).max(100).default(50),
    /** Only this grant's calls (one card's "Recent activity"). */
    grantId: z.uuid().optional(),
  })
  .strict();

// ─── Drafts waiting for the member's review (M2c) ────────────

const draftKind = z.enum(["food", "lab", "workout"]);
const draftCommon = {
  id: z.string(),
  grantId: z.string(),
  /** The app's name, shown as "via <app>". */
  appName: z.string(),
  createdAt: z.string(),
};
const draftShape = z.discriminatedUnion("kind", [
  z.object({
    ...draftCommon,
    kind: z.literal("food"),
    payload: z.object({
      eatenAt: z.string(),
      meal: z.string().nullable(),
      description: z.string().nullable(),
      items: z.array(foodDraftCandidate),
    }),
  }),
  z.object({
    ...draftCommon,
    kind: z.literal("lab"),
    payload: z.object({
      observedAt: z.string(),
      markerCode: z.string(),
      markerName: z.string(),
      value: z.number(),
      unit: z.string(),
      /** Only when the app sent one: the range printed on the report. */
      referenceRange: z
        .object({
          low: z.number().nullable(),
          high: z.number().nullable(),
          text: z.string().nullable(),
          source: z.literal("report"),
        })
        .nullable(),
    }),
  }),
  z.object({
    ...draftCommon,
    kind: z.literal("workout"),
    payload: z.object({
      date: z.string(),
      type: z.string(),
      duration: z.number().nullable(),
      notes: z.string().nullable(),
      intensity: z.string().nullable(),
      effortRating: z.number().nullable(),
      exercises: z.array(
        z.object({
          name: z.string(),
          /** `null`: not in the catalog; map it or create it before confirming. */
          exerciseId: z.number().nullable(),
          sets: z.array(
            z.object({
              reps: z.number(),
              weightKg: z.number().nullable(),
              rpe: z.number().nullable(),
            }),
          ),
        }),
      ),
    }),
  }),
]);

const draftsListInput = z.object({ kind: draftKind.optional() }).strict();
const draftIdInput = z.object({ draftId: z.uuid() }).strict();
const draftConfirmInput = z
  .object({
    draftId: z.uuid(),
    /** Workout drafts: for each exercise that was not in the catalog, the one to use. */
    exercises: z
      .array(
        z
          .object({
            index: z.number().int().min(0).max(100),
            exerciseId: z.number().int().positive(),
          })
          .strict(),
      )
      .max(100)
      .optional(),
  })
  .strict();

const writeProcedure = permissionedProcedure({ resource: "records", action: "write" });

function memberScope(context: Context & { authz: { activeOrganizationId: string } }) {
  return { organizationId: context.authz.activeOrganizationId, userId: trustedUserId(context) };
}

async function workspaceNameOf(db: Context["db"], organizationId: string): Promise<string> {
  const [row] = await db
    .select({ name: organization.name })
    .from(organization)
    .where(eq(organization.id, organizationId));
  return row?.name ?? "";
}
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

const oauthQuery = z.string().min(1).max(8_192);
const oauthDescribeInput = z.object({ oauthQuery }).strict();
const oauthApproveInput = z
  .object({
    oauthQuery,
    /** A workspace the member owns; checked on the server. */
    organizationId: z.string().min(1).max(200),
    /** Scopes the member ticked; `records:read` is always added. */
    scopes: z.array(z.string().min(1).max(40)).max(20).default([]),
    /** The AI-app consent text the member agreed to; must be the current one. */
    consentVersion: z.string().min(1).max(32),
  })
  .strict();
const oauthDescribeOutput = z.object({
  client: z.object({
    /** Self-declared by the app; never verified. */
    name: z.string().nullable(),
    clientIdHost: z.string().nullable(),
    registration: z.enum(["cimd", "dcr"]),
    redirectHost: z.string(),
    verified: z.literal(false),
  }),
  scopes: z.array(
    z.object({ scope: z.string(), required: z.boolean(), requestedByApp: z.boolean() }),
  ),
  workspaces: z.array(
    z.object({
      organizationId: z.string(),
      name: z.string(),
      allowed: z.boolean(),
      reason: z.enum(["NOT_OWNER", "WORKSPACE_DISABLED"]).nullable(),
    }),
  ),
  activeOrganizationId: z.string(),
  consentVersion: z.string(),
});

function requireOAuth(context: Context): McpOAuthConsent {
  if (!context.aiApps || !context.aiAppsOAuth) {
    throw raiseApiError(
      "NOT_FOUND",
      "Connecting AI apps with OAuth is not enabled on this server.",
    );
  }
  return context.aiAppsOAuth;
}

function sessionIdOf(context: Context): string {
  const id = context.session?.session.id;
  if (!id) throw raiseApiError("UNAUTHENTICATED", "Sign in to continue.");
  return id;
}

/** CSRF: a consent decision must come from the web app's own origin. */
function requireWebOrigin(context: Context): void {
  const allowed = context.webOrigin;
  const origin = context.honoContext.req.raw.headers.get("origin");
  if (!allowed || origin !== allowed) {
    throw raiseApiError("PERMISSION_DENIED", "You do not have permission to perform this action.");
  }
}

function toOAuthApiError(error: unknown) {
  if (error instanceof McpOAuthConsentError) {
    switch (error.code) {
      case "INVALID_REQUEST":
        return raiseApiError("INVALID_INPUT", error.message, { reason: "INVALID_OAUTH_REQUEST" });
      case "UNKNOWN_CLIENT":
        return raiseApiError("NOT_FOUND", error.message, { reason: "UNKNOWN_CLIENT" });
      case "CONSENT_FAILED":
        return raiseApiError("INTERNAL", error.message);
    }
  }
  if (error instanceof ORPCError) return error;
  return toApiError(error);
}

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
        writeScopes: [...WRITE_SCOPES],
        writeLimits: context.aiAppWrites
          ? {
              entriesPerCall: context.aiAppWrites.limits.entriesPerCall,
              entriesPerDay: context.aiAppWrites.limits.entriesPerDay,
            }
          : null,
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
          workspaceName: "",
          mcpUrl: null,
          oauthEnabled: false,
        };
      }
      const [setting, eligibility, workspaceName] = await Promise.all([
        context.aiApps.readWorkspaceSetting(organizationId),
        context.aiApps.canCreate({ userId: context.authz.user.id, organizationId }),
        workspaceNameOf(context.db, organizationId),
      ]);
      return {
        ...base,
        workspaceName,
        mcpUrl: context.aiAppsMcpUrl ?? null,
        oauthEnabled: Boolean(context.aiAppsOAuth),
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
    .handler(async ({ context }) => {
      const owner = {
        userId: context.authz.user.id,
        organizationId: context.authz.activeOrganizationId,
      };
      const [grants, counts] = await Promise.all([
        requireService(context).listGrants(owner),
        context.aiAppWrites ? context.aiAppWrites.entryCounts(owner) : new Map<string, number>(),
      ]);
      return {
        grants: grants.map((grant) => ({ ...grant, entryCount: counts.get(grant.id) ?? 0 })),
      };
    }),

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
        grantId: input.grantId,
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
        const created = await service.createPersonalKey({
          userId,
          organizationId: context.authz.activeOrganizationId,
          label: input.label,
          scopes: input.scopes,
          expiresInDays: input.expiresInDays,
          consentVersion: input.consentVersion,
          correlationId: context.correlationId,
        });
        return { key: created.key, grant: { ...created.grant, entryCount: 0 } };
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

  /**
   * "Delete everything this app wrote" (M2): deletes every entry one of the
   * member's grants (revoked or not) wrote in this workspace, through each
   * domain's own delete. Revoking a grant keeps its entries; this removes
   * them. Allowed even while the workspace is read-only: it is the member's
   * control over their own records.
   */
  deleteWrites: readProcedure
    .use(validateInput(grantIdInput))
    .input(grantIdInput)
    .output(z.object({ deleted: z.number().int().nonnegative() }))
    .handler(async ({ input, context }) => {
      requireService(context);
      if (!context.aiAppWrites) {
        throw raiseApiError("NOT_FOUND", "Connected AI apps are not enabled on this server.");
      }
      const result = await context.aiAppWrites.deleteEverythingWritten({
        userId: trustedUserId(context),
        organizationId: context.authz.activeOrganizationId,
        grantId: input.grantId,
        correlationId: context.correlationId,
      });
      if (!result) throw raiseApiError("NOT_FOUND", "This key or connection was not found.");
      return result;
    }),

  /**
   * Drafts an AI app wrote that wait for the member's review (M2c): meal
   * drafts, lab results and workouts with an exercise that is not in the
   * catalog. Nothing is in the member's records until they confirm one.
   * These stay reachable after the operator turns AI apps off, so a waiting
   * draft can always be confirmed or discarded.
   */
  drafts: {
    /** The member's own drafts in the active workspace, oldest first. */
    list: readProcedure
      .use(validateInput(draftsListInput))
      .input(draftsListInput)
      .output(z.object({ drafts: z.array(draftShape) }))
      .handler(async ({ input, context }) => ({
        drafts: (await createAiAppDraftReview(context.db).list({
          ...memberScope(context),
          kind: input.kind,
        })) as Array<z.infer<typeof draftShape>>,
      })),

    /**
     * Confirms one draft through the app's own write paths: a lab result is
     * saved, a workout is saved once every exercise not in the catalog is
     * mapped (a catalog one or the member's own, made on review), and a meal
     * draft is done once its items were logged in the meal diary.
     */
    confirm: writeProcedure
      .use(validateInput(draftConfirmInput))
      .input(draftConfirmInput)
      .output(z.object({ kind: draftKind, savedId: z.number().nullable() }))
      .handler(async ({ input, context }) => {
        let result;
        try {
          result = await createAiAppDraftReview(context.db).confirm({
            ...memberScope(context),
            draftId: input.draftId,
            exercises: input.exercises,
            correlationId: context.correlationId,
          });
        } catch (error) {
          if (error instanceof AiAppDraftReviewError)
            throw raiseApiError("INVALID_INPUT", error.message, { reason: "EXERCISE_MAPPING" });
          throw error;
        }
        if (!result) throw raiseApiError("NOT_FOUND", "This draft was not found.");
        return result;
      }),

    /**
     * Discards one draft: nothing is saved. Like "Delete everything this app
     * wrote", allowed while the workspace is read-only.
     */
    discard: readProcedure
      .use(validateInput(draftIdInput))
      .input(draftIdInput)
      .output(z.object({ discarded: z.boolean() }))
      .handler(async ({ input, context }) => {
        const discarded = await createAiAppDraftReview(context.db).discard({
          ...memberScope(context),
          draftId: input.draftId,
          correlationId: context.correlationId,
        });
        if (!discarded) throw raiseApiError("NOT_FOUND", "This draft was not found.");
        return { discarded };
      }),
  },

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

  /**
   * Issue #439 (M1b) — the OAuth consent screen. Each call carries Better
   * Auth's signed authorization request (`oauthQuery`), which must be valid,
   * unexpired and issued for this very session. Nothing is pre-approved: an
   * app gets access only through `approve`, which creates (or, on a step-up,
   * updates) the member's `oauth` grant for the chosen workspace under the
   * same rules as a personal key, then completes the authorization.
   */
  oauth: {
    /** What the app asks for, and the workspaces it could be connected to. */
    describe: readProcedure
      .use(validateInput(oauthDescribeInput))
      .input(oauthDescribeInput)
      .output(oauthDescribeOutput)
      .handler(async ({ input, context }) => {
        const service = requireService(context);
        const consent = requireOAuth(context);
        const userId = trustedUserId(context);
        try {
          const request = await consent.readRequest({
            oauthQuery: input.oauthQuery,
            sessionId: sessionIdOf(context),
            grantableScopes: GRANTABLE_SCOPES,
          });
          const workspaces = await service.listConnectableWorkspaces(userId);
          return {
            client: {
              name: request.clientName,
              clientIdHost: request.clientIdHost,
              registration: request.registration,
              redirectHost: request.redirectHost,
              verified: false as const,
            },
            scopes: request.offeredScopes.map((scope) => ({
              scope,
              required: scope === BASE_SCOPE,
              requestedByApp: request.requestedScopes.includes(scope),
            })),
            workspaces,
            activeOrganizationId: context.authz.activeOrganizationId,
            consentVersion: AI_APP_CONSENT_VERSION,
          };
        } catch (error) {
          throw toOAuthApiError(error);
        }
      }),

    /**
     * Approves the app for one workspace the member owns with the ticked
     * scopes and the current AI-app consent; returns the app's redirect URL.
     * Same-origin only (CSRF), never for an impersonated session.
     */
    approve: readProcedure
      .use(validateInput(oauthApproveInput))
      .input(oauthApproveInput)
      .output(z.object({ redirectUrl: z.string() }))
      .handler(async ({ input, context }) => {
        requireWebOrigin(context);
        const service = requireService(context);
        const consent = requireOAuth(context);
        const userId = trustedUserId(context);
        const sessionId = sessionIdOf(context);
        const headers = context.honoContext.req.raw.headers;
        try {
          const request = await consent.readRequest({
            oauthQuery: input.oauthQuery,
            sessionId,
            grantableScopes: GRANTABLE_SCOPES,
          });
          const offered = new Set(request.offeredScopes);
          const notOffered = input.scopes.filter((scope) => !offered.has(scope));
          if (notOffered.length > 0) {
            throw new AiAppGrantError("INVALID_SCOPE", "One or more scopes cannot be granted.", {
              invalid: notOffered,
            });
          }
          const connected = await service.connectOAuthClient({
            userId,
            organizationId: input.organizationId,
            clientId: request.clientId,
            clientName: request.clientName,
            clientIdHost: request.clientIdHost,
            scopes: input.scopes,
            consentVersion: input.consentVersion,
            correlationId: context.correlationId,
            authorize: (grant) =>
              consent.approve({
                headers,
                oauthQuery: input.oauthQuery,
                sessionId,
                referenceId: grant.grantId,
                scopes: grant.scopes,
              }),
          });
          return { redirectUrl: connected.redirectUrl };
        } catch (error) {
          throw toOAuthApiError(error);
        }
      }),

    /** Denies the request; returns the app's redirect URL with `access_denied`. */
    deny: readProcedure
      .use(validateInput(oauthDescribeInput))
      .input(oauthDescribeInput)
      .output(z.object({ redirectUrl: z.string() }))
      .handler(async ({ input, context }) => {
        requireWebOrigin(context);
        const consent = requireOAuth(context);
        try {
          return {
            redirectUrl: await consent.deny({
              headers: context.honoContext.req.raw.headers,
              oauthQuery: input.oauthQuery,
              sessionId: sessionIdOf(context),
            }),
          };
        } catch (error) {
          throw toOAuthApiError(error);
        }
      }),
  },
};
