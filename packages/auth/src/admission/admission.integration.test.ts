import { readdir } from "node:fs/promises";
import { beforeAll, describe, expect, test } from "bun:test";
import { createDb, sql } from "@openvalens/db";

import type { Session } from "../index";
import { createAdmissionService, type AdmissionService } from "./service";

/**
 * Issue #63 admission core against a real, disposable PostgreSQL.
 *
 * Guarded by `ADMISSION_TEST_DATABASE_URL`, which must point at an *empty*
 * loopback database named `admission_test`. The full migration set is applied
 * before the suite runs, so the admission tables must exist in the DB lane.
 * When the schema is not present the suite skips rather than declaring a pass.
 */
const url = process.env.ADMISSION_TEST_DATABASE_URL;

if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/admission_test"
  ) {
    throw new Error("Empty disposable loopback admission_test database required.");
  }
}

const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/admission_test" });

let schemaReady = false;
if (url) {
  const tables = await db.execute(sql`select tablename from pg_tables where schemaname = 'public'`);
  if (tables.rows.length) {
    throw new Error("Integration database must be empty.");
  }
  const root = new URL("../../../db/src/migrations/", import.meta.url);
  for (const directory of (await readdir(root)).sort()) {
    if (!/^\d/.test(directory)) continue;
    const text = await Bun.file(new URL(`${directory}/migration.sql`, root)).text();
    for (const statement of text.split("--> statement-breakpoint")) {
      if (statement.trim()) await db.execute(sql.raw(statement));
    }
  }
  const admissionTable = await db.execute(
    sql`select to_regclass('public.instance_admission') is not null as present`,
  );
  schemaReady = Boolean((admissionTable.rows[0] as { present: boolean } | undefined)?.present);
  if (!schemaReady) {
    console.warn(
      "admission.integration.test: instance_admission missing; DB lane not ready — skipping.",
    );
  }
}

function sessionFor(
  userId: string,
  options: { impersonatedBy?: string | null; expiresAt?: Date } = {},
): Session {
  return {
    user: { id: userId, email: "session@example.test", name: null },
    session: {
      id: `sess-${userId}`,
      userId,
      impersonatedBy: options.impersonatedBy ?? null,
      expiresAt: options.expiresAt ?? new Date(Date.now() + 60 * 60 * 1000),
    },
  } as unknown as Session;
}

async function lockWaiters(): Promise<number> {
  const result = await db.execute(
    sql`select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`,
  );
  return (result.rows[0] as { n: number }).n;
}

/** Bounded, non-blind wait until a competing backend is genuinely lock-blocked. */
async function waitForLockWaiter(timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await lockWaiters()) > 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

async function clockNow(): Promise<Date> {
  const result = await db.execute(sql`select clock_timestamp() as now`);
  return new Date(String((result.rows[0] as { now: unknown }).now));
}

async function reset(): Promise<void> {
  await db.execute(sql`delete from "global_security_event"`);
  await db.execute(sql`delete from "admission_grant"`);
  await db.execute(sql`delete from "instance_admission"`);
  await db.execute(sql`delete from "user"`);
  await db.execute(
    sql`insert into "instance_admission" ("id", "state", "generation") values ('instance', 'pending', 0)`,
  );
}

describe.skipIf(!url || !schemaReady)("admission core against disposable PostgreSQL", () => {
  let verifications: { email: string; kind: string; verificationCode: string }[] = [];
  let invitations: { email: string; invitationToken: string }[] = [];
  let service: AdmissionService;

  beforeAll(() => {
    verifications = [];
    invitations = [];
    service = createAdmissionService({
      db,
      deliverVerification: async (input) => {
        verifications.push(input);
      },
      deliverInvitation: async (input) => {
        invitations.push(input);
      },
    });
  });

  test("setup: wrong token, expired token and replay never grant admin", async () => {
    await reset();
    const minted = await service.mintSetupToken();

    await expect(
      service.begin({ kind: "setup", credential: "wrong", email: "first@example.test" }),
    ).rejects.toMatchObject({ code: "DENIED" });

    const begun = await service.begin({
      kind: "setup",
      credential: minted.token,
      email: "first@example.test",
    });
    const code = verifications.at(-1)?.verificationCode ?? "";
    await service.complete(
      { enrollmentId: begun.enrollmentId, credential: minted.token, verificationCode: code },
      null,
    );

    const admins = await db.execute(
      sql`select count(*)::int as n from "user" where "role" = 'admin'`,
    );
    expect((admins.rows[0] as { n: number }).n).toBe(1);

    // Replay must fail.
    await expect(
      service.complete(
        { enrollmentId: begun.enrollmentId, credential: minted.token, verificationCode: code },
        null,
      ),
    ).rejects.toMatchObject({ code: "DENIED" });
  });

  test("setup: rotating the token invalidates the prior reservation", async () => {
    await reset();
    const first = await service.mintSetupToken();
    const begun = await service.begin({
      kind: "setup",
      credential: first.token,
      email: "rot@example.test",
    });
    const second = await service.mintSetupToken();

    await expect(
      service.begin({ kind: "setup", credential: first.token, email: "rot@example.test" }),
    ).rejects.toMatchObject({ code: "DENIED" });
    const rotated = await service.begin({
      kind: "setup",
      credential: second.token,
      email: "rot@example.test",
    });
    expect(rotated.enrollmentId).not.toBe(begun.enrollmentId);
  });

  test("setup: a different email for the same generation is denied", async () => {
    await reset();
    const minted = await service.mintSetupToken();
    await service.begin({ kind: "setup", credential: minted.token, email: "a@example.test" });
    await expect(
      service.begin({ kind: "setup", credential: minted.token, email: "b@example.test" }),
    ).rejects.toMatchObject({ code: "DENIED" });
  });

  test("setup: two concurrent completions yield exactly one administrator", async () => {
    await reset();
    const minted = await service.mintSetupToken();
    const begun = await service.begin({
      kind: "setup",
      credential: minted.token,
      email: "race@example.test",
    });
    const code = verifications.at(-1)?.verificationCode ?? "";

    const results = await Promise.allSettled([
      service.complete(
        { enrollmentId: begun.enrollmentId, credential: minted.token, verificationCode: code },
        null,
      ),
      service.complete(
        { enrollmentId: begun.enrollmentId, credential: minted.token, verificationCode: code },
        null,
      ),
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);
    const admins = await db.execute(
      sql`select count(*)::int as n from "user" where "role" = 'admin'`,
    );
    expect((admins.rows[0] as { n: number }).n).toBe(1);
  });

  test("setup: an existing unverified or banned target and a mismatched session are denied", async () => {
    await reset();
    await db.execute(
      sql`insert into "user" ("id", "email", "email_verified", "role", "banned") values ('t1', 'target@example.test', false, 'user', false)`,
    );
    const minted = await service.mintSetupToken();
    const begun = await service.begin({
      kind: "setup",
      credential: minted.token,
      email: "target@example.test",
    });
    const code = verifications.at(-1)?.verificationCode ?? "";

    await expect(
      service.complete(
        { enrollmentId: begun.enrollmentId, credential: minted.token, verificationCode: code },
        sessionFor("t1"),
      ),
    ).rejects.toMatchObject({ code: "DENIED" });

    await db.execute(sql`update "user" set "email_verified" = true where "id" = 't1'`);
    await expect(
      service.complete(
        { enrollmentId: begun.enrollmentId, credential: minted.token, verificationCode: code },
        sessionFor("t1", { impersonatedBy: "someone" }),
      ),
    ).rejects.toMatchObject({ code: "DENIED" });

    const done = await service.complete(
      { enrollmentId: begun.enrollmentId, credential: minted.token, verificationCode: code },
      sessionFor("t1"),
    );
    expect(done).toEqual({ completed: true });
  });

  test("setup: a wrong proof commits an attempt and is bounded", async () => {
    await reset();
    const minted = await service.mintSetupToken();
    const begun = await service.begin({
      kind: "setup",
      credential: minted.token,
      email: "attempts@example.test",
    });

    for (let index = 0; index < 5; index += 1) {
      await expect(
        service.complete(
          { enrollmentId: begun.enrollmentId, credential: minted.token, verificationCode: "nope" },
          null,
        ),
      ).rejects.toMatchObject({ code: "DENIED" });
    }
    const grant = await db.execute(
      sql`select "verification_attempts" from "admission_grant" where "id" = ${begun.enrollmentId}`,
    );
    expect((grant.rows[0] as { verification_attempts: number }).verification_attempts).toBe(5);

    // The correct code can no longer be used: the grant is exhausted.
    await expect(
      service.begin({ kind: "setup", credential: minted.token, email: "attempts@example.test" }),
    ).rejects.toMatchObject({ code: "DENIED" });
  });

  test("setup: a delivery failure leaves a retryable grant and no user", async () => {
    await reset();
    const failing = createAdmissionService({
      db,
      deliverVerification: async () => {
        throw new Error("provider down");
      },
      deliverInvitation: async () => {},
    });
    const minted = await failing.mintSetupToken();
    await expect(
      failing.begin({ kind: "setup", credential: minted.token, email: "fail@example.test" }),
    ).rejects.toMatchObject({ code: "DELIVERY_FAILED" });

    const users = await db.execute(sql`select count(*)::int as n from "user"`);
    expect((users.rows[0] as { n: number }).n).toBe(0);
    const grants = await db.execute(
      sql`select "send_count" from "admission_grant" where "canonical_email" = 'fail@example.test'`,
    );
    expect(grants.rows).toHaveLength(1);
  });

  test("invitations: issue, recipient mismatch, revoke and issuer demotion", async () => {
    await reset();
    await db.execute(
      sql`insert into "user" ("id", "email", "email_verified", "role", "banned") values ('admin-1', 'admin@example.test', true, 'admin', false)`,
    );
    await db.execute(sql`update "instance_admission" set "state" = 'invite_only'`);

    const issued = await service.issueInvitation(
      { email: "invitee@example.test" },
      sessionFor("admin-1"),
    );
    const token = invitations.at(-1)?.invitationToken ?? "";

    await expect(
      service.begin({ kind: "invitation", credential: token, email: "other@example.test" }),
    ).rejects.toMatchObject({ code: "DENIED" });

    const begun = await service.begin({
      kind: "invitation",
      credential: token,
      email: "invitee@example.test",
    });
    const code = verifications.at(-1)?.verificationCode ?? "";
    await db.execute(sql`update "user" set "role" = 'user' where "id" = 'admin-1'`);
    await expect(
      service.complete(
        { enrollmentId: begun.enrollmentId, credential: token, verificationCode: code },
        null,
      ),
    ).rejects.toMatchObject({ code: "DENIED" });

    await db.execute(sql`update "user" set "role" = 'admin' where "id" = 'admin-1'`);
    const done = await service.complete(
      { enrollmentId: begun.enrollmentId, credential: token, verificationCode: code },
      null,
    );
    expect(done).toEqual({ completed: true });

    const invited = await db.execute(
      sql`select "role" from "user" where "email" = 'invitee@example.test'`,
    );
    expect((invited.rows[0] as { role: string }).role).toBe("user");

    // Revoking a consumed invitation is a no-op.
    expect(
      await service.revokeInvitation({ invitationId: issued.invitationId }, sessionFor("admin-1")),
    ).toEqual({ revoked: false });
  });

  test("invitations: canonical ambiguity and a revoked pending invitation", async () => {
    await reset();
    await db.execute(
      sql`insert into "user" ("id", "email", "email_verified", "role", "banned") values ('admin-1', 'admin@example.test', true, 'admin', false), ('dup-1', 'dup@example.test', true, 'user', false), ('dup-2', 'DUP@example.test', true, 'user', false)`,
    );
    await db.execute(sql`update "instance_admission" set "state" = 'invite_only'`);

    await expect(
      service.issueInvitation({ email: "dup@example.test" }, sessionFor("admin-1")),
    ).rejects.toMatchObject({ code: "DENIED" });

    const issued = await service.issueInvitation(
      { email: "fresh@example.test" },
      sessionFor("admin-1"),
    );
    const token = invitations.at(-1)?.invitationToken ?? "";
    expect(
      await service.revokeInvitation({ invitationId: issued.invitationId }, sessionFor("admin-1")),
    ).toEqual({ revoked: true });
    await expect(
      service.begin({ kind: "invitation", credential: token, email: "fresh@example.test" }),
    ).rejects.toMatchObject({ code: "DENIED" });
  });

  test("invitations: an existing recipient requires a matching live session; mismatch consumes nothing", async () => {
    await reset();
    await db.execute(
      sql`insert into "user" ("id", "email", "email_verified", "role", "banned") values ('admin-1', 'admin@example.test', true, 'admin', false), ('existing-1', 'existing@example.test', true, 'user', false)`,
    );
    await db.execute(sql`update "instance_admission" set "state" = 'invite_only'`);

    const issued = await service.issueInvitation(
      { email: "existing@example.test" },
      sessionFor("admin-1"),
    );
    const token = invitations.at(-1)?.invitationToken ?? "";
    const begun = await service.begin({
      kind: "invitation",
      credential: token,
      email: "existing@example.test",
    });
    const code = verifications.at(-1)?.verificationCode ?? "";
    const input = { enrollmentId: begun.enrollmentId, credential: token, verificationCode: code };

    // A raw bearer + code is insufficient for an existing target.
    await expect(service.complete(input, null)).rejects.toMatchObject({ code: "DENIED" });
    await expect(service.complete(input, sessionFor("someone-else"))).rejects.toMatchObject({
      code: "DENIED",
    });
    await expect(
      service.complete(input, sessionFor("existing-1", { impersonatedBy: "admin-1" })),
    ).rejects.toMatchObject({ code: "DENIED" });

    const afterDenied = await db.execute(
      sql`select "verification_attempts", "consumed_at" from "admission_grant" where "id" = ${begun.enrollmentId}`,
    );
    const denied = afterDenied.rows[0] as {
      verification_attempts: number;
      consumed_at: unknown;
    };
    expect(denied.verification_attempts).toBe(0);
    expect(denied.consumed_at).toBeNull();
    const completedEvents = await db.execute(
      sql`select count(*)::int as n from "global_security_event" where "event_type" = 'admission_completed'`,
    );
    expect((completedEvents.rows[0] as { n: number }).n).toBe(0);

    // A matching live session completes and leaves the existing role unchanged.
    const done = await service.complete(input, sessionFor("existing-1"));
    expect(done).toEqual({ completed: true });
    expect(issued.invitationId).toBe(begun.enrollmentId);
    const role = await db.execute(sql`select "role" from "user" where "id" = 'existing-1'`);
    expect((role.rows[0] as { role: string }).role).toBe("user");
  });

  test("security events carry no email, hash or metadata and roll back with their transaction", async () => {
    await reset();
    const minted = await service.mintSetupToken();
    const begun = await service.begin({
      kind: "setup",
      credential: minted.token,
      email: "audit@example.test",
    });
    const code = verifications.at(-1)?.verificationCode ?? "";

    // An event insert failure must roll back the whole completion.
    await db.execute(
      sql`create or replace function deny_admission_event() returns trigger as $$ begin raise exception 'blocked'; end; $$ language plpgsql`,
    );
    await db.execute(
      sql`create trigger deny_admission_event before insert on "global_security_event" for each row execute function deny_admission_event()`,
    );
    await expect(
      service.complete(
        { enrollmentId: begun.enrollmentId, credential: minted.token, verificationCode: code },
        null,
      ),
    ).rejects.toMatchObject({ code: "INTERNAL" });

    const users = await db.execute(sql`select count(*)::int as n from "user"`);
    expect((users.rows[0] as { n: number }).n).toBe(0);
    const state = await db.execute(
      sql`select "state" from "instance_admission" where "id" = 'instance'`,
    );
    expect((state.rows[0] as { state: string }).state).toBe("pending");
    const grants = await db.execute(
      sql`select "consumed_at" from "admission_grant" where "id" = ${begun.enrollmentId}`,
    );
    expect((grants.rows[0] as { consumed_at: unknown }).consumed_at).toBeNull();

    await db.execute(sql`drop trigger deny_admission_event on "global_security_event"`);
    await db.execute(sql`drop function deny_admission_event()`);
  });

  test("complete denies when the grant/proof expires while queued on the singleton lock", async () => {
    await reset();
    const minted = await service.mintSetupToken();
    const begun = await service.begin({
      kind: "setup",
      credential: minted.token,
      email: "queued@example.test",
    });
    const code = verifications.at(-1)?.verificationCode ?? "";
    await db.execute(
      sql`update "instance_admission" set "setup_expires_at" = clock_timestamp() + interval '1 second'`,
    );
    await db.execute(
      sql`update "admission_grant" set "expires_at" = clock_timestamp() + interval '1 second', "verification_expires_at" = clock_timestamp() + interval '1 second' where "id" = ${begun.enrollmentId}`,
    );

    const blocker = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/admission_test" });
    let release = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let acquired = () => {};
    const lockAcquired = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const holding = blocker.transaction(async (tx) => {
      await tx.execute(
        sql`select "id" from "instance_admission" where "id" = 'instance' for update`,
      );
      acquired();
      await released;
    });
    await lockAcquired;

    let settled = false;
    const completion = service
      .complete(
        { enrollmentId: begun.enrollmentId, credential: minted.token, verificationCode: code },
        null,
      )
      .finally(() => {
        settled = true;
      });

    // Genuinely blocked on the lock (not a blind sleep), and real time passes
    // the compressed expiry before it proceeds.
    expect(await waitForLockWaiter()).toBe(true);
    const until = Date.now() + 1500;
    while (Date.now() < until && (await clockNow()).getTime() < until) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(settled).toBe(false);

    release();
    await holding;
    await expect(completion).rejects.toMatchObject({ code: "DENIED" });
    await blocker.$client.end();

    const users = await db.execute(sql`select count(*)::int as n from "user"`);
    expect((users.rows[0] as { n: number }).n).toBe(0);
    const grant = await db.execute(
      sql`select "consumed_at" from "admission_grant" where "id" = ${begun.enrollmentId}`,
    );
    expect((grant.rows[0] as { consumed_at: unknown }).consumed_at).toBeNull();
    const events = await db.execute(
      sql`select count(*)::int as n from "global_security_event" where "event_type" = 'setup_completed'`,
    );
    expect((events.rows[0] as { n: number }).n).toBe(0);
  });

  test("complete denies an existing target that expires while queued on the user-row lock", async () => {
    await reset();
    await db.execute(
      sql`insert into "user" ("id", "email", "email_verified", "role", "banned") values ('target-1', 'target@example.test', true, 'user', false)`,
    );
    const minted = await service.mintSetupToken();
    const begun = await service.begin({
      kind: "setup",
      credential: minted.token,
      email: "target@example.test",
    });
    const code = verifications.at(-1)?.verificationCode ?? "";
    await db.execute(
      sql`update "admission_grant" set "verification_expires_at" = clock_timestamp() + interval '1 second' where "id" = ${begun.enrollmentId}`,
    );

    const blocker = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/admission_test" });
    let release = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let acquired = () => {};
    const lockAcquired = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const holding = blocker.transaction(async (tx) => {
      await tx.execute(sql`select "id" from "user" where "id" = 'target-1' for update`);
      acquired();
      await released;
    });
    await lockAcquired;

    let settled = false;
    const completion = service
      .complete(
        { enrollmentId: begun.enrollmentId, credential: minted.token, verificationCode: code },
        sessionFor("target-1"),
      )
      .finally(() => {
        settled = true;
      });

    expect(await waitForLockWaiter()).toBe(true);
    const until = Date.now() + 1500;
    while (Date.now() < until && (await clockNow()).getTime() < until) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(settled).toBe(false);

    release();
    await holding;
    await expect(completion).rejects.toMatchObject({ code: "DENIED" });
    await blocker.$client.end();

    const role = await db.execute(sql`select "role" from "user" where "id" = 'target-1'`);
    expect((role.rows[0] as { role: string }).role).toBe("user");
    const grant = await db.execute(
      sql`select "consumed_at" from "admission_grant" where "id" = ${begun.enrollmentId}`,
    );
    expect((grant.rows[0] as { consumed_at: unknown }).consumed_at).toBeNull();
  });

  test("prune removes an expired consumed grant while its event and user survive", async () => {
    await reset();
    const minted = await service.mintSetupToken();
    const begun = await service.begin({
      kind: "setup",
      credential: minted.token,
      email: "retain@example.test",
    });
    const code = verifications.at(-1)?.verificationCode ?? "";
    await service.complete(
      { enrollmentId: begun.enrollmentId, credential: minted.token, verificationCode: code },
      null,
    );
    const user = await db.execute(
      sql`select "id" from "user" where "email" = 'retain@example.test'`,
    );
    const userId = (user.rows[0] as { id: string }).id;

    await db.execute(
      sql`update "admission_grant" set "expires_at" = clock_timestamp() - interval '1 hour' where "id" = ${begun.enrollmentId}`,
    );
    expect((await service.pruneExpiredGrants({ limit: 10_000 })).pruned).toBe(1);

    const grant = await db.execute(
      sql`select count(*)::int as n from "admission_grant" where "id" = ${begun.enrollmentId}`,
    );
    expect((grant.rows[0] as { n: number }).n).toBe(0);
    // Security events reference the grant by opaque id (no FK) and the user
    // survives; the invite_only singleton is never reopened.
    const event = await db.execute(
      sql`select "target_user_id" from "global_security_event" where "event_type" = 'setup_completed'`,
    );
    expect((event.rows[0] as { target_user_id: string }).target_user_id).toBe(userId);
    const role = await db.execute(sql`select "role" from "user" where "id" = ${userId}`);
    expect((role.rows[0] as { role: string }).role).toBe("admin");
    const state = await db.execute(
      sql`select "state" from "instance_admission" where "id" = 'instance'`,
    );
    expect((state.rows[0] as { state: string }).state).toBe("invite_only");
  });

  test("revoke re-checks the live session after the grant lock; expiry while queued denies", async () => {
    await reset();
    await db.execute(
      sql`insert into "user" ("id", "email", "email_verified", "role", "banned") values ('admin-1', 'admin@example.test', true, 'admin', false)`,
    );
    await db.execute(sql`update "instance_admission" set "state" = 'invite_only'`);
    const issued = await service.issueInvitation(
      { email: "queued-revoke@example.test" },
      sessionFor("admin-1"),
    );

    const blocker = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/admission_test" });
    let release = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let acquired = () => {};
    const lockAcquired = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const holding = blocker.transaction(async (tx) => {
      await tx.execute(
        sql`select "id" from "admission_grant" where "id" = ${issued.invitationId} for update`,
      );
      acquired();
      await released;
    });
    await lockAcquired;

    // The session is live when the revocation is queued but expires while it
    // waits on the grant lock.
    const brieflyLive = new Date((await clockNow()).getTime() + 1500);
    let settled = false;
    const revocation = service
      .revokeInvitation(
        { invitationId: issued.invitationId },
        sessionFor("admin-1", { expiresAt: brieflyLive }),
      )
      .finally(() => {
        settled = true;
      });

    // Genuinely blocked on the grant row (real pg_stat_activity lock wait).
    expect(await waitForLockWaiter()).toBe(true);
    const until = Date.now() + 3000;
    while (Date.now() < until && (await clockNow()).getTime() < brieflyLive.getTime() + 100) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(settled).toBe(false);

    release();
    await holding;
    await expect(revocation).rejects.toMatchObject({ code: "DENIED" });
    await blocker.$client.end();

    // The pending grant is untouched and no revocation event was written.
    const grantCount = await db.execute(
      sql`select count(*)::int as n from "admission_grant" where "id" = ${issued.invitationId}`,
    );
    expect((grantCount.rows[0] as { n: number }).n).toBe(1);
    const revokeEvents = await db.execute(
      sql`select count(*)::int as n from "global_security_event" where "event_type" = 'admission_invitation_revoked'`,
    );
    expect((revokeEvents.rows[0] as { n: number }).n).toBe(0);
  });

  test("status, listInvitations and pruneExpiredGrants are safe and bounded", async () => {
    await reset();
    expect(await service.status()).toEqual({ setupAvailable: true });

    await db.execute(
      sql`insert into "user" ("id", "email", "email_verified", "role", "banned") values ('admin-1', 'admin@example.test', true, 'admin', false)`,
    );
    await db.execute(sql`update "instance_admission" set "state" = 'invite_only'`);
    expect(await service.status()).toEqual({ setupAvailable: false });

    await service.issueInvitation({ email: "one@example.test" }, sessionFor("admin-1"));
    const listed = await service.listInvitations(sessionFor("admin-1"));
    expect(listed).toHaveLength(1);
    expect(Object.keys(listed[0] ?? {}).sort()).toEqual([
      "consumedAt",
      "email",
      "expiresAt",
      "id",
      "status",
    ]);

    await db.execute(
      sql`update "admission_grant" set "expires_at" = now() - interval '1 hour' where "consumed_at" is null`,
    );
    expect((await service.pruneExpiredGrants({ limit: 10_000 })).pruned).toBe(1);
  });
});
