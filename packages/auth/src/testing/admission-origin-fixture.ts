/**
 * Production-like SDK origin fixture (Issue #63).
 *
 * Run as a child process with `NODE_ENV=production` and `bun --no-env-file`, so
 * Better Auth's `isTest()` origin bypass is NOT active and its real origin
 * enforcement runs. It builds the real `createAuth` with a fake (no-network)
 * email service against an explicitly supplied database, issues three
 * requests to a real enabled endpoint, and prints the status codes as JSON.
 *
 * This is a test fixture command, not a public diagnostic endpoint.
 *
 * Env: DATABASE_URL (explicit; required), plus the caller's NODE_ENV.
 */

import { createDb } from "@openvalens/db";
import type { EmailService } from "@openvalens/email";

import { createAuth } from "../index";

const APP_ORIGIN = "https://app.example";
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  process.stderr.write("DATABASE_URL is required.\n");
  process.exit(1);
}

const db = createDb({ DATABASE_URL: databaseUrl });
const email: EmailService = {
  organizationName: "OpenValens",
  sendEmail: async () => ({ id: "fixture", dryRun: false }),
};
const auth = createAuth(
  {
    BETTER_AUTH_URL: APP_ORIGIN,
    BETTER_AUTH_SECRET: "s".repeat(32),
    CORS_ORIGIN: APP_ORIGIN,
    NODE_ENV: "production",
  },
  db,
  { email },
);

async function magicLinkStatus(origin: string | null): Promise<number> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (origin !== null) headers.origin = origin;
  const response = await auth.handler(
    new Request(`${APP_ORIGIN}/api/auth/sign-in/magic-link`, {
      method: "POST",
      headers,
      body: JSON.stringify({ email: "origin-probe@example.test" }),
    }),
  );
  return response.status;
}

const result = {
  configured: await magicLinkStatus(APP_ORIGIN),
  foreign: await magicLinkStatus("https://evil.example"),
  missing: await magicLinkStatus(null),
};

process.stdout.write(`${JSON.stringify(result)}\n`);

const client = (db as unknown as { $client?: { end: () => Promise<void> } }).$client;
if (client) await client.end();
