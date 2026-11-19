#!/usr/bin/env bun
import { resolveFileSecrets } from "@openvalens/config/file-secrets";
import { createDb } from "@openvalens/db";

import { seedConfiguredDemoPhotos } from "./photos";
import { refreshPublicDemo } from "./public";
import { parseReviewOptions } from "./review-cli";

export async function main(argv: string[], env: Record<string, string | undefined>) {
  const now = new Date();
  const options = parseReviewOptions(argv, now);
  if (!options.ok)
    throw new Error(options.message.replaceAll("demo:seed:review", "demo:seed:public"));
  const resolved = { ...env, ...resolveFileSecrets(env, ["DATABASE_URL"]) };
  if (!resolved.DATABASE_URL) throw new Error("Set DATABASE_URL first.");
  if (!resolved.DEMO_ACCOUNT_EMAIL) throw new Error("Set DEMO_ACCOUNT_EMAIL first.");
  const db = createDb({ DATABASE_URL: resolved.DATABASE_URL });
  try {
    const result = await refreshPublicDemo(db, {
      email: resolved.DEMO_ACCOUNT_EMAIL,
      reviewEmail: resolved.REVIEW_ACCOUNT_EMAIL,
      today: options.today,
      timeZone: options.timeZone ?? undefined,
      now,
    });
    console.log(`Public read-only demo ${result.status}; synthetic data ends ${result.today}.`);
    await seedConfiguredDemoPhotos(db, result, resolved);
  } finally {
    await db.$client.end();
  }
}

if (import.meta.main) await main(process.argv.slice(2), process.env);
