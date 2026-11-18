import { sql, type Database } from "@openvalens/db";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { z } from "zod";

/** Durable marker: disabling public sign-in must never turn demo sessions into writers. */
export const DEMO_ROLE = "demo";
export const DEMO_SIGN_IN_PATH = "/sign-in/demo";
export const DEMO_READ_ONLY_MESSAGE =
  "This is a read-only demo. Create an account to log your own data.";

export function parseDemoEmail(env: {
  DEMO_ACCOUNT_EMAIL?: string | null;
  REVIEW_ACCOUNT_EMAIL?: string | null;
}): string | null {
  const email = env.DEMO_ACCOUNT_EMAIL?.trim().toLowerCase();
  if (!email) return null;
  if (!z.email().safeParse(email).success)
    throw new Error("DEMO_ACCOUNT_EMAIL must be an email address.");
  if (email === env.REVIEW_ACCOUNT_EMAIL?.trim().toLowerCase())
    throw new Error("DEMO_ACCOUNT_EMAIL must differ from REVIEW_ACCOUNT_EMAIL.");
  return email;
}

export async function isDemoUser(database: Pick<Database, "execute">, userId: string) {
  const result = await database.execute<{ role: string | null }>(
    sql`select "role" from "user" where "id" = ${userId}`,
  );
  return result.rows[0]?.role === DEMO_ROLE;
}

/** Exact auth operations that affect only this visitor's session or read its identity. */
export function demoAuthPathAllowed(path: string): boolean {
  return new Set([
    "/get-session",
    "/sign-out",
    "/organization/get-full-organization",
    "/organization/list",
    "/organization/get-active-member",
    "/organization/get-active-member-role",
    "/organization/has-permission",
  ]).has(path);
}

export function demoSignInPlugin(options: { email: string | null; database: Database }) {
  return {
    id: "openvalens-demo-sign-in",
    endpoints: {
      signInDemo: createAuthEndpoint(DEMO_SIGN_IN_PATH, { method: "POST" }, async (ctx) => {
        if (!options.email)
          throw new APIError("NOT_FOUND", { message: "The demo is unavailable." });
        const rows = await options.database.execute<{ id: string }>(sql`
          select u."id" from "user" u
          where lower(u."email") = ${options.email} and u."role" = ${DEMO_ROLE}
            and coalesce(u."banned", false) = false
            and (select count(*) from "member" m where m."user_id" = u."id") = 1
            and exists (select 1 from "member" m where m."user_id" = u."id"
              and m."role" = 'owner'
              and (select count(*) from "member" other where other."organization_id" = m."organization_id") = 1
              and exists (select 1 from "access_audit_log" a
                where a."organization_id" = m."organization_id" and a."event_type" = 'REVIEW_DEMO_SEEDED'))
          limit 2
        `);
        if (rows.rows.length !== 1)
          throw new APIError("NOT_FOUND", { message: "The demo is unavailable." });
        const userId = rows.rows[0]!.id;
        const user = await ctx.context.internalAdapter.findUserById(userId);
        const session = user
          ? await ctx.context.internalAdapter.createSession(
              userId,
              true,
              {
                expiresAt: new Date(Date.now() + 60 * 60 * 1000),
              },
              true,
            )
          : null;
        if (!user || !session)
          throw new APIError("FORBIDDEN", { message: "The demo is unavailable." });
        await setSessionCookie(ctx, { session, user }, true);
        return ctx.json({ status: true });
      }),
    },
    rateLimit: [{ pathMatcher: (path: string) => path === DEMO_SIGN_IN_PATH, window: 60, max: 10 }],
  } satisfies BetterAuthPlugin;
}
