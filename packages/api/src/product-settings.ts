import type { Session } from "@openvalens/auth";
import { isInstanceAdminRole } from "@openvalens/auth/authz/instance-admin";
import {
  isSessionLive,
  requireTrustedIdentity,
  resolveSessionIdentity,
  toDate,
  type SessionIdentity,
  type TrustedIdentity,
} from "@openvalens/auth/authz/trusted-session";
import { sql, type Database } from "@openvalens/db";

import type { Context } from "./context";
import { raiseApiError } from "./errors";
import {
  productSettingsUpdateInput,
  type ProductLocale,
  type ProductSettingsSnapshot,
  type ProductSettingsUpdateInput,
  type ProductUnits,
} from "./product-settings-contract";

/**
 * Issue #58 — product display-settings service.
 *
 * Persistence and authorization core for the singleton `product_settings` row
 * and its dedicated, value-free change audit. It owns no HTTP concern: the
 * router enforces the exact `Origin`, the fresh instance-admin gate and the
 * value-free input validation, then delegates here.
 *
 * Safety properties:
 * - Every mutation runs in one transaction that locks the actor `user` row,
 *   then the singleton settings row, then the actor's `session` row (a
 *   consistent order). Authority is read *fresh* under the actor lock, and the
 *   real wall-clock expiry is re-checked with `clock_timestamp()` *after* every
 *   contended lock, so a demotion, ban or expiry committed while the request
 *   waited on a lock denies with no side effect.
 * - The write requires a trusted, non-impersonated session with a live Better
 *   Auth `session` row for the same user.
 * - Optimistic concurrency: a stale `expectedRevision` is a stable `CONFLICT`
 *   with no mutation and no audit; identical values are a no-op (no revision
 *   bump, no audit).
 * - The audit row stores only the actor, the changed key *names* and the
 *   resulting revision — never a value, email, input, reason or metadata.
 */

export type ProductSettingsErrorCode = "DENIED" | "CONFLICT" | "INVALID_INPUT" | "INTERNAL";

const MESSAGES: Record<ProductSettingsErrorCode, string> = {
  DENIED: "You do not have permission to perform this action.",
  CONFLICT: "The settings were changed by another request. Reload and try again.",
  INVALID_INPUT: "Invalid input",
  INTERNAL: "Something went wrong.",
};

/** Typed, value-free settings failure. No `cause`, no structured detail. */
export class ProductSettingsError extends Error {
  readonly code: ProductSettingsErrorCode;

  constructor(code: ProductSettingsErrorCode) {
    super(MESSAGES[code]);
    this.name = "ProductSettingsError";
    this.code = code;
  }
}

export function isProductSettingsError(value: unknown): value is ProductSettingsError {
  return value instanceof ProductSettingsError;
}

export type ProductSettingsDeps = { db: Database };

export type ProductSettingsService = {
  /** Effective settings + a freshly resolved `canEdit` for the caller. */
  read(session: Session | null): Promise<ProductSettingsSnapshot>;
  /** Optimistic, audited mutation. Requires a fresh instance administrator. */
  update(
    input: ProductSettingsUpdateInput,
    session: Session | null,
  ): Promise<ProductSettingsSnapshot>;
};

type Tx = Parameters<Parameters<ProductSettingsDeps["db"]["transaction"]>[0]>[0];

type SettingsRow = { units: unknown; locale: unknown; revision: unknown };
type ActorRow = { id: string; role: unknown; banned: unknown; email_verified: unknown };
type SessionRow = { id: string; user_id: string; impersonated_by: unknown; expires_at: unknown };

/** The fresh DB authority fields both `read` and `update` must agree on. */
type ActorAuthority = { role: unknown; banned: unknown; email_verified: unknown };
type LiveSessionAuthority = {
  user_id: unknown;
  impersonated_by: unknown;
  expires_at: unknown;
};

/** Structural view of a session identity accepted by {@link authorityAllows}. */
type SessionAuthority = {
  userId: string;
  sessionId: string | null;
  impersonated?: boolean;
  expiresAt: Date | null;
};

/** One row joining the actor user with its (optional) live session + DB clock. */
type AuthorityRow = {
  role: unknown;
  banned: unknown;
  email_verified: unknown;
  session_id: string | null;
  session_user_id: string | null;
  impersonated_by: unknown;
  session_expires_at: unknown;
  now: unknown;
};

function toInt(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.trunc(parsed);
    }
  }
  return 0;
}

function asUnits(value: unknown): ProductUnits {
  if (value === "metric" || value === "imperial") {
    return value;
  }
  throw new ProductSettingsError("INTERNAL");
}

function asLocale(value: unknown): ProductLocale {
  if (value === "en-US" || value === "en-GB" || value === "en-CA" || value === "pt-PT") {
    return value;
  }
  throw new ProductSettingsError("INTERNAL");
}

/** Maps any thrown value to a generic typed error; never echoes the original. */
function asProductSettingsError(error: unknown): ProductSettingsError {
  if (error instanceof ProductSettingsError) {
    return error;
  }
  return new ProductSettingsError("INTERNAL");
}

async function run<T>(db: Database, fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await db.transaction(fn);
  } catch (error) {
    throw asProductSettingsError(error);
  }
}

async function dbNow(tx: Tx): Promise<Date> {
  const result = await tx.execute<{ now: unknown }>(sql`select clock_timestamp() as now`);
  const now = toDate(result.rows[0]?.now);
  if (!now) {
    throw new ProductSettingsError("INTERNAL");
  }
  return now;
}

async function lockActor(tx: Tx, userId: string): Promise<ActorRow | null> {
  const result = await tx.execute<ActorRow>(
    sql`select "id", "role", "banned", "email_verified" from "user" where "id" = ${userId} for update`,
  );
  return result.rows[0] ?? null;
}

async function lockSettings(tx: Tx): Promise<SettingsRow | null> {
  const result = await tx.execute<SettingsRow>(
    sql`select "units", "locale", "revision" from "product_settings" where "id" = 'instance' for update`,
  );
  return result.rows[0] ?? null;
}

async function lockSession(tx: Tx, sessionId: string): Promise<SessionRow | null> {
  const result = await tx.execute<SessionRow>(
    sql`select "id", "user_id", "impersonated_by", "expires_at" from "session" where "id" = ${sessionId} for update`,
  );
  return result.rows[0] ?? null;
}

async function loadSettings(db: Database): Promise<SettingsRow | null> {
  const result = await db.execute<SettingsRow>(
    sql`select "units", "locale", "revision" from "product_settings" where "id" = 'instance'`,
  );
  return result.rows[0] ?? null;
}

/**
 * One atomic read of the caller's fresh authority: the actor `user` row joined
 * with the *live* persisted `session` row and the authoritative wall clock.
 * The role always comes from the `user` row, never from the session object.
 * Returns `null` when the user row is absent (a denied capability, not a
 * failure).
 */
async function loadAuthorityRow(
  db: Database,
  userId: string,
  sessionId: string | null,
): Promise<AuthorityRow | null> {
  const result = await db.execute<AuthorityRow>(
    sql`select u."role" as role, u."banned" as banned, u."email_verified" as email_verified, s."id" as session_id, s."user_id" as session_user_id, s."impersonated_by" as impersonated_by, s."expires_at" as session_expires_at, clock_timestamp() as now from "user" u left join "session" s on s."id" = ${sessionId} and s."user_id" = u."id" where u."id" = ${userId} limit 1`,
  );
  return result.rows[0] ?? null;
}

/**
 * The single authority predicate shared by `read` (`canEdit`) and `update`, so
 * the two can never diverge. It requires:
 * - a trusted, non-impersonated session object with a resolvable expiry and id;
 * - the live persisted `session` row for the same user, not impersonated, and
 *   unexpired against the fresh wall-clock `now`;
 * - a fresh `user` row that is the exact `admin` token, not banned, verified.
 */
function authorityAllows(
  identity: SessionAuthority | null,
  actor: ActorAuthority | null,
  live: LiveSessionAuthority | null,
  now: Date,
): boolean {
  if (!identity || identity.impersonated || !identity.expiresAt || !identity.sessionId) {
    return false;
  }
  const identityExpiresAt = identity.expiresAt;
  if (!isSessionLive({ expiresAt: identityExpiresAt }, now)) {
    return false;
  }
  if (!live || live.user_id !== identity.userId || live.impersonated_by !== null) {
    return false;
  }
  const sessionExpires = toDate(live.expires_at);
  if (!sessionExpires || !isSessionLive({ expiresAt: sessionExpires }, now)) {
    return false;
  }
  return isFreshAdmin(actor);
}

/**
 * The actor must be the exact `admin` token, not banned, and verified. `banned`
 * `false` (and the null column default) pass; `true` and malformed values do
 * not.
 */
function isFreshAdmin(actor: ActorAuthority | null): boolean {
  if (!actor || !isInstanceAdminRole(actor.role) || actor.email_verified !== true) {
    return false;
  }
  return actor.banned === false || actor.banned === null;
}

/** Resolves a trusted session or denies; the plain helper error is swallowed. */
function requireIdentity(session: Session | null): TrustedIdentity {
  try {
    return requireTrustedIdentity(session);
  } catch {
    throw new ProductSettingsError("DENIED");
  }
}

export function createProductSettingsService(deps: ProductSettingsDeps): ProductSettingsService {
  const { db } = deps;

  async function read(session: Session | null): Promise<ProductSettingsSnapshot> {
    try {
      // The effective values are readable by any authenticated consumer even
      // when the capability is false; only the capability reflects write
      // authority. No locks are taken: this is a best-effort snapshot, and the
      // write path re-verifies authoritatively under its own locks.
      const settings = await loadSettings(db);
      if (!settings) {
        throw new ProductSettingsError("INTERNAL");
      }

      const identity: SessionIdentity | null = resolveSessionIdentity(session);
      let canEdit = false;
      if (identity) {
        const row = await loadAuthorityRow(db, identity.userId, identity.sessionId);
        const now = toDate(row?.now);
        if (row && now) {
          const live: LiveSessionAuthority | null =
            row.session_id === null
              ? null
              : {
                  user_id: row.session_user_id,
                  impersonated_by: row.impersonated_by,
                  expires_at: row.session_expires_at,
                };
          canEdit = authorityAllows(identity, row, live, now);
        }
      }

      return {
        units: asUnits(settings.units),
        locale: asLocale(settings.locale),
        revision: toInt(settings.revision),
        canEdit,
      };
    } catch (error) {
      throw asProductSettingsError(error);
    }
  }

  async function update(
    input: ProductSettingsUpdateInput,
    session: Session | null,
  ): Promise<ProductSettingsSnapshot> {
    // Re-validate strictly even though the router already did: a direct caller
    // cannot smuggle unknown/secret keys into the write.
    const parsed = productSettingsUpdateInput.safeParse(input);
    if (!parsed.success) {
      throw new ProductSettingsError("INVALID_INPUT");
    }
    const { units, locale, expectedRevision } = parsed.data;

    const identity = requireIdentity(session);

    return run(db, async (tx) => {
      // Consistent lock order: actor user → settings → session.
      const actor = await lockActor(tx, identity.userId);
      const settings = await lockSettings(tx);
      const liveSession = identity.sessionId ? await lockSession(tx, identity.sessionId) : null;

      // All contended locks are held; the shared predicate re-checks the exact
      // write authority against the fresh wall-clock `now` (identity + live
      // persisted session + fresh actor row), so a demotion, ban or expiry
      // committed while queued denies with no side effect.
      const now = await dbNow(tx);

      if (!authorityAllows(identity, actor, liveSession, now)) {
        throw new ProductSettingsError("DENIED");
      }

      if (!settings) {
        throw new ProductSettingsError("INTERNAL");
      }

      const currentRevision = toInt(settings.revision);
      if (currentRevision !== expectedRevision) {
        throw new ProductSettingsError("CONFLICT");
      }

      const changedKeys: string[] = [];
      if (units !== settings.units) {
        changedKeys.push("units");
      }
      if (locale !== settings.locale) {
        changedKeys.push("locale");
      }

      if (changedKeys.length === 0) {
        // Same values: no revision bump, no audit row.
        return {
          units: asUnits(settings.units),
          locale: asLocale(settings.locale),
          revision: currentRevision,
          canEdit: true,
        };
      }

      const nextRevision = currentRevision + 1;
      await tx.execute(
        sql`update "product_settings" set "units" = ${units}, "locale" = ${locale}, "revision" = ${nextRevision}, "updated_at" = clock_timestamp() where "id" = 'instance'`,
      );
      await tx.execute(
        sql`insert into "product_settings_audit" ("id", "actor_user_id", "changed_keys", "revision") values (${crypto.randomUUID()}, ${identity.userId}, ${changedKeys.join(",")}, ${nextRevision})`,
      );

      return { units, locale, revision: nextRevision, canEdit: true };
    });
  }

  return { read, update };
}

/** Resolves the server-injected service or fails closed (never an in-memory fallback). */
export function requireProductSettingsService(context: Context): ProductSettingsService {
  const service = context.productSettingsService;
  if (!service) {
    throw raiseApiError("INTERNAL", "Something went wrong.");
  }
  return service;
}

/** Maps a typed settings failure to the stable, value-free envelope. */
export function mapProductSettingsError(error: unknown): never {
  if (isProductSettingsError(error)) {
    switch (error.code) {
      case "DENIED":
        throw raiseApiError(
          "PERMISSION_DENIED",
          "You do not have permission to perform this action.",
        );
      case "CONFLICT":
        throw raiseApiError(
          "CONFLICT",
          "The settings were changed by another request. Reload and try again.",
        );
      case "INVALID_INPUT":
        throw raiseApiError("INVALID_INPUT", "Invalid input");
      case "INTERNAL":
        throw raiseApiError("INTERNAL", "Something went wrong.");
    }
  }

  throw raiseApiError("INTERNAL", "Something went wrong.");
}
