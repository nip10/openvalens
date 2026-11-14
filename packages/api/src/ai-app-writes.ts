import { createHash } from "node:crypto";

import type { Database } from "@openvalens/db";
import { metricSample } from "@openvalens/db/schema/health-record";
import { plainWaterEntry } from "@openvalens/db/schema/nutrition";
import { supplementIntake } from "@openvalens/db/schema/plans";
import { createHealthRecordRepository } from "@openvalens/health-record";
import { ToolInputError } from "@openvalens/mcp/format";
import type {
  AiDomainWriter,
  AiWriteBatchContext,
  AiWriteEntryContext,
  AiWrittenEntry,
  BodyEntryInput,
  McpWriteTargets,
  SupplementEntryInput,
  VitalEntryInput,
  WaterEntryInput,
} from "@openvalens/mcp/writes";
import { createPlainWaterDiary, NutritionError } from "@openvalens/nutrition";
import {
  createPlansRepository,
  createSupplementIntakeRepository,
  SupplementIntakeConflictError,
  SupplementIntakeNotFoundError,
  SupplementIntakeValidationError,
  validateSupplementIntakePayload,
} from "@openvalens/plans";
import { hasDeviceReadingNear } from "@openvalens/vitals/device-overlap";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { findLogKind } from "./presenters/log-kinds";
import { MANUAL_ENTRY_FIELDS, parseBloodPressure } from "./presenters/manual-entry";
import { weightInKg } from "./presenters/quick-log";

/**
 * Issue #439 (M2a) — the domain write paths behind the AI write tools, the
 * same ones the quick log and the app's own forms use:
 *
 * - water: the plain-water diary (`plainWater.add` / `delete`), with its own
 *   receipts (#83) keyed by a client mutation id derived from the entry key;
 * - weight, body composition and vitals: `healthRecord.ingestMetricSample`'s
 *   repository call, with the quick log's ranges (`MANUAL_ENTRY_FIELDS`), its
 *   blood pressure rule (systolic above diastolic, pulse as `heart_rate`) and
 *   its lb → kg conversion; the sample is a manual one (no data source,
 *   `ingestedByUserId`) tagged with the grant (`aiApp`), and its dedupe hash
 *   comes from the entry key, so a retry finds it instead of writing again;
 * - a supplement taken: the supplement intake repository (`supplementIntake.create`),
 *   with its receipts keyed by a UUID derived from the entry key.
 *
 * A reading within ten minutes of a device reading of the same metric is a
 * possible duplicate (the blood pressure rule, `@openvalens/vitals`); nothing
 * is merged and device data wins in the daily totals.
 */

const ML_PER: Record<WaterEntryInput["unit"], number> = { ml: 1, l: 1000, fl_oz: 29.5735295625 };
const MAX_FUTURE_SKEW_MS = 60_000;
/** At most this far back; older history goes through the import flows. */
const MAX_PAST_DAYS = 3_650;

const round3 = (value: number) => Math.round(value * 1000) / 1000;

function badEntry(index: number, message: string): never {
  throw new ToolInputError(`Entry ${index}: ${message}`);
}

/** A tool's `at` as a Date, refused when unreadable, in the future or older than ten years. */
function instantOf(index: number, value: string, now: Date): Date {
  const at = new Date(value);
  if (!Number.isFinite(at.getTime())) badEntry(index, "`at` is not a valid time.");
  if (at.getTime() > now.getTime() + MAX_FUTURE_SKEW_MS) badEntry(index, "`at` is in the future.");
  if (at.getTime() < now.getTime() - MAX_PAST_DAYS * 86_400_000)
    badEntry(index, "`at` is more than ten years ago; use the app's import screens for history.");
  return at;
}

function inRange(
  index: number,
  label: string,
  value: number,
  min: number,
  max: number,
  unit: string,
) {
  if (!Number.isFinite(value) || value < min || value > max)
    badEntry(index, `${label} must be between ${min} and ${max} ${unit}.`);
}

/** A client mutation id for the domain's own receipts: `ai-` and 40 hex characters. */
function domainMutationId(entryKey: string, purpose: string): string {
  return `ai-${createHash("sha256").update(`${purpose}:${entryKey}`).digest("hex").slice(0, 40)}`;
}

/** A UUID (version 8, RFC 9562) derived from the entry key, for receipts that need a UUID. */
function domainMutationUuid(entryKey: string, purpose: string): string {
  const hex = createHash("sha256").update(`${purpose}:${entryKey}`).digest("hex");
  const variant = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

// ─── Water ────────────────────────────────────────────────────

type PreparedWater = { quantity: number; unit: WaterEntryInput["unit"]; observedAt: Date };

function waterWriter(db: Database): AiDomainWriter<WaterEntryInput> {
  const diary = createPlainWaterDiary(db);
  const field = findLogKind("water")?.fields.find((item) => item.id === "quantity");
  const min = field?.min ?? 1;
  const max = field?.max ?? 5_000;
  return {
    async prepare(context, entries) {
      const preference = await diary.getPreference(context.scope);
      if (!preference.enabled)
        throw new ToolInputError(
          "Plain-water logging is off for this member. They can turn it on in the app (Nutrition, Water).",
        );
      return entries.map((entry, index): PreparedWater => {
        const ml = entry.amount * (ML_PER[entry.unit] ?? Number.NaN);
        inRange(index, "The amount", round3(ml), min, max, "ml");
        return {
          quantity: entry.amount,
          unit: entry.unit,
          observedAt: instantOf(index, entry.at, context.now),
        };
      });
    },
    async write(context, prepared) {
      const entry = prepared as PreparedWater;
      try {
        const saved = await diary.add(context.scope, {
          quantity: entry.quantity,
          unit: entry.unit,
          observedAt: entry.observedAt,
          timeZone: context.timeZone,
          clientMutationId: domainMutationId(context.entryKey, "water.add"),
        });
        return {
          kind: "water",
          targetTable: "plain_water_entry",
          targetIds: [saved.entry.id],
          possibleDuplicate: false,
        };
      } catch (error) {
        if (error instanceof NutritionError) throw new ToolInputError(error.message);
        throw error;
      }
    },
  };
}

// ─── Metric samples: weight, body composition, vitals ─────────

type PreparedSamples = {
  kind: string;
  at: Date;
  samples: Array<{ metricCode: string; value: number }>;
  /** Codes whose device readings make this a possible duplicate. */
  overlapCodes: string[];
};

const BODY_RULES: Record<
  BodyEntryInput["kind"],
  { code: string; label: string; min: number; max: number; mass: boolean }
> = {
  weight: {
    code: "weight",
    label: "Weight",
    min: MANUAL_ENTRY_FIELDS.weight.min,
    max: MANUAL_ENTRY_FIELDS.weight.max,
    mass: true,
  },
  body_fat: { code: "body_fat", label: "Body fat", min: 2, max: 75, mass: false },
  muscle_mass: { code: "muscle_mass", label: "Muscle mass", min: 5, max: 200, mass: true },
  bone_mass: { code: "bone_mass", label: "Bone mass", min: 0.5, max: 10, mass: true },
  body_water: { code: "body_water", label: "Body water", min: 20, max: 80, mass: false },
};

const VITAL_RULES: Record<
  Exclude<VitalEntryInput["kind"], "blood_pressure">,
  { label: string; min: number; max: number; unit: string }
> = {
  heart_rate: {
    label: "Heart rate",
    min: MANUAL_ENTRY_FIELDS.heart_rate.min,
    max: MANUAL_ENTRY_FIELDS.heart_rate.max,
    unit: "bpm",
  },
  resting_heart_rate: {
    label: "Resting heart rate",
    min: MANUAL_ENTRY_FIELDS.resting_heart_rate.min,
    max: MANUAL_ENTRY_FIELDS.resting_heart_rate.max,
    unit: "bpm",
  },
  oxygen_saturation: { label: "Blood oxygen", min: 70, max: 100, unit: "%" },
  respiratory_rate: { label: "Respiratory rate", min: 4, max: 60, unit: "breaths/min" },
};

function prepareBody(index: number, entry: BodyEntryInput, now: Date): PreparedSamples {
  const rule = BODY_RULES[entry.kind];
  const unit = entry.unit ?? (rule.mass ? "kg" : "%");
  if (rule.mass && unit !== "kg" && unit !== "lb") badEntry(index, `${rule.label} takes kg or lb.`);
  if (!rule.mass && unit !== "%") badEntry(index, `${rule.label} is a percentage (%).`);
  const value = round3(rule.mass ? weightInKg(entry.value, unit) : entry.value);
  inRange(index, rule.label, value, rule.min, rule.max, rule.mass ? "kg" : "%");
  return {
    kind: entry.kind,
    at: instantOf(index, entry.at, now),
    samples: [{ metricCode: rule.code, value }],
    overlapCodes: [rule.code],
  };
}

function prepareVital(index: number, entry: VitalEntryInput, now: Date): PreparedSamples {
  const at = instantOf(index, entry.at, now);
  if (entry.kind === "blood_pressure") {
    if (entry.value !== undefined)
      badEntry(index, "blood_pressure takes systolic and diastolic, not value.");
    // The quick log's own rule: each value in its range, systolic above diastolic.
    const parsed = parseBloodPressure(
      {
        systolic: entry.systolic === undefined ? "" : String(entry.systolic),
        diastolic: entry.diastolic === undefined ? "" : String(entry.diastolic),
        pulse: entry.pulse === undefined ? "" : String(entry.pulse),
      },
      (field, raw) => {
        const value = Number(raw);
        if (!Number.isFinite(value)) return null;
        const rounded = round3(value);
        return rounded < field.min || rounded > field.max ? null : rounded;
      },
    );
    if (!parsed.ok) {
      const first = parsed.errors[0] ?? "systolic";
      if (first === "order") badEntry(index, "systolic must be above diastolic.");
      const field =
        first === "pulse"
          ? MANUAL_ENTRY_FIELDS.heart_rate
          : MANUAL_ENTRY_FIELDS[`blood_pressure_${first}`];
      badEntry(index, `${first} must be between ${field.min} and ${field.max}.`);
    }
    const reading = parsed.reading;
    return {
      kind: "blood_pressure",
      at,
      samples: [
        { metricCode: "blood_pressure_systolic", value: reading.systolic },
        { metricCode: "blood_pressure_diastolic", value: reading.diastolic },
        ...(reading.pulse === null ? [] : [{ metricCode: "heart_rate", value: reading.pulse }]),
      ],
      overlapCodes: ["blood_pressure_systolic", "blood_pressure_diastolic"],
    };
  }
  if (entry.systolic !== undefined || entry.diastolic !== undefined || entry.pulse !== undefined)
    badEntry(index, `${entry.kind} takes value only.`);
  if (entry.value === undefined) badEntry(index, `${entry.kind} needs a value.`);
  const rule = VITAL_RULES[entry.kind];
  const value = round3(entry.value);
  inRange(index, rule.label, value, rule.min, rule.max, rule.unit);
  return {
    kind: entry.kind,
    at,
    samples: [{ metricCode: entry.kind, value }],
    overlapCodes: [entry.kind],
  };
}

function metricWriter<Input>(
  db: Database,
  prepareOne: (index: number, entry: Input, now: Date) => PreparedSamples,
): AiDomainWriter<Input> {
  const repository = createHealthRecordRepository(db);

  async function existingSample(organizationId: string, dedupeHash: string) {
    const [row] = await db
      .select({ id: metricSample.id })
      .from(metricSample)
      .where(
        and(
          eq(metricSample.organizationId, organizationId),
          eq(metricSample.dedupeHash, dedupeHash),
        ),
      )
      .limit(1);
    return row?.id ?? null;
  }

  async function writeSample(
    context: AiWriteEntryContext,
    sample: { metricCode: string; value: number },
    at: Date,
  ): Promise<number> {
    const dedupeHash = domainMutationId(context.entryKey, `metric:${sample.metricCode}`);
    const found = await existingSample(context.scope.organizationId, dedupeHash);
    if (found !== null) return found;
    try {
      const row = await repository.ingestMetricSample({
        organizationId: context.scope.organizationId,
        userId: context.scope.userId,
        payload: {
          metricCode: sample.metricCode,
          observedAt: at.toISOString(),
          valueNumeric: sample.value,
          dedupeHash,
        },
        registerCanonicalDefinition: true,
        aiApp: context.source,
      });
      return row.id;
    } catch (error) {
      // A concurrent retry of the same entry won the insert.
      const raced = await existingSample(context.scope.organizationId, dedupeHash);
      if (raced !== null) return raced;
      throw error;
    }
  }

  return {
    async prepare(context: AiWriteBatchContext, entries) {
      return entries.map((entry, index) => prepareOne(index, entry, context.now));
    },
    async write(context, prepared): Promise<AiWrittenEntry> {
      const entry = prepared as PreparedSamples;
      const targetIds: number[] = [];
      for (const sample of entry.samples)
        targetIds.push(await writeSample(context, sample, entry.at));
      const possibleDuplicate = await hasDeviceReadingNear(db, {
        organizationId: context.scope.organizationId,
        codes: entry.overlapCodes,
        at: entry.at,
      });
      return { kind: entry.kind, targetTable: "metric_sample", targetIds, possibleDuplicate };
    },
  };
}

// ─── Supplement taken ─────────────────────────────────────────

type PreparedIntake = { supplementId: number; occurredAt: string; dose: string };

function supplementWriter(db: Database): AiDomainWriter<SupplementEntryInput> {
  return {
    async prepare(context, entries) {
      const own = await createPlansRepository(db).listSupplements(context.scope.organizationId);
      const byName = new Map<string, typeof own>();
      for (const item of own) {
        const key = item.name.trim().toLowerCase();
        byName.set(key, [...(byName.get(key) ?? []), item]);
      }
      const names = own
        .map((item) => item.name)
        .sort()
        .slice(0, 30);
      return entries.map((entry, index): PreparedIntake => {
        const matches = byName.get(entry.supplement.trim().toLowerCase()) ?? [];
        if (matches.length === 0)
          badEntry(
            index,
            names.length
              ? `"${entry.supplement}" is not one of the member's supplements. Their supplements: ${names.join(", ")}.`
              : "The member has no supplements yet; they add them in the app first.",
          );
        if (matches.length > 1)
          badEntry(
            index,
            `More than one of the member's supplements is called "${entry.supplement}".`,
          );
        const supplement = matches[0]!;
        const dose = entry.dose?.trim() || supplement.dose?.trim() || "";
        if (!dose)
          badEntry(index, `Give the dose taken: "${supplement.name}" has no dose of its own.`);
        const occurredAt = instantOf(index, entry.at, context.now).toISOString();
        try {
          validateSupplementIntakePayload({
            supplementId: supplement.id,
            occurredAt,
            timeZone: context.timeZone,
            dose,
          });
        } catch (error) {
          if (error instanceof SupplementIntakeValidationError) badEntry(index, error.message);
          throw error;
        }
        return { supplementId: supplement.id, occurredAt, dose };
      });
    },
    async write(context, prepared) {
      const entry = prepared as PreparedIntake;
      try {
        const saved = await createSupplementIntakeRepository(db, context.scope).create({
          supplementId: entry.supplementId,
          occurredAt: entry.occurredAt,
          timeZone: context.timeZone,
          dose: entry.dose,
          clientMutationId: domainMutationUuid(context.entryKey, "supplement_intake.create"),
        });
        return {
          kind: "supplement_intake",
          targetTable: "supplement_intake",
          targetIds: [saved.intake.id],
          possibleDuplicate: false,
        };
      } catch (error) {
        if (
          error instanceof SupplementIntakeValidationError ||
          error instanceof SupplementIntakeNotFoundError
        )
          throw new ToolInputError(error.message);
        throw error;
      }
    },
  };
}

// ─── Delete ───────────────────────────────────────────────────

/** The domain write paths for AI app writes, bound to one database. */
export function createAiAppWriteTargets(db: Database): McpWriteTargets {
  const diary = createPlainWaterDiary(db);

  const remove: McpWriteTargets["remove"] = async (context, entry) => {
    const { scope } = context;
    let deleted = 0;
    switch (entry.targetTable) {
      case "plain_water_entry": {
        for (const id of entry.targetIds) {
          for (let attempt = 0; attempt < 3; attempt += 1) {
            const [current] = await db
              .select({ revision: plainWaterEntry.revision, deletedAt: plainWaterEntry.deletedAt })
              .from(plainWaterEntry)
              .where(
                and(
                  eq(plainWaterEntry.id, id),
                  eq(plainWaterEntry.organizationId, scope.organizationId),
                  eq(plainWaterEntry.userId, scope.userId),
                ),
              )
              .limit(1);
            if (!current || current.deletedAt) break;
            const result = await diary.change(scope, {
              id,
              clientMutationId: domainMutationId(
                context.entryKey,
                `water.delete:${id}:${current.revision}`,
              ),
              expectedRevision: current.revision,
              deleted: true,
            });
            if (result.outcome !== "conflict") {
              deleted += 1;
              break;
            }
          }
        }
        break;
      }
      case "supplement_intake": {
        const repository = createSupplementIntakeRepository(db, scope);
        for (const id of entry.targetIds) {
          for (let attempt = 0; attempt < 3; attempt += 1) {
            const [current] = await db
              .select({ version: supplementIntake.version })
              .from(supplementIntake)
              .where(
                and(
                  eq(supplementIntake.id, id),
                  eq(supplementIntake.organizationId, scope.organizationId),
                  eq(supplementIntake.userId, scope.userId),
                  isNull(supplementIntake.deletedAt),
                ),
              )
              .limit(1);
            if (!current) break;
            try {
              await repository.delete({
                id,
                version: current.version,
                clientMutationId: domainMutationUuid(
                  context.entryKey,
                  `supplement_intake.delete:${id}:${current.version}`,
                ),
              });
              deleted += 1;
              break;
            } catch (error) {
              if (error instanceof SupplementIntakeNotFoundError) break;
              if (error instanceof SupplementIntakeConflictError) continue;
              throw error;
            }
          }
        }
        break;
      }
      case "metric_sample": {
        // Only the manual samples this very grant wrote: never a device row.
        const rows = await db
          .delete(metricSample)
          .where(
            and(
              eq(metricSample.organizationId, scope.organizationId),
              inArray(metricSample.id, [...entry.targetIds]),
              isNull(metricSample.dataSourceId),
              sql`${metricSample.metadataJson}->'aiApp'->>'grantId' = ${context.source.grantId}`,
            ),
          )
          .returning({ id: metricSample.id });
        deleted += rows.length;
        break;
      }
    }
    return deleted > 0 ? "deleted" : "gone";
  };

  return {
    water: waterWriter(db),
    body: metricWriter<BodyEntryInput>(db, prepareBody),
    vitals: metricWriter<VitalEntryInput>(db, prepareVital),
    supplements: supplementWriter(db),
    remove,
  };
}
