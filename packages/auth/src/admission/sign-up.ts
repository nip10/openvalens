import { sql, type Database, type DbTransaction } from "@openvalens/db";
import { isLocale, type Locale } from "@openvalens/i18n";

import { createDrizzleAuthOrgStore, ensureActiveOrganization } from "../authz/auth-org";
import { toDate } from "../authz/trusted-session";
import type { DeploymentConfig } from "../deployment";
import { EMAIL_LOCK_DOMAIN, generateSignUpSecret, hashSignUpSecret, newId } from "./crypto";
import { canonicalizeEmail } from "./email";
import { AdmissionError } from "./errors";

/**
 * Public sign-up for OpenValens Cloud (Issue #294).
 *
 * Self-host stays invite-only: on a `self-hosted` deployment every method here
 * refuses before touching the database. In Cloud, anyone may create an
 * account, but still only through the admission core — Better Auth's own
 * sign-up paths stay closed (`validateUserInfo`, the `user.create.before`
 * hook and `magicLink({ disableSignUp: true })` in `../index.ts`).
 *
 * The flow has two steps:
 * 1. {@link PublicSignUpService.signUpPublic} — the person enters an email and
 *    ticks the terms and privacy policy. A single-use link is emailed; only
 *    its SHA-256 digest is stored, with the document versions they accepted.
 *    **No `user` row is created**, so an address nobody controls never becomes
 *    an account. When the email already has an account, nothing is stored and
 *    the person is emailed a pointer to sign in instead. Both cases answer the
 *    caller identically, so the response never reveals whether an email is
 *    registered.
 * 2. {@link PublicSignUpService.completePublicSignUp} — the link is used. In
 *    one transaction the user (role `user`: a customer is never an instance
 *    administrator), their own personal workspace (role `owner`, onboarding
 *    `pending`, exactly as a first sign-in creates it), the legal acceptance
 *    records and an audit event are written, and the request is consumed. The
 *    Better Auth endpoint that serves the link then starts the session.
 *
 * Locks follow the admission order: the request row, then the canonical-email
 * advisory lock shared with setup and invitations, then the `user` rows for
 * that email. Real wall-clock database time decides expiry.
 */

/** How long an emailed sign-up link stays usable. */
export const SIGN_UP_LINK_TTL_MS = 60 * 60 * 1000;
/** Expired requests older than this are pruned opportunistically. */
const PRUNE_AFTER_MS = 24 * 60 * 60 * 1000;
const PRUNE_BATCH = 100;
const TOKEN_MAX_LENGTH = 512;

export type DeliverSignUp = (
  input:
    | {
        /** No account yet: `url` is the single-use link that creates it. */
        kind: "new";
        email: string;
        url: string;
        locale?: Locale;
      }
    | {
        /** The email already has an account: point the person at sign-in. */
        kind: "existing";
        email: string;
        locale?: Locale;
      },
) => Promise<void>;

/**
 * Runs inside the account-creation transaction, after the user and workspace
 * exist. Extension point for #297, which starts the 30-day no-card trial here
 * for the new workspace owner. A throw rolls the whole sign-up back.
 */
export type OnPublicAccountCreated = (input: {
  tx: DbTransaction;
  userId: string;
  organizationId: string;
}) => Promise<void>;

export type PublicSignUpDeps = {
  db: Database;
  deployment: DeploymentConfig;
  deliver: DeliverSignUp;
  /** Builds the emailed link for a raw token (served by the Better Auth plugin). */
  verifyUrl: (token: string) => string;
  /** Whether email is really delivered. Without it nothing is written. Defaults to true. */
  emailDeliveryAvailable?: () => boolean;
  onAccountCreated?: OnPublicAccountCreated;
};

export type SignUpPublicInput = {
  email: string;
  /** The app language: used for the email and saved as the account's language. */
  locale?: Locale;
  /** The person ticked the terms of service and privacy policy. Must be `true`. */
  acceptedLegal: boolean;
};

export type CompletePublicSignUpResult =
  | { status: "created"; userId: string; organizationId: string }
  /** Unknown token, or sign-up is off on this deployment. */
  | { status: "invalid" }
  | { status: "expired" }
  /** Already used, or the email got an account by another route meanwhile. */
  | { status: "used" };

export type PublicSignUpService = {
  /** True only on a Cloud deployment. */
  readonly enabled: boolean;
  signUpPublic(input: SignUpPublicInput): Promise<{ accepted: true }>;
  completePublicSignUp(token: string): Promise<CompletePublicSignUpResult>;
};

type RequestRow = {
  id: string;
  canonical_email: string;
  locale: unknown;
  terms_version: string;
  privacy_version: string;
  accepted_at: unknown;
  expires_at: unknown;
  consumed_at: unknown;
};

async function dbNow(tx: DbTransaction): Promise<Date> {
  const result = await tx.execute<{ now: unknown }>(sql`select clock_timestamp() as now`);
  const now = toDate(result.rows[0]?.now);
  if (!now) throw new AdmissionError("INTERNAL");
  return now;
}

async function lockEmail(tx: DbTransaction, canonical: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${EMAIL_LOCK_DOMAIN + canonical}, 0))`,
  );
}

async function hasAccount(tx: DbTransaction, canonical: string): Promise<boolean> {
  const result = await tx.execute<{ id: string }>(
    sql`select "id" from "user" where lower("email") = ${canonical} order by "id" for update`,
  );
  return result.rows.length > 0;
}

async function inTransaction<T>(db: Database, fn: (tx: DbTransaction) => Promise<T>): Promise<T> {
  try {
    return await db.transaction(fn);
  } catch (error) {
    // Never surface raw SQL, a DSN or an email from a driver error.
    if (error instanceof AdmissionError) throw error;
    throw new AdmissionError("INTERNAL");
  }
}

export function createPublicSignUpService(deps: PublicSignUpDeps): PublicSignUpService {
  const { db, deployment, deliver, verifyUrl } = deps;
  const emailDeliveryAvailable = deps.emailDeliveryAvailable ?? (() => true);
  const legal = deployment.mode === "cloud" ? deployment.legal : null;

  async function signUpPublic(input: SignUpPublicInput): Promise<{ accepted: true }> {
    if (!legal) throw new AdmissionError("DENIED");
    if (input?.acceptedLegal !== true) throw new AdmissionError("DENIED");
    const canonical = canonicalizeEmail(input.email);
    if (!canonical) throw new AdmissionError("DENIED");
    if (!emailDeliveryAvailable()) throw new AdmissionError("EMAIL_UNAVAILABLE");
    const locale = isLocale(input.locale) ? input.locale : undefined;

    const token = generateSignUpSecret();
    const outcome = await inTransaction(db, async (tx): Promise<"new" | "existing"> => {
      await lockEmail(tx, canonical);
      const now = await dbNow(tx);
      // Bounded retention: requests that expired long ago carry an email and
      // nothing else useful.
      await tx.execute(
        sql`delete from "sign_up_request" where "id" in (select "id" from "sign_up_request" where "expires_at" < ${new Date(now.getTime() - PRUNE_AFTER_MS).toISOString()} order by "expires_at" asc limit ${PRUNE_BATCH})`,
      );
      if (await hasAccount(tx, canonical)) return "existing";
      await tx.execute(
        sql`insert into "sign_up_request" ("id", "canonical_email", "token_hash", "locale", "terms_version", "privacy_version", "accepted_at", "expires_at", "consumed_at", "user_id", "created_at") values (${newId()}, ${canonical}, ${hashSignUpSecret(token)}, ${locale ?? null}, ${legal.terms.version}, ${legal.privacy.version}, ${now.toISOString()}, ${new Date(now.getTime() + SIGN_UP_LINK_TTL_MS).toISOString()}, null, null, clock_timestamp())`,
      );
      return "new";
    });

    try {
      await deliver(
        outcome === "new"
          ? { kind: "new", email: canonical, url: verifyUrl(token), ...(locale ? { locale } : {}) }
          : { kind: "existing", email: canonical, ...(locale ? { locale } : {}) },
      );
    } catch {
      // The same failure either way: a delivery error never tells the caller
      // which branch was taken.
      throw new AdmissionError("DELIVERY_FAILED");
    }
    return { accepted: true };
  }

  async function completePublicSignUp(rawToken: string): Promise<CompletePublicSignUpResult> {
    if (!legal) return { status: "invalid" };
    const token = typeof rawToken === "string" ? rawToken : "";
    if (token.length === 0 || token.length > TOKEN_MAX_LENGTH) return { status: "invalid" };

    return inTransaction(db, async (tx): Promise<CompletePublicSignUpResult> => {
      const found = await tx.execute<RequestRow>(
        sql`select "id", "canonical_email", "locale", "terms_version", "privacy_version", "accepted_at", "expires_at", "consumed_at" from "sign_up_request" where "token_hash" = ${hashSignUpSecret(token)} for update`,
      );
      const request = found.rows[0];
      if (!request) return { status: "invalid" };
      if (request.consumed_at) return { status: "used" };

      await lockEmail(tx, request.canonical_email);
      const accountExists = await hasAccount(tx, request.canonical_email);

      // Wall-clock time after every contended lock.
      const now = await dbNow(tx);
      const expiresAt = toDate(request.expires_at);
      if (!expiresAt || expiresAt.getTime() <= now.getTime()) return { status: "expired" };

      if (accountExists) {
        // Another link (or an invitation) created the account first. Retire
        // this one so it can never be replayed.
        await tx.execute(
          sql`update "sign_up_request" set "consumed_at" = clock_timestamp() where "id" = ${request.id}`,
        );
        return { status: "used" };
      }

      const userId = newId();
      // A customer is never an instance administrator: always role `user`.
      await tx.execute(
        sql`insert into "user" ("id", "email", "email_verified", "role", "banned", "name", "created_at", "updated_at") values (${userId}, ${request.canonical_email}, true, 'user', false, null, clock_timestamp(), clock_timestamp())`,
      );
      if (isLocale(request.locale)) {
        await tx.execute(
          sql`insert into "user_preference" ("user_id", "locale") values (${userId}, ${request.locale})`,
        );
      }

      // Their own personal workspace, owner role, onboarding pending — the same
      // shape a first sign-in creates, so the new account lands in `/welcome`.
      const workspace = await ensureActiveOrganization(
        userId,
        createDrizzleAuthOrgStore(tx as unknown as Database),
      );

      const acceptedAt = toDate(request.accepted_at) ?? now;
      for (const [document, version] of [
        ["terms", request.terms_version],
        ["privacy", request.privacy_version],
      ] as const) {
        await tx.execute(
          sql`insert into "legal_acceptance" ("id", "user_id", "document", "version", "accepted_at", "source") values (${newId()}, ${userId}, ${document}, ${version}, ${acceptedAt.toISOString()}, 'sign_up')`,
        );
      }

      await tx.execute(
        sql`update "sign_up_request" set "consumed_at" = clock_timestamp(), "user_id" = ${userId} where "id" = ${request.id}`,
      );
      await tx.execute(
        sql`insert into "global_security_event" ("id", "event_type", "actor_user_id", "target_user_id", "grant_id") values (${newId()}, 'public_sign_up_completed', null, ${userId}, ${request.id})`,
      );

      // #297 — start the trial for the new workspace owner here.
      await deps.onAccountCreated?.({ tx, userId, organizationId: workspace.organizationId });

      return { status: "created", userId, organizationId: workspace.organizationId };
    });
  }

  return { enabled: legal !== null, signUpPublic, completePublicSignUp };
}
