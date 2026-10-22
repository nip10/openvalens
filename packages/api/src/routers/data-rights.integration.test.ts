import { beforeAll, describe, expect, test } from "bun:test";
import { createDb, sql } from "@openvalens/db";
import { RPCHandler } from "@orpc/server/fetch";

import type { Context } from "../context";
import { dataRightsRouter } from "./data-rights";

/**
 * Issue #89: exercise deleteEverything over its production oRPC procedure and
 * PostgreSQL deletion service. The HTTP request is real; session authority is
 * a trusted context seam loaded from synthetic persisted user/session rows,
 * not Better Auth cookie authentication.
 */
const url = process.env.DATA_RIGHTS_ERASURE_AUTH_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/data_rights_erasure_auth_test"
  ) {
    throw new Error("Empty disposable loopback data_rights_erasure_auth_test database required.");
  }
}

const db = createDb({
  DATABASE_URL: url ?? "postgres://127.0.0.1/data_rights_erasure_auth_test",
});
const rpc = new RPCHandler(dataRightsRouter);

type Identity =
  | "subject-impersonated"
  | "subject-control"
  | "subject-stale"
  | "subject-expired"
  | "subject-future"
  | "subject-revoked"
  | "subject-mismatch"
  | "subject-race-revoked"
  | "subject-race-expired"
  | "subject-race-stale"
  | "subject-race-owner-change"
  | "subject-race-coowner"
  | "subject-race-coowner-other"
  | "subject-race-gate"
  | "subject-race-gate-a"
  | "subject-race-gate-b"
  | "subject-race-gate-c"
  | "subject-race-gate-insert"
  | "subject-storage"
  | "subject-photo"
  | "subject-infinite-expiry"
  | "subject-infinite-created"
  | "subject-serialization"
  | "subject-deadlock";
type RpcResponse = { status: number; body: unknown };

async function contextFromDatabase(
  headers: Headers,
  identity: Identity,
  sessionIdentity: Identity = identity,
): Promise<Context> {
  const row = (
    await db.execute(sql`
    select u.id as user_id, u.email, s.id as session_id, s.user_id as session_user_id,
           s.created_at, s.expires_at, s.impersonated_by
    from "user" u join "session" s on s.user_id = ${sessionIdentity}
    where u.id = ${identity} and s.id = ${`session-${sessionIdentity}`}
  `)
  ).rows[0] as
    | {
        user_id: string;
        email: string;
        session_id: string;
        session_user_id: string;
        created_at: Date;
        expires_at: Date;
        impersonated_by: string | null;
      }
    | undefined;
  if (!row) throw new Error("Synthetic DB-backed session fixture missing.");
  return {
    session: {
      user: { id: row.user_id, email: row.email, name: null },
      session: {
        id: row.session_id,
        userId: row.session_user_id,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        impersonatedBy: row.impersonated_by,
      },
    },
    db,
    correlationId: "corr-erasure-auth-synthetic",
    cronSecret: "synthetic-cron-secret-long-enough",
    betterAuthSecretConfigured: true,
    capabilities: { telegram: false, anthropic: false, resend: false, mobilePairing: false },
    telegram: { webhookSecret: "synthetic-webhook-secret", connectTokenTtlSeconds: 600 },
    telegramClient: null,
    aiConfig: {} as never,
    aiRateLimiter: { check: () => ({ allowed: true }) } as never,
    honoContext: { req: { raw: { headers } } },
  } as unknown as Context;
}

async function call(
  identity: Identity,
  input: unknown,
  options: {
    sessionIdentity?: Identity;
    context?: Context;
    path?: "deleteEverything" | "deletionPreview";
  } = {},
): Promise<RpcResponse> {
  const headers = new Headers({ "content-type": "application/json" });
  const request = new Request(`http://test.local/rpc/${options.path ?? "deleteEverything"}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ json: input }),
  });
  const { matched, response } = await rpc.handle(request, {
    prefix: "/rpc",
    context:
      options.context ?? (await contextFromDatabase(headers, identity, options.sessionIdentity)),
  });
  if (!matched || !response) throw new Error("unmatched data-rights RPC path");
  return { status: response.status, body: await response.json() };
}

async function counts(
  identity: Identity,
): Promise<{ users: number; sessions: number; orgs: number; ledger: number }> {
  const rows = (
    await db.execute(sql`
    select
      (select count(*)::int from "user" where id = ${identity}) as users,
      (select count(*)::int from "session" where user_id = ${identity}) as sessions,
      (select count(*)::int from organization where id = ${`org-${identity}`}) as orgs,
      (select count(*)::int from erasure_ledger where subject_user_id = ${identity}) as ledger
  `)
  ).rows[0] as { users: number; sessions: number; orgs: number; ledger: number };
  return rows;
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function waitForLockWait(queryFragment: string): Promise<number> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const waiting = await db.execute(sql`select pid from pg_stat_activity
      where datname = current_database() and wait_event_type = 'Lock'
        and query like ${`%${queryFragment}%`} limit 1`);
    if (waiting.rows.length) return Number((waiting.rows[0] as { pid: number }).pid);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const active = await db.execute(sql`select state, wait_event_type, query from pg_stat_activity
    where datname = current_database() and pid <> pg_backend_pid()`);
  throw new Error(
    `Timed out waiting for PostgreSQL lock query ${queryFragment}; observed ${JSON.stringify(active.rows)}`,
  );
}

async function waitForWriterBlockedBy(applicationName: string, blockingPid: number): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const blocked = await db.execute(sql`select 1 from pg_stat_activity
      where application_name = ${applicationName} and wait_event_type = 'Lock'
        and ${blockingPid} = any(pg_blocking_pids(pid)) limit 1`);
    if (blocked.rows.length) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Writer ${applicationName} did not wait on erasure backend ${blockingPid}.`);
}

async function waitForSessionBoundary(sessionId: string, boundary: "freshness" | "expiry") {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const row = (
      await db.execute(
        boundary === "freshness"
          ? sql`select clock_timestamp() > created_at + interval '10 minutes' as passed
            from "session" where id = ${sessionId}`
          : sql`select clock_timestamp() >= expires_at as passed from "session" where id = ${sessionId}`,
      )
    ).rows[0] as { passed: boolean } | undefined;
    if (row?.passed) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Database clock did not cross the ${boundary} authorization boundary.`);
}

describe.skipIf(!url)("data-rights impersonation authorization over HTTP/PostgreSQL", () => {
  beforeAll(async () => {
    const existing = await db.execute(
      sql`select tablename from pg_tables where schemaname = 'public'`,
    );
    if (existing.rows.length) throw new Error("Integration database must be empty.");
    const { migrateEmptyDatabase } = await import("@openvalens/data-rights/testing");
    await migrateEmptyDatabase(db);
    await db.execute(
      sql.raw(`
      insert into "user" (id, email) values
        ('operator-admin', 'operator-admin@example.test'),
        ('subject-impersonated', 'subject-impersonated@example.test'),
        ('subject-control', 'subject-control@example.test'),
        ('subject-stale', 'subject-stale@example.test'),
        ('subject-expired', 'subject-expired@example.test'),
        ('subject-future', 'subject-future@example.test'),
        ('subject-revoked', 'subject-revoked@example.test'),
        ('subject-mismatch', 'subject-mismatch@example.test'),
        ('subject-race-revoked', 'subject-race-revoked@example.test'),
        ('subject-race-expired', 'subject-race-expired@example.test'),
        ('subject-race-stale', 'subject-race-stale@example.test'),
        ('subject-race-owner-change', 'subject-race-owner-change@example.test'),
        ('subject-race-coowner', 'subject-race-coowner@example.test'),
        ('subject-race-coowner-other', 'subject-race-coowner-other@example.test'),
        ('subject-race-gate', 'subject-race-gate@example.test'),
        ('subject-race-gate-a', 'subject-race-gate-a@example.test'),
        ('subject-race-gate-b', 'subject-race-gate-b@example.test'),
        ('subject-race-gate-c', 'subject-race-gate-c@example.test'),
        ('subject-race-gate-insert', 'subject-race-gate-insert@example.test'),
        ('subject-storage', 'subject-storage@example.test'),
        ('subject-photo', 'subject-photo@example.test'),
        ('subject-infinite-expiry', 'subject-infinite-expiry@example.test'),
        ('subject-infinite-created', 'subject-infinite-created@example.test'),
        ('subject-serialization', 'subject-serialization@example.test'),
        ('subject-deadlock', 'subject-deadlock@example.test');
      insert into organization (id, name, slug) values
        ('org-subject-impersonated', 'Synthetic subject record', 'synthetic-impersonated'),
        ('org-subject-control', 'Synthetic control record', 'synthetic-control'),
        ('org-subject-stale', 'Synthetic stale record', 'synthetic-stale'),
        ('org-subject-expired', 'Synthetic expired record', 'synthetic-expired'),
        ('org-subject-future', 'Synthetic future record', 'synthetic-future'),
        ('org-subject-revoked', 'Synthetic revoked record', 'synthetic-revoked'),
        ('org-subject-mismatch', 'Synthetic mismatched record', 'synthetic-mismatch'),
        ('org-subject-race-revoked', 'Synthetic revoked-race record', 'synthetic-race-revoked'),
        ('org-subject-race-expired', 'Synthetic expired-race record', 'synthetic-race-expired'),
        ('org-subject-race-stale', 'Synthetic stale-race record', 'synthetic-race-stale'),
        ('org-subject-race-owner-change', 'Synthetic owner-change record', 'synthetic-owner-change'),
        ('org-subject-race-coowner', 'Synthetic co-owner record', 'synthetic-coowner'),
        ('org-subject-race-gate', 'Synthetic lock-gate record', 'synthetic-lock-gate'),
        ('org-subject-storage', 'Synthetic stored-object record', 'synthetic-storage'),
        ('org-subject-photo', 'Synthetic photo record', 'synthetic-photo'),
        ('org-subject-infinite-expiry', 'Synthetic infinite-expiry record', 'synthetic-infinite-expiry'),
        ('org-subject-infinite-created', 'Synthetic infinite-created record', 'synthetic-infinite-created'),
        ('org-subject-serialization', 'Synthetic serialization record', 'synthetic-serialization'),
        ('org-subject-deadlock', 'Synthetic deadlock record', 'synthetic-deadlock');
      insert into member (id, organization_id, user_id, role) values
        ('member-impersonated', 'org-subject-impersonated', 'subject-impersonated', 'owner'),
        ('member-control', 'org-subject-control', 'subject-control', 'owner'),
        ('member-stale', 'org-subject-stale', 'subject-stale', 'owner'),
        ('member-expired', 'org-subject-expired', 'subject-expired', 'owner'),
        ('member-future', 'org-subject-future', 'subject-future', 'owner'),
        ('member-revoked', 'org-subject-revoked', 'subject-revoked', 'owner'),
        ('member-mismatch', 'org-subject-mismatch', 'subject-mismatch', 'owner'),
        ('member-race-revoked', 'org-subject-race-revoked', 'subject-race-revoked', 'owner'),
        ('member-race-expired', 'org-subject-race-expired', 'subject-race-expired', 'owner'),
        ('member-race-stale', 'org-subject-race-stale', 'subject-race-stale', 'owner'),
        ('member-race-owner-change', 'org-subject-race-owner-change', 'subject-race-owner-change', 'owner'),
        ('member-race-coowner', 'org-subject-race-coowner', 'subject-race-coowner', 'owner'),
        ('member-race-coowner-other', 'org-subject-race-coowner', 'subject-race-coowner-other', 'collaborator'),
        ('member-race-gate', 'org-subject-race-gate', 'subject-race-gate', 'owner'),
        ('member-race-gate-a', 'org-subject-race-gate', 'subject-race-gate-a', 'collaborator'),
        ('member-race-gate-b', 'org-subject-race-gate', 'subject-race-gate-b', 'collaborator'),
        ('member-race-gate-c', 'org-subject-race-gate', 'subject-race-gate-c', 'collaborator'),
        ('member-storage', 'org-subject-storage', 'subject-storage', 'owner'),
        ('member-photo', 'org-subject-photo', 'subject-photo', 'owner');
      insert into member (id, organization_id, user_id, role) values
        ('member-infinite-expiry', 'org-subject-infinite-expiry', 'subject-infinite-expiry', 'owner'),
        ('member-infinite-created', 'org-subject-infinite-created', 'subject-infinite-created', 'owner'),
        ('member-serialization', 'org-subject-serialization', 'subject-serialization', 'owner'),
        ('member-deadlock', 'org-subject-deadlock', 'subject-deadlock', 'owner');
      insert into session (id, user_id, token, expires_at, created_at, impersonated_by) values
        ('session-subject-impersonated', 'subject-impersonated', 'synthetic-token-impersonated', now() + interval '1 hour', now(), 'operator-admin'),
        ('session-subject-control', 'subject-control', 'synthetic-token-control', now() + interval '1 hour', now(), null),
        ('session-subject-stale', 'subject-stale', 'synthetic-token-stale', now() + interval '1 hour', now() - interval '11 minutes', null),
        ('session-subject-expired', 'subject-expired', 'synthetic-token-expired', now() - interval '1 second', now(), null),
        ('session-subject-future', 'subject-future', 'synthetic-token-future', now() + interval '1 hour', now() + interval '1 minute', null),
        ('session-subject-revoked', 'subject-revoked', 'synthetic-token-revoked', now() + interval '1 hour', now(), null),
        ('session-subject-mismatch', 'subject-mismatch', 'synthetic-token-mismatch', now() + interval '1 hour', now(), null),
        ('session-subject-race-revoked', 'subject-race-revoked', 'synthetic-token-race-revoked', now() + interval '1 hour', now(), null),
        ('session-subject-race-expired', 'subject-race-expired', 'synthetic-token-race-expired', now() + interval '1 hour', now(), null),
        ('session-subject-race-stale', 'subject-race-stale', 'synthetic-token-race-stale', now() + interval '1 hour', now(), null),
        ('session-subject-race-owner-change', 'subject-race-owner-change', 'synthetic-token-owner-change', now() + interval '1 hour', now(), null),
        ('session-subject-race-coowner', 'subject-race-coowner', 'synthetic-token-coowner', now() + interval '1 hour', now(), null),
        ('session-subject-race-gate', 'subject-race-gate', 'synthetic-token-lock-gate', now() + interval '1 hour', now(), null),
        ('session-subject-storage', 'subject-storage', 'synthetic-token-storage', now() + interval '1 hour', now(), null),
        ('session-subject-photo', 'subject-photo', 'synthetic-token-photo', now() + interval '1 hour', now(), null),
        ('session-subject-infinite-expiry', 'subject-infinite-expiry', 'synthetic-token-infinite-expiry', now() + interval '1 hour', now(), null),
        ('session-subject-infinite-created', 'subject-infinite-created', 'synthetic-token-infinite-created', now() + interval '1 hour', now(), null),
        ('session-subject-serialization', 'subject-serialization', 'synthetic-token-serialization', now() + interval '1 hour', now(), null),
        ('session-subject-deadlock', 'subject-deadlock', 'synthetic-token-deadlock', now() + interval '1 hour', now(), null);
    `),
    );
  });

  test("fresh impersonation cannot erase its subject (pre-fix regression)", async () => {
    const before = await counts("subject-impersonated");
    expect(before).toEqual({ users: 1, sessions: 1, orgs: 1, ledger: 0 });

    const response = await call("subject-impersonated", { confirmation: "DELETE" });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await counts("subject-impersonated")).toEqual(before);
  });

  test("persisted impersonation is rejected even if the trusted context flag is absent", async () => {
    const before = await counts("subject-impersonated");
    const headers = new Headers({ "content-type": "application/json" });
    const trusted = await contextFromDatabase(headers, "subject-impersonated");
    const staleContext = {
      ...trusted,
      session: {
        ...trusted.session!,
        session: { ...trusted.session!.session, impersonatedBy: null },
      },
    } as unknown as Context;
    const response = await call(
      "subject-impersonated",
      { confirmation: "DELETE" },
      { context: staleContext },
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await counts("subject-impersonated")).toEqual(before);
  });

  test("wrong confirmation is denied without changing control subject", async () => {
    const before = await counts("subject-control");
    const response = await call("subject-control", { confirmation: "delete" });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await counts("subject-control")).toEqual(before);
  });

  test("request-supplied user override is rejected without changing the subject", async () => {
    const before = await counts("subject-control");
    const response = await call("subject-control", {
      confirmation: "DELETE",
      userId: "subject-impersonated",
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await counts("subject-control")).toEqual(before);
  });

  test("stale, expired, and future persisted sessions cannot erase their subjects", async () => {
    for (const identity of ["subject-stale", "subject-expired", "subject-future"] as const) {
      const before = await counts(identity);
      const response = await call(identity, { confirmation: "DELETE" });
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(await counts(identity)).toEqual(before);
    }
  });

  test("non-finite persisted timestamps fail closed using a previously captured trusted context", async () => {
    const headers = new Headers({ "content-type": "application/json" });
    const expiryContext = await contextFromDatabase(headers, "subject-infinite-expiry");
    const expiryBefore = await counts("subject-infinite-expiry");
    await db.execute(sql`update "session" set expires_at = '-infinity'
      where id = 'session-subject-infinite-expiry'`);
    const expiredInfinity = await call(
      "subject-infinite-expiry",
      { confirmation: "DELETE" },
      {
        context: expiryContext,
      },
    );
    expect(expiredInfinity.body).toMatchObject({ json: { code: "REAUTH_REQUIRED" } });
    expect(await counts("subject-infinite-expiry")).toEqual(expiryBefore);

    const createdContext = await contextFromDatabase(headers, "subject-infinite-created");
    const createdBefore = await counts("subject-infinite-created");
    await db.execute(sql`update "session" set created_at = 'infinity'
      where id = 'session-subject-infinite-created'`);
    const createdInfinity = await call(
      "subject-infinite-created",
      { confirmation: "DELETE" },
      {
        context: createdContext,
      },
    );
    expect(createdInfinity.body).toMatchObject({ json: { code: "REAUTH_REQUIRED" } });
    expect(await counts("subject-infinite-created")).toEqual(createdBefore);
  });

  test("revoked and mismatched session ids are rejected without erasure", async () => {
    const revokedBefore = await counts("subject-revoked");
    const headers = new Headers({ "content-type": "application/json" });
    const revokedContext = await contextFromDatabase(headers, "subject-revoked");
    await db.execute(sql`delete from "session" where id = 'session-subject-revoked'`);
    const revoked = await call(
      "subject-revoked",
      { confirmation: "DELETE" },
      { context: revokedContext },
    );
    expect(revoked.status).toBeGreaterThanOrEqual(400);
    expect(await counts("subject-revoked")).toEqual({ ...revokedBefore, sessions: 0 });

    const mismatchBefore = await counts("subject-mismatch");
    const mismatch = await call(
      "subject-mismatch",
      { confirmation: "DELETE" },
      {
        sessionIdentity: "subject-control",
      },
    );
    expect(mismatch.status).toBeGreaterThanOrEqual(400);
    expect(await counts("subject-mismatch")).toEqual(mismatchBefore);
  });

  test("impersonated deletion preview is denied before preview data queries", async () => {
    const response = await call("subject-impersonated", {}, { path: "deletionPreview" });
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  test("session revoked while account-lock authorization waits is rejected", async () => {
    const headers = new Headers({ "content-type": "application/json" });
    const trustedContext = await contextFromDatabase(headers, "subject-race-revoked");
    const locked = deferred();
    const release = deferred();
    const holder = db.transaction(async (tx) => {
      await tx.execute(sql`select id from "user" where id = 'subject-race-revoked' for update`);
      locked.resolve();
      await release.promise;
      await tx.execute(sql`delete from "session" where id = 'session-subject-race-revoked'`);
    });
    await locked.promise;
    let rejected!: Promise<RpcResponse>;
    try {
      rejected = call(
        "subject-race-revoked",
        { confirmation: "DELETE" },
        { context: trustedContext },
      );
      await waitForLockWait('from "user" where id');
    } finally {
      release.resolve();
    }
    await holder;
    const response = await rejected;
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await counts("subject-race-revoked")).toEqual({
      users: 1,
      sessions: 0,
      orgs: 1,
      ledger: 0,
    });
  });

  test("freshness is checked against database wall clock after lock wait", async () => {
    await db.execute(sql`update "session" set created_at = clock_timestamp() - interval '599.5 seconds'
      where id = 'session-subject-race-stale'`);
    const headers = new Headers({ "content-type": "application/json" });
    const trustedContext = await contextFromDatabase(headers, "subject-race-stale");
    const validAtStart = (
      await db.execute(sql`select clock_timestamp() - created_at < interval '10 minutes' as valid
      from "session" where id = 'session-subject-race-stale'`)
    ).rows[0] as { valid: boolean };
    expect(validAtStart.valid).toBe(true);
    const locked = deferred();
    const release = deferred();
    const holder = db.transaction(async (tx) => {
      await tx.execute(sql`select id from "user" where id = 'subject-race-stale' for update`);
      locked.resolve();
      await release.promise;
    });
    await locked.promise;
    let rejected!: Promise<RpcResponse>;
    try {
      rejected = call(
        "subject-race-stale",
        { confirmation: "DELETE" },
        { context: trustedContext },
      );
      await waitForLockWait('from "user" where id');
      await waitForSessionBoundary("session-subject-race-stale", "freshness");
    } finally {
      release.resolve();
    }
    await holder;
    const response = await rejected;
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await counts("subject-race-stale")).toEqual({
      users: 1,
      sessions: 1,
      orgs: 1,
      ledger: 0,
    });
  });

  test("session expiry is checked against database wall clock after lock wait", async () => {
    await db.execute(sql`update "session" set expires_at = clock_timestamp() + interval '500 milliseconds'
      where id = 'session-subject-race-expired'`);
    const headers = new Headers({ "content-type": "application/json" });
    const trustedContext = await contextFromDatabase(headers, "subject-race-expired");
    const validAtStart = (
      await db.execute(sql`select expires_at > clock_timestamp() as valid
      from "session" where id = 'session-subject-race-expired'`)
    ).rows[0] as { valid: boolean };
    expect(validAtStart.valid).toBe(true);
    const locked = deferred();
    const release = deferred();
    const holder = db.transaction(async (tx) => {
      await tx.execute(sql`select id from "user" where id = 'subject-race-expired' for update`);
      locked.resolve();
      await release.promise;
    });
    await locked.promise;
    let rejected!: Promise<RpcResponse>;
    try {
      rejected = call(
        "subject-race-expired",
        { confirmation: "DELETE" },
        { context: trustedContext },
      );
      await waitForLockWait('from "user" where id');
      await waitForSessionBoundary("session-subject-race-expired", "expiry");
    } finally {
      release.resolve();
    }
    await holder;
    const response = await rejected;
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await counts("subject-race-expired")).toEqual({
      users: 1,
      sessions: 1,
      orgs: 1,
      ledger: 0,
    });
  });

  test("ownership transfer before membership locks conflicts instead of erasing", async () => {
    const headers = new Headers({ "content-type": "application/json" });
    const trustedContext = await contextFromDatabase(headers, "subject-race-owner-change");
    const locked = deferred();
    const release = deferred();
    const holder = db.transaction(async (tx) => {
      await tx.execute(
        sql`select id from "user" where id = 'subject-race-owner-change' for update`,
      );
      locked.resolve();
      await release.promise;
      await tx.execute(
        sql`update member set role = 'collaborator' where id = 'member-race-owner-change'`,
      );
    });
    await locked.promise;
    let pending!: Promise<RpcResponse>;
    try {
      pending = call(
        "subject-race-owner-change",
        { confirmation: "DELETE" },
        { context: trustedContext },
      );
      await waitForLockWait('from "user" where id');
    } finally {
      release.resolve();
    }
    await holder;
    const response = await pending;
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await counts("subject-race-owner-change")).toEqual({
      users: 1,
      sessions: 1,
      orgs: 1,
      ledger: 0,
    });
  });

  test("co-owner promotion before owned-organization membership locks conflicts", async () => {
    const headers = new Headers({ "content-type": "application/json" });
    const trustedContext = await contextFromDatabase(headers, "subject-race-coowner");
    const locked = deferred();
    const release = deferred();
    const holder = db.transaction(async (tx) => {
      await tx.execute(sql`select id from "user" where id = 'subject-race-coowner' for update`);
      locked.resolve();
      await release.promise;
      await tx.execute(
        sql`update member set role = 'owner' where id = 'member-race-coowner-other'`,
      );
    });
    await locked.promise;
    let pending!: Promise<RpcResponse>;
    try {
      pending = call(
        "subject-race-coowner",
        { confirmation: "DELETE" },
        { context: trustedContext },
      );
      await waitForLockWait('from "user" where id');
    } finally {
      release.resolve();
    }
    await holder;
    const response = await pending;
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await counts("subject-race-coowner")).toEqual({
      users: 1,
      sessions: 1,
      orgs: 1,
      ledger: 0,
    });
  });

  test("stable locks block member insert, promotion, and deletion; erasure rollback releases writers", async () => {
    await db.execute(sql`insert into stored_object
      (id, organization_id, created_by_user_id, purpose, storage_key, content_type, size_bytes, sha256)
      values ('synthetic-gated-object', 'org-subject-race-gate', 'subject-race-gate', 'clinical_export',
        'org/org-subject-race-gate/synthetic-gated-object', 'application/octet-stream', 1, ${"c".repeat(64)})`);
    await db.execute(
      sql.raw(`
      create function erasure_test_fail_ledger() returns trigger language plpgsql as $$
      begin
        if new.subject_user_id = 'subject-race-gate' then
        raise exception 'synthetic erasure rollback injection';
        end if;
        return new;
      end;
      $$;
      create trigger erasure_test_fail_ledger before insert on erasure_ledger
        for each row execute function erasure_test_fail_ledger();
    `),
    );

    const headers = new Headers({ "content-type": "application/json" });
    const context = await contextFromDatabase(headers, "subject-race-gate");
    let storageDeletes = 0;
    const contextWithStorage = {
      ...context,
      storage: {
        deleteKeys: async () => {
          storageDeletes += 1;
          return { deleted: 1, failed: 0 };
        },
      },
    } as unknown as Context;
    const gateLocked = deferred();
    const releaseGate = deferred();
    const gate = db.transaction(async (tx) => {
      // A blocks on this selected metadata table only after its authorization locks,
      // but this table barrier is independent of membership writes.
      await tx.execute(sql`lock table supplement in access exclusive mode`);
      gateLocked.resolve();
      await releaseGate.promise;
    });
    await gateLocked.promise;

    let erasure!: Promise<RpcResponse>;
    const writers: Promise<unknown>[] = [];
    try {
      erasure = call(
        "subject-race-gate",
        { confirmation: "DELETE" },
        { context: contextWithStorage },
      );
      const erasurePid = await waitForLockWait("select id from supplement where");
      const barrierQuery = (
        await db.execute(sql`select query from pg_stat_activity where pid = ${erasurePid}`)
      ).rows[0] as { query: string };
      expect(barrierQuery.query.toLowerCase()).toContain("select id from supplement");
      expect(barrierQuery.query.toLowerCase()).not.toContain("delete");
      expect(await counts("subject-race-gate")).toEqual({
        users: 1,
        sessions: 1,
        orgs: 1,
        ledger: 0,
      });

      writers.push(
        Promise.resolve(
          db.transaction(async (tx) => {
            await tx.execute(sql`select set_config('application_name', 'erase-gate-insert', true)`);
            await tx.execute(sql`insert into member (id, organization_id, user_id, role)
              values ('member-race-gate-insert', 'org-subject-race-gate', 'subject-race-gate-insert', 'owner')`);
          }),
        ),
      );
      writers.push(
        Promise.resolve(
          db.transaction(async (tx) => {
            await tx.execute(
              sql`select set_config('application_name', 'erase-gate-promote', true)`,
            );
            await tx.execute(sql`update member set role = 'owner' where id = 'member-race-gate-a'`);
          }),
        ),
      );
      writers.push(
        Promise.resolve(
          db.transaction(async (tx) => {
            await tx.execute(sql`select set_config('application_name', 'erase-gate-delete', true)`);
            await tx.execute(sql`delete from member where id = 'member-race-gate-b'`);
          }),
        ),
      );
      await waitForWriterBlockedBy("erase-gate-insert", erasurePid);
      await waitForWriterBlockedBy("erase-gate-promote", erasurePid);
      await waitForWriterBlockedBy("erase-gate-delete", erasurePid);
    } finally {
      releaseGate.resolve();
    }

    await gate;
    const failedErasure = await erasure;
    await Promise.all(writers);
    expect(failedErasure.status).toBeGreaterThanOrEqual(400);
    expect(storageDeletes).toBe(0);
    expect(
      (await db.execute(sql`select id from stored_object where id = 'synthetic-gated-object'`))
        .rows,
    ).toHaveLength(1);
    expect(await counts("subject-race-gate")).toEqual({
      users: 1,
      sessions: 1,
      orgs: 1,
      ledger: 0,
    });
    expect(
      (await db.execute(sql`select role from member where id = 'member-race-gate-insert'`)).rows,
    ).toEqual([{ role: "owner" }]);
    expect(
      (await db.execute(sql`select role from member where id = 'member-race-gate-a'`)).rows,
    ).toEqual([{ role: "owner" }]);
    expect(
      (await db.execute(sql`select id from member where id = 'member-race-gate-b'`)).rows,
    ).toHaveLength(0);
    await db.execute(
      sql.raw(`drop trigger erasure_test_fail_ledger on erasure_ledger;
      drop function erasure_test_fail_ledger();`),
    );
  });

  test("wrapped PostgreSQL serialization and deadlock errors map to conflict without retry", async () => {
    await db.execute(
      sql.raw(`
      create sequence erasure_test_attempts start with 1;
      create table erasure_test_sqlstates (subject_user_id text primary key, error_code text not null);
      insert into erasure_test_sqlstates values
        ('subject-serialization', '40001'), ('subject-deadlock', '40P01');
      create function erasure_test_raise_sqlstate() returns trigger language plpgsql as $$
      declare failure_code text;
      begin
        select error_code into failure_code from erasure_test_sqlstates
          where subject_user_id = new.subject_user_id;
        if found then
          perform nextval('erasure_test_attempts');
          raise exception 'synthetic PostgreSQL conflict' using errcode = failure_code;
        end if;
        return new;
      end;
      $$;
      create trigger erasure_test_raise_sqlstate before insert on erasure_ledger
        for each row execute function erasure_test_raise_sqlstate();
    `),
    );
    for (const identity of ["subject-serialization", "subject-deadlock"] as const) {
      await db.execute(sql`insert into stored_object
        (id, organization_id, created_by_user_id, purpose, storage_key, content_type, size_bytes, sha256)
        values (${`object-${identity}`}, ${`org-${identity}`}, ${identity}, 'clinical_export',
          ${`org/org-${identity}/${identity}`}, 'application/octet-stream', 1, ${"d".repeat(64)})`);
      const before = await counts(identity);
      const sequenceBefore = (
        await db.execute(sql`select last_value, is_called from erasure_test_attempts`)
      ).rows[0] as { last_value: number; is_called: boolean };
      const headers = new Headers({ "content-type": "application/json" });
      const trusted = await contextFromDatabase(headers, identity);
      let storageCalls = 0;
      const withStorage = {
        ...trusted,
        storage: {
          deleteKeys: async () => {
            storageCalls += 1;
            return { deleted: 1, failed: 0 };
          },
        },
      } as unknown as Context;
      const response = await call(identity, { confirmation: "DELETE" }, { context: withStorage });
      expect(response).toMatchObject({ status: 409, body: { json: { code: "CONFLICT" } } });
      expect(await counts(identity)).toEqual(before);
      expect(storageCalls).toBe(0);
      expect(
        (await db.execute(sql`select id from stored_object where id = ${`object-${identity}`}`))
          .rows,
      ).toHaveLength(1);
      const sequenceAfter = (
        await db.execute(sql`select last_value, is_called from erasure_test_attempts`)
      ).rows[0] as { last_value: number; is_called: boolean };
      expect(Number(sequenceAfter.last_value)).toBe(
        Number(sequenceBefore.last_value) + (sequenceBefore.is_called ? 1 : 0),
      );
      expect(sequenceAfter.is_called).toBe(true);
    }
  });

  test("storage absence refuses indexed objects, and configured storage runs after commit", async () => {
    await db.execute(sql`insert into stored_object
      (id, organization_id, created_by_user_id, purpose, storage_key, content_type, size_bytes, sha256)
      values ('synthetic-object', 'org-subject-storage', 'subject-storage', 'clinical_export',
        'org/org-subject-storage/synthetic-object', 'application/octet-stream', 1, ${"a".repeat(64)})`);
    const unavailable = await call("subject-storage", { confirmation: "DELETE" });
    expect(unavailable.status).toBe(500);
    expect(await counts("subject-storage")).toEqual({ users: 1, sessions: 1, orgs: 1, ledger: 0 });
    expect(
      (await db.execute(sql`select id from stored_object where id = 'synthetic-object'`)).rows,
    ).toHaveLength(1);

    const headers = new Headers({ "content-type": "application/json" });
    const trusted = await contextFromDatabase(headers, "subject-storage");
    let observedCommitted = false;
    const withStorage = {
      ...trusted,
      storage: {
        deleteKeys: async (keys: readonly string[]) => {
          expect(keys).toEqual(["org/org-subject-storage/synthetic-object"]);
          const committedCounts = await counts("subject-storage");
          observedCommitted = committedCounts.users === 0 && committedCounts.ledger === 1;
          return { deleted: keys.length, failed: 0 };
        },
      },
    } as unknown as Context;
    const response = await call(
      "subject-storage",
      { confirmation: "DELETE" },
      { context: withStorage },
    );
    expect(response.status).toBe(200);
    expect(observedCommitted).toBe(true);
  });

  test("photo index and cleanup intent block deletion before raw storage cleanup", async () => {
    await db.execute(sql`insert into stored_object
      (id, organization_id, created_by_user_id, purpose, storage_key, content_type, size_bytes, sha256,
       storage_provider, storage_store_id, photo_state, photo_write_state)
      values ('synthetic-photo', 'org-subject-photo', 'subject-photo', 'progress_photo',
        'org/org-subject-photo/synthetic-photo', 'image/jpeg', 1, ${"b".repeat(64)},
        'local', 'synthetic-store', 'ready', 'settled')`);
    await db.execute(sql`insert into photo_cleanup_intent
      (id, storage_key, subject_id, org_id, write_state)
      values ('synthetic-photo', 'org/org-subject-photo/synthetic-photo', 'subject-photo',
        'org-subject-photo', 'uncertain')`);
    const headers = new Headers({ "content-type": "application/json" });
    const trusted = await contextFromDatabase(headers, "subject-photo");
    let storageCalls = 0;
    const withThrowingStorage = {
      ...trusted,
      storage: {
        deleteKeys: async () => {
          storageCalls += 1;
          throw new Error("synthetic storage failure");
        },
      },
    } as unknown as Context;
    const response = await call(
      "subject-photo",
      { confirmation: "DELETE" },
      { context: withThrowingStorage },
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(storageCalls).toBe(0);
    expect(await counts("subject-photo")).toEqual({ users: 1, sessions: 1, orgs: 1, ledger: 0 });
    expect(
      (await db.execute(sql`select id from stored_object where id = 'synthetic-photo'`)).rows,
    ).toHaveLength(1);
    expect(
      (await db.execute(sql`select id from photo_cleanup_intent where id = 'synthetic-photo'`))
        .rows,
    ).toHaveLength(1);
  });

  test("a fresh non-impersonated session exercises successful production deletion", async () => {
    const before = await counts("subject-control");
    const response = await call("subject-control", { confirmation: "DELETE" });
    expect(response).toMatchObject({ status: 200 });
    expect(await counts("subject-control")).toEqual({
      users: 0,
      sessions: 0,
      orgs: 0,
      ledger: before.ledger + 1,
    });
  });
});
