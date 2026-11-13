import { writeAuditLog, type AuditEventType } from "@openvalens/audit-security";
import type { Database } from "@openvalens/db";
import { aiAppCall, aiAppGrant, aiAppKey } from "@openvalens/db/schema/ai-apps";
import { member, organization, user } from "@openvalens/db/schema/auth";
import { createStructuredLogger, type StructuredLogger } from "@openvalens/observability";
import { and, desc, eq, gt, isNull, lt, or, sql } from "drizzle-orm";

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
  | "workspace_disabled";

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

export type AiAppsServiceOptions = {
  db: Database;
  now?: () => Date;
  logger?: StructuredLogger;
  /**
   * Sends the "a key was created" security email. Awaited but never fatal: a
   * failure is logged and the key is still returned.
   */
  onKeyCreated?: (event: AiAppKeyCreatedEvent) => Promise<void>;
};

export type AiAppsService = ReturnType<typeof createAiAppsService>;

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
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

  /**
   * Resolves an `Authorization: Bearer ov_…` header to its grant, re-checking
   * everything that can stop a grant. Only the `Bearer` scheme is read; cookies
   * are never consulted.
   */
  async function authenticate(
    authorizationHeader: string | null | undefined,
    context: { correlationId?: string } = {},
  ): Promise<AiAppAuthResult> {
    const token = bearerToken(authorizationHeader);
    if (!token) return { ok: false, reason: "missing" };
    if (!isPersonalKeyFormat(token)) return { ok: false, reason: "invalid" };

    const rows = await db
      .select({
        grant: aiAppGrant,
        role: member.role,
        banned: user.banned,
        metadata: organization.metadata,
      })
      .from(aiAppKey)
      .innerJoin(aiAppGrant, eq(aiAppGrant.id, aiAppKey.grantId))
      .innerJoin(user, eq(user.id, aiAppGrant.userId))
      .innerJoin(organization, eq(organization.id, aiAppGrant.organizationId))
      .leftJoin(
        member,
        and(
          eq(member.organizationId, aiAppGrant.organizationId),
          eq(member.userId, aiAppGrant.userId),
        ),
      )
      .where(eq(aiAppKey.keyHash, hashPersonalKey(token)))
      .limit(1);
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
        scopes: [...grant.scopes],
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

  /** The member's most recent calls in one workspace ("Recent activity"). */
  async function listRecentCalls(input: {
    userId: string;
    organizationId: string;
    limit: number;
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

  return Object.freeze({
    canCreate,
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
