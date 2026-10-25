import { describe, expect, test } from "bun:test";
import type { Database } from "@openvalens/db";
import {
  EmailPermanentError,
  EmailTransientError,
  type EmailService,
  type SendEmailInput,
  type SendEmailOptions,
} from "@openvalens/email";

import type { MessageLocales } from "@openvalens/i18n/server";

import { roles } from "./access/better-auth";
import { createAuth } from "./index";

/**
 * Callback-wiring coverage for {@link createAuth} (Issue #58).
 *
 * Rather than mocking the `better-auth` module (which would pollute the shared
 * unit suite), this introspects the real `auth.options.plugins` returned by
 * Better Auth and invokes the actual callbacks with a fake, config-bound
 * `EmailService`. The fake DB is an inert object — no SQL, no network, no
 * provider calls.
 */

const ENV = {
  BETTER_AUTH_URL: "http://localhost:3000",
  BETTER_AUTH_SECRET: "s".repeat(32),
  CORS_ORIGIN: "http://localhost:3000",
  NODE_ENV: "test",
};

const fakeDatabase = {} as Database;

type CapturedCall = { input: SendEmailInput; options?: SendEmailOptions };

function createFakeEmailService(
  organizationName = "Alpha",
  error: Error | null = null,
): { service: EmailService; calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  const service: EmailService = {
    organizationName,
    sendEmail: async (input, options) => {
      calls.push({ input, options });
      if (error) throw error;
      return { id: "msg-1", dryRun: false };
    },
  };
  return { service, calls };
}

type InvitationArgs = {
  email: string;
  invitation: { id: string; role: string };
  organization: { name: string };
  inviter: { user: { id?: string; name?: string; email: string } };
};

type MagicLinkData = { email: string; url: string; token: string; metadata?: unknown };
type MagicLinkCtx = { getHeader: (name: string) => string | null | undefined };

type PluginOptions = {
  sendInvitationEmail?: (args: InvitationArgs) => Promise<void>;
  sendMagicLink?: (data: MagicLinkData, ctx: MagicLinkCtx) => Promise<void>;
};

function pluginOptions(auth: ReturnType<typeof createAuth>, id: string): PluginOptions {
  const plugins = auth.options.plugins as unknown as Array<{ id: string; options?: PluginOptions }>;
  const plugin = plugins.find((candidate) => candidate.id === id);
  if (!plugin?.options) throw new Error(`missing plugin ${id}`);
  return plugin.options;
}

function buildAuth(service: EmailService) {
  return createAuth(ENV, fakeDatabase, {
    email: service,
    desktopOrigins: ["openvalens://desktop"],
  });
}

const INVITATION_ARGS: InvitationArgs = {
  email: "invitee@example.com",
  invitation: { id: "inv-1", role: "member" },
  organization: { name: "Acme Health" },
  inviter: { user: { name: "Dr. Who", email: "inviter@example.com" } },
};

describe("createAuth email wiring", () => {
  test("fails closed for the old two-argument call shape", () => {
    const legacyCall = createAuth as unknown as (env: unknown, db: unknown) => unknown;

    expect(() => legacyCall(ENV, fakeDatabase)).toThrow("Auth email service is not configured.");
  });

  test("routes the invitation callback through the injected email service", async () => {
    const { service, calls } = createFakeEmailService("Alpha");
    const auth = buildAuth(service);

    await pluginOptions(auth, "organization").sendInvitationEmail?.(INVITATION_ARGS);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.input.to).toBe("invitee@example.com");
    expect(calls[0]?.input.templateName).toBe("invitation");
    expect(calls[0]?.input.tags).toEqual(["invitation"]);
    expect(calls[0]?.input.subject).toContain("Acme Health");
    // Accept URL is built from CORS_ORIGIN + invitation id.
    expect(calls[0]?.input.html).toContain("http://localhost:3000/accept-invitation/inv-1");
    // Expiry is the 2-day invitation window.
    expect(calls[0]?.input.html).toContain("expires in 2 days");
    // Branding from the injected service is threaded into the render options.
    expect(calls[0]?.input.html).toContain("Alpha");
  });

  test("routes the magic-link callback through the injected email service", async () => {
    const { service, calls } = createFakeEmailService("Alpha");
    const auth = buildAuth(service);
    const url = "https://app.example/magic-link/verify?token=raw-token";

    await pluginOptions(auth, "magic-link").sendMagicLink?.(
      { email: "user@example.com", url, token: "raw-token" },
      { getHeader: (name) => (name === "x-correlation-id" ? "corr-1" : undefined) },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.input.to).toBe("user@example.com");
    expect(calls[0]?.input.subject).toBe("Sign in to OpenValens");
    expect(calls[0]?.input.tags).toEqual(["magic-link"]);
    expect(calls[0]?.options?.correlationId).toBe("corr-1");
    expect(calls[0]?.input.html).toContain(url);
    // Branding from the injected service is threaded into the render options.
    expect(calls[0]?.input.html).toContain("Alpha");
  });

  test("invitation swallows a transient provider failure (best-effort)", async () => {
    const { service } = createFakeEmailService("Alpha", new EmailTransientError(503, "down"));
    const auth = buildAuth(service);

    await expect(
      pluginOptions(auth, "organization").sendInvitationEmail?.(INVITATION_ARGS),
    ).resolves.toBeUndefined();
  });

  test("magic link rethrows a transient failure and swallows a permanent one", async () => {
    const transient = buildAuth(
      createFakeEmailService("Alpha", new EmailTransientError(503, "down")).service,
    );
    await expect(
      pluginOptions(transient, "magic-link").sendMagicLink?.(
        { email: "user@example.com", url: "https://app.example/x", token: "t" },
        { getHeader: () => undefined },
      ),
    ).rejects.toBeInstanceOf(EmailTransientError);

    const permanent = buildAuth(
      createFakeEmailService("Alpha", new EmailPermanentError(422, "invalid")).service,
    );
    await expect(
      pluginOptions(permanent, "magic-link").sendMagicLink?.(
        { email: "user@example.com", url: "https://app.example/x", token: "t" },
        { getHeader: () => undefined },
      ),
    ).resolves.toBeUndefined();
  });

  test("keeps desktop origins in trusted origins and defaults to none", () => {
    const { service } = createFakeEmailService();
    const withDesktop = buildAuth(service);
    const withoutDesktop = createAuth(ENV, fakeDatabase, { email: service });

    expect(withDesktop.options.trustedOrigins).toContain("openvalens://desktop");
    expect(withoutDesktop.options.trustedOrigins).not.toContain("openvalens://desktop");
    expect(withoutDesktop.options.trustedOrigins).toContain("http://localhost:3000");
  });
});

describe("createAuth email language (Issue #231)", () => {
  /** Saved languages by address and by user id; an address missing here has no account. */
  function fakeLocales(
    byEmail: Record<string, "en" | "pt-PT">,
    byUser: Record<string, "en" | "pt-PT"> = {},
  ): MessageLocales {
    return {
      forEmail: async (email) => byEmail[email.toLowerCase()] ?? null,
      forUser: async (userId) => byUser[userId] ?? "en",
    };
  }

  function buildLocalizedAuth(service: EmailService, locales: MessageLocales) {
    return createAuth(ENV, fakeDatabase, { email: service, locales });
  }

  async function sendMagicLink(auth: ReturnType<typeof createAuth>, email: string) {
    await pluginOptions(auth, "magic-link").sendMagicLink?.(
      { email, url: "https://app.example/magic-link/verify?token=raw-token", token: "raw-token" },
      { getHeader: () => undefined },
    );
  }

  test("a magic link uses the account's saved language", async () => {
    const { service, calls } = createFakeEmailService("Alpha");
    const auth = buildLocalizedAuth(
      service,
      fakeLocales({ "pt@example.com": "pt-PT", "en@example.com": "en" }),
    );

    await sendMagicLink(auth, "PT@example.com");
    await sendMagicLink(auth, "en@example.com");
    await sendMagicLink(auth, "nobody@example.com");

    expect(calls.map((call) => call.input.subject)).toEqual([
      "Iniciar sessão em OpenValens",
      "Sign in to OpenValens",
      "Sign in to OpenValens",
    ]);
    expect(calls[0]?.input.text).toContain("Por segurança, esta ligação expira");
    expect(calls[1]?.input.text).toContain("For your security, this link expires");
  });

  test("a magic link falls back to English when the lookup fails", async () => {
    const { service, calls } = createFakeEmailService("Alpha");
    const auth = buildLocalizedAuth(service, {
      forEmail: async () => {
        throw new Error("db down");
      },
      forUser: async () => "pt-PT",
    });

    await sendMagicLink(auth, "user@example.com");
    expect(calls[0]?.input.subject).toBe("Sign in to OpenValens");
  });

  test("a workspace invitation uses the recipient's language", async () => {
    const { service, calls } = createFakeEmailService("Alpha");
    const auth = buildLocalizedAuth(
      service,
      fakeLocales({ "invitee@example.com": "pt-PT" }, { "inviter-1": "en" }),
    );

    await pluginOptions(auth, "organization").sendInvitationEmail?.({
      ...INVITATION_ARGS,
      inviter: { user: { id: "inviter-1", name: "Dr. Who", email: "inviter@example.com" } },
    });

    expect(calls[0]?.input.subject).toBe("Dr. Who convidou-o para Acme Health em OpenValens");
    expect(calls[0]?.input.html).toContain("Este convite expira dentro de 2 dias.");
    expect(calls[0]?.input.html).toContain("http://localhost:3000/accept-invitation/inv-1");
  });

  test("a workspace invitation to an address with no account uses the inviter's language", async () => {
    const { service, calls } = createFakeEmailService("Alpha");
    const auth = buildLocalizedAuth(service, fakeLocales({}, { "inviter-1": "pt-PT" }));

    await pluginOptions(auth, "organization").sendInvitationEmail?.({
      ...INVITATION_ARGS,
      inviter: { user: { id: "inviter-1", name: "Dr. Who", email: "inviter@example.com" } },
    });
    expect(calls[0]?.input.subject).toBe("Dr. Who convidou-o para Acme Health em OpenValens");
  });

  test("a recipient with an English account gets English even from a pt-PT inviter", async () => {
    const { service, calls } = createFakeEmailService("Alpha");
    const auth = buildLocalizedAuth(
      service,
      fakeLocales({ "invitee@example.com": "en" }, { "inviter-1": "pt-PT" }),
    );

    await pluginOptions(auth, "organization").sendInvitationEmail?.({
      ...INVITATION_ARGS,
      inviter: { user: { id: "inviter-1", name: "Dr. Who", email: "inviter@example.com" } },
    });
    expect(calls[0]?.input.subject).toBe("Dr. Who invited you to Acme Health on OpenValens");
  });
});

describe("global role boundary (Issue #58)", () => {
  test("the admin plugin marks user.role as a non-input field", () => {
    const { service } = createFakeEmailService();
    const auth = buildAuth(service);
    const plugins = auth.options.plugins as unknown as Array<{
      id: string;
      schema?: { user?: { fields?: Record<string, { input?: boolean }> } };
    }>;
    const admin = plugins.find((candidate) => candidate.id === "admin");

    expect(admin?.schema?.user?.fields?.role?.input).toBe(false);
  });

  test("a workspace owner cannot set a global user role; an admin can", () => {
    expect(roles.owner.authorize({ user: ["set-role"] }).success).toBe(false);
    expect(roles.admin.authorize({ user: ["set-role"] }).success).toBe(true);
  });
});

// ─── Issue #63 admission wiring ─────────────────────────────────

type AnyOptions = {
  user?: { validateUserInfo?: (input?: unknown) => unknown };
  databaseHooks?: { user?: { create?: { before?: () => unknown } } };
  hooks?: { before?: unknown };
};

function fakeDatabaseWithRows(rows: { id: string }[]): Database {
  return {
    execute: async () => ({ rows }),
  } as unknown as Database;
}

describe("createAuth admission wiring (Issue #63)", () => {
  test("rejects every SDK user creation (validateUserInfo + databaseHooks)", async () => {
    const { service } = createFakeEmailService();
    const auth = buildAuth(service);
    const options = auth.options as unknown as AnyOptions;

    expect(options.user?.validateUserInfo?.()).toEqual({ error: "registration_not_allowed" });
    expect(await options.databaseHooks?.user?.create?.before?.()).toBe(false);
  });

  test("magic link disables sign-up and stores only hashed tokens", () => {
    const { service } = createFakeEmailService();
    const auth = buildAuth(service);
    const magic = pluginOptions(auth, "magic-link") as unknown as {
      disableSignUp?: boolean;
      storeToken?: string;
    };

    expect(magic.disableSignUp).toBe(true);
    expect(magic.storeToken).toBe("hashed");
  });

  test("the /admin/* hook is registered", () => {
    const { service } = createFakeEmailService();
    const auth = buildAuth(service);
    const options = auth.options as unknown as AnyOptions;
    expect(typeof options.hooks?.before).toBe("function");
  });

  test("organization invitations allow existing accounts only", async () => {
    const { service } = createFakeEmailService();
    const args = {
      invitation: { email: "invitee@example.com" },
      inviter: { user: { email: "inviter@example.com" } },
      organization: { name: "Acme" },
    };

    const existing = createAuth(ENV, fakeDatabaseWithRows([{ id: "user-1" }]), { email: service });
    const orgHooks = pluginOptions(existing, "organization") as unknown as {
      organizationHooks?: { beforeCreateInvitation?: (a: unknown) => Promise<unknown> };
    };
    await expect(
      orgHooks.organizationHooks?.beforeCreateInvitation?.(args),
    ).resolves.toBeUndefined();

    const missing = createAuth(ENV, fakeDatabaseWithRows([]), { email: service });
    const missingHooks = pluginOptions(missing, "organization") as unknown as {
      organizationHooks?: { beforeCreateInvitation?: (a: unknown) => Promise<unknown> };
    };
    await expect(missingHooks.organizationHooks?.beforeCreateInvitation?.(args)).rejects.toThrow();
  });
});
