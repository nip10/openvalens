import { readdir } from "node:fs/promises";

import { sql, type Database } from "@openvalens/db";

/**
 * Test-only helpers for the data-rights integration suites: apply every
 * migration to an empty disposable database, and seed one synthetic account
 * (user + owned organization) across the tables export and delete must cover.
 */

export function assertDisposable(url: string | undefined, database: string): void {
  if (!url) return;
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.pathname !== `/${database}`)
    throw new Error(`Empty disposable loopback ${database} database required.`);
}

export async function migrateEmptyDatabase(db: Database): Promise<void> {
  const tables = await db.execute(sql`select tablename from pg_tables where schemaname = 'public'`);
  if (tables.rows.length) throw new Error("Integration database must be empty.");
  const root = new URL("../../db/src/migrations/", import.meta.url);
  for (const directory of (await readdir(root)).sort()) {
    if (!/^\d/.test(directory)) continue;
    const text = await Bun.file(new URL(`${directory}/migration.sql`, root)).text();
    for (const statement of text.split("--> statement-breakpoint"))
      if (statement.trim()) await db.execute(sql.raw(statement));
  }
}

/** Seeds account `who` (user-<who>, org-<who>) with `samples` metric samples. */
export async function seedAccount(db: Database, who: string, samples: number): Promise<void> {
  await db.execute(
    sql.raw(`
    insert into "user" (id, email) values ('user-${who}', '${who}@example.test');
    insert into organization (id, name, slug) values ('org-${who}', 'Record ${who}', 'record-${who}');
    insert into member (id, organization_id, user_id, role) values ('m-${who}', 'org-${who}', 'user-${who}', 'owner');
    insert into session (id, user_id, token, expires_at) values ('s-${who}', 'user-${who}', 'session-secret-${who}', now() + interval '1 day');
    insert into account (id, account_id, provider_id, user_id, password) values ('acc-${who}', 'acct-${who}', 'credential', 'user-${who}', 'password-hash-${who}');
    insert into metric_definition (organization_id, code, display_name) values ('org-${who}', 'weight', 'Weight');
    insert into telegram_connect_token (organization_id, user_id, token_hash, expires_at, created_at) values ('org-${who}', 'user-${who}', 'tg-hash-${who}', '2099-01-01', '2026-10-01');
    insert into supplement (name, dose) values ('Supplement ${who}', '1 cap');
    insert into access_request (organization_id, requester_user_id, target_domain, requested_actions, created_at) values ('org-${who}', 'user-${who}', 'labs', '["read"]', '2026-10-01');
  `),
  );
  await db.execute(
    sql.raw(`
    insert into metric_sample (organization_id, metric_definition_id, sampled_at, dedupe_hash, numeric_value)
      select 'org-${who}', id, now(), 'dh-${who}-' || g, 70 + g
      from metric_definition, generate_series(1, ${samples}) g
      where organization_id = 'org-${who}';
    insert into supplement_schedule (organization_id, user_id, supplement_id, time_of_day)
      select 'org-${who}', 'user-${who}', id, 'morning' from supplement where name = 'Supplement ${who}';
    insert into access_request_decision (request_id, decision, created_at)
      select id, 'approved', '2026-10-01' from access_request where organization_id = 'org-${who}';
  `),
  );
}
