import { createHash, timingSafeEqual } from "node:crypto";

import { writeAuditLog } from "@openvalens/audit-security";
import { sql, type Database } from "@openvalens/db";
import { createStructuredLogger } from "@openvalens/observability";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { z } from "zod";

/**
 * App store review sign-in.
 *
 * Apple App Review and Google Play review need a login they can type in, but
 * OpenValens signs people in with emailed links. When `REVIEW_ACCOUNT_EMAIL`
 * and `REVIEW_ACCOUNT_CODE` are both set, that one existing account may also
 * sign in by entering the fixed code. Nothing else changes:
 *
 * - Only that email can use a code. Every other email, a wrong code, a missing
 *   account and the feature being off all get the same generic error, so the
 *   endpoint never tells a caller without the code which email is the review
 *   email (or whether the feature is on).
 * - The account must already exist. This path never creates a user; on Cloud
 *   it is created through the normal sign-up (terms, health-data consent,
 *   trial) like any other account.
 * - The session is a normal Better Auth session: `internalAdapter.createSession`
 *   runs the same `session.create` hooks as a magic link (active workspace,
 *   the admin plugin's ban check), then the session cookie is set.
 * - The email and the code are compared in constant time (as SHA-256 digests,
 *   so their lengths do not matter), and the endpoint has its own per-IP rate
 *   limit. Every attempt while the feature is on writes an `access_audit_log`
 *   entry in the review account's own workspace, with ids and a reason only:
 *   never the submitted email or code.
 */
export const REVIEW_SIGN_IN_PATH = "/sign-in/review-code";

/** Shortest accepted code; the server schema enforces the same at startup. */
export const REVIEW_CODE_MIN_LENGTH = 12;

/** Per-IP limit on attempts (Better Auth's limiter, on in production). */
export const REVIEW_SIGN_IN_RATE_LIMIT = { window: 60, max: 5 } as const;

/** The one error every refused attempt gets. */
export const REVIEW_SIGN_IN_ERROR_CODE = "INVALID_EMAIL_OR_CODE";
const REVIEW_SIGN_IN_ERROR_MESSAGE = "That email and code do not match.";

export type ReviewSignInConfig = {
  /** The review account's email, trimmed and lower-cased. */
  email: string;
  /** The fixed code. A credential: never logged or returned. */
  code: string;
};

export type ReviewSignInEnv = {
  REVIEW_ACCOUNT_EMAIL?: string | null;
  REVIEW_ACCOUNT_CODE?: string | null;
};

/** Value-free configuration error: names keys only. */
export class ReviewSignInConfigError extends Error {
  readonly code = "REVIEW_SIGN_IN_CONFIG_INVALID";

  constructor(message: string) {
    super(`REVIEW_SIGN_IN_CONFIG_INVALID: ${message}`);
    this.name = "ReviewSignInConfigError";
  }
}

const read = (value: string | null | undefined): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

/**
 * Parses the two settings. Both set: on. Neither: off. Only one: off, and
 * `missingKeys` names the other so the server can log it (names only). A code
 * shorter than {@link REVIEW_CODE_MIN_LENGTH} throws, so a weak code fails
 * startup instead of being served.
 */
export function parseReviewSignInConfig(env: ReviewSignInEnv): {
  config: ReviewSignInConfig | null;
  missingKeys: string[];
} {
  const email = read(env.REVIEW_ACCOUNT_EMAIL);
  const code = read(env.REVIEW_ACCOUNT_CODE);
  if (code !== null && code.length < REVIEW_CODE_MIN_LENGTH) {
    throw new ReviewSignInConfigError(
      `REVIEW_ACCOUNT_CODE must be at least ${REVIEW_CODE_MIN_LENGTH} characters`,
    );
  }
  if (email !== null && !z.email().safeParse(email).success) {
    throw new ReviewSignInConfigError("REVIEW_ACCOUNT_EMAIL must be an email address");
  }
  if (email && code) return { config: { email: email.toLowerCase(), code }, missingKeys: [] };
  if (email) return { config: null, missingKeys: ["REVIEW_ACCOUNT_CODE"] };
  if (code) return { config: null, missingKeys: ["REVIEW_ACCOUNT_EMAIL"] };
  return { config: null, missingKeys: [] };
}

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();

/** Constant-time string equality, whatever the lengths. */
export function constantTimeEqual(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b));
}

type ReviewAccount = { userId: string; organizationId: string | null };

/** The review account and the earliest workspace it owns (its personal one). */
async function findReviewAccount(database: Database, email: string): Promise<ReviewAccount | null> {
  const rows = await database.execute<{ id: string; organization_id: string | null }>(sql`
    select u."id", (
      select m."organization_id" from "member" m
      where m."user_id" = u."id" and m."role" = 'owner'
      order by m."created_at" asc, m."id" asc
      limit 1
    ) as "organization_id"
    from "user" u
    where lower(u."email") = ${email}
    limit 2
  `);
  // Ambiguous (should be impossible: emails are unique) is treated as missing.
  if (rows.rows.length !== 1) return null;
  const row = rows.rows[0]!;
  return { userId: row.id, organizationId: row.organization_id };
}

type FailureReason = "other_email" | "wrong_code" | "no_account" | "session_refused";

export type ReviewSignInPluginOptions = {
  /** From {@link parseReviewSignInConfig}; `null` keeps the endpoint refusing. */
  config: ReviewSignInConfig | null;
  database: Database;
};

const logger = createStructuredLogger({ level: "info" });

export function reviewSignInPlugin(options: ReviewSignInPluginOptions) {
  const { config, database } = options;

  const audit = async (
    account: ReviewAccount | null,
    outcome: { ok: true } | { ok: false; reason: FailureReason },
    correlationId: string | null,
  ) => {
    // The audit log is per workspace; with no review workspace there is
    // nowhere to write it, so only a value-free log line remains.
    if (!account?.organizationId) {
      logger.warn("auth.review-sign-in.unaudited", {
        outcome: outcome.ok ? "succeeded" : "failed",
        ...(outcome.ok ? {} : { reason: outcome.reason }),
      });
      return;
    }
    await writeAuditLog({
      db: database,
      organizationId: account.organizationId,
      actorUserId: outcome.ok ? account.userId : null,
      eventType: outcome.ok ? "REVIEW_SIGN_IN_SUCCEEDED" : "REVIEW_SIGN_IN_FAILED",
      targetType: "user",
      targetId: account.userId,
      metadata: { method: "review_code", ...(outcome.ok ? {} : { reason: outcome.reason }) },
      correlationId,
    });
  };

  const refuse = (): never => {
    throw new APIError("UNAUTHORIZED", {
      code: REVIEW_SIGN_IN_ERROR_CODE,
      message: REVIEW_SIGN_IN_ERROR_MESSAGE,
    });
  };

  return {
    id: "openvalens-review-sign-in",
    endpoints: {
      signInReviewCode: createAuthEndpoint(
        REVIEW_SIGN_IN_PATH,
        {
          method: "POST",
          body: z.object({ email: z.string().max(320), code: z.string().max(256) }),
        },
        async (ctx) => {
          // Off: refuse like any wrong code. There is no workspace to audit in.
          if (!config) return refuse();

          const correlationId =
            ctx.headers?.get("x-correlation-id") ?? ctx.headers?.get("x-request-id") ?? null;
          // Both comparisons always run, so the time taken does not depend on
          // which one failed.
          const emailMatches = constantTimeEqual(ctx.body.email.trim().toLowerCase(), config.email);
          const codeMatches = constantTimeEqual(ctx.body.code.trim(), config.code);
          const account = await findReviewAccount(database, config.email);

          if (!emailMatches || !codeMatches || !account) {
            await audit(
              account,
              {
                ok: false,
                reason: !emailMatches ? "other_email" : !codeMatches ? "wrong_code" : "no_account",
              },
              correlationId,
            );
            return refuse();
          }

          // A normal session: the same hooks as a magic link (active
          // workspace; the admin plugin refuses a banned user).
          let session: Awaited<ReturnType<typeof ctx.context.internalAdapter.createSession>> | null;
          let user: Awaited<ReturnType<typeof ctx.context.internalAdapter.findUserById>>;
          try {
            user = await ctx.context.internalAdapter.findUserById(account.userId);
            session = user ? await ctx.context.internalAdapter.createSession(account.userId) : null;
          } catch {
            session = null;
            user = null;
          }
          if (!session || !user) {
            await audit(account, { ok: false, reason: "session_refused" }, correlationId);
            return refuse();
          }

          await setSessionCookie(ctx, { session, user });
          await audit(account, { ok: true }, correlationId);
          return ctx.json({ status: true });
        },
      ),
    },
    rateLimit: [
      {
        pathMatcher: (path: string) => path === REVIEW_SIGN_IN_PATH,
        ...REVIEW_SIGN_IN_RATE_LIMIT,
      },
    ],
  } satisfies BetterAuthPlugin;
}
