#!/usr/bin/env bun
/**
 * `bun run demo:seed:review` — fills the app store review account's own
 * workspace with the synthetic demo data, on the server's real database.
 *
 *   bun run demo:seed:review [--today YYYY-MM-DD]
 *
 * Reads the server's own settings from the environment: `DATABASE_URL` (or
 * `DATABASE_URL_FILE`), `REVIEW_ACCOUNT_EMAIL` and `REVIEW_ACCOUNT_CODE` (or
 * `REVIEW_ACCOUNT_CODE_FILE`). It refuses unless review sign-in is configured
 * (both review settings set) and the guards in `review.ts` pass. It never
 * deletes anything, and a second run changes nothing. `--today` defaults to
 * the current UTC day, so the newest data is today's. See
 * docs/store-review-account.md.
 */
import { parseReviewSignInConfig, ReviewSignInConfigError } from "@openvalens/auth/review-sign-in";
import { resolveFileSecrets } from "@openvalens/config/file-secrets";
import { createDb } from "@openvalens/db";

import { parseDay } from "./options";
import { ReviewSeedRefusal, seedReviewAccount } from "./review";

export const REVIEW_USAGE = "Usage: bun run demo:seed:review [--today YYYY-MM-DD]";

export function parseReviewOptions(
  argv: readonly string[],
  now: Date = new Date(),
): { ok: true; today: string } | { ok: false; message: string } {
  let today = now.toISOString().slice(0, 10);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--today") {
      today = argv[i + 1] ?? "";
      i += 1;
    } else if (arg.startsWith("--today=")) {
      today = arg.slice("--today=".length);
    } else {
      return { ok: false, message: `Unknown option.\n${REVIEW_USAGE}` };
    }
  }
  const day = parseDay(today);
  return day
    ? { ok: true, today: day }
    : { ok: false, message: `--today must be a calendar day (YYYY-MM-DD).\n${REVIEW_USAGE}` };
}

export async function main(
  argv: readonly string[],
  env: Record<string, string | undefined>,
): Promise<number> {
  const options = parseReviewOptions(argv);
  if (!options.ok) {
    console.error(options.message);
    return 1;
  }
  let resolved: Record<string, string | undefined>;
  let email: string;
  try {
    resolved = { ...env, ...resolveFileSecrets(env, ["DATABASE_URL", "REVIEW_ACCOUNT_CODE"]) };
    const review = parseReviewSignInConfig(resolved);
    if (!review.config) {
      console.error(
        "Refusing to seed: review sign-in is off. Set REVIEW_ACCOUNT_EMAIL and REVIEW_ACCOUNT_CODE first.",
      );
      return 1;
    }
    email = review.config.email;
  } catch (error) {
    // Both errors name keys only, never a value.
    console.error(
      error instanceof ReviewSignInConfigError || error instanceof Error
        ? error.message
        : "Refusing to seed.",
    );
    return 1;
  }
  if (!resolved.DATABASE_URL) {
    console.error("Refusing to seed: DATABASE_URL is not set.");
    return 1;
  }

  const db = createDb({ DATABASE_URL: resolved.DATABASE_URL });
  try {
    const result = await seedReviewAccount(db, { email, today: options.today });
    if (result.status === "already-seeded") {
      console.log("The review account was already seeded. Nothing changed.");
    } else {
      console.log(`Seeded the review account's workspace with demo data ending ${result.today}.`);
    }
    return 0;
  } catch (error) {
    if (error instanceof ReviewSeedRefusal) {
      console.error(error.message);
      return 1;
    }
    console.error('Seeding failed part-way. See docs/store-review-account.md ("If a run fails").');
    throw error;
  } finally {
    await db.$client.end();
  }
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2), process.env);
}
