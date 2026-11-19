#!/usr/bin/env bun
/**
 * `bun run demo:seed:review` — fills the app store review account's own
 * workspace with the synthetic demo data, on the server's real database.
 *
 *   bun run demo:seed:review [--refresh] [--today YYYY-MM-DD | --time-zone Area/City]
 *
 * Reads the server's own settings from the environment: `DATABASE_URL` (or
 * `DATABASE_URL_FILE`), `REVIEW_ACCOUNT_EMAIL` and `REVIEW_ACCOUNT_CODE` (or
 * `REVIEW_ACCOUNT_CODE_FILE`). It refuses unless review sign-in is configured
 * (both review settings set) and the guards in `review.ts` pass.
 *
 * Without `--refresh` it never deletes anything, and a second run changes
 * nothing. With `--refresh` (the nightly scheduled task) it replaces the
 * records of a workspace it seeded before with fresh ones and keeps the trial
 * running; see `refreshReviewAccount`.
 *
 * The newest data is on `--today`, or today in `--time-zone` (an IANA zone),
 * or today in UTC. With `--time-zone`, clock times are that zone's wall clock
 * (a night runs 22:00 to 07:00 there). Nothing is dated after the moment the
 * command runs. See docs/store-review-account.md.
 */
import { parseReviewSignInConfig, ReviewSignInConfigError } from "@openvalens/auth/review-sign-in";
import { resolveFileSecrets } from "@openvalens/config/file-secrets";
import { createDb } from "@openvalens/db";

import { seedConfiguredDemoPhotos } from "./photos";
import { parseDay } from "./options";
import { refreshReviewAccount, ReviewSeedRefusal, seedReviewAccount } from "./review";

export const REVIEW_USAGE =
  "Usage: bun run demo:seed:review [--refresh] [--today YYYY-MM-DD | --time-zone Area/City]";

/** `YYYY-MM-DD` for `now` in an IANA time zone, or `null` for an unknown zone. */
export function dayInTimeZone(now: Date, timeZone: string): string | null {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const part = (type: string) => parts.find((p) => p.type === type)?.value;
    return parseDay(`${part("year")}-${part("month")}-${part("day")}`);
  } catch {
    return null;
  }
}

export type ReviewOptions =
  | { ok: true; today: string; refresh: boolean; timeZone: string | null }
  | { ok: false; message: string };

export function parseReviewOptions(argv: readonly string[], now: Date = new Date()): ReviewOptions {
  let today: string | undefined;
  let timeZone: string | undefined;
  let refresh = false;
  const value = (arg: string, name: string, next: string | undefined) =>
    arg === name ? (next ?? "") : arg.slice(name.length + 1);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--refresh") {
      refresh = true;
    } else if (arg === "--today" || arg.startsWith("--today=")) {
      today = value(arg, "--today", argv[i + 1]);
      if (arg === "--today") i += 1;
    } else if (arg === "--time-zone" || arg.startsWith("--time-zone=")) {
      timeZone = value(arg, "--time-zone", argv[i + 1]);
      if (arg === "--time-zone") i += 1;
    } else {
      return { ok: false, message: `Unknown option.\n${REVIEW_USAGE}` };
    }
  }
  if (today !== undefined && timeZone !== undefined)
    return { ok: false, message: `Pass --today or --time-zone, not both.\n${REVIEW_USAGE}` };
  if (timeZone !== undefined) {
    const day = dayInTimeZone(now, timeZone);
    return day
      ? { ok: true, today: day, refresh, timeZone }
      : { ok: false, message: `--time-zone must be an IANA time zone.\n${REVIEW_USAGE}` };
  }
  const day = parseDay(today ?? now.toISOString().slice(0, 10));
  return day
    ? { ok: true, today: day, refresh, timeZone: null }
    : { ok: false, message: `--today must be a calendar day (YYYY-MM-DD).\n${REVIEW_USAGE}` };
}

export async function main(
  argv: readonly string[],
  env: Record<string, string | undefined>,
): Promise<number> {
  const now = new Date();
  const options = parseReviewOptions(argv, now);
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
  const input = {
    email,
    today: options.today,
    ...(options.timeZone ? { timeZone: options.timeZone } : {}),
    now,
  };
  try {
    if (options.refresh) {
      const result = await refreshReviewAccount(db, input);
      console.log(
        result.status === "refreshed"
          ? `Refreshed the review account: replaced ${result.erasedRows} rows with demo data ending ${result.today}.`
          : `Seeded the review account's workspace with demo data ending ${result.today}.`,
      );
      console.log(
        {
          extended: "Its trial runs for another 30 days.",
          stripe: "Its subscription is managed by Stripe; the trial was left alone.",
          none: "It has no subscription (billing is off); nothing to extend.",
        }[result.trial],
      );
      await seedConfiguredDemoPhotos(db, result, resolved);
      return 0;
    }
    const result = await seedReviewAccount(db, input);
    if (result.status === "already-seeded") {
      console.log(
        "The review account was already seeded. Nothing changed (use --refresh to replace its data).",
      );
    } else {
      console.log(`Seeded the review account's workspace with demo data ending ${result.today}.`);
    }
    await seedConfiguredDemoPhotos(db, result, resolved);
    return 0;
  } catch (error) {
    if (error instanceof ReviewSeedRefusal) {
      console.error(error.message);
      return 1;
    }
    // Records commit atomically; private files are a separate, retryable stage.
    console.error(
      "Seeding did not complete. Record changes are atomic; photo uploads run afterwards and can be retried.",
    );
    throw error;
  } finally {
    await db.$client.end();
  }
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2), process.env);
}
