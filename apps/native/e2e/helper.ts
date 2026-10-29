/**
 * Issue #302 — the loopback helper the Maestro flows call (with `http.get` in
 * a `runScript`). It only ever runs next to the disposable e2e database.
 *
 * - `GET /magic-link?email=` — the newest dev magic link the server printed
 *   for a request made after the previous call, followed server-side with
 *   redirects off. Answers with the `openvalens://` callback (carrying the
 *   session cookie) that the flow then opens with `openLink`, the same URL the
 *   browser would hand the app after a tap on the emailed link.
 * - `GET /sign-up?email=` — creates a Cloud account the way the emailed
 *   sign-up link does (a `sign_up_request` row, then the real verify
 *   endpoint), because the server refuses public sign-up while email is a dry
 *   run. The account gets the 30-day trial and lands in onboarding.
 * - `GET /subscription?email=&status=ended|trialing` — moves the owner's
 *   subscription, for the read-only state (#298).
 * - `POST /v1/chat/completions` — a stub OpenAI-compatible model for the
 *   coach: a fixed reply, streamed or not, with token usage.
 */
import { createHash, randomBytes } from "node:crypto";

import { SQL } from "bun";

import { E2E, databaseUrl, serverUrl } from "./config";

/** Same domain-separated hash as `hashSignUpSecret` in `@openvalens/auth`. */
function hashSignUpSecret(secret: string): string {
  return createHash("sha256").update(`openvalens:admission:sign-up:${secret}`).digest("hex");
}

export const STUB_REPLY =
  "Your sleep has been steadier this week, and your resting heart rate is down a little. Keep the same bedtime and add a short walk after lunch.";

const MAGIC_LINK_LINE = /(\/api\/auth\/magic-link\/verify\?\S+)/;

export type Helper = {
  /** Feed one line of server output. */
  onServerLine(line: string): void;
  stop(): Promise<void>;
};

export function startHelper(): Helper {
  const sql = new SQL(databaseUrl());
  const links: string[] = [];
  let handedOut = 0;

  async function nextMagicLink(timeoutMs = 15_000): Promise<string | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (links.length > handedOut) {
        // Only the newest counts; anything older was abandoned by a retry.
        handedOut = links.length;
        return links[links.length - 1] ?? null;
      }
      await Bun.sleep(200);
    }
    return null;
  }

  async function followToApp(path: string): Promise<string | null> {
    const response = await fetch(new URL(path, serverUrl()), { redirect: "manual" });
    const location = response.headers.get("location");
    return location && location.startsWith("openvalens:") ? location : null;
  }

  async function signUp(email: string): Promise<Response> {
    const token = randomBytes(32).toString("base64url");
    const now = new Date();
    const expires = new Date(now.getTime() + 30 * 60_000);
    await sql`insert into "sign_up_request" ("id", "canonical_email", "token_hash", "locale", "terms_version", "privacy_version", "accepted_at", "expires_at", "consumed_at", "user_id", "created_at")
      values (${crypto.randomUUID()}, ${email}, ${hashSignUpSecret(token)}, ${"en"}, ${"2026-11-01"}, ${"2026-11-01"}, ${now}, ${expires}, null, null, ${now})`;
    const verify = new URL("/api/auth/admission/sign-up/verify", serverUrl());
    verify.searchParams.set("token", token);
    const response = await fetch(verify, { redirect: "manual" });
    const location = response.headers.get("location") ?? "";
    if (!location.endsWith("/welcome")) {
      return new Response(`sign-up did not complete (${response.status} ${location})`, {
        status: 500,
      });
    }
    return new Response("created");
  }

  async function setSubscription(email: string, status: string): Promise<Response> {
    if (status !== "ended" && status !== "trialing") {
      return new Response("status must be ended or trialing", { status: 400 });
    }
    const ended = status === "ended" ? new Date() : null;
    const trialEnds =
      status === "ended"
        ? new Date(Date.now() - 86_400_000)
        : new Date(Date.now() + 30 * 86_400_000);
    const rows =
      await sql`update "subscription" set "status" = ${status}, "ended_at" = ${ended}, "trial_ends_at" = ${trialEnds}, "updated_at" = now()
      where "user_id" = (select "id" from "user" where "email" = ${email}) returning "id"`;
    if (rows.length !== 1) return new Response("no subscription for that email", { status: 404 });
    return new Response(status);
  }

  function stubCompletion(body: { stream?: boolean }): Response {
    const usage = { prompt_tokens: 420, completion_tokens: 38, total_tokens: 458 };
    const id = "chatcmpl-e2e";
    const created = Math.floor(Date.now() / 1000);
    if (!body.stream) {
      return Response.json({
        id,
        object: "chat.completion",
        created,
        model: "e2e-stub",
        choices: [
          { index: 0, message: { role: "assistant", content: STUB_REPLY }, finish_reason: "stop" },
        ],
        usage,
      });
    }
    const words = STUB_REPLY.split(/(?<= )/);
    const chunk = (delta: object, finish: string | null, extra: object = {}) =>
      `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model: "e2e-stub", choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`;
    const stream = new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(enc.encode(chunk({ role: "assistant", content: "" }, null)));
        for (const word of words) {
          controller.enqueue(enc.encode(chunk({ content: word }, null)));
          await Bun.sleep(15);
        }
        controller.enqueue(enc.encode(chunk({}, "stop", { usage })));
        controller.enqueue(enc.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream" } });
  }

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: E2E.helperPort,
    idleTimeout: 60,
    async fetch(request) {
      const url = new URL(request.url);
      const email = (url.searchParams.get("email") ?? "").trim().toLowerCase();
      try {
        switch (url.pathname) {
          case "/health":
            return new Response("ok");
          case "/magic-link": {
            const path = await nextMagicLink();
            if (!path) return new Response("no magic link was printed", { status: 404 });
            const deepLink = await followToApp(path);
            if (!deepLink)
              return new Response("the link did not redirect to the app", { status: 502 });
            return new Response(deepLink);
          }
          case "/sign-up":
            if (!email.endsWith("@example.com"))
              return new Response("example.com only", { status: 400 });
            return await signUp(email);
          case "/subscription":
            return await setSubscription(email, url.searchParams.get("status") ?? "");
          case "/v1/chat/completions":
            return stubCompletion((await request.json()) as { stream?: boolean });
          case "/v1/models":
            return Response.json({ object: "list", data: [{ id: "e2e-stub", object: "model" }] });
          default:
            return new Response("not found", { status: 404 });
        }
      } catch (error) {
        return new Response(`helper error: ${(error as Error).message}`, { status: 500 });
      }
    },
  });

  return {
    onServerLine(line) {
      const match = MAGIC_LINK_LINE.exec(line);
      if (match?.[1]) links.push(match[1]);
    },
    async stop() {
      await server.stop(true);
      await sql.close();
    },
  };
}
