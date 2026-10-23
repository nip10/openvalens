import { sql, type Database } from "@openvalens/db";

import { isInstanceAdminRole } from "../authz/instance-admin";
import {
  isSessionLive,
  requireTrustedIdentity as requireTrustedSessionIdentity,
  resolveSessionIdentity,
  toDate,
  type TrustedIdentity,
} from "../authz/trusted-session";
import type { Session } from "../index";
import {
  constantTimeHashEquals,
  EMAIL_LOCK_DOMAIN,
  generateInvitationSecret,
  generateProofCode,
  generateSetupSecret,
  hashInvitationSecret,
  hashProofCode,
  hashSetupSecret,
  isHashFormat,
  newId,
} from "./crypto";
import { canonicalizeEmail } from "./email";
import { AdmissionError } from "./errors";

/**
 * Application-owned admission service (Issue #63).
 *
 * A one-time setup token bootstraps the first global instance administrator.
 * Once any global administrator exists the instance is `invite_only`: only a
 * global administrator may invite a new account. This module owns *no* HTTP,
 * CLI, email transport or Better Auth wiring — it is a pure persistence and
 * authorization core built from raw SQL, so the auth/API integrator can mount
 * it behind trusted session resolution.
 *
 * Safety properties enforced here:
 * - Every mutation runs in a single transaction that takes locks in one order:
 *   singleton `instance_admission` → grant → canonical-email advisory lock →
 *   affected `user` rows (`ORDER BY id FOR UPDATE`).
 * - Setup/invitation bearers and email proof codes are compared in constant
 *   time against domain-separated SHA-256 digests; only digests are persisted.
 * - Authorization always reads the *fresh* global role from the database; a
 *   caller-supplied id, an organization role or a stale session claim is never
 *   trusted. Existing setup targets additionally require a matching,
 *   non-impersonated, unexpired session and a verified, unbanned account.
 * - Email delivery is injected. A delivery failure maps to a generic
 *   `DELIVERY_FAILED`; the committed grant stays retryable and no secret leaks.
 */

const SETUP_TTL_MS = 24 * 60 * 60 * 1000;
const INVITE_TTL_MS = 2 * 24 * 60 * 60 * 1000;
const PROOF_TTL_MS = 10 * 60 * 1000;
const SEND_WINDOW_MS = 10 * 60 * 1000;
const MAX_PROOF_ATTEMPTS = 5;
const MAX_SENDS = 3;
const PRUNE_LIMIT_MAX = 500;
const LIST_LIMIT_MAX = 100;

export type AdmissionKind = "setup" | "invitation";

export type DeliverVerification = (input: {
  email: string;
  kind: AdmissionKind;
  verificationCode: string;
}) => Promise<void>;

export type DeliverInvitation = (input: {
  email: string;
  invitationToken: string;
}) => Promise<void>;

export type AdmissionDeps = {
  db: Database;
  deliverVerification: DeliverVerification;
  deliverInvitation: DeliverInvitation;
  /**
   * Whether email can really be delivered (false when email is a dry run).
   * Admission needs an emailed code, so without it `begin` and
   * `issueInvitation` refuse before writing anything. Defaults to true.
   */
  emailDeliveryAvailable?: () => boolean;
};

export type AdmissionBeginInput = {
  kind: AdmissionKind;
  credential: string;
  email: string;
};

export type AdmissionCompleteInput = {
  enrollmentId: string;
  credential: string;
  verificationCode: string;
};

export type AdmissionInvitationSummary = {
  id: string;
  email: string;
  expiresAt: Date | null;
  consumedAt: Date | null;
  status: "pending" | "consumed" | "expired";
};

export type AdmissionService = {
  /** INTERNAL operator-only. Never expose as a public RPC. */
  mintSetupToken(): Promise<{ token: string; expiresAt: Date; generation: number }>;
  begin(input: AdmissionBeginInput): Promise<{ enrollmentId: string }>;
  complete(input: AdmissionCompleteInput, session: Session | null): Promise<{ completed: true }>;
  issueInvitation(
    input: { email: string },
    session: Session | null,
  ): Promise<{ invitationId: string; expiresAt: Date }>;
  revokeInvitation(
    input: { invitationId: string },
    session: Session | null,
  ): Promise<{ revoked: boolean }>;
  status(): Promise<{ setupAvailable: boolean; emailDeliveryAvailable: boolean }>;
  listInvitations(session: Session | null): Promise<AdmissionInvitationSummary[]>;
  /** INTERNAL operator-only cleanup, fixed bound ≤ 500. Never a public RPC. */
  pruneExpiredGrants(input?: { limit?: number }): Promise<{ pruned: number }>;
};

type Tx = Parameters<Parameters<AdmissionDeps["db"]["transaction"]>[0]>[0];

type SingletonRow = {
  id: string;
  state: string;
  generation: unknown;
  setup_token_hash: unknown;
  setup_expires_at: unknown;
  completed_at: unknown;
};

type GrantRow = {
  id: string;
  kind: string;
  generation: unknown;
  canonical_email: string;
  target_user_id: string | null;
  inviter_user_id: string | null;
  invitation_token_hash: unknown;
  expires_at: unknown;
  verification_code_hash: unknown;
  verification_expires_at: unknown;
  verification_attempts: unknown;
  send_count: unknown;
  send_window_started_at: unknown;
  consumed_at: unknown;
};

type UserRow = {
  id: string;
  email: string;
  role: unknown;
  banned: unknown;
  email_verified: unknown;
};

const GRANT_COLUMNS = sql`"id", "kind", "generation", "canonical_email", "target_user_id", "inviter_user_id", "invitation_token_hash", "expires_at", "verification_code_hash", "verification_expires_at", "verification_attempts", "send_count", "send_window_started_at", "consumed_at"`;

// ─── Value coercion ────────────────────────────────────────────

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

/** Maps any thrown value to a generic typed error; never echoes the original. */
function asAdmissionError(error: unknown): AdmissionError {
  if (error instanceof AdmissionError) {
    return error;
  }
  const code = (error as { code?: unknown } | null)?.code;
  // Unique-violation (e.g. an email bound by a concurrent writer) is a denial,
  // not an internal fault, and never surfaces the raw SQL or DSN.
  if (code === "23505") {
    return new AdmissionError("DENIED");
  }
  return new AdmissionError("INTERNAL");
}

async function run<T>(db: Database, fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await db.transaction(fn);
  } catch (error) {
    throw asAdmissionError(error);
  }
}

// ─── SQL primitives (shared lock order) ────────────────────────

/**
 * Real wall-clock database time. `now()` is frozen at transaction start, so a
 * request that was valid when queued but waited on a lock would still see the
 * old instant. `clock_timestamp()` advances with real time and is the only
 * authoritative TTL source for expiry decisions and issuance.
 */
async function dbNow(tx: Tx): Promise<Date> {
  const result = await tx.execute<{ now: unknown }>(sql`select clock_timestamp() as now`);
  const now = toDate(result.rows[0]?.now);
  if (!now) {
    throw new AdmissionError("INTERNAL");
  }
  return now;
}

async function lockSingleton(tx: Tx): Promise<SingletonRow | null> {
  const result = await tx.execute<SingletonRow>(
    sql`select "id", "state", "generation", "setup_token_hash", "setup_expires_at", "completed_at" from "instance_admission" where "id" = 'instance' for update`,
  );
  return result.rows[0] ?? null;
}

function requireSingleton(row: SingletonRow | null): SingletonRow {
  if (!row || row.id !== "instance") {
    throw new AdmissionError("DENIED");
  }
  return row;
}

/** True when *any* exact global administrator exists, banned or not. */
async function anyGlobalAdmin(tx: Tx): Promise<boolean> {
  const result = await tx.execute<{ role: unknown }>(sql`select "role" from "user"`);
  return result.rows.some((row) => isInstanceAdminRole(row.role));
}

async function lockUserById(tx: Tx, id: string): Promise<UserRow | null> {
  const result = await tx.execute<UserRow>(
    sql`select "id", "email", "role", "banned", "email_verified" from "user" where "id" = ${id} for update`,
  );
  return result.rows[0] ?? null;
}

async function lockUsersByEmail(tx: Tx, canonical: string): Promise<UserRow[]> {
  const result = await tx.execute<UserRow>(
    sql`select "id", "email", "role", "banned", "email_verified" from "user" where lower("email") = ${canonical} order by "id" for update`,
  );
  return result.rows;
}

async function lockEmail(tx: Tx, canonical: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${EMAIL_LOCK_DOMAIN + canonical}, 0))`,
  );
}

async function lockGrantById(tx: Tx, id: string): Promise<GrantRow | null> {
  const result = await tx.execute<GrantRow>(
    sql`select ${GRANT_COLUMNS} from "admission_grant" where "id" = ${id} for update`,
  );
  return result.rows[0] ?? null;
}

async function lockSetupGrant(tx: Tx, generation: number): Promise<GrantRow | null> {
  const result = await tx.execute<GrantRow>(
    sql`select ${GRANT_COLUMNS} from "admission_grant" where "kind" = 'setup' and "generation" = ${generation} for update`,
  );
  return result.rows[0] ?? null;
}

async function lockInvitationGrantByHash(tx: Tx, hash: string): Promise<GrantRow | null> {
  const result = await tx.execute<GrantRow>(
    sql`select ${GRANT_COLUMNS} from "admission_grant" where "invitation_token_hash" = ${hash} for update`,
  );
  return result.rows[0] ?? null;
}

async function insertEvent(
  tx: Tx,
  input: {
    type: string;
    actorUserId: string | null;
    targetUserId: string | null;
    grantId: string | null;
  },
): Promise<void> {
  await tx.execute(
    sql`insert into "global_security_event" ("id", "event_type", "actor_user_id", "target_user_id", "grant_id") values (${newId()}, ${input.type}, ${input.actorUserId}, ${input.targetUserId}, ${input.grantId})`,
  );
}

// ─── Proof / send-window accounting ────────────────────────────

type SendDecision = { count: number; window: Date };

/**
 * 3 sends per rolling 10-minute window. The window only resets once the
 * committed `send_window_started_at` is more than 10 minutes old; it never
 * extends the grant expiry.
 */
function nextSend(
  now: Date,
  sendCount: number,
  windowStart: Date | null,
): SendDecision | "rate_limited" {
  if (windowStart && now.getTime() - windowStart.getTime() < SEND_WINDOW_MS) {
    if (sendCount >= MAX_SENDS) {
      return "rate_limited";
    }
    return { count: sendCount + 1, window: windowStart };
  }
  return { count: 1, window: now };
}

function proofExpiry(now: Date, grantExpires: Date): Date {
  return new Date(Math.min(now.getTime() + PROOF_TTL_MS, grantExpires.getTime()));
}

// ─── Session narrowing ─────────────────────────────────────────
//
// The pure helpers (`toDate`, `resolveSessionIdentity`, `isSessionLive`) are
// shared with the product-settings service via `../authz/trusted-session`.
// Admission keeps its own thin wrappers so a denied identity still surfaces the
// typed `AdmissionError("DENIED")` the API layer maps.

/**
 * A trusted, non-impersonated administrator session with a *resolvable* expiry.
 * A missing, null, undefined or malformed `expiresAt` is a denial here; the
 * real wall-clock expiry comparison happens after the lock wait, using
 * {@link assertSessionLive}. This keeps every public method's session
 * condition uniform: an expired date field can never authorize a mutation or a
 * listing.
 */
function requireTrustedIdentity(session: Session | null): TrustedIdentity {
  try {
    return requireTrustedSessionIdentity(session);
  } catch {
    throw new AdmissionError("DENIED");
  }
}

/**
 * Re-checks the session expiry against real wall-clock DB time *after* all
 * contended locks are held, immediately before a privileged mutation or a
 * listing. A session that expired while the request waited on a lock is
 * denied with no side effects.
 */
async function assertSessionLive(tx: Tx, identity: TrustedIdentity): Promise<Date> {
  const now = await dbNow(tx);
  if (!isSessionLive(identity, now)) {
    throw new AdmissionError("DENIED");
  }
  return now;
}

/**
 * Existing-target check for {@link complete}. The session must belong to the
 * bound user, be non-impersonated, and carry a finite `expiresAt` later than
 * the fresh wall-clock `now`. A `Date` with a NaN timestamp yields a non-finite
 * `getTime()` and is denied rather than slipping through a `<=` comparison.
 */
function sessionMatchesTarget(session: Session | null, targetId: string, now: Date): boolean {
  const identity = resolveSessionIdentity(session);
  if (!identity || identity.impersonated || identity.userId !== targetId) {
    return false;
  }
  const expiresAt = identity.expiresAt;
  if (!expiresAt) {
    return false;
  }
  const time = expiresAt.getTime();
  return Number.isFinite(time) && time > now.getTime();
}

async function requireFreshAdmin(tx: Tx, userId: string): Promise<void> {
  const user = await lockUserById(tx, userId);
  if (!user || !isInstanceAdminRole(user.role) || user.banned === true) {
    throw new AdmissionError("DENIED");
  }
}

// ─── Resolve an immutable target identity ──────────────────────

type TargetResolution = { kind: "none" } | { kind: "ambiguous" } | { kind: "user"; id: string };

function resolveTarget(users: UserRow[]): TargetResolution {
  if (users.length > 1) {
    return { kind: "ambiguous" };
  }
  const first = users[0];
  if (!first) {
    return { kind: "none" };
  }
  return { kind: "user", id: first.id };
}

/**
 * Binds or re-validates a grant's immutable target. Binding happens only on the
 * first proof issuance; afterwards the identity can never switch, and an
 * account appearing after issuance is a restartable denial rather than an
 * automatic approval.
 */
function bindTarget(
  boundTargetId: string | null,
  firstIssuance: boolean,
  resolved: TargetResolution,
): string | null {
  if (resolved.kind === "ambiguous") {
    throw new AdmissionError("DENIED");
  }
  const resolvedId = resolved.kind === "user" ? resolved.id : null;
  if (boundTargetId === null) {
    if (firstIssuance) {
      return resolvedId;
    }
    if (resolvedId !== null) {
      throw new AdmissionError("DENIED");
    }
    return null;
  }
  if (resolvedId !== null && resolvedId !== boundTargetId) {
    throw new AdmissionError("DENIED");
  }
  return boundTargetId;
}

// ─── Factory ───────────────────────────────────────────────────

export function createAdmissionService(deps: AdmissionDeps): AdmissionService {
  const { db, deliverVerification, deliverInvitation } = deps;
  const emailDeliveryAvailable = deps.emailDeliveryAvailable ?? (() => true);

  /** Refuses before any write when no emailed code could be delivered. */
  function requireEmailDelivery(): void {
    if (!emailDeliveryAvailable()) throw new AdmissionError("EMAIL_UNAVAILABLE");
  }

  async function status(): Promise<{ setupAvailable: boolean; emailDeliveryAvailable: boolean }> {
    const result = await db.execute<SingletonRow>(
      sql`select "id", "state", "generation", "setup_token_hash", "setup_expires_at", "completed_at" from "instance_admission" where "id" = 'instance'`,
    );
    const row = result.rows[0];
    const available = !!row && row.state === "pending" && !row.completed_at;
    return { setupAvailable: available, emailDeliveryAvailable: emailDeliveryAvailable() };
  }

  async function mintSetupToken(): Promise<{
    token: string;
    expiresAt: Date;
    generation: number;
  }> {
    return run(db, async (tx) => {
      const singleton = requireSingleton(await lockSingleton(tx));

      if (singleton.state !== "pending" || singleton.completed_at) {
        throw new AdmissionError("DENIED");
      }
      // A manually created administrator (even a banned one) closes bootstrap.
      if (await anyGlobalAdmin(tx)) {
        throw new AdmissionError("DENIED");
      }

      // Derive the TTL from real wall-clock time acquired *after* the
      // singleton lock, not from the transaction-start instant.
      const now = await dbNow(tx);
      const generation = toInt(singleton.generation) + 1;
      const token = generateSetupSecret();
      const tokenHash = hashSetupSecret(token);
      const expiresAt = new Date(now.getTime() + SETUP_TTL_MS);

      await tx.execute(
        sql`update "instance_admission" set "state" = 'pending', "generation" = ${generation}, "setup_token_hash" = ${tokenHash}, "setup_expires_at" = ${expiresAt.toISOString()}, "completed_at" = null where "id" = 'instance'`,
      );
      // Rotation invalidates every prior setup reservation but leaves global
      // admission invitations untouched.
      await tx.execute(sql`delete from "admission_grant" where "kind" = 'setup'`);
      await insertEvent(tx, {
        type: "setup_token_minted",
        actorUserId: null,
        targetUserId: null,
        grantId: null,
      });

      return { token, expiresAt, generation };
    });
  }

  async function begin(input: AdmissionBeginInput): Promise<{ enrollmentId: string }> {
    if (input?.kind !== "setup" && input?.kind !== "invitation") {
      throw new AdmissionError("DENIED");
    }
    const kind = input.kind;
    const credential = typeof input.credential === "string" ? input.credential : "";
    if (credential.length === 0 || credential.length > 512) {
      throw new AdmissionError("DENIED");
    }
    const canonical = canonicalizeEmail(input.email);
    if (!canonical) {
      throw new AdmissionError("DENIED");
    }
    requireEmailDelivery();

    const issued = await run(db, async (tx) => {
      const singleton = requireSingleton(await lockSingleton(tx));
      return kind === "setup"
        ? beginSetup(tx, singleton, credential, canonical)
        : beginInvitation(tx, singleton, credential, canonical);
    });

    try {
      await deliverVerification({
        email: issued.email,
        kind,
        verificationCode: issued.code,
      });
    } catch {
      throw new AdmissionError("DELIVERY_FAILED");
    }
    return { enrollmentId: issued.enrollmentId };
  }

  async function beginSetup(
    tx: Tx,
    singleton: SingletonRow,
    credential: string,
    canonical: string,
  ): Promise<{ enrollmentId: string; email: string; code: string }> {
    if (singleton.state !== "pending" || singleton.completed_at) {
      throw new AdmissionError("DENIED");
    }
    if (!isHashFormat(singleton.setup_token_hash)) {
      throw new AdmissionError("DENIED");
    }
    if (!constantTimeHashEquals(hashSetupSecret(credential), singleton.setup_token_hash)) {
      throw new AdmissionError("DENIED");
    }
    if (await anyGlobalAdmin(tx)) {
      throw new AdmissionError("DENIED");
    }

    const existing = await lockSetupGrant(tx, toInt(singleton.generation));
    await lockEmail(tx, canonical);
    const users = await lockUsersByEmail(tx, canonical);
    const resolved = resolveTarget(users);

    // Real wall-clock time after every contended lock; the setup token must
    // still be unexpired at the moment a proof is issued.
    const now = await dbNow(tx);
    const setupExpires = toDate(singleton.setup_expires_at);
    if (!setupExpires || setupExpires.getTime() <= now.getTime()) {
      throw new AdmissionError("DENIED");
    }

    if (existing) {
      if (existing.canonical_email !== canonical || existing.consumed_at) {
        throw new AdmissionError("DENIED");
      }
      const grantExpires = toDate(existing.expires_at);
      if (!grantExpires || grantExpires.getTime() <= now.getTime()) {
        throw new AdmissionError("DENIED");
      }
      if (toInt(existing.verification_attempts) >= MAX_PROOF_ATTEMPTS) {
        throw new AdmissionError("DENIED");
      }
      const firstIssuance = !isHashFormat(existing.verification_code_hash);
      bindTarget(existing.target_user_id, firstIssuance, resolved);
      const send = nextSend(
        now,
        toInt(existing.send_count),
        toDate(existing.send_window_started_at),
      );
      if (send === "rate_limited") {
        throw new AdmissionError("RATE_LIMITED");
      }
      const code = generateProofCode();
      await tx.execute(
        sql`update "admission_grant" set "verification_code_hash" = ${hashProofCode(code)}, "verification_expires_at" = ${proofExpiry(now, grantExpires).toISOString()}, "send_count" = ${send.count}, "send_window_started_at" = ${send.window.toISOString()}, "updated_at" = clock_timestamp() where "id" = ${existing.id}`,
      );
      return { enrollmentId: existing.id, email: canonical, code };
    }

    const targetId = bindTarget(null, true, resolved);
    const send = nextSend(now, 0, null);
    if (send === "rate_limited") {
      throw new AdmissionError("RATE_LIMITED");
    }
    const code = generateProofCode();
    const grantId = newId();
    await tx.execute(
      sql`insert into "admission_grant" ("id", "kind", "generation", "canonical_email", "target_user_id", "inviter_user_id", "invitation_token_hash", "expires_at", "verification_code_hash", "verification_expires_at", "verification_attempts", "send_count", "send_window_started_at", "consumed_at", "created_at", "updated_at") values (${grantId}, 'setup', ${toInt(singleton.generation)}, ${canonical}, ${targetId}, null, null, ${setupExpires.toISOString()}, ${hashProofCode(code)}, ${proofExpiry(now, setupExpires).toISOString()}, 0, ${send.count}, ${send.window.toISOString()}, null, clock_timestamp(), clock_timestamp())`,
    );
    return { enrollmentId: grantId, email: canonical, code };
  }

  async function beginInvitation(
    tx: Tx,
    singleton: SingletonRow,
    credential: string,
    canonical: string,
  ): Promise<{ enrollmentId: string; email: string; code: string }> {
    if (singleton.state !== "invite_only") {
      throw new AdmissionError("DENIED");
    }
    const grant = await lockInvitationGrantByHash(tx, hashInvitationSecret(credential));
    if (
      !grant ||
      grant.kind !== "invitation" ||
      grant.canonical_email !== canonical ||
      grant.consumed_at
    ) {
      throw new AdmissionError("DENIED");
    }
    await lockEmail(tx, canonical);
    if (!grant.inviter_user_id) {
      throw new AdmissionError("DENIED");
    }
    await requireFreshAdmin(tx, grant.inviter_user_id);
    const users = await lockUsersByEmail(tx, canonical);
    const resolved = resolveTarget(users);

    // Real wall-clock time after every contended lock.
    const now = await dbNow(tx);
    const grantExpires = toDate(grant.expires_at);
    if (!grantExpires || grantExpires.getTime() <= now.getTime()) {
      throw new AdmissionError("DENIED");
    }
    if (toInt(grant.verification_attempts) >= MAX_PROOF_ATTEMPTS) {
      throw new AdmissionError("DENIED");
    }
    const firstIssuance = !isHashFormat(grant.verification_code_hash);
    const targetId = bindTarget(grant.target_user_id, firstIssuance, resolved);
    const send = nextSend(now, toInt(grant.send_count), toDate(grant.send_window_started_at));
    if (send === "rate_limited") {
      throw new AdmissionError("RATE_LIMITED");
    }
    const code = generateProofCode();
    await tx.execute(
      sql`update "admission_grant" set "target_user_id" = ${targetId}, "verification_code_hash" = ${hashProofCode(code)}, "verification_expires_at" = ${proofExpiry(now, grantExpires).toISOString()}, "send_count" = ${send.count}, "send_window_started_at" = ${send.window.toISOString()}, "updated_at" = clock_timestamp() where "id" = ${grant.id}`,
    );
    return { enrollmentId: grant.id, email: canonical, code };
  }

  type CompleteOutcome = { type: "completed" } | { type: "denied" } | { type: "bad_code" };

  async function complete(
    input: AdmissionCompleteInput,
    session: Session | null,
  ): Promise<{ completed: true }> {
    const enrollmentId = typeof input?.enrollmentId === "string" ? input.enrollmentId : "";
    const credential = typeof input?.credential === "string" ? input.credential : "";
    const verificationCode =
      typeof input?.verificationCode === "string" ? input.verificationCode : "";
    if (!enrollmentId || !credential || !verificationCode) {
      throw new AdmissionError("DENIED");
    }

    const outcome = await run(db, async (tx): Promise<CompleteOutcome> => {
      const singleton = requireSingleton(await lockSingleton(tx));
      const grant = await lockGrantById(tx, enrollmentId);
      if (!grant) {
        return { type: "denied" };
      }
      await lockEmail(tx, grant.canonical_email);

      // Non-time credential shape: kind/state/generation/consumed and the
      // constant-time bearer digest. A wrong bearer never consumes a proof
      // attempt and never writes.
      let credentialShapeValid = false;
      if (grant.kind === "setup") {
        credentialShapeValid =
          singleton.state === "pending" &&
          !singleton.completed_at &&
          grant.generation !== null &&
          toInt(grant.generation) === toInt(singleton.generation) &&
          isHashFormat(singleton.setup_token_hash) &&
          constantTimeHashEquals(hashSetupSecret(credential), singleton.setup_token_hash);
      } else if (grant.kind === "invitation") {
        credentialShapeValid =
          singleton.state === "invite_only" &&
          isHashFormat(grant.invitation_token_hash) &&
          constantTimeHashEquals(hashInvitationSecret(credential), grant.invitation_token_hash);
      }
      if (!credentialShapeValid || grant.consumed_at) {
        return { type: "denied" };
      }

      // Lock every affected user row (issuer first for invitations) before the
      // final wall-clock re-check.
      if (grant.kind === "invitation") {
        if (!grant.inviter_user_id) {
          return { type: "denied" };
        }
        const inviter = await lockUserById(tx, grant.inviter_user_id);
        if (!inviter || !isInstanceAdminRole(inviter.role) || inviter.banned === true) {
          return { type: "denied" };
        }
      }
      const users = await lockUsersByEmail(tx, grant.canonical_email);
      if (users.length > 1) {
        return { type: "denied" };
      }

      // All locks are held. Re-read real wall-clock DB time: a request that was
      // valid when queued but expired while waiting on a lock must deny with no
      // user/role/consume/audit side effects. Expiry is validated at the
      // mutation, never at transaction start.
      const finalNow = await dbNow(tx);

      if (grant.kind === "setup") {
        const setupExpires = toDate(singleton.setup_expires_at);
        if (!setupExpires || setupExpires.getTime() <= finalNow.getTime()) {
          return { type: "denied" };
        }
        // A manual grant closed the window; no auto-approval.
        if (await anyGlobalAdmin(tx)) {
          return { type: "denied" };
        }
      }
      const grantExpires = toDate(grant.expires_at);
      if (!grantExpires || grantExpires.getTime() <= finalNow.getTime()) {
        return { type: "denied" };
      }
      if (toInt(grant.verification_attempts) >= MAX_PROOF_ATTEMPTS) {
        return { type: "denied" };
      }
      const proofExpires = toDate(grant.verification_expires_at);
      if (!proofExpires || proofExpires.getTime() <= finalNow.getTime()) {
        return { type: "denied" };
      }

      // Live window confirmed. A wrong proof commits a durable attempt and
      // denies from outside the transaction; an expired proof above denied
      // without writing, so no counter ever increments after expiry.
      if (
        !isHashFormat(grant.verification_code_hash) ||
        !constantTimeHashEquals(hashProofCode(verificationCode), grant.verification_code_hash)
      ) {
        await tx.execute(
          sql`update "admission_grant" set "verification_attempts" = "verification_attempts" + 1, "updated_at" = clock_timestamp() where "id" = ${grant.id}`,
        );
        return { type: "bad_code" };
      }

      // Resolve the immutable target and validate the session against the fresh
      // clock. An invalid/missing/expired/impersonated session denies here with
      // no consume, no role change and no audit row.
      let userId: string;
      const isNewUser = grant.target_user_id === null;
      if (isNewUser) {
        // The account must not have appeared between issuance and completion.
        if (users.length !== 0) {
          return { type: "denied" };
        }
        userId = newId();
      } else {
        const target = users[0];
        if (
          !target ||
          target.id !== grant.target_user_id ||
          target.email_verified !== true ||
          target.banned === true
        ) {
          return { type: "denied" };
        }
        // Final Oracle contract 2: every *existing* target — setup or
        // invitation — must prove ownership of a live, non-impersonated
        // session matching the bound user id, on top of the fresh verified,
        // unbanned, still-bound database row. A raw invitation bearer plus
        // email code alone is never enough to consume an existing account,
        // even though the role is left unchanged.
        if (!sessionMatchesTarget(session, target.id, finalNow)) {
          return { type: "denied" };
        }
        userId = target.id;
      }

      if (isNewUser) {
        const role = grant.kind === "setup" ? "admin" : "user";
        await tx.execute(
          sql`insert into "user" ("id", "email", "email_verified", "role", "banned", "name", "created_at", "updated_at") values (${userId}, ${grant.canonical_email}, true, ${role}, false, null, clock_timestamp(), clock_timestamp())`,
        );
      } else if (grant.kind === "setup") {
        // Promote to the exact global admin claim; never touch organization roles.
        await tx.execute(
          sql`update "user" set "role" = 'admin', "updated_at" = clock_timestamp() where "id" = ${userId}`,
        );
      }

      await tx.execute(
        sql`update "admission_grant" set "consumed_at" = clock_timestamp(), "target_user_id" = ${userId}, "updated_at" = clock_timestamp() where "id" = ${grant.id}`,
      );

      if (grant.kind === "setup") {
        await tx.execute(
          sql`update "instance_admission" set "state" = 'invite_only', "setup_token_hash" = null, "setup_expires_at" = null, "completed_at" = clock_timestamp() where "id" = 'instance'`,
        );
      }

      await insertEvent(tx, {
        type: grant.kind === "setup" ? "setup_completed" : "admission_completed",
        actorUserId: grant.kind === "invitation" ? grant.inviter_user_id : null,
        targetUserId: userId,
        grantId: grant.id,
      });

      return { type: "completed" };
    });

    if (outcome.type === "completed") {
      return { completed: true };
    }
    throw new AdmissionError("DENIED");
  }

  async function issueInvitation(
    input: { email: string },
    session: Session | null,
  ): Promise<{ invitationId: string; expiresAt: Date }> {
    const canonical = canonicalizeEmail(input?.email);
    if (!canonical) {
      throw new AdmissionError("DENIED");
    }
    const identity = requireTrustedIdentity(session);
    requireEmailDelivery();

    const token = generateInvitationSecret();
    const tokenHash = hashInvitationSecret(token);

    const issued = await run(db, async (tx) => {
      const singleton = requireSingleton(await lockSingleton(tx));
      if (singleton.state !== "invite_only") {
        throw new AdmissionError("DENIED");
      }
      await requireFreshAdmin(tx, identity.userId);
      await lockEmail(tx, canonical);
      const users = await lockUsersByEmail(tx, canonical);
      if (users.length > 1) {
        throw new AdmissionError("DENIED");
      }
      // Session expiry and the invitation TTL are derived from real wall-clock
      // time after the lock wait; an expired session never issues a grant.
      const now = await assertSessionLive(tx, identity);
      const targetId = users[0]?.id ?? null;
      const grantId = newId();
      const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);
      await tx.execute(
        sql`insert into "admission_grant" ("id", "kind", "generation", "canonical_email", "target_user_id", "inviter_user_id", "invitation_token_hash", "expires_at", "verification_code_hash", "verification_expires_at", "verification_attempts", "send_count", "send_window_started_at", "consumed_at", "created_at", "updated_at") values (${grantId}, 'invitation', null, ${canonical}, ${targetId}, ${identity.userId}, ${tokenHash}, ${expiresAt.toISOString()}, null, null, 0, 0, null, null, clock_timestamp(), clock_timestamp())`,
      );
      await insertEvent(tx, {
        type: "admission_invitation_issued",
        actorUserId: identity.userId,
        targetUserId: targetId,
        grantId,
      });
      return { invitationId: grantId, expiresAt, email: canonical };
    });

    try {
      await deliverInvitation({ email: issued.email, invitationToken: token });
    } catch {
      throw new AdmissionError("DELIVERY_FAILED");
    }
    return { invitationId: issued.invitationId, expiresAt: issued.expiresAt };
  }

  async function revokeInvitation(
    input: { invitationId: string },
    session: Session | null,
  ): Promise<{ revoked: boolean }> {
    const invitationId = typeof input?.invitationId === "string" ? input.invitationId : "";
    if (!invitationId) {
      throw new AdmissionError("DENIED");
    }
    const identity = requireTrustedIdentity(session);

    return run(db, async (tx) => {
      const singleton = requireSingleton(await lockSingleton(tx));
      if (singleton.state !== "invite_only") {
        throw new AdmissionError("DENIED");
      }
      await requireFreshAdmin(tx, identity.userId);
      const grant = await lockGrantById(tx, invitationId);
      // Final fresh wall-clock session check *after* the grant lock: a session
      // that expired while queued on the grant lock denies here, before the
      // existence check and the delete + audit, with no side effect.
      await assertSessionLive(tx, identity);
      if (!grant || grant.kind !== "invitation" || grant.consumed_at) {
        return { revoked: false };
      }
      const deleted = await tx.execute<{ id: string }>(
        sql`delete from "admission_grant" where "id" = ${invitationId} and "consumed_at" is null returning "id"`,
      );
      if (deleted.rows.length === 0) {
        return { revoked: false };
      }
      await insertEvent(tx, {
        type: "admission_invitation_revoked",
        actorUserId: identity.userId,
        targetUserId: grant.target_user_id,
        grantId: grant.id,
      });
      return { revoked: true };
    });
  }

  async function listInvitations(session: Session | null): Promise<AdmissionInvitationSummary[]> {
    const identity = requireTrustedIdentity(session);

    return run(db, async (tx) => {
      const singleton = requireSingleton(await lockSingleton(tx));
      if (singleton.state !== "invite_only") {
        throw new AdmissionError("DENIED");
      }
      await requireFreshAdmin(tx, identity.userId);
      // Listing requires a live, non-expired administrator session.
      const now = await assertSessionLive(tx, identity);
      const result = await tx.execute<GrantRow>(
        sql`select "id", "canonical_email", "expires_at", "consumed_at" from "admission_grant" where "kind" = 'invitation' order by "created_at" desc limit ${LIST_LIMIT_MAX}`,
      );
      return result.rows.map((row) => {
        const expiresAt = toDate(row.expires_at);
        const consumedAt = toDate(row.consumed_at);
        const status: AdmissionInvitationSummary["status"] = consumedAt
          ? "consumed"
          : expiresAt && expiresAt.getTime() <= now.getTime()
            ? "expired"
            : "pending";
        return { id: row.id, email: row.canonical_email, expiresAt, consumedAt, status };
      });
    });
  }

  async function pruneExpiredGrants(input: { limit?: number } = {}): Promise<{ pruned: number }> {
    const requested = typeof input.limit === "number" ? Math.trunc(input.limit) : PRUNE_LIMIT_MAX;
    const limit = Math.min(Math.max(requested, 1), PRUNE_LIMIT_MAX);

    return run(db, async (tx) => {
      // Consistent lock order: singleton first. Cleanup never reopens a
      // completed instance or emits an event.
      requireSingleton(await lockSingleton(tx));
      // Bounded retention: prune every *expired* grant, pending or already
      // consumed, in a stable order. Unexpired grants of any kind are retained,
      // and the immutable invite_only singleton is never touched. Deleting a
      // consumed grant does not affect the user/role it produced, and security
      // events reference grants by opaque id only (no FK), so audit rows remain
      // readable after the grant is gone.
      const deleted = await tx.execute<{ id: string }>(
        sql`delete from "admission_grant" where "id" in (select "id" from "admission_grant" where "expires_at" < clock_timestamp() order by "expires_at" asc, "id" asc limit ${limit}) returning "id"`,
      );
      return { pruned: deleted.rows.length };
    });
  }

  return {
    mintSetupToken,
    begin,
    complete,
    issueInvitation,
    revokeInvitation,
    status,
    listInvitations,
    pruneExpiredGrants,
  };
}
