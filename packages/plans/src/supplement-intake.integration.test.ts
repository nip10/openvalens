import { readdir } from "node:fs/promises";

import { beforeAll, describe, expect, test } from "bun:test";
import { createDb, sql, type Database } from "@openvalens/db";
import {
  createSupplementIntakeRepository,
  SupplementIntakeConflictError,
  SupplementIntakeMutationConflictError,
  SupplementIntakeNotFoundError,
} from "./supplement-intake";

const url = process.env.SUPPLEMENT_INTAKE_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/supplement_intake_test"
  )
    throw new Error("Empty disposable loopback supplement_intake_test database required.");
}
const ROOT = new URL("../../db/src/migrations/", import.meta.url);
const A = { organizationId: "intake-org-a", userId: "intake-user-a" };
const A2 = { organizationId: "intake-org-a", userId: "intake-user-a2" };
const supplementId = 784231;
const iso = "2026-10-01T12:00:00.000Z";
const uuid = (n: number) => `90000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

async function migrate(db: Database) {
  for (const directory of (await readdir(ROOT)).sort()) {
    if (!/^\d/.test(directory)) continue;
    const migration = Bun.file(new URL(`${directory}/migration.sql`, ROOT));
    if (!(await migration.exists())) continue;
    const content = await migration.text();
    for (const statement of content.split("--> statement-breakpoint"))
      if (statement.trim()) await db.execute(sql.raw(statement));
  }
}

async function expectError<T extends Error>(
  work: () => Promise<unknown>,
  ErrorType: new (...args: never[]) => T,
) {
  try {
    await work();
  } catch (error) {
    expect(error).toBeInstanceOf(ErrorType);
    return;
  }
  throw new Error(`Expected ${ErrorType.name}`);
}

describe.skipIf(!url)("actual supplement intake repository on disposable PostgreSQL", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/supplement_intake_test" });
  const intakeA = createSupplementIntakeRepository(db, A);
  const intakeA2 = createSupplementIntakeRepository(db, A2);

  beforeAll(async () => {
    const tables = await db.execute(
      sql`select tablename from pg_tables where schemaname = 'public'`,
    );
    if (tables.rows.length) throw new Error("Integration database must be empty.");
    await migrate(db);
    await db.execute(
      sql.raw(`
      insert into "user" (id, email) values
        ('intake-user-a', 'intake-a@example.test'), ('intake-user-a2', 'intake-a2@example.test');
      insert into organization (id, name, slug) values ('intake-org-a', 'Intake A', 'intake-a');
      insert into member (id, organization_id, user_id, role) values
        ('intake-member-a', 'intake-org-a', 'intake-user-a', 'owner'),
        ('intake-member-a2', 'intake-org-a', 'intake-user-a2', 'collaborator');
      insert into supplement (id, name) values (${supplementId}, 'Test supplement');
    `),
    );
  });

  test("allows multiple doses on one day and replays create receipts without duplicating", async () => {
    const first = await intakeA.create({
      supplementId,
      occurredAt: iso,
      timeZone: "UTC",
      dose: "1 capsule",
      clientMutationId: uuid(1),
    });
    const replay = await intakeA.create({
      supplementId,
      occurredAt: iso,
      timeZone: "UTC",
      dose: "1 capsule",
      clientMutationId: uuid(1),
    });
    const second = await intakeA.create({
      supplementId,
      occurredAt: "2026-10-01T20:00:00Z",
      timeZone: "UTC",
      dose: "1 capsule",
      clientMutationId: uuid(2),
    });
    expect(replay).toMatchObject({ created: false, intake: { id: first.intake.id } });
    expect(second.intake.id).not.toBe(first.intake.id);
    expect(await intakeA.list()).toHaveLength(2);
    await expectError(
      () =>
        intakeA.create({
          supplementId,
          occurredAt: iso,
          timeZone: "UTC",
          dose: "2 capsules",
          clientMutationId: uuid(1),
        }),
      SupplementIntakeMutationConflictError,
    );
  });

  test("corrections preserve prior rows, enforce versions, and soft-delete", async () => {
    const created = await intakeA.create({
      supplementId,
      occurredAt: iso,
      timeZone: "UTC",
      dose: "1 capsule",
      clientMutationId: uuid(3),
    });
    const edited = await intakeA.update({
      id: created.intake.id,
      version: created.intake.version,
      clientMutationId: uuid(4),
      dose: "2 capsules",
      note: "Corrected entry",
    });
    expect(edited).toMatchObject({ dose: "2 capsules", note: "Corrected entry", version: 2 });
    expect(edited.id).not.toBe(created.intake.id);
    await expectError(
      () =>
        intakeA.update({
          id: edited.id,
          version: 1,
          clientMutationId: uuid(5),
          dose: "3 capsules",
        }),
      SupplementIntakeConflictError,
    );

    const deleted = await intakeA.delete({
      id: edited.id,
      version: edited.version,
      clientMutationId: uuid(6),
    });
    expect(deleted).toMatchObject({ id: edited.id, deleted: true, version: 3 });
    expect((await intakeA.list()).some((row) => row.id === edited.id)).toBe(false);
    expect(
      await intakeA.delete({ id: edited.id, version: edited.version, clientMutationId: uuid(6) }),
    ).toEqual(deleted);
    await expectError(
      () =>
        intakeA.update({
          id: edited.id,
          version: edited.version,
          clientMutationId: uuid(7),
          dose: "4 capsules",
        }),
      SupplementIntakeNotFoundError,
    );
  });

  test("another member in the same organization cannot read or mutate an intake", async () => {
    const created = await intakeA.create({
      supplementId,
      occurredAt: iso,
      timeZone: "UTC",
      dose: "1 capsule",
      clientMutationId: uuid(8),
    });
    expect((await intakeA2.list()).some((row) => row.id === created.intake.id)).toBe(false);
    await expectError(
      () =>
        intakeA2.update({
          id: created.intake.id,
          version: 1,
          clientMutationId: uuid(9),
          dose: "foreign edit",
        }),
      SupplementIntakeNotFoundError,
    );
    await expectError(
      () =>
        intakeA2.delete({
          id: created.intake.id,
          version: 1,
          clientMutationId: uuid(10),
        }),
      SupplementIntakeNotFoundError,
    );
  });
});
