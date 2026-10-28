import type { Context } from "@openvalens/api/context";
import { createProductSettingsService } from "@openvalens/api/product-settings";
import { appRouter } from "@openvalens/api/routers/index";
import { clearRegisteredAuth, setRegisteredAuth, type Auth } from "@openvalens/auth";
import { roles } from "@openvalens/auth/access/better-auth";
import type { Database } from "@openvalens/db";
import { member, user } from "@openvalens/db/schema/auth";
import { RPCHandler } from "@orpc/server/fetch";
import { and, eq } from "drizzle-orm";

/**
 * In-process client for the real oRPC router (Issue #301).
 *
 * The demo seed writes through the same procedures the apps call, so every
 * row passes the same validation, ownership rules and side effects (audit,
 * derived rows) as a person using the app. Only the HTTP session lookup is
 * replaced: the registered auth resolves the acting person from the request
 * headers, reads their real membership and role from the database, and checks
 * permissions with the same access-control roles Better Auth uses.
 */
export type DemoActor = { userId: string; organizationId: string };

export type DemoApi = {
  call<T = unknown>(path: string, input: unknown, actor: DemoActor): Promise<T>;
  close(): void;
};

const SESSION_TTL_MS = 60 * 60 * 1000;

type RoleName = keyof typeof roles;

export function createDemoApi(db: Database): DemoApi {
  const actorOf = (headers: Headers): DemoActor | null => {
    const userId = headers.get("x-demo-user");
    const organizationId = headers.get("x-demo-org");
    return userId && organizationId ? { userId, organizationId } : null;
  };

  const membership = async (actor: DemoActor) => {
    const [row] = await db
      .select({ id: member.id, role: member.role })
      .from(member)
      .where(and(eq(member.userId, actor.userId), eq(member.organizationId, actor.organizationId)));
    return row ?? null;
  };

  const sessionFor = async (actor: DemoActor) => {
    const [person] = await db
      .select({ id: user.id, email: user.email, name: user.name, role: user.role })
      .from(user)
      .where(eq(user.id, actor.userId));
    if (!person) return null;
    return {
      user: person,
      session: {
        id: `demo-seed-${actor.userId}`,
        userId: actor.userId,
        activeOrganizationId: actor.organizationId,
        impersonatedBy: null,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
    };
  };

  const auth = {
    api: {
      getSession: async ({ headers }: { headers: Headers }) => {
        const actor = actorOf(headers);
        return actor ? sessionFor(actor) : null;
      },
      getActiveMember: async ({ headers }: { headers: Headers }) => {
        const actor = actorOf(headers);
        const row = actor ? await membership(actor) : null;
        return row && actor
          ? { ...row, userId: actor.userId, organizationId: actor.organizationId }
          : null;
      },
      getActiveMemberRole: async ({ headers }: { headers: Headers }) => {
        const actor = actorOf(headers);
        const row = actor ? await membership(actor) : null;
        return row ? { role: row.role } : null;
      },
      hasPermission: async ({
        headers,
        body,
      }: {
        headers: Headers;
        body: { permissions: Record<string, string[]> };
      }) => {
        const actor = actorOf(headers);
        const row = actor ? await membership(actor) : null;
        const role = row ? roles[row.role as RoleName] : undefined;
        if (!role) return { success: false };
        return role.authorize(body.permissions as never);
      },
    },
  } as unknown as Auth;
  setRegisteredAuth(auth);

  const rpc = new RPCHandler(appRouter);
  const productSettingsService = createProductSettingsService({ db });

  const contextFor = async (headers: Headers): Promise<Context> => {
    const actor = actorOf(headers);
    return {
      session: actor ? await sessionFor(actor) : null,
      db,
      correlationId: "demo-seed",
      cronSecret: "demo-seed-cron-secret-not-used-anywhere",
      betterAuthSecretConfigured: true,
      capabilities: { telegram: false, anthropic: false, resend: false, mobilePairing: false },
      telegram: { connectTokenTtlSeconds: 600 },
      telegramClient: null,
      aiConfig: {
        AI_PROVIDER: null,
        AI_API_KEY: null,
        AI_BASE_URL: null,
        AI_SUPPORTS_STRUCTURED_OUTPUTS: false,
        AI_MODEL: "none",
        AI_RATE_LIMIT_PER_MINUTE: 0,
      },
      aiRateLimiter: { check: () => ({ allowed: false }) },
      productSettingsService,
      honoContext: { req: { raw: { headers } } },
    } as unknown as Context;
  };

  return {
    async call<T>(path: string, input: unknown, actor: DemoActor): Promise<T> {
      const headers = new Headers({
        "content-type": "application/json",
        "x-demo-user": actor.userId,
        "x-demo-org": actor.organizationId,
      });
      const request = new Request(`http://demo-seed.local/rpc/${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ json: input }),
      });
      const { matched, response } = await rpc.handle(request, {
        prefix: "/rpc",
        context: await contextFor(headers),
      });
      if (!matched || !response) throw new Error(`Demo seed: no procedure at ${path}.`);
      const body = (await response.json()) as { json?: unknown };
      if (!response.ok) {
        throw new Error(
          `Demo seed: ${path} failed (${response.status}): ${JSON.stringify(body.json)}`,
        );
      }
      return body.json as T;
    },
    close() {
      clearRegisteredAuth();
    },
  };
}
