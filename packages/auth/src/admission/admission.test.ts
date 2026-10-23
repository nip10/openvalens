import { describe, expect, test } from "bun:test";
import type { Database } from "@openvalens/db";
import { PgDialect } from "drizzle-orm/pg-core";

import type { Session } from "../index";
import { canonicalizeEmail } from "./email";
import { AdmissionError } from "./errors";
import { createAdmissionService } from "./service";

/**
 * Issue #63 unit suite for the admission core.
 *
 * A faithful in-memory fake interprets the module's own raw SQL so transaction
 * commit/rollback, attempt counters and send windows are exercised for real
 * (no `mock.module`). PostgreSQL integration lives in
 * `admission.integration.test.ts`.
 */

const CANARY = "CANARY_LEAK_9f3a6b2c";

type Row = Record<string, unknown>;

type Snapshot = {
  singleton: Row | null;
  grants: Map<string, Row>;
  users: Map<string, Row>;
  events: Row[];
};

/** Split a SQL list on top-level commas, respecting quotes and parentheses. */
function splitTopLevel(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let current = "";
  for (const character of input) {
    if (quoted) {
      current += character;
      if (character === "'") quoted = false;
      continue;
    }
    if (character === "'") {
      quoted = true;
      current += character;
      continue;
    }
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (character === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += character;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function literalValue(token: string, params: unknown[], clock: Date): unknown {
  const trimmed = token.trim();
  if (trimmed.startsWith("$")) return params[Number(trimmed.slice(1)) - 1];
  if (/^(now|clock_timestamp)\(\)$/i.test(trimmed)) return clock;
  if (trimmed.toLowerCase() === "null") return null;
  if (trimmed.toLowerCase() === "true") return true;
  if (trimmed.toLowerCase() === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1);
  return trimmed;
}

class FakeAdmissionDb {
  clock = new Date("2026-01-01T00:00:00.000Z");
  singleton: Row | null = null;
  grants = new Map<string, Row>();
  users = new Map<string, Row>();
  events: Row[] = [];
  queries: { text: string; params: unknown[] }[] = [];
  committed = 0;

  private snapshot(): Snapshot {
    return {
      singleton: this.singleton ? { ...this.singleton } : null,
      grants: new Map([...this.grants].map(([key, value]) => [key, { ...value }])),
      users: new Map([...this.users].map(([key, value]) => [key, { ...value }])),
      events: this.events.slice(),
    };
  }

  private restore(snapshot: Snapshot): void {
    this.singleton = snapshot.singleton;
    this.grants = snapshot.grants;
    this.users = snapshot.users;
    this.events = snapshot.events;
  }

  execute = async (query: unknown): Promise<{ rows: Row[] }> => {
    const rendered = new PgDialect().sqlToQuery(query as Parameters<PgDialect["sqlToQuery"]>[0]);
    const text = rendered.sql.replace(/\s+/g, " ").trim().toLowerCase();
    const params = rendered.params as unknown[];
    this.queries.push({ text, params });
    return { rows: this.handle(text, params) };
  };

  transaction = async <T>(
    fn: (tx: { execute: (q: unknown) => Promise<{ rows: Row[] }> }) => Promise<T>,
  ): Promise<T> => {
    const snapshot = this.snapshot();
    try {
      const result = await fn({ execute: this.execute });
      this.committed += 1;
      return result;
    } catch (error) {
      this.restore(snapshot);
      throw error;
    }
  };

  private handle(text: string, params: unknown[]): Row[] {
    if (text === "select now() as now" || text === "select clock_timestamp() as now") {
      return [{ now: this.clock }];
    }

    if (text.startsWith("insert into ")) {
      return this.handleInsert(text, params);
    }

    if (text.startsWith("update ")) {
      return this.handleUpdate(text, params);
    }

    if (text.startsWith("delete ")) {
      return this.handleDelete(text, params);
    }

    if (text.startsWith("select pg_advisory_xact_lock")) {
      return [];
    }
    if (text === 'select "role" from "user"') {
      return [...this.users.values()].map((user) => ({ role: user.role }));
    }
    if (text.includes('from "instance_admission"')) {
      return this.singleton ? [this.singleton] : [];
    }
    if (text.includes('from "user" where lower("email")')) {
      const canonical = String(params[0]);
      return [...this.users.values()]
        .filter((user) => String(user.email).toLowerCase() === canonical)
        .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    }
    if (text.includes('from "user" where "id" =')) {
      const user = this.users.get(String(params[0]));
      return user ? [user] : [];
    }
    if (text.includes('from "admission_grant" where "kind" = \'setup\' and "generation" =')) {
      const grant = [...this.grants.values()].find(
        (candidate) =>
          candidate.kind === "setup" && Number(candidate.generation) === Number(params[0]),
      );
      return grant ? [grant] : [];
    }
    if (text.includes('from "admission_grant" where "invitation_token_hash" =')) {
      const grant = [...this.grants.values()].find(
        (candidate) => candidate.invitation_token_hash === params[0],
      );
      return grant ? [grant] : [];
    }
    if (text.includes('from "admission_grant" where "kind" = \'invitation\' order by')) {
      return [...this.grants.values()]
        .filter((grant) => grant.kind === "invitation")
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    }
    if (text.includes('from "admission_grant" where "id" =')) {
      const grant = this.grants.get(String(params[0]));
      return grant ? [grant] : [];
    }

    throw new Error(`FakeAdmissionDb: unhandled SQL: ${text}`);
  }

  private handleInsert(text: string, params: unknown[]): Row[] {
    const match = /^insert into "([^"]+)" \(([^)]*)\) values \((.*)\)$/.exec(text);
    if (!match) throw new Error(`FakeAdmissionDb: unparsed insert: ${text}`);
    const columns = splitTopLevel(match[2]!).map((column) => column.replace(/"/g, "").trim());
    const values = splitTopLevel(match[3]!).map((value) => literalValue(value, params, this.clock));
    const row: Row = {};
    columns.forEach((column, index) => {
      row[column] = values[index];
    });

    if (match[1] === "admission_grant") {
      row.created_at = this.clock;
      row.updated_at = this.clock;
      this.grants.set(String(row.id), row);
    } else if (match[1] === "user") {
      row.banned ??= false;
      row.email_verified ??= true;
      this.users.set(String(row.id), row);
    } else if (match[1] === "global_security_event") {
      row.occurred_at = this.clock;
      this.events.push(row);
    } else {
      throw new Error(`FakeAdmissionDb: unknown insert table ${match[1]}`);
    }
    return [];
  }

  private handleUpdate(text: string, params: unknown[]): Row[] {
    const match = /^update "([^"]+)" set (.*?) where (.*)$/.exec(text);
    if (!match) throw new Error(`FakeAdmissionDb: unparsed update: ${text}`);
    const assignments = splitTopLevel(match[2]!).map((part) => {
      const equals = part.indexOf("=");
      return {
        column: part.slice(0, equals).replace(/"/g, "").trim(),
        valueToken: part.slice(equals + 1).trim(),
      };
    });
    const idMatch = /"id" = \$(\d+)/.exec(match[3]!);
    const id = idMatch ? String(params[Number(idMatch[1]) - 1]) : null;

    const apply = (row: Row) => {
      for (const { column, valueToken } of assignments) {
        if (valueToken.includes("+ 1")) {
          row[column] = Number(row[column] ?? 0) + 1;
        } else {
          row[column] = literalValue(valueToken, params, this.clock);
        }
      }
    };

    if (match[1] === "admission_grant") {
      const grant = id ? this.grants.get(id) : undefined;
      if (grant) apply(grant);
    } else if (match[1] === "user") {
      const user = id ? this.users.get(id) : undefined;
      if (user) apply(user);
    } else if (match[1] === "instance_admission") {
      if (this.singleton) apply(this.singleton);
    } else {
      throw new Error(`FakeAdmissionDb: unknown update table ${match[1]}`);
    }
    return [];
  }

  private handleDelete(text: string, params: unknown[]): Row[] {
    if (text.startsWith('delete from "admission_grant" where "kind" = \'setup\'')) {
      for (const [key, grant] of this.grants) {
        if (grant.kind === "setup") this.grants.delete(key);
      }
      return [];
    }
    if (text.includes('"id" in (select')) {
      const limit = Number(params[0]);
      const expired = [...this.grants.values()]
        .filter(
          (grant) =>
            grant.expires_at != null &&
            new Date(String(grant.expires_at)).getTime() < this.clock.getTime(),
        )
        .sort((a, b) => {
          const byExpiry =
            new Date(String(a.expires_at)).getTime() - new Date(String(b.expires_at)).getTime();
          return byExpiry !== 0 ? byExpiry : String(a.id).localeCompare(String(b.id));
        })
        .slice(0, limit);
      for (const grant of expired) this.grants.delete(String(grant.id));
      return expired.map((grant) => ({ id: grant.id }));
    }
    const idMatch = /"id" = \$(\d+)/.exec(text);
    if (idMatch) {
      const id = String(params[Number(idMatch[1]) - 1]);
      const grant = this.grants.get(id);
      if (!grant || grant.consumed_at != null) return [];
      this.grants.delete(id);
      return [{ id }];
    }
    throw new Error(`FakeAdmissionDb: unparsed delete: ${text}`);
  }
}

function makeService(options: { emailDeliveryAvailable?: boolean } = {}) {
  const fake = new FakeAdmissionDb();
  const verifications: { email: string; kind: string; verificationCode: string }[] = [];
  const invitations: { email: string; invitationToken: string }[] = [];
  const service = createAdmissionService({
    db: fake as unknown as Database,
    deliverVerification: async (input) => {
      verifications.push(input);
    },
    deliverInvitation: async (input) => {
      invitations.push(input);
    },
    emailDeliveryAvailable: () => options.emailDeliveryAvailable ?? true,
  });
  return { fake, service, verifications, invitations };
}

function seedPending(fake: FakeAdmissionDb): void {
  fake.singleton = {
    id: "instance",
    state: "pending",
    generation: 0,
    setup_token_hash: null,
    setup_expires_at: null,
    completed_at: null,
  };
}

function seedInviteOnly(fake: FakeAdmissionDb): void {
  fake.singleton = {
    id: "instance",
    state: "invite_only",
    generation: 1,
    setup_token_hash: null,
    setup_expires_at: null,
    completed_at: new Date("2026-01-01T00:00:00.000Z"),
  };
}

function addUser(
  fake: FakeAdmissionDb,
  id: string,
  email: string,
  role: string,
  extra: Partial<Row> = {},
): void {
  fake.users.set(id, {
    id,
    email,
    role,
    banned: false,
    email_verified: true,
    ...extra,
  });
}

function sessionFor(
  userId: string,
  options: { impersonatedBy?: string | null; expiresAt?: Date } = {},
): Session {
  return {
    user: { id: userId, email: "session@example.test", name: null },
    session: {
      id: "sess-1",
      userId,
      impersonatedBy: options.impersonatedBy ?? null,
      expiresAt: options.expiresAt ?? new Date("2030-01-01T00:00:00.000Z"),
    },
  } as unknown as Session;
}

/** A session whose `expiresAt` is an arbitrary raw value (invalid-date matrix). */
function sessionWithRawExpiry(userId: string, expiresAt: unknown): Session {
  return {
    user: { id: userId, email: "session@example.test", name: null },
    session: { id: "sess-raw", userId, impersonatedBy: null, expiresAt },
  } as unknown as Session;
}

// ─── Pure helpers ──────────────────────────────────────────────

describe("canonicalizeEmail", () => {
  test("lower-cases without trimming, dot or plus normalisation", () => {
    expect(canonicalizeEmail("New@Example.test")).toBe("new@example.test");
    expect(canonicalizeEmail("a.b+tag@Example.test")).toBe("a.b+tag@example.test");
  });

  test("rejects non-strings and malformed values", () => {
    for (const value of [null, undefined, 1, {}, "not-an-email", "", " x@y.co"]) {
      expect(canonicalizeEmail(value)).toBeNull();
    }
  });
});

describe("AdmissionError", () => {
  test("exposes stable codes with generic messages and no cause", () => {
    for (const code of ["DENIED", "RATE_LIMITED", "DELIVERY_FAILED", "INTERNAL"] as const) {
      const error = new AdmissionError(code);
      expect(error.code).toBe(code);
      expect(error.cause).toBeUndefined();
      expect(error.message.length).toBeGreaterThan(0);
      expect(error.message).not.toContain("CANARY");
    }
  });
});

// ─── status ────────────────────────────────────────────────────

describe("status", () => {
  test("reports unavailable for a missing singleton", async () => {
    const { service } = makeService();
    expect(await service.status()).toEqual({ setupAvailable: false, emailDeliveryAvailable: true });
  });

  test("tracks the pending/invite_only state", async () => {
    const { fake, service } = makeService();
    seedPending(fake);
    expect(await service.status()).toEqual({ setupAvailable: true, emailDeliveryAvailable: true });
    seedInviteOnly(fake);
    expect(await service.status()).toEqual({ setupAvailable: false, emailDeliveryAvailable: true });
  });
});

// ─── mintSetupToken ────────────────────────────────────────────

describe("mintSetupToken", () => {
  test("mints a 256-bit base64url secret, bumps the generation and audits", async () => {
    const { fake, service } = makeService();
    seedPending(fake);

    const minted = await service.mintSetupToken();

    expect(minted.generation).toBe(1);
    expect(minted.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(minted.expiresAt.getTime()).toBe(fake.clock.getTime() + 24 * 60 * 60 * 1000);
    expect(fake.singleton?.setup_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(fake.singleton?.setup_token_hash).not.toContain(minted.token);
    expect(fake.events.map((event) => event.event_type)).toEqual(["setup_token_minted"]);
    expect(fake.events[0]?.actor_user_id).toBeNull();
  });

  test("rotates by clearing prior setup grants but keeping invitations", async () => {
    const { fake, service } = makeService();
    seedPending(fake);
    fake.grants.set("setup-old", { id: "setup-old", kind: "setup", generation: 1 });
    fake.grants.set("invite-1", { id: "invite-1", kind: "invitation", generation: null });

    await service.mintSetupToken();

    expect(fake.grants.has("setup-old")).toBe(false);
    expect(fake.grants.has("invite-1")).toBe(true);
  });

  test("denies when any global administrator exists, banned or not", async () => {
    const { fake, service } = makeService();
    seedPending(fake);
    addUser(fake, "banned-admin", "b@example.test", "admin", { banned: true });
    await expect(service.mintSetupToken()).rejects.toMatchObject({ code: "DENIED" });
  });

  test("denies a non-pending instance and a missing row", async () => {
    const { fake, service } = makeService();
    seedInviteOnly(fake);
    await expect(service.mintSetupToken()).rejects.toMatchObject({ code: "DENIED" });

    const { service: bare } = makeService();
    await expect(bare.mintSetupToken()).rejects.toMatchObject({ code: "DENIED" });
  });
});

// ─── begin(setup) ──────────────────────────────────────────────

describe("without email delivery (#63)", () => {
  test("status reports it, and begin refuses before writing or sending anything", async () => {
    const { fake, service, verifications } = makeService({ emailDeliveryAvailable: false });
    seedPending(fake);
    expect(await service.status()).toEqual({
      setupAvailable: true,
      emailDeliveryAvailable: false,
    });
    const minted = await service.mintSetupToken();
    const before = fake.grants.size;

    await expect(
      service.begin({ kind: "setup", credential: minted.token, email: "owner@example.test" }),
    ).rejects.toMatchObject({ code: "EMAIL_UNAVAILABLE" });
    expect(fake.grants.size).toBe(before);
    expect(verifications).toHaveLength(0);
  });

  test("issueInvitation refuses before creating a grant", async () => {
    const { fake, service, invitations } = makeService({ emailDeliveryAvailable: false });
    seedInviteOnly(fake);
    addUser(fake, "admin-1", "admin@example.test", "admin");
    await expect(
      service.issueInvitation({ email: "invitee@example.test" }, sessionFor("admin-1")),
    ).rejects.toMatchObject({ code: "EMAIL_UNAVAILABLE" });
    expect(fake.grants.size).toBe(0);
    expect(invitations).toHaveLength(0);
  });
});

describe("begin(setup)", () => {
  test("reserves one canonical email and delivers a proof code", async () => {
    const { fake, service, verifications } = makeService();
    seedPending(fake);
    const minted = await service.mintSetupToken();

    const result = await service.begin({
      kind: "setup",
      credential: minted.token,
      email: "New@Example.test",
    });

    expect(result.enrollmentId).toMatch(/^[0-9a-f-]{36}$/);
    expect(verifications).toHaveLength(1);
    expect(verifications[0]).toMatchObject({ kind: "setup", email: "new@example.test" });
    const grant = fake.grants.get(result.enrollmentId);
    expect(grant?.canonical_email).toBe("new@example.test");
    expect(grant?.verification_code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(grant?.verification_attempts).toBe(0);
    expect(grant?.send_count).toBe(1);
    expect(String(verifications[0]?.verificationCode)).toHaveLength(22);
  });

  test("never calls delivery for a wrong bearer and stores no grant", async () => {
    const { fake, service, verifications } = makeService();
    seedPending(fake);
    await service.mintSetupToken();

    await expect(
      service.begin({ kind: "setup", credential: CANARY, email: "new@example.test" }),
    ).rejects.toMatchObject({ code: "DENIED" });
    expect(verifications).toHaveLength(0);
    expect(fake.grants.size).toBe(0);
  });

  test("denies an expired setup token", async () => {
    const { fake, service } = makeService();
    seedPending(fake);
    const minted = await service.mintSetupToken();
    fake.clock = new Date(fake.clock.getTime() + 25 * 60 * 60 * 1000);

    await expect(
      service.begin({ kind: "setup", credential: minted.token, email: "new@example.test" }),
    ).rejects.toMatchObject({ code: "DENIED" });
  });

  test("rebegins the same email with a fresh code and no attempt reset", async () => {
    const { fake, service, verifications } = makeService();
    seedPending(fake);
    const minted = await service.mintSetupToken();
    const first = await service.begin({
      kind: "setup",
      credential: minted.token,
      email: "new@example.test",
    });
    const firstGrant = fake.grants.get(first.enrollmentId);
    if (firstGrant) firstGrant.verification_attempts = 2;

    const second = await service.begin({
      kind: "setup",
      credential: minted.token,
      email: "new@example.test",
    });

    expect(second.enrollmentId).toBe(first.enrollmentId);
    const grant = fake.grants.get(first.enrollmentId);
    expect(grant?.send_count).toBe(2);
    expect(grant?.verification_attempts).toBe(2);
    expect(verifications).toHaveLength(2);
  });

  test("denies rebeginning with a different email for the same generation", async () => {
    const { fake, service } = makeService();
    seedPending(fake);
    const minted = await service.mintSetupToken();
    await service.begin({ kind: "setup", credential: minted.token, email: "one@example.test" });

    await expect(
      service.begin({ kind: "setup", credential: minted.token, email: "two@example.test" }),
    ).rejects.toMatchObject({ code: "DENIED" });
  });

  test("rate-limits after three sends within the window", async () => {
    const { fake, service } = makeService();
    seedPending(fake);
    const minted = await service.mintSetupToken();
    for (let index = 0; index < 3; index += 1) {
      await service.begin({ kind: "setup", credential: minted.token, email: "new@example.test" });
    }
    await expect(
      service.begin({ kind: "setup", credential: minted.token, email: "new@example.test" }),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });
});

// ─── begin(invitation) ─────────────────────────────────────────

describe("begin(invitation)", () => {
  test("never calls delivery for an unknown bearer", async () => {
    const { fake, service, verifications } = makeService();
    seedInviteOnly(fake);
    await expect(
      service.begin({ kind: "invitation", credential: CANARY, email: "new@example.test" }),
    ).rejects.toMatchObject({ code: "DENIED" });
    expect(verifications).toHaveLength(0);
  });

  test("binds a new-account target on first issuance and denies a wrong recipient", async () => {
    const { fake, service, invitations } = makeService();
    seedInviteOnly(fake);
    addUser(fake, "admin-1", "admin@example.test", "admin");
    const issued = await service.issueInvitation(
      { email: "invitee@example.test" },
      sessionFor("admin-1"),
    );
    const token = String(invitations[0]?.invitationToken);

    await expect(
      service.begin({ kind: "invitation", credential: token, email: "other@example.test" }),
    ).rejects.toMatchObject({ code: "DENIED" });

    const begun = await service.begin({
      kind: "invitation",
      credential: token,
      email: "invitee@example.test",
    });
    expect(begun.enrollmentId).toBe(issued.invitationId);
  });
});

// ─── complete(invitation) ──────────────────────────────────────

describe("complete(invitation)", () => {
  test("consumes an invitation for a new account as a plain user", async () => {
    const { fake, service, invitations, verifications } = makeService();
    seedInviteOnly(fake);
    addUser(fake, "admin-1", "admin@example.test", "admin");
    const issued = await service.issueInvitation(
      { email: "invitee@example.test" },
      sessionFor("admin-1"),
    );
    const token = String(invitations[0]?.invitationToken);
    const begun = await service.begin({
      kind: "invitation",
      credential: token,
      email: "invitee@example.test",
    });
    const code = String(verifications[0]?.verificationCode);

    const done = await service.complete(
      { enrollmentId: begun.enrollmentId, credential: token, verificationCode: code },
      null,
    );

    expect(done).toEqual({ completed: true });
    const created = [...fake.users.values()].find((user) => user.email === "invitee@example.test");
    expect(created?.role).toBe("user");
    expect(fake.grants.get(issued.invitationId)?.consumed_at).toBeTruthy();
  });

  test("requires a matching live session for an existing invitation target", async () => {
    const { fake, service, invitations, verifications } = makeService();
    seedInviteOnly(fake);
    addUser(fake, "admin-1", "admin@example.test", "admin");
    addUser(fake, "existing-1", "Existing@Example.test", "user");
    const issued = await service.issueInvitation(
      { email: "existing@example.test" },
      sessionFor("admin-1"),
    );
    const token = String(invitations[0]?.invitationToken);
    const begun = await service.begin({
      kind: "invitation",
      credential: token,
      email: "existing@example.test",
    });
    const code = String(verifications[0]?.verificationCode);
    const input = {
      enrollmentId: begun.enrollmentId,
      credential: token,
      verificationCode: code,
    };
    const attempts = () => fake.grants.get(begun.enrollmentId)?.verification_attempts;

    // A raw bearer + code with no session must not consume an existing target.
    await expect(service.complete(input, null)).rejects.toMatchObject({ code: "DENIED" });
    await expect(service.complete(input, sessionFor("someone-else"))).rejects.toMatchObject({
      code: "DENIED",
    });
    await expect(
      service.complete(input, sessionFor("existing-1", { impersonatedBy: "admin-1" })),
    ).rejects.toMatchObject({ code: "DENIED" });
    await expect(
      service.complete(
        input,
        sessionFor("existing-1", { expiresAt: new Date("2020-01-01T00:00:00.000Z") }),
      ),
    ).rejects.toMatchObject({ code: "DENIED" });

    // A valid proof denied by the session check consumes no attempt, no grant,
    // no role mutation and no audit row.
    expect(attempts()).toBe(0);
    expect(fake.grants.get(begun.enrollmentId)?.consumed_at).toBeFalsy();
    expect(fake.users.get("existing-1")?.role).toBe("user");
    expect(fake.events.map((event) => event.event_type)).not.toContain("admission_completed");

    const done = await service.complete(input, sessionFor("existing-1"));
    expect(done).toEqual({ completed: true });
    expect(fake.grants.get(issued.invitationId)?.consumed_at).toBeTruthy();
    expect(fake.users.get("existing-1")?.role).toBe("user");
    expect(fake.events.map((event) => event.event_type)).toContain("admission_completed");
  });
});

// ─── complete(setup) ───────────────────────────────────────────

describe("complete(setup)", () => {
  test("creates the first admin, consumes the grant, closes setup and audits atomically", async () => {
    const { fake, service, verifications } = makeService();
    seedPending(fake);
    const minted = await service.mintSetupToken();
    const begun = await service.begin({
      kind: "setup",
      credential: minted.token,
      email: "New@Example.test",
    });
    const code = String(verifications[0]?.verificationCode);

    const result = await service.complete(
      { enrollmentId: begun.enrollmentId, credential: minted.token, verificationCode: code },
      null,
    );

    expect(result).toEqual({ completed: true });
    const created = [...fake.users.values()][0];
    expect(created?.role).toBe("admin");
    expect(created?.email).toBe("new@example.test");
    expect(created?.email_verified).toBe(true);
    expect(fake.grants.get(begun.enrollmentId)?.consumed_at).toBeTruthy();
    expect(fake.singleton?.state).toBe("invite_only");
    expect(fake.singleton?.setup_token_hash).toBeNull();
    expect(fake.events.map((event) => event.event_type)).toContain("setup_completed");
  });

  test("commits a wrong proof attempt then denies, without consuming the grant", async () => {
    const { fake, service } = makeService();
    seedPending(fake);
    const minted = await service.mintSetupToken();
    const begun = await service.begin({
      kind: "setup",
      credential: minted.token,
      email: "new@example.test",
    });
    const before = fake.committed;

    await expect(
      service.complete(
        { enrollmentId: begun.enrollmentId, credential: minted.token, verificationCode: CANARY },
        null,
      ),
    ).rejects.toMatchObject({ code: "DENIED" });

    expect(fake.committed).toBe(before + 1);
    expect(fake.grants.get(begun.enrollmentId)?.verification_attempts).toBe(1);
    expect(fake.grants.get(begun.enrollmentId)?.consumed_at).toBeFalsy();
    expect(fake.users.size).toBe(0);
  });

  test("a wrong bearer does not consume a proof attempt", async () => {
    const { fake, service, verifications } = makeService();
    seedPending(fake);
    const minted = await service.mintSetupToken();
    const begun = await service.begin({
      kind: "setup",
      credential: minted.token,
      email: "new@example.test",
    });
    const code = String(verifications[0]?.verificationCode);

    await expect(
      service.complete(
        { enrollmentId: begun.enrollmentId, credential: CANARY, verificationCode: code },
        null,
      ),
    ).rejects.toMatchObject({ code: "DENIED" });

    expect(fake.grants.get(begun.enrollmentId)?.verification_attempts).toBe(0);
  });

  test("denies once five proof attempts are exhausted", async () => {
    const { fake, service, verifications } = makeService();
    seedPending(fake);
    const minted = await service.mintSetupToken();
    const begun = await service.begin({
      kind: "setup",
      credential: minted.token,
      email: "new@example.test",
    });
    const code = String(verifications[0]?.verificationCode);
    const grant = fake.grants.get(begun.enrollmentId);
    if (grant) grant.verification_attempts = 5;

    await expect(
      service.complete(
        { enrollmentId: begun.enrollmentId, credential: minted.token, verificationCode: code },
        null,
      ),
    ).rejects.toMatchObject({ code: "DENIED" });
  });

  test("denies when a new account appears after issuance", async () => {
    const { fake, service, verifications } = makeService();
    seedPending(fake);
    const minted = await service.mintSetupToken();
    const begun = await service.begin({
      kind: "setup",
      credential: minted.token,
      email: "new@example.test",
    });
    const code = String(verifications[0]?.verificationCode);
    addUser(fake, "late-user", "new@example.test", "user");

    await expect(
      service.complete(
        { enrollmentId: begun.enrollmentId, credential: minted.token, verificationCode: code },
        null,
      ),
    ).rejects.toMatchObject({ code: "DENIED" });
  });

  test("promotes an existing verified target only with a matching live session", async () => {
    const { fake, service, verifications } = makeService();
    seedPending(fake);
    addUser(fake, "target-1", "Target@Example.test", "user");
    const minted = await service.mintSetupToken();
    const begun = await service.begin({
      kind: "setup",
      credential: minted.token,
      email: "target@example.test",
    });
    const code = String(verifications[0]?.verificationCode);

    await expect(
      service.complete(
        { enrollmentId: begun.enrollmentId, credential: minted.token, verificationCode: code },
        sessionFor("someone-else"),
      ),
    ).rejects.toMatchObject({ code: "DENIED" });

    await expect(
      service.complete(
        { enrollmentId: begun.enrollmentId, credential: minted.token, verificationCode: code },
        sessionFor("target-1", { impersonatedBy: "admin-1" }),
      ),
    ).rejects.toMatchObject({ code: "DENIED" });

    await expect(
      service.complete(
        { enrollmentId: begun.enrollmentId, credential: minted.token, verificationCode: code },
        sessionFor("target-1", { expiresAt: new Date("2020-01-01T00:00:00.000Z") }),
      ),
    ).rejects.toMatchObject({ code: "DENIED" });

    // A valid proof rejected for a session mismatch consumes no attempt or grant.
    expect(fake.grants.get(begun.enrollmentId)?.verification_attempts).toBe(0);
    expect(fake.grants.get(begun.enrollmentId)?.consumed_at).toBeFalsy();

    const done = await service.complete(
      { enrollmentId: begun.enrollmentId, credential: minted.token, verificationCode: code },
      sessionFor("target-1"),
    );
    expect(done).toEqual({ completed: true });
    expect(fake.users.get("target-1")?.role).toBe("admin");
  });

  test("denies an existing but unverified target", async () => {
    const { fake, service, verifications } = makeService();
    seedPending(fake);
    addUser(fake, "target-1", "target@example.test", "user", { email_verified: false });
    const minted = await service.mintSetupToken();
    const begun = await service.begin({
      kind: "setup",
      credential: minted.token,
      email: "target@example.test",
    });
    const code = String(verifications[0]?.verificationCode);

    await expect(
      service.complete(
        { enrollmentId: begun.enrollmentId, credential: minted.token, verificationCode: code },
        sessionFor("target-1"),
      ),
    ).rejects.toMatchObject({ code: "DENIED" });
  });

  test("denies a replayed completion", async () => {
    const { fake, service, verifications } = makeService();
    seedPending(fake);
    const minted = await service.mintSetupToken();
    const begun = await service.begin({
      kind: "setup",
      credential: minted.token,
      email: "new@example.test",
    });
    const code = String(verifications[0]?.verificationCode);
    await service.complete(
      { enrollmentId: begun.enrollmentId, credential: minted.token, verificationCode: code },
      null,
    );

    await expect(
      service.complete(
        { enrollmentId: begun.enrollmentId, credential: minted.token, verificationCode: code },
        null,
      ),
    ).rejects.toMatchObject({ code: "DENIED" });
  });

  test("denies a proof that expired while queued, with no consume/attempt/user", async () => {
    const { fake, service, verifications } = makeService();
    seedPending(fake);
    const minted = await service.mintSetupToken();
    const begun = await service.begin({
      kind: "setup",
      credential: minted.token,
      email: "queued@example.test",
    });
    const code = String(verifications[0]?.verificationCode);
    // The proof window is 10 minutes; advance past it while "queued".
    fake.clock = new Date(fake.clock.getTime() + 11 * 60 * 1000);

    await expect(
      service.complete(
        { enrollmentId: begun.enrollmentId, credential: minted.token, verificationCode: code },
        null,
      ),
    ).rejects.toMatchObject({ code: "DENIED" });

    expect(fake.grants.get(begun.enrollmentId)?.verification_attempts).toBe(0);
    expect(fake.grants.get(begun.enrollmentId)?.consumed_at).toBeFalsy();
    expect(fake.users.size).toBe(0);
    expect(fake.events.map((event) => event.event_type)).not.toContain("setup_completed");
  });

  test("denies a grant that expired while queued", async () => {
    const { fake, service, verifications } = makeService();
    seedPending(fake);
    const minted = await service.mintSetupToken();
    const begun = await service.begin({
      kind: "setup",
      credential: minted.token,
      email: "queued2@example.test",
    });
    const code = String(verifications[0]?.verificationCode);
    // The setup grant expires with the 24h token.
    fake.clock = new Date(fake.clock.getTime() + 25 * 60 * 60 * 1000);

    await expect(
      service.complete(
        { enrollmentId: begun.enrollmentId, credential: minted.token, verificationCode: code },
        null,
      ),
    ).rejects.toMatchObject({ code: "DENIED" });
    expect(fake.users.size).toBe(0);
    expect(fake.grants.get(begun.enrollmentId)?.consumed_at).toBeFalsy();
  });

  test("respects the singleton → grant → email → user lock order", async () => {
    const { fake, service, verifications } = makeService();
    seedPending(fake);
    const minted = await service.mintSetupToken();
    const begun = await service.begin({
      kind: "setup",
      credential: minted.token,
      email: "new@example.test",
    });
    const code = String(verifications[0]?.verificationCode);
    fake.queries.length = 0;

    await service.complete(
      { enrollmentId: begun.enrollmentId, credential: minted.token, verificationCode: code },
      null,
    );

    const texts = fake.queries.map((query) => query.text);
    const singleton = texts.findIndex((text) => text.includes('from "instance_admission"'));
    const grant = texts.findIndex((text) => text.includes('from "admission_grant" where "id" ='));
    const email = texts.findIndex((text) => text.includes("pg_advisory_xact_lock"));
    const users = texts.findIndex((text) => text.includes('from "user" where lower("email")'));
    expect(singleton).toBeGreaterThanOrEqual(0);
    expect(grant).toBeGreaterThan(singleton);
    expect(email).toBeGreaterThan(grant);
    expect(users).toBeGreaterThan(email);
  });
});

// ─── issue / revoke / list ─────────────────────────────────────

describe("issueInvitation", () => {
  test("requires a fresh, non-impersonated administrator session", async () => {
    const { fake, service } = makeService();
    seedInviteOnly(fake);
    addUser(fake, "member-1", "member@example.test", "user");

    await expect(
      service.issueInvitation({ email: "x@example.test" }, sessionFor("member-1")),
    ).rejects.toMatchObject({ code: "DENIED" });
    await expect(service.issueInvitation({ email: "x@example.test" }, null)).rejects.toMatchObject({
      code: "DENIED",
    });
  });

  test("creates a hashed invitation, audits it and delivers the bearer once", async () => {
    const { fake, service, invitations } = makeService();
    seedInviteOnly(fake);
    addUser(fake, "admin-1", "admin@example.test", "admin");

    const issued = await service.issueInvitation(
      { email: "Invitee@Example.test" },
      sessionFor("admin-1"),
    );

    expect(issued.invitationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(issued.expiresAt.getTime()).toBe(fake.clock.getTime() + 2 * 24 * 60 * 60 * 1000);
    expect(invitations).toHaveLength(1);
    expect(invitations[0]?.email).toBe("invitee@example.test");
    const token = String(invitations[0]?.invitationToken);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const grant = fake.grants.get(issued.invitationId);
    expect(grant?.invitation_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(grant?.invitation_token_hash).not.toContain(token);
    expect(grant?.generation).toBeNull();
    expect(fake.events.map((event) => event.event_type)).toContain("admission_invitation_issued");
  });

  test("denies an ambiguous canonical identity", async () => {
    const { fake, service } = makeService();
    seedInviteOnly(fake);
    addUser(fake, "admin-1", "admin@example.test", "admin");
    addUser(fake, "dup-1", "dup@example.test", "user");
    addUser(fake, "dup-2", "DUP@example.test", "user");

    await expect(
      service.issueInvitation({ email: "dup@example.test" }, sessionFor("admin-1")),
    ).rejects.toMatchObject({ code: "DENIED" });
  });

  test("maps a delivery failure to DELIVERY_FAILED and keeps the grant", async () => {
    const fake = new FakeAdmissionDb();
    seedInviteOnly(fake);
    addUser(fake, "admin-1", "admin@example.test", "admin");
    const service = createAdmissionService({
      db: fake as unknown as Database,
      deliverVerification: async () => {},
      deliverInvitation: async () => {
        throw new Error(`provider blew up: ${CANARY}`);
      },
    });

    await expect(
      service.issueInvitation({ email: "invitee@example.test" }, sessionFor("admin-1")),
    ).rejects.toMatchObject({ code: "DELIVERY_FAILED" });
    expect(fake.grants.size).toBe(1);
  });
});

describe("revokeInvitation", () => {
  test("deletes a pending invitation and records the event", async () => {
    const { fake, service } = makeService();
    seedInviteOnly(fake);
    addUser(fake, "admin-1", "admin@example.test", "admin");
    const issued = await service.issueInvitation(
      { email: "invitee@example.test" },
      sessionFor("admin-1"),
    );

    const result = await service.revokeInvitation(
      { invitationId: issued.invitationId },
      sessionFor("admin-1"),
    );

    expect(result).toEqual({ revoked: true });
    expect(fake.grants.has(issued.invitationId)).toBe(false);
    expect(fake.events.map((event) => event.event_type)).toContain("admission_invitation_revoked");
  });

  test("returns revoked:false for an unknown or consumed invitation", async () => {
    const { fake, service } = makeService();
    seedInviteOnly(fake);
    addUser(fake, "admin-1", "admin@example.test", "admin");

    expect(
      await service.revokeInvitation({ invitationId: "missing" }, sessionFor("admin-1")),
    ).toEqual({ revoked: false });

    const issued = await service.issueInvitation(
      { email: "invitee@example.test" },
      sessionFor("admin-1"),
    );
    const grant = fake.grants.get(issued.invitationId);
    if (grant) grant.consumed_at = fake.clock;
    expect(
      await service.revokeInvitation({ invitationId: issued.invitationId }, sessionFor("admin-1")),
    ).toEqual({ revoked: false });
  });

  test("denies a non-administrator", async () => {
    const { fake, service } = makeService();
    seedInviteOnly(fake);
    addUser(fake, "member-1", "member@example.test", "user");
    await expect(
      service.revokeInvitation({ invitationId: "x" }, sessionFor("member-1")),
    ).rejects.toMatchObject({ code: "DENIED" });
  });

  test("re-checks the live session only after the grant lock", async () => {
    const { fake, service } = makeService();
    seedInviteOnly(fake);
    addUser(fake, "admin-1", "admin@example.test", "admin");
    const issued = await service.issueInvitation(
      { email: "invitee@example.test" },
      sessionFor("admin-1"),
    );
    fake.queries.length = 0;

    await service.revokeInvitation({ invitationId: issued.invitationId }, sessionFor("admin-1"));

    const texts = fake.queries.map((query) => query.text);
    const grantLock = texts.findIndex((text) =>
      text.includes('from "admission_grant" where "id" ='),
    );
    const clock = texts.findIndex((text) => text.includes("clock_timestamp"));
    expect(grantLock).toBeGreaterThanOrEqual(0);
    expect(clock).toBeGreaterThan(grantLock);
  });
});

describe("listInvitations", () => {
  test("returns only safe fields with derived status", async () => {
    const { fake, service } = makeService();
    seedInviteOnly(fake);
    addUser(fake, "admin-1", "admin@example.test", "admin");
    const issued = await service.issueInvitation(
      { email: "invitee@example.test" },
      sessionFor("admin-1"),
    );

    const listed = await service.listInvitations(sessionFor("admin-1"));

    expect(listed).toHaveLength(1);
    expect(listed[0]).toEqual({
      id: issued.invitationId,
      email: "invitee@example.test",
      expiresAt: issued.expiresAt,
      consumedAt: null,
      status: "pending",
    });
    expect(JSON.stringify(listed)).not.toContain("hash");
    expect(JSON.stringify(listed)).not.toContain("token");
  });

  test("denies a non-administrator and a missing session", async () => {
    const { fake, service } = makeService();
    seedInviteOnly(fake);
    addUser(fake, "member-1", "member@example.test", "user");
    await expect(service.listInvitations(sessionFor("member-1"))).rejects.toMatchObject({
      code: "DENIED",
    });
    await expect(service.listInvitations(null)).rejects.toMatchObject({ code: "DENIED" });
  });
});

describe("session expiry is authoritative for admin operations", () => {
  test("issue/revoke/list deny an expired or malformed session with no side effects", async () => {
    const { fake, service } = makeService();
    seedInviteOnly(fake);
    addUser(fake, "admin-1", "admin@example.test", "admin");

    const expired = sessionFor("admin-1", { expiresAt: new Date("2020-01-01T00:00:00.000Z") });
    await expect(
      service.issueInvitation({ email: "x@example.test" }, expired),
    ).rejects.toMatchObject({ code: "DENIED" });
    await expect(service.revokeInvitation({ invitationId: "x" }, expired)).rejects.toMatchObject({
      code: "DENIED",
    });
    await expect(service.listInvitations(expired)).rejects.toMatchObject({ code: "DENIED" });
    expect(fake.grants.size).toBe(0);
    expect(fake.events).toHaveLength(0);

    // A missing/invalid expiresAt date field is also a denial.
    const noExpiry = {
      user: { id: "admin-1", email: "admin@example.test", name: null },
      session: { id: "s", userId: "admin-1", impersonatedBy: null },
    } as unknown as Session;
    await expect(
      service.issueInvitation({ email: "x@example.test" }, noExpiry),
    ).rejects.toMatchObject({ code: "DENIED" });
    await expect(service.listInvitations(noExpiry)).rejects.toMatchObject({ code: "DENIED" });

    // A live session still works.
    expect(await service.listInvitations(sessionFor("admin-1"))).toEqual([]);
    const issued = await service.issueInvitation(
      { email: "ok@example.test" },
      sessionFor("admin-1"),
    );
    expect(
      await service.revokeInvitation({ invitationId: issued.invitationId }, sessionFor("admin-1")),
    ).toEqual({ revoked: true });
  });
});

// ─── prune ─────────────────────────────────────────────────────

describe("pruneExpiredGrants", () => {
  test("prunes expired grants of any state, retains unexpired, and clamps the bound", async () => {
    const { fake, service } = makeService();
    seedInviteOnly(fake);
    fake.grants.set("expired-pending", {
      id: "expired-pending",
      kind: "invitation",
      consumed_at: null,
      expires_at: new Date("2025-01-01T00:00:00.000Z"),
    });
    fake.grants.set("expired-consumed", {
      id: "expired-consumed",
      kind: "invitation",
      consumed_at: new Date("2025-01-01T00:00:00.000Z"),
      expires_at: new Date("2025-01-01T00:00:00.000Z"),
    });
    fake.grants.set("live-consumed", {
      id: "live-consumed",
      kind: "invitation",
      consumed_at: new Date("2026-01-01T00:00:00.000Z"),
      expires_at: new Date("2030-01-01T00:00:00.000Z"),
    });
    fake.grants.set("live-pending", {
      id: "live-pending",
      kind: "invitation",
      consumed_at: null,
      expires_at: new Date("2030-01-01T00:00:00.000Z"),
    });

    const result = await service.pruneExpiredGrants({ limit: 10_000 });

    expect(result.pruned).toBe(2);
    expect(fake.grants.has("expired-pending")).toBe(false);
    expect(fake.grants.has("expired-consumed")).toBe(false);
    expect(fake.grants.has("live-consumed")).toBe(true);
    expect(fake.grants.has("live-pending")).toBe(true);
    const pruneQuery = fake.queries.find((query) => query.text.includes("returning"));
    expect(Number(pruneQuery?.params[0])).toBe(500);
  });
});

// ─── finding A: invalid expiresAt dates are denied ─────────────

describe("invalid expiresAt dates are denied everywhere", () => {
  test("issue/revoke/list deny an invalid Date expiry with no grant or event", async () => {
    const { fake, service } = makeService();
    seedInviteOnly(fake);
    addUser(fake, "admin-1", "admin@example.test", "admin");
    const invalid = sessionWithRawExpiry("admin-1", new Date(Number.NaN));

    await expect(
      service.issueInvitation({ email: "x@example.test" }, invalid),
    ).rejects.toMatchObject({ code: "DENIED" });
    await expect(service.revokeInvitation({ invitationId: "x" }, invalid)).rejects.toMatchObject({
      code: "DENIED",
    });
    await expect(service.listInvitations(invalid)).rejects.toMatchObject({ code: "DENIED" });
    expect(fake.grants.size).toBe(0);
    expect(fake.events).toHaveLength(0);
  });

  test("complete denies an invalid Date expiry for a setup existing target", async () => {
    const { fake, service, verifications } = makeService();
    seedPending(fake);
    addUser(fake, "target-1", "target@example.test", "user");
    const minted = await service.mintSetupToken();
    const begun = await service.begin({
      kind: "setup",
      credential: minted.token,
      email: "target@example.test",
    });
    const code = String(verifications[0]?.verificationCode);

    await expect(
      service.complete(
        { enrollmentId: begun.enrollmentId, credential: minted.token, verificationCode: code },
        sessionWithRawExpiry("target-1", new Date(Number.NaN)),
      ),
    ).rejects.toMatchObject({ code: "DENIED" });

    expect(fake.grants.get(begun.enrollmentId)?.verification_attempts).toBe(0);
    expect(fake.grants.get(begun.enrollmentId)?.consumed_at).toBeFalsy();
    expect(fake.users.get("target-1")?.role).toBe("user");
    expect(fake.events.map((event) => event.event_type)).not.toContain("setup_completed");
  });

  test("complete denies an invalid Date expiry for an invitation existing target", async () => {
    const { fake, service, invitations, verifications } = makeService();
    seedInviteOnly(fake);
    addUser(fake, "admin-1", "admin@example.test", "admin");
    addUser(fake, "existing-1", "existing@example.test", "user");
    await service.issueInvitation({ email: "existing@example.test" }, sessionFor("admin-1"));
    const token = String(invitations[0]?.invitationToken);
    const begun = await service.begin({
      kind: "invitation",
      credential: token,
      email: "existing@example.test",
    });
    const code = String(verifications[0]?.verificationCode);

    await expect(
      service.complete(
        { enrollmentId: begun.enrollmentId, credential: token, verificationCode: code },
        sessionWithRawExpiry("existing-1", new Date(Number.NaN)),
      ),
    ).rejects.toMatchObject({ code: "DENIED" });

    expect(fake.grants.get(begun.enrollmentId)?.consumed_at).toBeFalsy();
    expect(fake.users.get("existing-1")?.role).toBe("user");
    expect(fake.events.map((event) => event.event_type)).not.toContain("admission_completed");
  });

  test("valid live sessions still issue, list, revoke and complete", async () => {
    const { fake, service, invitations, verifications } = makeService();
    seedInviteOnly(fake);
    addUser(fake, "admin-1", "admin@example.test", "admin");
    addUser(fake, "existing-1", "existing@example.test", "user");

    const issued = await service.issueInvitation(
      { email: "existing@example.test" },
      sessionFor("admin-1"),
    );
    expect(await service.listInvitations(sessionFor("admin-1"))).toHaveLength(1);

    const token = String(invitations[0]?.invitationToken);
    const begun = await service.begin({
      kind: "invitation",
      credential: token,
      email: "existing@example.test",
    });
    const code = String(verifications[0]?.verificationCode);
    expect(
      await service.complete(
        { enrollmentId: begun.enrollmentId, credential: token, verificationCode: code },
        sessionFor("existing-1"),
      ),
    ).toEqual({ completed: true });

    const second = await service.issueInvitation(
      { email: "revoke-me@example.test" },
      sessionFor("admin-1"),
    );
    expect(
      await service.revokeInvitation({ invitationId: second.invitationId }, sessionFor("admin-1")),
    ).toEqual({ revoked: true });
    expect(issued.invitationId).toBe(begun.enrollmentId);
  });
});

// ─── hardening ─────────────────────────────────────────────────

describe("hardening", () => {
  test("never leaks credentials, codes or emails through errors", async () => {
    const { fake, service } = makeService();
    seedPending(fake);
    const minted = await service.mintSetupToken();

    let error: unknown;
    try {
      await service.begin({ kind: "setup", credential: CANARY, email: "new@example.test" });
    } catch (caught) {
      error = caught;
    }
    const serialised = `${(error as Error).message} ${JSON.stringify(error)} ${(error as Error).stack ?? ""}`;
    expect(serialised).not.toContain(CANARY);
    expect(serialised).not.toContain(minted.token);

    let emailError: unknown;
    try {
      await service.begin({ kind: "setup", credential: minted.token, email: CANARY });
    } catch (caught) {
      emailError = caught;
    }
    expect(String((emailError as Error).message)).not.toContain(CANARY);
  });

  test("rejects malformed raw input without a raw TypeError", async () => {
    const { service } = makeService();
    const raw = service as unknown as {
      begin: (input: unknown) => Promise<unknown>;
      complete: (input: unknown, session: unknown) => Promise<unknown>;
      issueInvitation: (input: unknown, session: unknown) => Promise<unknown>;
      revokeInvitation: (input: unknown, session: unknown) => Promise<unknown>;
    };
    await expect(raw.begin(undefined)).rejects.toBeInstanceOf(AdmissionError);
    await expect(
      raw.begin({ kind: "nope", credential: "x", email: "a@b.co" }),
    ).rejects.toBeInstanceOf(AdmissionError);
    await expect(raw.complete(null, null)).rejects.toBeInstanceOf(AdmissionError);
    await expect(raw.issueInvitation(undefined, null)).rejects.toBeInstanceOf(AdmissionError);
    await expect(raw.revokeInvitation(undefined, null)).rejects.toBeInstanceOf(AdmissionError);
  });

  test("the core reads no process environment", async () => {
    for (const file of ["service.ts", "crypto.ts", "email.ts", "errors.ts", "index.ts"]) {
      const source = await Bun.file(new URL(`./${file}`, import.meta.url)).text();
      expect(source).not.toContain("process.env");
    }
  });
});
