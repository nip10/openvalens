import { sql, type Database, type DbTransaction } from "@openvalens/db";
import { isLocale, type Locale } from "@openvalens/i18n";

import { createDrizzleAuthOrgStore, ensureActiveOrganization } from "../authz/auth-org";
import type { DeploymentConfig } from "../deployment";
import { EMAIL_LOCK_DOMAIN, newId } from "./crypto";
import { canonicalizeEmail } from "./email";
import { AdmissionError } from "./errors";
import type { OnPublicAccountCreated } from "./sign-up";

/**
 * Cloud sign-up with Google or Apple (Issue #296).
 *
 * The emailed-link sign-up (`./sign-up.ts`, #294) proves the email by a link;
 * here the provider has already proven it (`email_verified`) and the identity
 * is the provider's stable subject. The account is still created only by the
 * admission core, in one transaction with the same shape as
 * `completePublicSignUp`: the user (role `user`), their own personal
 * workspace (role `owner`), the legal acceptance, the provider account row, an
 * audit event and the `onAccountCreated` hook (#297's trial). Better Auth's own
 * create paths stay refused.
 *
 * Legal acceptance: the person ticks the terms and privacy policy *before*
 * the provider flow starts. The server stamps the versions it currently
 * serves and the time onto the OAuth state as server-only context (Better
 * Auth's `addOAuthServerContext`, which the client cannot forge), and the
 * callback hands them here. Without that context nothing is created: an
 * unknown identity from the sign-in page is refused like on self-host.
 *
 * It never links: an email that already has an account is refused
 * (`email_taken`), so a provider identity is bound to an existing account
 * only by the signed-in "Connect" path (#65 rules).
 */

export type SocialSignUpProviderId = "google" | "apple";

/** What the person agreed to, stamped by the server when the flow started. */
export type SocialSignUpLegal = {
  termsVersion: string;
  privacyVersion: string;
  acceptedAt: Date;
  healthDataConsentVersion: string;
  healthDataConsentAcceptedAt: Date;
};

export type SocialSignUpInput = {
  providerId: SocialSignUpProviderId;
  /** The provider's stable subject (`sub`), the Better Auth account id. */
  accountId: string;
  email: string;
  /** The provider asserts the email is verified. Required to create an account. */
  emailVerified: boolean;
  /** Display name, if the provider gave one (Apple only on the first sign-in). */
  name?: string | null;
  legal: SocialSignUpLegal;
  locale?: Locale;
};

export type SocialSignUpResult =
  | { status: "created"; userId: string; organizationId: string }
  /** This provider identity already belongs to an account: Better Auth signs it in. */
  | { status: "exists" }
  /** Another account has this email. Never linked implicitly. */
  | { status: "email_taken" }
  /** Sign-up is off, or the input cannot create an account. */
  | { status: "invalid" };

export type SocialSignUpDeps = {
  db: Database;
  deployment: DeploymentConfig;
  /** Same hook as the emailed sign-up: #297 starts the trial here. */
  onAccountCreated?: OnPublicAccountCreated;
};

export type SocialSignUpService = {
  /** True only on a Cloud deployment. */
  readonly enabled: boolean;
  /** The versions a sign-up started now accepts, or `null` when sign-up is off. */
  currentLegal(): { termsVersion: string; privacyVersion: string } | null;
  currentHealthDataConsent(): { version: string } | null;
  createAccount(input: SocialSignUpInput): Promise<SocialSignUpResult>;
};

const SOCIAL_IDENTITY_LOCK_DOMAIN = "openvalens:admission:social:";
const SUBJECT_MAX_LENGTH = 255;
const NAME_MAX_LENGTH = 200;
const VERSION_MAX_LENGTH = 64;

function validVersion(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= VERSION_MAX_LENGTH;
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

export function createSocialSignUpService(deps: SocialSignUpDeps): SocialSignUpService {
  const { db, deployment } = deps;
  const legal = deployment.mode === "cloud" ? deployment.legal : null;

  async function createAccount(input: SocialSignUpInput): Promise<SocialSignUpResult> {
    if (!legal) return { status: "invalid" };
    if (input.providerId !== "google" && input.providerId !== "apple") return { status: "invalid" };
    const accountId = typeof input.accountId === "string" ? input.accountId : "";
    if (accountId.length === 0 || accountId.length > SUBJECT_MAX_LENGTH) {
      return { status: "invalid" };
    }
    if (input.emailVerified !== true) return { status: "invalid" };
    const canonical = canonicalizeEmail(input.email);
    if (!canonical) return { status: "invalid" };
    const acceptedAt = input.legal?.acceptedAt;
    const healthDataConsentAcceptedAt = input.legal?.healthDataConsentAcceptedAt;
    if (
      !validVersion(input.legal?.termsVersion) ||
      !validVersion(input.legal?.privacyVersion) ||
      !(acceptedAt instanceof Date) ||
      !Number.isFinite(acceptedAt.getTime()) ||
      input.legal?.healthDataConsentVersion !== legal.healthDataConsent.version ||
      !validVersion(input.legal?.healthDataConsentVersion) ||
      !(healthDataConsentAcceptedAt instanceof Date) ||
      !Number.isFinite(healthDataConsentAcceptedAt.getTime())
    ) {
      return { status: "invalid" };
    }
    const name =
      typeof input.name === "string" && input.name.trim().length > 0
        ? input.name.trim().slice(0, NAME_MAX_LENGTH)
        : null;
    const locale = isLocale(input.locale) ? input.locale : undefined;

    return inTransaction(db, async (tx): Promise<SocialSignUpResult> => {
      // The provider identity first, then the canonical email (the admission
      // lock shared with setup, invitations and the emailed sign-up).
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`${SOCIAL_IDENTITY_LOCK_DOMAIN}${input.providerId}:${accountId}`}, 0))`,
      );
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${EMAIL_LOCK_DOMAIN + canonical}, 0))`,
      );

      const bound = await tx.execute<{ id: string }>(
        sql`select "id" from "account" where "provider_id" = ${input.providerId} and "account_id" = ${accountId}`,
      );
      if (bound.rows.length > 0) return { status: "exists" };

      const taken = await tx.execute<{ id: string }>(
        sql`select "id" from "user" where lower("email") = ${canonical} order by "id" for update`,
      );
      if (taken.rows.length > 0) return { status: "email_taken" };

      const userId = newId();
      // A customer is never an instance administrator: always role `user`.
      await tx.execute(
        sql`insert into "user" ("id", "email", "email_verified", "role", "banned", "name", "created_at", "updated_at") values (${userId}, ${canonical}, true, 'user', false, ${name}, clock_timestamp(), clock_timestamp())`,
      );
      if (locale) {
        await tx.execute(
          sql`insert into "user_preference" ("user_id", "locale") values (${userId}, ${locale})`,
        );
      }

      // Their own personal workspace, owner role, onboarding pending.
      const workspace = await ensureActiveOrganization(
        userId,
        createDrizzleAuthOrgStore(tx as unknown as Database),
      );

      for (const [document, version] of [
        ["terms", input.legal.termsVersion],
        ["privacy", input.legal.privacyVersion],
        ["health_data_consent", input.legal.healthDataConsentVersion],
      ] as const) {
        const acceptedAt = document === "health_data_consent"
          ? input.legal.healthDataConsentAcceptedAt
          : input.legal.acceptedAt;
        await tx.execute(
          sql`insert into "legal_acceptance" ("id", "user_id", "document", "version", "accepted_at", "source") values (${newId()}, ${userId}, ${document}, ${version}, ${acceptedAt.toISOString()}, 'sign_up')`,
        );
      }

      // The provider identity, bound by subject. Better Auth finds it right
      // after this and signs the person in (storing the encrypted tokens).
      await tx.execute(
        sql`insert into "account" ("id", "account_id", "provider_id", "user_id", "created_at", "updated_at") values (${newId()}, ${accountId}, ${input.providerId}, ${userId}, clock_timestamp(), clock_timestamp())`,
      );

      await tx.execute(
        sql`insert into "global_security_event" ("id", "event_type", "actor_user_id", "target_user_id", "grant_id") values (${newId()}, 'public_sign_up_completed', null, ${userId}, null)`,
      );

      // #297 — the trial for the new workspace owner.
      await deps.onAccountCreated?.({ tx, userId, organizationId: workspace.organizationId });

      return { status: "created", userId, organizationId: workspace.organizationId };
    });
  }

  return {
    enabled: legal !== null,
    currentLegal: () =>
      legal ? { termsVersion: legal.terms.version, privacyVersion: legal.privacy.version } : null,
    currentHealthDataConsent: () =>
      legal ? { version: legal.healthDataConsent.version } : null,
    createAccount,
  };
}
