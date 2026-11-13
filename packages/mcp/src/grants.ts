import { writeAuditLog, type AuditEventType } from "@openvalens/audit-security";
import {
  hashOAuthToken,
  isOAuthAccessTokenFormat,
  MCP_OAUTH_ACCESS_TOKEN_PREFIX,
} from "@openvalens/auth/mcp-oauth/tokens";
import type { Database } from "@openvalens/db";
import { aiAppCall, aiAppGrant, aiAppKey } from "@openvalens/db/schema/ai-apps";
import { member, organization, user } from "@openvalens/db/schema/auth";
import {
  oauthAccessToken,
  oauthClient,
  oauthConsent,
  oauthRefreshToken,
} from "@openvalens/db/schema/oauth";
import { createStructuredLogger, type StructuredLogger } from "@openvalens/observability";
import { and, desc, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";

import {
  bearerToken,
  expiryFrom,
  generatePersonalKey,
  hashPersonalKey,
  isPersonalKeyFormat,
  MAX_ACTIVE_PERSONAL_KEYS,
  type PersonalKeyExpiryDays,
} from "./keys";
import { normalizeScopes, type GrantableScope } from "./scopes";
import { parseAiAppsSetting, readAiAppsSetting, writeAiAppsSetting } from "./settings";

/**
 * Connected AI apps: grants and personal API keys (Issue #439).
 *
 * A grant lets one AI app read **one member's own records in one workspace**,
 * with a fixed scope list and the AI-app consent (`mcp-v1`). It is separate
 * from Coach AI consent in both directions: neither the workspace Coach switch
 * nor the member's Coach consent is read or written here.
 *
 * Organization records are one person's health record (see the data-rights
 * registry), so a grant may only be created, and only keeps working, while its
 * member **owns** the workspace. Reading another member's records is the later
 * caregiver milestone (M3) and needs that member's own consent.
 *
 * Every call is re-checked from the database: a revoked or expired grant, a
 * removed or downgraded member, a banned account or the owner turning "Members
 * can connect AI apps" off stops the very next call. Bearer authentication
 * never consults a session cookie, so an admin or impersonated browser session
 * can never act through this path.
 *
 * OAuth connections (M1b) are grants of kind `oauth`. Better Auth issues their
 * opaque tokens; each consent, access token and refresh token carries the
 * grant id in `reference_id`. A bearer `ovat_…` token is looked up by digest,
 * must be unrevoked, unexpired, issued to the grant's client and bound to this
 * MCP resource (RFC 8707), and then passes the very same grant checks as a
 * personal key. Its effective scopes are the grant's scopes the token also
 * carries.
 */

export const AI_APP_CONSENT_VERSION = "mcp-v1";

/** Usage rows older than this are purged. */
export const AI_APP_CALL_RETENTION_DAYS = 90;

/** `last_used_at` is written at most this often per grant. */
const LAST_USED_WRITE_INTERVAL_MS = 60_000;

export type AiAppGrantKind = "personal_key" | "oauth";

/** The authenticated principal of one MCP or REST call. */
export type AiAppGrantPrincipal = {
  grantId: string;
  kind: AiAppGrantKind;
  userId: string;
  organizationId: string;
  scopes: readonly string[];
  /** The key's name or the client's name, for the security email and audit. */
  label: string;
};

export type AiAppGrantStatus = "active" | "revoked" | "expired";

export type AiAppGrantSummary = {
  id: string;
  kind: AiAppGrantKind;
  label: string;
  scopes: string[];
  consentVersion: string;
  status: AiAppGrantStatus;
  /** `ov_` and six characters of a personal key; `null` for OAuth. */
  displayPrefix: string | null;
  /**
   * Host of an OAuth app's client id when it is a metadata document URL
   * (CIMD); `null` for a personal key or a dynamically registered app.
   */
  clientIdHost: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
};

export type AiAppCallSummary = {
  grantId: string;
  tool: string;
  transport: "mcp" | "rest";
  status: string;
  rowCount: number | null;
  createdAt: string;
};

export type AiAppGrantErrorCode =
  | "WORKSPACE_DISABLED"
  | "NOT_OWNER"
  | "KEY_LIMIT_REACHED"
  | "INVALID_SCOPE"
  | "CONSENT_REQUIRED";

export class AiAppGrantError extends Error {
  readonly code: AiAppGrantErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: AiAppGrantErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "AiAppGrantError";
    this.code = code;
    this.details = details;
  }
}

/** Why a bearer value was refused. Value-free; safe to log. */
export type AiAppAuthFailure =
  | "missing"
  | "invalid"
  | "revoked"
  | "expired"
  | "not_owner"
  | "workspace_disabled"
  /** An OAuth token issued for another resource (RFC 8707), or used off `/api/mcp`. */
  | "wrong_audience";

/** Clients that never complete a grant are deleted after this long. */
export const ABANDONED_OAUTH_CLIENT_HOURS = 24;

/** Most characters of a client's self-declared name kept as the grant label. */
const MAX_LABEL_LENGTH = 80;

export type AiAppAuthResult =
  | { ok: true; principal: AiAppGrantPrincipal }
  | { ok: false; reason: AiAppAuthFailure };

/** What the security email needs. Never carries the key itself. */
export type AiAppKeyCreatedEvent = {
  grantId: string;
  userId: string;
  organizationId: string;
  label: string;
  displayPrefix: string;
  scopes: readonly string[];
  createdAt: Date;
  expiresAt: Date | null;
};

export type CreatePersonalKeyInput = {
  userId: string;
  organizationId: string;
  label: string;
  scopes: readonly string[];
  expiresInDays: PersonalKeyExpiryDays;
  /** Must equal {@link AI_APP_CONSENT_VERSION}: the member agreed to that text. */
  consentVersion: string;
  correlationId?: string;
};

export type CreatedPersonalKey = {
  /** The full key, returned exactly once. */
  key: string;
  grant: AiAppGrantSummary;
};

/** What the "new connection" security email needs. */
export type AiAppOAuthConnectedEvent = {
  grantId: string;
  userId: string;
  organizationId: string;
  /** The client's self-declared (unverified) name. */
  label: string;
  /** Host of a CIMD client id, or `null` for a dynamically registered client. */
  clientIdHost: string | null;
  scopes: readonly string[];
  createdAt: Date;
};

export type ConnectOAuthClientInput = {
  userId: string;
  organizationId: string;
  clientId: string;
  /** The client's self-declared name; stored as the grant label. */
  clientName: string | null;
  clientIdHost: string | null;
  scopes: readonly string[];
  /** Must equal {@link AI_APP_CONSENT_VERSION}. */
  consentVersion: string;
  /**
   * Completes the OAuth authorization for the grant (Better Auth's consent
   * step) and returns the client's redirect URL. A failure rolls the grant
   * back and is rethrown.
   */
  authorize: (grant: { grantId: string; scopes: readonly string[] }) => Promise<string>;
  correlationId?: string;
};

export type AiAppsServiceOptions = {
  db: Database;
  now?: () => Date;
  logger?: StructuredLogger;
  /**
   * Sends the "a key was created" security email. Awaited but never fatal: a
   * failure is logged and the key is still returned.
   */
  onKeyCreated?: (event: AiAppKeyCreatedEvent) => Promise<void>;
  /** Sends the "an app was connected" security email. Same rules as `onKeyCreated`. */
  onOAuthConnected?: (event: AiAppOAuthConnectedEvent) => Promise<void>;
  /**
   * OAuth access tokens are accepted only when set: the canonical MCP resource
   * URL every token must be bound to.
   */
  oauth?: { resource: string } | null;
};

export type AiAppsService = ReturnType<typeof createAiAppsService>;

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

/** The host of a CIMD client id (an `https://` URL); `null` for any other id. */
function clientIdHostOf(clientId: string | null): string | null {
  if (!clientId) return null;
  try {
    const url = new URL(clientId);
    return url.protocol === "https:" ? url.host : null;
  } catch {
    return null;
  }
}

function grantStatus(
  row: { revokedAt: Date | null; revokedReason: string | null; expiresAt: Date | null },
  now: Date,
): AiAppGrantStatus {
  if (row.revokedAt) return row.revokedReason === "expired" ? "expired" : "revoked";
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return "expired";
  return "active";
}

export function createAiAppsService(options: AiAppsServiceOptions) {
  const { db } = options;
  const now = options.now ?? (() => new Date());
  const logger = options.logger ?? createStructuredLogger({ level: "info" });

  async function audit(input: {
    eventType: AuditEventType;
    organizationId: string;
    userId: string;
    grantId: string;
    correlationId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await writeAuditLog({
      db,
      organizationId: input.organizationId,
      actorUserId: input.userId,
      eventType: input.eventType,
      targetType: "ai_app_grant",
      targetId: input.grantId,
      correlationId: input.correlationId,
      metadata: input.metadata ?? null,
    });
  }

  async function memberRole(userId: string, organizationId: string): Promise<string | null> {
    const rows = await db
      .select({ role: member.role })
      .from(member)
      .where(and(eq(member.userId, userId), eq(member.organizationId, organizationId)))
      .limit(1);
    return rows[0]?.role ?? null;
  }

  function summary(
    row: typeof aiAppGrant.$inferSelect,
    displayPrefix: string | null,
  ): AiAppGrantSummary {
    return {
      id: row.id,
      kind: row.kind as AiAppGrantKind,
      label: row.label,
      scopes: [...row.scopes],
      consentVersion: row.consentVersion,
      status: grantStatus(row, now()),
      displayPrefix,
      clientIdHost: row.kind === "oauth" ? clientIdHostOf(row.oauthClientId) : null,
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: iso(row.lastUsedAt),
      expiresAt: iso(row.expiresAt),
      revokedAt: iso(row.revokedAt),
    };
  }

  /**
   * Whether this member may create a grant in this workspace right now: they
   * own it and the owner has not turned AI apps off. Value-free.
   */
  async function canCreate(input: {
    userId: string;
    organizationId: string;
  }): Promise<{ allowed: boolean; reason: "NOT_OWNER" | "WORKSPACE_DISABLED" | null }> {
    const role = await memberRole(input.userId, input.organizationId);
    if (role !== "owner") return { allowed: false, reason: "NOT_OWNER" };
    const setting = await readAiAppsSetting(db, input.organizationId);
    if (!setting.membersCanConnect) return { allowed: false, reason: "WORKSPACE_DISABLED" };
    return { allowed: true, reason: null };
  }

  async function createPersonalKey(input: CreatePersonalKeyInput): Promise<CreatedPersonalKey> {
    if (input.consentVersion !== AI_APP_CONSENT_VERSION) {
      throw new AiAppGrantError(
        "CONSENT_REQUIRED",
        "Agree to the current AI-app consent to create a key.",
        { consentVersion: AI_APP_CONSENT_VERSION },
      );
    }
    const scopes = normalizeScopes(input.scopes);
    if (!scopes.ok) {
      throw new AiAppGrantError("INVALID_SCOPE", "One or more scopes cannot be granted.", {
        invalid: scopes.invalid,
      });
    }
    const eligibility = await canCreate(input);
    if (!eligibility.allowed) {
      throw eligibility.reason === "WORKSPACE_DISABLED"
        ? new AiAppGrantError(
            "WORKSPACE_DISABLED",
            "The workspace owner has turned off connecting AI apps.",
          )
        : new AiAppGrantError("NOT_OWNER", "Only the workspace owner can connect AI apps for now.");
    }

    const createdAt = now();
    const expiresAt = expiryFrom(createdAt, input.expiresInDays);
    const generated = generatePersonalKey();
    const label = input.label.trim();

    const row = await db.transaction(async (tx) => {
      // One member's key count is checked and increased under one lock, so two
      // parallel creates cannot both take the tenth slot.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`ai-app-keys:${input.userId}`}, 0))`,
      );
      const [counted] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(aiAppGrant)
        .where(
          and(
            eq(aiAppGrant.userId, input.userId),
            eq(aiAppGrant.kind, "personal_key"),
            isNull(aiAppGrant.revokedAt),
            or(isNull(aiAppGrant.expiresAt), gt(aiAppGrant.expiresAt, createdAt)),
          ),
        );
      if ((counted?.count ?? 0) >= MAX_ACTIVE_PERSONAL_KEYS) {
        throw new AiAppGrantError(
          "KEY_LIMIT_REACHED",
          `You can have at most ${MAX_ACTIVE_PERSONAL_KEYS} active personal keys. Revoke one first.`,
          { limit: MAX_ACTIVE_PERSONAL_KEYS },
        );
      }
      const [grant] = await tx
        .insert(aiAppGrant)
        .values({
          organizationId: input.organizationId,
          userId: input.userId,
          kind: "personal_key",
          label,
          scopes: scopes.scopes,
          consentVersion: AI_APP_CONSENT_VERSION,
          consentedAt: createdAt,
          expiresAt,
          createdAt,
        })
        .returning();
      if (!grant) throw new Error("ai_app_grant insert returned no row");
      await tx.insert(aiAppKey).values({
        grantId: grant.id,
        userId: input.userId,
        keyHash: generated.hash,
        displayPrefix: generated.displayPrefix,
        createdAt,
      });
      return grant;
    });

    const metadata = {
      kind: "personal_key",
      scopes: scopes.scopes,
      consentVersion: AI_APP_CONSENT_VERSION,
      expiresAt: iso(expiresAt),
    };
    await audit({
      eventType: "AI_APP_CONSENT_GIVEN",
      organizationId: input.organizationId,
      userId: input.userId,
      grantId: row.id,
      correlationId: input.correlationId,
      metadata: { consentVersion: AI_APP_CONSENT_VERSION },
    });
    await audit({
      eventType: "AI_APP_GRANT_CREATED",
      organizationId: input.organizationId,
      userId: input.userId,
      grantId: row.id,
      correlationId: input.correlationId,
      metadata,
    });

    if (options.onKeyCreated) {
      try {
        await options.onKeyCreated({
          grantId: row.id,
          userId: input.userId,
          organizationId: input.organizationId,
          label,
          displayPrefix: generated.displayPrefix,
          scopes: scopes.scopes,
          createdAt,
          expiresAt,
        });
      } catch (error) {
        logger.warn("ai_apps.key_created_email.failed", {
          correlationId: input.correlationId,
          organizationId: input.organizationId,
          grantId: row.id,
          error,
        });
      }
    }

    logger.info("ai_apps.grant.created", {
      correlationId: input.correlationId,
      organizationId: input.organizationId,
      grantId: row.id,
      kind: "personal_key",
      scopeCount: scopes.scopes.length,
    });

    return { key: generated.key, grant: summary(row, generated.displayPrefix) };
  }

  /** The member's grants in one workspace, newest first. Never returns a key or digest. */
  async function listGrants(input: {
    userId: string;
    organizationId: string;
  }): Promise<AiAppGrantSummary[]> {
    const rows = await db
      .select({ grant: aiAppGrant, displayPrefix: aiAppKey.displayPrefix })
      .from(aiAppGrant)
      .leftJoin(aiAppKey, eq(aiAppKey.grantId, aiAppGrant.id))
      .where(
        and(
          eq(aiAppGrant.userId, input.userId),
          eq(aiAppGrant.organizationId, input.organizationId),
        ),
      )
      .orderBy(desc(aiAppGrant.createdAt), desc(aiAppGrant.id));
    return rows.map((row) => summary(row.grant, row.displayPrefix ?? null));
  }

  /**
   * Revokes one of the member's own grants. Idempotent: revoking a grant that
   * is already revoked or expired changes nothing and returns `false`.
   */
  async function revokeGrant(input: {
    userId: string;
    organizationId: string;
    grantId: string;
    correlationId?: string;
  }): Promise<{ revoked: boolean; found: boolean }> {
    const revokedAt = now();
    const updated = await db
      .update(aiAppGrant)
      .set({ revokedAt, revokedReason: "revoked" })
      .where(
        and(
          eq(aiAppGrant.id, input.grantId),
          eq(aiAppGrant.userId, input.userId),
          eq(aiAppGrant.organizationId, input.organizationId),
          isNull(aiAppGrant.revokedAt),
        ),
      )
      .returning({ id: aiAppGrant.id, kind: aiAppGrant.kind });
    const row = updated[0];
    if (row?.kind === "oauth") await dropOAuthTokens([row.id]);
    if (!row) {
      const existing = await db
        .select({ id: aiAppGrant.id })
        .from(aiAppGrant)
        .where(
          and(
            eq(aiAppGrant.id, input.grantId),
            eq(aiAppGrant.userId, input.userId),
            eq(aiAppGrant.organizationId, input.organizationId),
          ),
        )
        .limit(1);
      return { revoked: false, found: existing.length > 0 };
    }
    await audit({
      eventType: "AI_APP_GRANT_REVOKED",
      organizationId: input.organizationId,
      userId: input.userId,
      grantId: row.id,
      correlationId: input.correlationId,
      metadata: { kind: row.kind },
    });
    await audit({
      eventType: "AI_APP_CONSENT_WITHDRAWN",
      organizationId: input.organizationId,
      userId: input.userId,
      grantId: row.id,
      correlationId: input.correlationId,
      metadata: { consentVersion: AI_APP_CONSENT_VERSION },
    });
    logger.info("ai_apps.grant.revoked", {
      correlationId: input.correlationId,
      organizationId: input.organizationId,
      grantId: row.id,
    });
    return { revoked: true, found: true };
  }

  /** Deletes every OAuth token and consent of these grants (revoke, replay). */
  async function dropOAuthTokens(grantIds: string[]): Promise<void> {
    if (grantIds.length === 0) return;
    await db.transaction(async (tx) => {
      await tx.delete(oauthAccessToken).where(inArray(oauthAccessToken.referenceId, grantIds));
      await tx.delete(oauthRefreshToken).where(inArray(oauthRefreshToken.referenceId, grantIds));
      await tx.delete(oauthConsent).where(inArray(oauthConsent.referenceId, grantIds));
    });
  }

  /** The grant with everything that can stop it, joined in one read. */
  function grantWithStanding() {
    return db
      .select({
        grant: aiAppGrant,
        role: member.role,
        banned: user.banned,
        metadata: organization.metadata,
      })
      .from(aiAppGrant)
      .innerJoin(user, eq(user.id, aiAppGrant.userId))
      .innerJoin(organization, eq(organization.id, aiAppGrant.organizationId))
      .leftJoin(
        member,
        and(
          eq(member.organizationId, aiAppGrant.organizationId),
          eq(member.userId, aiAppGrant.userId),
        ),
      );
  }

  /**
   * Resolves an `ovat_…` OAuth access token to its grant id and the scopes the
   * token itself carries, or a refusal. The token must be unrevoked,
   * unexpired, bound to this MCP resource and point at an `oauth` grant of the
   * same client and member.
   */
  async function resolveOAuthToken(
    token: string,
  ): Promise<
    { ok: true; grantId: string; scopes: string[] } | { ok: false; reason: AiAppAuthFailure }
  > {
    if (!options.oauth) return { ok: false, reason: "invalid" };
    const digest = hashOAuthToken(token.slice(MCP_OAUTH_ACCESS_TOKEN_PREFIX.length));
    const rows = await db
      .select({
        token: oauthAccessToken,
        grantKind: aiAppGrant.kind,
        grantClientId: aiAppGrant.oauthClientId,
        grantUserId: aiAppGrant.userId,
      })
      .from(oauthAccessToken)
      .leftJoin(aiAppGrant, sql`${aiAppGrant.id}::text = ${oauthAccessToken.referenceId}`)
      .where(eq(oauthAccessToken.token, digest))
      .limit(1);
    const row = rows[0];
    if (!row) return { ok: false, reason: "invalid" };
    const issued = row.token;
    if (issued.revoked) return { ok: false, reason: "revoked" };
    if (!issued.expiresAt || issued.expiresAt.getTime() <= now().getTime()) {
      return { ok: false, reason: "expired" };
    }
    // RFC 8707: only tokens issued for exactly this resource. No passthrough.
    if (!(issued.resources ?? []).includes(options.oauth.resource)) {
      return { ok: false, reason: "wrong_audience" };
    }
    if (
      !issued.referenceId ||
      row.grantKind !== "oauth" ||
      row.grantClientId !== issued.clientId ||
      row.grantUserId !== issued.userId
    ) {
      return { ok: false, reason: "invalid" };
    }
    return { ok: true, grantId: issued.referenceId, scopes: [...issued.scopes] };
  }

  /**
   * Resolves an `Authorization: Bearer …` header (a personal `ov_…` key, or an
   * `ovat_…` OAuth access token when `allowOAuth`) to its grant, re-checking
   * everything that can stop a grant. Only the `Bearer` scheme is read; cookies
   * are never consulted. OAuth tokens are bound to `/api/mcp`, so the REST
   * tool API passes `allowOAuth: false` and they are refused there.
   */
  async function authenticate(
    authorizationHeader: string | null | undefined,
    context: { correlationId?: string; allowOAuth?: boolean } = {},
  ): Promise<AiAppAuthResult> {
    const token = bearerToken(authorizationHeader);
    if (!token) return { ok: false, reason: "missing" };

    let rows: Array<{
      grant: typeof aiAppGrant.$inferSelect;
      role: string | null;
      banned: boolean | null;
      metadata: unknown;
    }>;
    let tokenScopes: string[] | null = null;
    if (isPersonalKeyFormat(token)) {
      rows = await grantWithStanding()
        .innerJoin(aiAppKey, eq(aiAppKey.grantId, aiAppGrant.id))
        .where(eq(aiAppKey.keyHash, hashPersonalKey(token)))
        .limit(1);
    } else if (isOAuthAccessTokenFormat(token)) {
      if (context.allowOAuth === false) return { ok: false, reason: "wrong_audience" };
      const resolved = await resolveOAuthToken(token);
      if (!resolved.ok) return resolved;
      tokenScopes = resolved.scopes;
      rows = await grantWithStanding().where(eq(aiAppGrant.id, resolved.grantId)).limit(1);
    } else {
      return { ok: false, reason: "invalid" };
    }
    const row = rows[0];
    if (!row || row.banned === true) return { ok: false, reason: "invalid" };

    const grant = row.grant;
    const at = now();
    if (grant.revokedAt) {
      return { ok: false, reason: grant.revokedReason === "expired" ? "expired" : "revoked" };
    }
    if (grant.expiresAt && grant.expiresAt.getTime() <= at.getTime()) {
      const marked = await db
        .update(aiAppGrant)
        .set({ revokedAt: grant.expiresAt, revokedReason: "expired" })
        .where(and(eq(aiAppGrant.id, grant.id), isNull(aiAppGrant.revokedAt)))
        .returning({ id: aiAppGrant.id });
      if (marked.length > 0) {
        await audit({
          eventType: "AI_APP_GRANT_EXPIRED",
          organizationId: grant.organizationId,
          userId: grant.userId,
          grantId: grant.id,
          correlationId: context.correlationId,
          metadata: { kind: grant.kind },
        });
      }
      return { ok: false, reason: "expired" };
    }
    if (row.role !== "owner") return { ok: false, reason: "not_owner" };
    if (!parseAiAppsSetting(row.metadata).membersCanConnect) {
      return { ok: false, reason: "workspace_disabled" };
    }

    if (
      !grant.lastUsedAt ||
      at.getTime() - grant.lastUsedAt.getTime() >= LAST_USED_WRITE_INTERVAL_MS
    ) {
      await db.update(aiAppGrant).set({ lastUsedAt: at }).where(eq(aiAppGrant.id, grant.id));
    }

    return {
      ok: true,
      principal: {
        grantId: grant.id,
        kind: grant.kind as AiAppGrantKind,
        userId: grant.userId,
        organizationId: grant.organizationId,
        scopes: tokenScopes
          ? grant.scopes.filter((scope) => tokenScopes.includes(scope))
          : [...grant.scopes],
        label: grant.label,
      },
    };
  }

  /** Writes the light usage record of one call. Never fails the call. */
  async function recordCall(input: {
    principal: AiAppGrantPrincipal;
    tool: string;
    transport: "mcp" | "rest";
    status: string;
    rowCount?: number | null;
  }): Promise<void> {
    try {
      await db.insert(aiAppCall).values({
        grantId: input.principal.grantId,
        userId: input.principal.userId,
        tool: input.tool.slice(0, 64),
        transport: input.transport,
        status: input.status.slice(0, 32),
        rowCount: input.rowCount ?? null,
        createdAt: now(),
      });
    } catch (error) {
      logger.warn("ai_apps.call_record.failed", {
        grantId: input.principal.grantId,
        tool: input.tool,
        error,
      });
    }
  }

  /**
   * The member's most recent calls in one workspace ("Recent activity"), or
   * of one of their grants there when `grantId` is given.
   */
  async function listRecentCalls(input: {
    userId: string;
    organizationId: string;
    limit: number;
    grantId?: string;
  }): Promise<AiAppCallSummary[]> {
    const rows = await db
      .select({
        grantId: aiAppCall.grantId,
        tool: aiAppCall.tool,
        transport: aiAppCall.transport,
        status: aiAppCall.status,
        rowCount: aiAppCall.rowCount,
        createdAt: aiAppCall.createdAt,
      })
      .from(aiAppCall)
      .innerJoin(aiAppGrant, eq(aiAppGrant.id, aiAppCall.grantId))
      .where(
        and(
          eq(aiAppCall.userId, input.userId),
          eq(aiAppGrant.organizationId, input.organizationId),
          input.grantId ? eq(aiAppCall.grantId, input.grantId) : undefined,
        ),
      )
      .orderBy(desc(aiAppCall.createdAt), desc(aiAppCall.id))
      .limit(input.limit);
    return rows.map((row) => ({
      ...row,
      transport: row.transport as "mcp" | "rest",
      createdAt: row.createdAt.toISOString(),
    }));
  }

  /** Deletes usage rows older than the retention window; returns how many. */
  async function purgeExpiredCalls(): Promise<number> {
    const cutoff = new Date(now().getTime() - AI_APP_CALL_RETENTION_DAYS * 86_400_000);
    const deleted = await db
      .delete(aiAppCall)
      .where(lt(aiAppCall.createdAt, cutoff))
      .returning({ id: aiAppCall.id });
    return deleted.length;
  }

  async function setWorkspaceSetting(input: {
    userId: string;
    organizationId: string;
    membersCanConnect: boolean;
    correlationId?: string;
  }): Promise<{ membersCanConnect: boolean }> {
    const role = await memberRole(input.userId, input.organizationId);
    if (role !== "owner") {
      throw new AiAppGrantError("NOT_OWNER", "Only the workspace owner can change this setting.");
    }
    const change = await writeAiAppsSetting(db, input.organizationId, input.membersCanConnect);
    if (!change) throw new AiAppGrantError("NOT_OWNER", "Workspace not found.");
    if (change.before.membersCanConnect !== change.after.membersCanConnect) {
      await writeAuditLog({
        db,
        organizationId: input.organizationId,
        actorUserId: input.userId,
        eventType: "AI_APP_WORKSPACE_SETTING_CHANGED",
        targetType: "organization",
        targetId: input.organizationId,
        before: change.before,
        after: change.after,
        correlationId: input.correlationId,
      });
    }
    return change.after;
  }

  /**
   * Approves an OAuth connection: creates the member's `oauth` grant for this
   * client in this workspace (or, when one is already active, sets its scopes
   * to the newly approved ones, which is how a client steps up after a 403
   * `insufficient_scope`), then runs `authorize` to finish the OAuth consent
   * with the grant as its reference. If `authorize` fails, a new grant is
   * deleted and an existing one gets its previous scopes back.
   *
   * The same rules as a personal key apply: the current AI-app consent, only
   * grantable scopes, the member must own the workspace and the owner must
   * allow AI apps. A new connection is audited and sends the security email.
   */
  async function connectOAuthClient(
    input: ConnectOAuthClientInput,
  ): Promise<{ redirectUrl: string; grant: AiAppGrantSummary; created: boolean }> {
    if (input.consentVersion !== AI_APP_CONSENT_VERSION) {
      throw new AiAppGrantError(
        "CONSENT_REQUIRED",
        "Agree to the current AI-app consent to connect an app.",
        { consentVersion: AI_APP_CONSENT_VERSION },
      );
    }
    const scopes = normalizeScopes(input.scopes);
    if (!scopes.ok) {
      throw new AiAppGrantError("INVALID_SCOPE", "One or more scopes cannot be granted.", {
        invalid: scopes.invalid,
      });
    }
    const eligibility = await canCreate(input);
    if (!eligibility.allowed) {
      throw eligibility.reason === "WORKSPACE_DISABLED"
        ? new AiAppGrantError(
            "WORKSPACE_DISABLED",
            "The workspace owner has turned off connecting AI apps.",
          )
        : new AiAppGrantError("NOT_OWNER", "Only the workspace owner can connect AI apps for now.");
    }

    const at = now();
    const label = (input.clientName?.trim() || input.clientIdHost || "AI app").slice(
      0,
      MAX_LABEL_LENGTH,
    );
    const [existing] = await db
      .select()
      .from(aiAppGrant)
      .where(
        and(
          eq(aiAppGrant.userId, input.userId),
          eq(aiAppGrant.organizationId, input.organizationId),
          eq(aiAppGrant.kind, "oauth"),
          eq(aiAppGrant.oauthClientId, input.clientId),
          isNull(aiAppGrant.revokedAt),
        ),
      )
      .orderBy(desc(aiAppGrant.createdAt))
      .limit(1);

    let row: typeof aiAppGrant.$inferSelect;
    if (existing) {
      const [updated] = await db
        .update(aiAppGrant)
        .set({ scopes: scopes.scopes, consentedAt: at, label })
        .where(eq(aiAppGrant.id, existing.id))
        .returning();
      if (!updated) throw new Error("ai_app_grant update returned no row");
      row = updated;
    } else {
      const [inserted] = await db
        .insert(aiAppGrant)
        .values({
          organizationId: input.organizationId,
          userId: input.userId,
          kind: "oauth",
          label,
          scopes: scopes.scopes,
          consentVersion: AI_APP_CONSENT_VERSION,
          consentedAt: at,
          oauthClientId: input.clientId,
          expiresAt: null,
          createdAt: at,
        })
        .returning();
      if (!inserted) throw new Error("ai_app_grant insert returned no row");
      row = inserted;
    }

    let redirectUrl: string;
    try {
      redirectUrl = await input.authorize({ grantId: row.id, scopes: row.scopes });
    } catch (error) {
      if (existing) {
        await db
          .update(aiAppGrant)
          .set({
            scopes: existing.scopes,
            consentedAt: existing.consentedAt,
            label: existing.label,
          })
          .where(eq(aiAppGrant.id, existing.id));
      } else {
        await dropOAuthTokens([row.id]);
        await db.delete(aiAppGrant).where(eq(aiAppGrant.id, row.id));
      }
      throw error;
    }

    await audit({
      eventType: "AI_APP_CONSENT_GIVEN",
      organizationId: input.organizationId,
      userId: input.userId,
      grantId: row.id,
      correlationId: input.correlationId,
      metadata: { consentVersion: AI_APP_CONSENT_VERSION, kind: "oauth", scopes: scopes.scopes },
    });
    if (!existing) {
      await audit({
        eventType: "AI_APP_GRANT_CREATED",
        organizationId: input.organizationId,
        userId: input.userId,
        grantId: row.id,
        correlationId: input.correlationId,
        metadata: {
          kind: "oauth",
          clientIdHost: input.clientIdHost,
          scopes: scopes.scopes,
          consentVersion: AI_APP_CONSENT_VERSION,
        },
      });
      if (options.onOAuthConnected) {
        try {
          await options.onOAuthConnected({
            grantId: row.id,
            userId: input.userId,
            organizationId: input.organizationId,
            label,
            clientIdHost: input.clientIdHost,
            scopes: scopes.scopes,
            createdAt: at,
          });
        } catch (error) {
          logger.warn("ai_apps.connection_email.failed", {
            correlationId: input.correlationId,
            organizationId: input.organizationId,
            grantId: row.id,
            error,
          });
        }
      }
    }
    logger.info(existing ? "ai_apps.grant.reconsented" : "ai_apps.grant.created", {
      correlationId: input.correlationId,
      organizationId: input.organizationId,
      grantId: row.id,
      kind: "oauth",
      scopeCount: scopes.scopes.length,
    });
    return { redirectUrl, grant: summary(row, null), created: !existing };
  }

  /**
   * A rotated refresh token was presented again: revokes every active OAuth
   * grant of that member for that client (Better Auth tears down the whole
   * token family of the pair) and drops their tokens. Returns how many.
   */
  async function revokeOAuthAfterReplay(input: {
    clientId: string;
    userId: string;
    correlationId?: string;
  }): Promise<number> {
    const revoked = await db
      .update(aiAppGrant)
      .set({ revokedAt: now(), revokedReason: "revoked" })
      .where(
        and(
          eq(aiAppGrant.kind, "oauth"),
          eq(aiAppGrant.oauthClientId, input.clientId),
          eq(aiAppGrant.userId, input.userId),
          isNull(aiAppGrant.revokedAt),
        ),
      )
      .returning({ id: aiAppGrant.id, organizationId: aiAppGrant.organizationId });
    await dropOAuthTokens(revoked.map((grant) => grant.id));
    for (const grant of revoked) {
      await audit({
        eventType: "AI_APP_GRANT_REVOKED",
        organizationId: grant.organizationId,
        userId: input.userId,
        grantId: grant.id,
        correlationId: input.correlationId,
        metadata: { kind: "oauth", reason: "refresh_token_replay" },
      });
      logger.warn("ai_apps.grant.revoked_after_replay", {
        correlationId: input.correlationId,
        organizationId: grant.organizationId,
        grantId: grant.id,
      });
    }
    return revoked.length;
  }

  /**
   * Deletes dynamically registered clients older than 24 hours that never
   * completed a grant (their tokens, consents and resource links go with
   * them). Clients from a metadata document are kept: they are re-fetched,
   * not registered. Returns how many were deleted.
   */
  async function purgeAbandonedOAuthClients(): Promise<number> {
    const cutoff = new Date(now().getTime() - ABANDONED_OAUTH_CLIENT_HOURS * 3_600_000);
    const deleted = await db
      .delete(oauthClient)
      .where(
        and(
          isNull(oauthClient.clientDiscoveryId),
          or(isNull(oauthClient.createdAt), lt(oauthClient.createdAt, cutoff)),
          sql`not exists (select 1 from ${aiAppGrant} where ${aiAppGrant.oauthClientId} = ${oauthClient.clientId})`,
        ),
      )
      .returning({ id: oauthClient.id });
    return deleted.length;
  }

  /**
   * The workspaces this member could connect an app to, for the consent
   * screen's picker: every membership, with whether a grant may be created
   * there now (the member owns it and the owner allows AI apps).
   */
  async function listConnectableWorkspaces(userId: string): Promise<
    Array<{
      organizationId: string;
      name: string;
      allowed: boolean;
      reason: "NOT_OWNER" | "WORKSPACE_DISABLED" | null;
    }>
  > {
    const rows = await db
      .select({
        organizationId: organization.id,
        name: organization.name,
        role: member.role,
        metadata: organization.metadata,
      })
      .from(member)
      .innerJoin(organization, eq(organization.id, member.organizationId))
      .where(eq(member.userId, userId))
      .orderBy(organization.name, organization.id);
    return rows.map((row) => {
      const reason =
        row.role !== "owner"
          ? ("NOT_OWNER" as const)
          : !parseAiAppsSetting(row.metadata).membersCanConnect
            ? ("WORKSPACE_DISABLED" as const)
            : null;
      return {
        organizationId: row.organizationId,
        name: row.name,
        allowed: reason === null,
        reason,
      };
    });
  }

  return Object.freeze({
    canCreate,
    listConnectableWorkspaces,
    connectOAuthClient,
    revokeOAuthAfterReplay,
    purgeAbandonedOAuthClients,
    createPersonalKey,
    listGrants,
    revokeGrant,
    authenticate,
    recordCall,
    listRecentCalls,
    purgeExpiredCalls,
    readWorkspaceSetting: (organizationId: string) => readAiAppsSetting(db, organizationId),
    setWorkspaceSetting,
  });
}

export type { GrantableScope };
