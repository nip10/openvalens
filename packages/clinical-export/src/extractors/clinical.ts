// Source: anchovy/apps/web/src/lib/export/extractors/clinical.ts
// Clinical / body / weight domain extractors. Every read goes through the
// existing target repositories in `@openhealth/clinical`, `@openhealth/body`,
// and Drizzle tables, each filtered by the active organization id. The package
// does not invent new DB access — the only direct DB queries are simple
// `bloodMarker`-by-`bloodPanel` and `supplement`+`supplementSchedule` joins,
// both already filtered by the target repositories' contracts.
import type { Database } from "@openhealth/db";
import { bloodMarker, bloodPanel, cardiacExam, imagingStudy } from "@openhealth/db/schema/clinical";
import { medication, supplement, supplementSchedule } from "@openhealth/db/schema/plans";
import { weightCheckin } from "@openhealth/db/schema/body";
import { desc, eq, sql } from "drizzle-orm";
import {
  getLatestCanonicalWeight,
  getLatestDexaScan,
  listAllDexaScans,
  listLegacyCheckins,
} from "@openhealth/body";
import type { ExportPayloadDataByDomain } from "../types";
import type { ExportPayloadScope } from "../build-payload";
import { maxIsoDate, selectLatestBodyWeight } from "./body-source";

export async function extractBlood(
  db: Database,
  scope: ExportPayloadScope,
): Promise<ExportPayloadDataByDomain["blood"]> {
  // blood_marker rows are org-scoped; we still join to the panel to surface the
  // recordedAt (panel date) in the export. The join predicate enforces
  // matching org on both sides so a foreign panel id can never surface.
  const rows = await db
    .select({
      markerId: bloodMarker.id,
      panelId: bloodPanel.id,
      panelDate: bloodPanel.date,
      testKey: bloodMarker.testKey,
      testName: bloodMarker.testName,
      valueNumeric: bloodMarker.valueNumeric,
      valueText: bloodMarker.valueText,
      unit: bloodMarker.unit,
      flag: bloodMarker.flag,
    })
    .from(bloodMarker)
    .innerJoin(
      bloodPanel,
      sql`${bloodMarker.panelId} = ${bloodPanel.id} and ${bloodMarker.organizationId} = ${bloodPanel.organizationId}`,
    )
    .where(eq(bloodMarker.organizationId, scope.organizationId))
    .orderBy(desc(bloodPanel.date), desc(bloodPanel.id), desc(bloodMarker.id));

  return rows.map((row) => ({
    recordedAt: row.panelDate,
    markerKey: row.testKey,
    markerName: row.testName,
    value: row.valueNumeric ?? row.valueText,
    unit: row.unit,
    flag: row.flag,
  }));
}

export async function extractBody(
  db: Database,
  scope: ExportPayloadScope,
): Promise<ExportPayloadDataByDomain["body"]> {
  const [latestDexa, latestCanonicalWeight] = await Promise.all([
    getLatestDexaScan(db, scope.organizationId),
    getLatestCanonicalWeight(db, scope.organizationId),
  ]);

  const latestLegacyWeight = latestCanonicalWeight
    ? undefined
    : await getLatestLegacyWeightFromRepo(db, scope.organizationId);
  const latestWeight = selectLatestBodyWeight(
    latestCanonicalWeight
      ? { date: latestCanonicalWeight.date, weightKg: latestCanonicalWeight.weightKg }
      : undefined,
    latestLegacyWeight,
  );

  const dexaDate = latestDexa?.date ?? null;
  const weightDate = latestWeight?.date ?? null;

  return {
    asOfDate: maxIsoDate(dexaDate, weightDate),
    weightKg: latestWeight?.weightKg ?? latestDexa?.weight ?? null,
    bodyFatPct: latestDexa?.bodyFatPct ?? latestWeight?.bodyFatPct ?? null,
    leanMassKg:
      latestDexa?.leanMass !== null && latestDexa?.leanMass !== undefined
        ? latestDexa.leanMass / 1000
        : null,
    bmi: latestDexa?.bmi ?? null,
  };
}

async function getLatestLegacyWeightFromRepo(db: Database, organizationId: string) {
  // Mirror of `getLatestWeight` fallback when canonical is missing.
  const rows = await listLegacyCheckins(db, organizationId, 1);
  const row = rows[0];
  if (!row) return undefined;
  return { date: row.date, weightKg: row.weightKg, bodyFatPct: row.bodyFatPct };
}

export async function extractMedications(
  db: Database,
  scope: ExportPayloadScope,
): Promise<ExportPayloadDataByDomain["medications"]> {
  const rows = await db
    .select()
    .from(medication)
    .where(eq(medication.organizationId, scope.organizationId))
    .orderBy(desc(medication.id));

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    dose: row.dose,
    route: row.route,
    protocol: row.protocol,
    frequency: row.frequency,
    status: row.status,
    notes: row.notes,
  }));
}

export async function extractSupplements(
  db: Database,
  scope: ExportPayloadScope,
): Promise<ExportPayloadDataByDomain["supplements"]> {
  const rows = await db
    .select({
      supplementId: supplement.id,
      scheduleId: supplementSchedule.id,
      name: supplement.name,
      dose: supplement.dose,
      form: supplement.form,
      category: supplement.category,
      timeOfDay: supplementSchedule.timeOfDay,
      quantity: supplementSchedule.quantity,
      frequency: supplementSchedule.frequency,
      status: supplementSchedule.status,
      notes: supplementSchedule.notes,
    })
    .from(supplement)
    .innerJoin(supplementSchedule, eq(supplement.id, supplementSchedule.supplementId))
    .where(eq(supplementSchedule.organizationId, scope.organizationId))
    .orderBy(desc(supplement.id), desc(supplementSchedule.id));

  return rows.map((row) => ({
    id: row.supplementId,
    scheduleId: row.scheduleId,
    name: row.name,
    dose: row.dose,
    form: row.form,
    category: row.category,
    timeOfDay: row.timeOfDay,
    quantity: row.quantity,
    frequency: row.frequency,
    status: row.status,
    notes: row.notes,
  }));
}

export async function extractDexa(
  db: Database,
  scope: ExportPayloadScope,
): Promise<ExportPayloadDataByDomain["dexa"]> {
  const rows = await listAllDexaScans(db, scope.organizationId);
  return rows.map((row) => ({
    id: row.id,
    date: row.date,
    weightKg: row.weight,
    bodyFatPct: row.bodyFatPct,
    leanMassKg: row.leanMass !== null ? row.leanMass / 1000 : null,
    bmi: row.bmi,
    rmr: row.rmr,
    sourceFile: row.sourceFile,
  }));
}

export async function extractCardiac(
  db: Database,
  scope: ExportPayloadScope,
): Promise<ExportPayloadDataByDomain["cardiac"]> {
  const rows = await db
    .select()
    .from(cardiacExam)
    .where(eq(cardiacExam.organizationId, scope.organizationId))
    .orderBy(desc(cardiacExam.date), desc(cardiacExam.id));
  return rows.map((row) => ({
    id: row.id,
    date: row.date,
    type: row.type,
    facility: row.facility,
    physician: row.physician,
    conclusion: row.conclusion,
    sourceFile: row.sourceFile,
  }));
}

export async function extractImaging(
  db: Database,
  scope: ExportPayloadScope,
): Promise<ExportPayloadDataByDomain["imaging"]> {
  const rows = await db
    .select()
    .from(imagingStudy)
    .where(eq(imagingStudy.organizationId, scope.organizationId))
    .orderBy(desc(imagingStudy.date), desc(imagingStudy.id));
  return rows.map((row) => ({
    id: row.id,
    date: row.date,
    type: row.type,
    bodyPart: row.bodyPart,
    facility: row.facility,
    physician: row.physician,
    conclusion: row.conclusion,
    sourceFile: row.sourceFile,
  }));
}

export async function extractWeight(
  db: Database,
  scope: ExportPayloadScope,
): Promise<ExportPayloadDataByDomain["weight"]> {
  const rows = await db
    .select()
    .from(weightCheckin)
    .where(eq(weightCheckin.organizationId, scope.organizationId))
    .orderBy(desc(weightCheckin.date), desc(weightCheckin.id));
  return rows.map((row) => ({
    id: row.id,
    date: row.date,
    weightKg: row.weightKg,
    bodyFatPct: row.bodyFatPct,
    notes: row.notes,
  }));
}
