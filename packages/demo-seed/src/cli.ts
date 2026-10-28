#!/usr/bin/env bun
/**
 * `bun run demo:seed` — seeds the synthetic demo instance (Issue #301).
 *
 *   DEMO_DATABASE_URL=postgres://postgres:pw@127.0.0.1:5432/openvalens_demo \
 *     bun run demo:seed [--today YYYY-MM-DD] [--cloud]
 *
 * Reads only `DEMO_DATABASE_URL` (never `DATABASE_URL`, so an ambient `.env`
 * cannot aim it at a real database) and refuses anything but a loopback
 * database named `openvalens_demo[_suffix]`. Every run drops and recreates that
 * database's schema first. See `packages/demo-seed/README.md`.
 */
import { createDb } from "@openvalens/db";

import { assertDisposableDemoDatabase, DemoGuardError } from "./guard";
import { parseOptions } from "./options";
import { seedDemo } from "./seed";
import { DEMO_MEMBER, DEMO_PERSON } from "./accounts";

async function main(): Promise<number> {
  const parsed = parseOptions(process.argv.slice(2), process.env);
  if (!parsed.ok) {
    console.error(parsed.message);
    return 1;
  }
  let url: string;
  try {
    url = assertDisposableDemoDatabase(process.env.DEMO_DATABASE_URL);
  } catch (error) {
    console.error(error instanceof DemoGuardError ? error.message : "Refusing to seed.");
    return 1;
  }
  const db = createDb({ DATABASE_URL: url });
  try {
    const result = await seedDemo(db, parsed.options);
    console.log(`Seeded the demo instance for ${parsed.options.today}.`);
    console.log(`  ${DEMO_PERSON.name} <${DEMO_PERSON.email}>: instance admin, workspace owner`);
    console.log(`  ${DEMO_MEMBER.name} <${DEMO_MEMBER.email}>: member of Alex's workspace`);
    if (result.cloud) console.log(`  --cloud: ${result.cloud.reason ?? "applied"}`);
    return 0;
  } finally {
    await db.$client.end();
  }
}

if (import.meta.main) {
  process.exitCode = await main();
}
