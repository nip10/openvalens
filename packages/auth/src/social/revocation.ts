/**
 * Revoke provider tokens when an account is deleted (Issue #296).
 *
 * App Store Review Guideline 5.1.1(v): deleting an account that used Sign in
 * with Apple must revoke the user's Apple tokens through Apple's REST API.
 *
 * Deletion is two steps around the erasure transaction:
 * 1. {@link SocialTokenRevocation.collect} reads and decrypts the account's
 *    Apple tokens *before* erasure (the `account` rows are erased with the
 *    user).
 * 2. {@link SocialTokenRevocation.revoke} calls Apple *after* the erasure
 *    committed, so a failed deletion never revokes a still-live sign-in. A
 *    failed revocation never undoes the deletion; the caller logs the counts.
 *
 * Google tokens are not revoked: Google sign-in asks only for `openid email
 * profile` and keeps no offline access, and deleting the account removes the
 * stored tokens. Nothing here logs a token.
 */

import { sql, type Database } from "@openvalens/db";
import { decryptOAuthToken } from "better-auth/oauth2";

import {
  createAppleClientSecrets,
  revokeAppleToken,
  type AppleClientSecrets,
} from "../providers/apple";
import type { AppleSignInConfig } from "./config";

/** Decrypted tokens waiting for the erasure to commit. Never log it. */
export type PendingRevocation = {
  apple: Array<{ token: string; hint: "refresh_token" | "access_token" }>;
};

export type SocialTokenRevocation = {
  collect(userId: string): Promise<PendingRevocation>;
  revoke(pending: PendingRevocation): Promise<{ revoked: number; failed: number }>;
};

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** Decrypts a stored OAuth token with the Better Auth instance's secret. */
export function betterAuthTokenDecrypter(auth: {
  $context: Promise<unknown>;
}): (token: string) => Promise<string | null> {
  return async (token) => {
    const context = await auth.$context;
    const value = await decryptOAuthToken(token, context as never);
    return typeof value === "string" && value.length > 0 ? value : null;
  };
}

export function createSocialTokenRevocation(deps: {
  db: Database;
  apple: AppleSignInConfig | null;
  decrypt: (token: string) => Promise<string | null>;
  appleSecrets?: AppleClientSecrets;
  fetch?: Fetch;
}): SocialTokenRevocation {
  const apple = deps.apple;
  const secrets = apple ? (deps.appleSecrets ?? createAppleClientSecrets(apple)) : null;

  return {
    async collect(userId) {
      const pending: PendingRevocation = { apple: [] };
      if (!apple) return pending;
      const rows = await deps.db.execute<{
        refresh_token: string | null;
        access_token: string | null;
      }>(
        sql`select "refresh_token", "access_token" from "account" where "user_id" = ${userId} and "provider_id" = 'apple'`,
      );
      for (const row of rows.rows) {
        // A refresh token revokes the whole grant; fall back to the access
        // token when Apple never issued one.
        const [stored, hint] = row.refresh_token
          ? [row.refresh_token, "refresh_token" as const]
          : [row.access_token, "access_token" as const];
        if (!stored) continue;
        try {
          const token = await deps.decrypt(stored);
          if (token) pending.apple.push({ token, hint });
        } catch {
          // An undecryptable token cannot be revoked; it is erased anyway.
        }
      }
      return pending;
    },

    async revoke(pending) {
      let revoked = 0;
      let failed = 0;
      if (!apple || !secrets) return { revoked, failed: pending.apple.length };
      for (const entry of pending.apple) {
        const ok = await revokeAppleToken({
          config: apple,
          secrets,
          token: entry.token,
          tokenTypeHint: entry.hint,
          ...(deps.fetch ? { fetch: deps.fetch } : {}),
        });
        if (ok) revoked += 1;
        else failed += 1;
      }
      return { revoked, failed };
    },
  };
}
