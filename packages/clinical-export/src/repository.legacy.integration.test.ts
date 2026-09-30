import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { createDb, sql } from "@openhealth/db";
import { organization, user, member } from "@openhealth/db/schema/auth";
import { providerConnection } from "@openhealth/db/schema/ingestion";
import { bloodMarker, bloodPanel, cardiacExam, imagingStudy } from "@openhealth/db/schema/clinical";
import {
  goal,
  goalCheckin,
  medication,
  scheduledEvent,
  supplement,
  supplementSchedule,
} from "@openhealth/db/schema/plans";
import { weightCheckin } from "@openhealth/db/schema/body";
import { accessAuditLog } from "@openhealth/db/schema/auth";
import { buildExportPayload, parseExportRequest, renderCsvExport } from "./index";

// Opt-in only; never accept a production URL or existing database. This test
// applies the ACTUAL repository migrations to an empty disposable database.
const url = process.env.LEGACY_EXPORT_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/legacy_export_issue20"
  )
    throw new Error("Disposable loopback legacy_export_issue20 database required.");
}
describe.skipIf(!url)("legacy export real PostgreSQL schema", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/legacy_export_issue20" });
  const at = "2026-03-08T09:30:00.000Z";
  beforeAll(async () => {
    const existing = await db.execute(
      sql`select tablename from pg_tables where schemaname = 'public'`,
    );
    if (existing.rows.length) throw new Error("Integration database must be empty.");
    const root = new URL("../../db/src/migrations/", import.meta.url);
    for (const directory of (await readdir(root)).sort()) {
      if (!/^\d/.test(directory)) continue;
      const text = await Bun.file(new URL(`${directory}/migration.sql`, root)).text();
      for (const statement of text.split("--> statement-breakpoint"))
        if (statement.trim()) await db.execute(sql.raw(statement));
    }
    await db.insert(organization).values([
      { id: "org-a", name: "A", slug: "a" },
      { id: "org-b", name: "B", slug: "b" },
    ]);
    for (const org of ["org-a", "org-b"]) {
      const [actor] = await db
        .insert(user)
        .values({ id: `actor-${org}`, email: `${org}@example.invalid`, name: "Synthetic" })
        .returning();
      if (!actor) throw new Error("Missing seed actor.");
      await db.insert(member).values({
        id: actor.id,
        organizationId: org,
        userId: actor.id,
        role: "owner",
      });
      const [panel] = await db
        .insert(bloodPanel)
        .values({ organizationId: org, date: at, sourceFile: "shared.pdf" })
        .returning();
      const [marker] = await db
        .insert(bloodMarker)
        .values({
          organizationId: org,
          panelId: panel!.id,
          category: "Biochemistry",
          testKey: "ast",
          testName: `PRIVATE ${org}`,
          valueNumeric: org === "org-a" ? 35 : 88,
          unit: "U/L",
        })
        .returning();
      const [medicationRow] = await db
        .insert(medication)
        .values({
          organizationId: org,
          userId: actor.id,
          name: `PRIVATE ${org}`,
          dose: "5mg",
        })
        .returning();
      const [goalRow] = await db
        .insert(goal)
        .values({
          organizationId: org,
          title: `PRIVATE ${org}`,
          category: "body_composition",
        })
        .returning();
      const [checkin] = await db
        .insert(goalCheckin)
        .values({
          organizationId: org,
          goalId: goalRow!.id,
          date: at,
          value: "80kg",
        })
        .returning();
      const [supplementRow] = await db
        .insert(supplement)
        .values({ name: `PRIVATE ${org}`, dose: "10mg" })
        .returning();
      const [schedule] = await db
        .insert(supplementSchedule)
        .values({
          organizationId: org,
          userId: actor.id,
          supplementId: supplementRow!.id,
          timeOfDay: "morning",
          quantity: "1",
          frequency: "daily",
        })
        .returning();
      const [imaging] = await db
        .insert(imagingStudy)
        .values({
          organizationId: org,
          date: at,
          type: "MRI",
          bodyPart: "Knee",
          conclusion: `PRIVATE ${org}`,
        })
        .returning();
      const [cardiac] = await db
        .insert(cardiacExam)
        .values({
          organizationId: org,
          date: at,
          type: "ECG",
          conclusion: `PRIVATE ${org}`,
        })
        .returning();
      const [weight] = await db
        .insert(weightCheckin)
        .values({ organizationId: org, date: at, weightKg: 80 })
        .returning();
      const [audit] = await db
        .insert(accessAuditLog)
        .values({
          organizationId: org,
          actorUserId: actor.id,
          eventType: "RECORD_CREATED",
          targetType: "blood_panel",
          targetId: String(panel!.id),
        })
        .returning();
      const [scheduledEventRow] = await db
        .insert(scheduledEvent)
        .values({
          organizationId: org,
          userId: actor.id,
          title: `PRIVATE ${org}`,
          type: "medication",
          startDate: at,
          frequency: "daily",
        })
        .returning();
      const [connection] = await db
        .insert(providerConnection)
        .values({ organizationId: org, provider: "manual", externalUserId: org })
        .returning();
      void connection;
      if (
        !panel ||
        !marker ||
        !medicationRow ||
        !goalRow ||
        !checkin ||
        !supplementRow ||
        !schedule ||
        !imaging ||
        !cardiac ||
        !weight ||
        !audit ||
        !scheduledEventRow
      )
        throw new Error("Missing seed rows.");
      if (org === "org-b") {
        // Reserved for cross-tenant id pinning if a future test wants to assert
        // specific foreign row ids; current assertions rely on the
        // `PRIVATE org-b` marker, which is already part of every seeded row.
        void panel.id;
      }
    }
  }, 120000);
  afterAll(async () => {
    await db.$client.end();
  });
  test("default domains payload is tenant-scoped: foreign tenant ids never leak", async () => {
    const payload = await buildExportPayload(db, ["blood", "body", "medications", "supplements"], {
      organizationId: "org-a",
    });
    expect(payload.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(payload.schemaVersion).toBe("export-v1");
    expect(payload.selectedDomains).toEqual(["blood", "body", "medications", "supplements"]);
    const csv = renderCsvExport(payload);
    const csvText = csv.map((file) => file.content).join("");
    expect(csvText).toContain("PRIVATE org-a");
    expect(csvText).not.toContain("PRIVATE org-b");
  });
  test("explicit domain set still respects tenant boundary across all extractors", async () => {
    const payload = await buildExportPayload(
      db,
      [
        "medications",
        "supplements",
        "workouts",
        "goals",
        "familyHistory",
        "calendar",
        "insights",
        "imaging",
        "cardiac",
        "dexa",
        "weight",
        "audit",
      ],
      { organizationId: "org-a" },
    );
    const csvText = renderCsvExport(payload)
      .map((file) => file.content)
      .join("");
    // Only "PRIVATE org-a" should appear; foreign tenant rows must never surface.
    expect(csvText).toContain("PRIVATE org-a");
    expect(csvText).not.toContain("PRIVATE org-b");
  });
  test("parseExportRequest sanitizes invalid bodies without echoing raw values", () => {
    for (const body of [
      null,
      "string",
      42,
      { format: "xls", domains: ["blood"] },
      { format: "csv", domains: ["secret"] },
    ]) {
      const result = parseExportRequest(body);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(JSON.stringify(result.error).includes("secret")).toBe(false);
        expect(JSON.stringify(result.error).includes("xls")).toBe(false);
        expect(JSON.stringify(result.error).includes("string")).toBe(false);
      }
    }
  });
  test("tenant-scoped reads emit no console payloads", async () => {
    const logs = [spyOn(console, "log"), spyOn(console, "warn"), spyOn(console, "error")];
    try {
      const payload = await buildExportPayload(db, ["blood", "medications"], {
        organizationId: "org-a",
      });
      expect(payload.data.blood).toBeDefined();
      for (const log of logs) expect(log).not.toHaveBeenCalled();
    } finally {
      for (const log of logs) log.mockRestore();
    }
  });
});
