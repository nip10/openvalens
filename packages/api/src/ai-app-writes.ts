import { createHash } from "node:crypto";

import { writeAuditLog } from "@openvalens/audit-security";
import type { Database } from "@openvalens/db";
import { aiAppDraft, aiAppEntry, aiAppGrant } from "@openvalens/db/schema/ai-apps";
import { exercise } from "@openvalens/db/schema/exercises";
import { metricDefinition, metricSample } from "@openvalens/db/schema/health-record";
import { plainWaterEntry } from "@openvalens/db/schema/nutrition";
import { supplementIntake, workout } from "@openvalens/db/schema/plans";
import { customTracker, customTrackerEntry } from "@openvalens/db/schema/trackers";
import { BLOOD_MARKER_CODE_PREFIX, createHealthRecordRepository } from "@openvalens/health-record";
import { ToolInputError } from "@openvalens/mcp/format";
import type {
  AiDomainWriter,
  AiWriteBatchContext,
  AiWriteEntryContext,
  AiWrittenEntry,
  BodyEntryInput,
  FoodEntryInput,
  LabEntryInput,
  McpWriteTargets,
  PainEntryInput,
  SleepEntryInput,
  SupplementEntryInput,
  TrackerEntryInput,
  VitalEntryInput,
  WaterEntryInput,
  WorkoutEntryInput,
} from "@openvalens/mcp/writes";
import { createPlainWaterDiary, NutritionError, type MealSlot } from "@openvalens/nutrition";
import {
  candidateFromParts,
  FOOD_DRAFT_LIMITS,
  parseFoodTranscript,
  type FoodDraftCandidate,
} from "@openvalens/nutrition/food-draft";
import { createPainService, PainError, readPainPreference, type PainType } from "@openvalens/pain";
import {
  createPlansRepository,
  createSupplementIntakeRepository,
  createWorkoutRepository,
  isWorkoutType,
  MAX_EXERCISES_PER_WORKOUT,
  MAX_SETS_PER_EXERCISE,
  SupplementIntakeConflictError,
  SupplementIntakeNotFoundError,
  SupplementIntakeValidationError,
  validateSupplementIntakePayload,
  WorkoutExerciseNotFoundError,
  WorkoutMutationConflictError,
  WorkoutNotFoundError,
  WorkoutVersionConflictError,
  type UpsertWorkoutExerciseInput,
  type UpsertWorkoutInput,
} from "@openvalens/plans";
import {
  deleteManualSleepSession,
  insertManualSleepSession,
  overlapsDeviceSleep,
} from "@openvalens/sleep";
import {
  createTrackerService,
  localDateIn,
  TrackerError,
  trackerValueProblem,
  type TrackerType,
} from "@openvalens/trackers";
import { hasDeviceReadingNear } from "@openvalens/vitals/device-overlap";
import { and, asc, between, eq, inArray, isNull, like, ne, or, sql } from "drizzle-orm";

import type { AiAppDraftKind } from "./presenters/ai-apps";
import { findLogKind } from "./presenters/log-kinds";
import { MANUAL_ENTRY_FIELDS, parseBloodPressure } from "./presenters/manual-entry";
import { checkManualSleepWindow, type ManualSleepError } from "./presenters/manual-sleep";
import { weightInKg } from "./presenters/quick-log";

/**
 * Issue #439 (M2a, M2b) — the domain write paths behind the AI write tools,
 * the same ones the quick log and the app's own forms use:
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
 *   with its receipts keyed by a UUID derived from the entry key;
 * - a workout (M2b): the workout repository's `upsertWorkout` (what
 *   `plans.workouts.upsertWorkout` runs), with its receipts keyed by a UUID
 *   derived from the entry key. Exercises are catalog exercises the workspace
 *   can see; a session with one named that is not in the catalog is a draft
 *   the member confirms (M2c), mapping or creating the exercise on review;
 * - a night of sleep (M2b): a manual night (`sleep.logManualSession`'s
 *   `insertManualSleepSession`, #440) with a dedupe hash from the entry key
 *   and the grant tag in its payload;
 * - a custom tracker entry (M2b, #441): the tracker service's `log`, only into
 *   the member's own trackers with the AI switch on, with an entry id derived
 *   from the entry key;
 * - a pain entry (M2b, #442): the pain service's `log`, one entry per region,
 *   only while the pain log and its AI switch are on, with an entry id derived
 *   from the entry key;
 * - drafts the member confirms (M2c), in `ai_app_draft` with an id derived
 *   from the entry key: a meal draft (#73, the "Describe a meal" items, never
 *   a nutrient value), a lab result (one of the member's markers in a unit it
 *   already uses, never converted; a reference range only when the app sent
 *   one, kept as the range from the report) and a workout with an exercise
 *   that is not in the catalog. {@link createAiAppDraftReview} is the member's
 *   side: confirm (the same write paths, the app's tag kept) or discard.
 *
 * Device data always wins and is never changed: a reading within ten minutes
 * of a device reading of the same metric (the blood pressure rule,
 * `@openvalens/vitals`), a night overlapping a device night (#440) and a
 * tracker entry within ten minutes of one imported from a phone platform are
 * possible duplicates.
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

// ─── Workouts (M2b) ───────────────────────────────────────────

const MAX_SET_WEIGHT_KG = 1_000;

type PreparedWorkout = Omit<UpsertWorkoutInput, "clientMutationId" | "userId">;

/** Today's calendar day in a time zone, falling back to UTC for an unknown zone. */
function todayIn(now: Date, timeZone: string): string {
  try {
    return localDateIn(now, timeZone);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

const NOT_IN_CATALOG =
  "Find the exercise with exercises.search and pass its exerciseId (the member's own custom exercises are listed there too). For an exercise the catalog does not have, pass its name without an exerciseId: the workout then waits for the member to review it in the app.";

/**
 * A workout ready to save, or (M2c) a draft: a session with an exercise that
 * is not in the catalog (`exerciseId: null`, by name) waits for the member,
 * who maps or creates that exercise on review.
 */
type PreparedWorkoutEntry =
  | { draft: false; workout: PreparedWorkout }
  | { draft: true; payload: WorkoutDraftPayload };

/** The exercises catalog ids a workspace can use (the shared catalog and its own). */
async function visibleExercises(
  db: Database,
  organizationId: string,
  ids: readonly number[],
): Promise<Map<number, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: exercise.id, name: exercise.name })
    .from(exercise)
    .where(
      and(
        inArray(exercise.id, [...ids]),
        or(isNull(exercise.organizationId), eq(exercise.organizationId, organizationId)),
      ),
    );
  return new Map(rows.map((row) => [row.id, row.name]));
}

function workoutWriter(db: Database): AiDomainWriter<WorkoutEntryInput> {
  const repository = createWorkoutRepository(db);
  return {
    async prepare(context, entries) {
      const ids = [
        ...new Set(
          entries.flatMap((entry) =>
            (entry.exercises ?? []).flatMap((item) =>
              item.exerciseId === undefined ? [] : [item.exerciseId],
            ),
          ),
        ),
      ];
      const names = await visibleExercises(db, context.scope.organizationId, ids);
      const today = todayIn(context.now, context.timeZone);
      return entries.map((entry, index): PreparedWorkoutEntry => {
        const day = Date.parse(`${entry.date}T00:00:00Z`);
        if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== entry.date)
          badEntry(index, "`date` is not a valid day (YYYY-MM-DD).");
        if (entry.date > today) badEntry(index, "`date` is in the future.");
        if (day < context.now.getTime() - MAX_PAST_DAYS * 86_400_000)
          badEntry(
            index,
            "`date` is more than ten years ago; use the app's import screens for history.",
          );
        if (!isWorkoutType(entry.type)) badEntry(index, `"${entry.type}" is not a workout type.`);
        const exercises = entry.exercises ?? [];
        if (exercises.length > MAX_EXERCISES_PER_WORKOUT)
          badEntry(index, `A workout has at most ${MAX_EXERCISES_PER_WORKOUT} exercises.`);
        const prepared = exercises.map((item, position): WorkoutDraftExercise => {
          const label = item.name ? ` ("${item.name}")` : "";
          let exerciseId: number | null = null;
          let name: string;
          if (item.exerciseId === undefined) {
            // Not in the catalog (M2c): the member maps or creates it on review.
            if (!item.name)
              badEntry(
                index,
                `exercise ${position} needs an exerciseId or a name. ${NOT_IN_CATALOG}`,
              );
            name = item.name;
          } else {
            const found = names.get(item.exerciseId);
            if (found === undefined)
              badEntry(
                index,
                `exercise ${position}${label}: ${item.exerciseId} is not a catalog exercise id. ${NOT_IN_CATALOG}`,
              );
            exerciseId = item.exerciseId;
            name = found;
          }
          const sets = item.sets ?? [];
          if (sets.length > MAX_SETS_PER_EXERCISE)
            badEntry(index, `An exercise has at most ${MAX_SETS_PER_EXERCISE} sets.`);
          return {
            name,
            exerciseId,
            sets: sets.map((set) => {
              const weightKg =
                set.weight === undefined ? null : round3(weightInKg(set.weight, set.unit ?? "kg"));
              if (weightKg !== null && weightKg > MAX_SET_WEIGHT_KG)
                badEntry(index, `A set's weight must be at most ${MAX_SET_WEIGHT_KG} kg.`);
              return { reps: set.reps, weightKg, rpe: set.rpe ?? null };
            }),
          };
        });
        const session = {
          date: entry.date,
          type: entry.type,
          duration: entry.durationMinutes ?? null,
          notes: entry.notes ?? null,
          intensity: entry.intensity ?? null,
          effortRating: entry.effort ?? null,
        };
        if (prepared.some((item) => item.exerciseId === null))
          return { draft: true, payload: { ...session, exercises: prepared } };
        return { draft: false, workout: workoutFromDraft(session, prepared) };
      });
    },
    async write(context, prepared) {
      const planned = prepared as PreparedWorkoutEntry;
      if (planned.draft) {
        const id = await insertDraft(db, context, "workout", planned.payload);
        return draftEntry("workout", id);
      }
      const entry = planned.workout;
      try {
        const saved = await db.transaction((tx) =>
          repository.upsertWorkout(
            tx as Parameters<typeof repository.upsertWorkout>[0],
            context.scope.organizationId,
            {
              ...entry,
              userId: context.scope.userId,
              clientMutationId: domainMutationUuid(context.entryKey, "workout.create"),
            },
          ),
        );
        return {
          kind: "workout",
          targetTable: "workout",
          targetIds: [saved.id],
          possibleDuplicate: false,
        };
      } catch (error) {
        if (error instanceof WorkoutExerciseNotFoundError)
          throw new ToolInputError(`An exercise is not in the catalog. ${NOT_IN_CATALOG}`);
        throw error;
      }
    },
  };
}

// ─── Sleep (M2b) ──────────────────────────────────────────────

type PreparedSleep = { startAt: string; endAt: string; quality: number | null };

const SLEEP_ERRORS: Record<ManualSleepError, string> = {
  invalid: "give a bedtime and a wake time.",
  order: "the wake time must be after the bedtime.",
  too_short: "a night needs at least 10 minutes.",
  too_long: "a night can be at most 24 hours.",
  future: "the wake time is in the future.",
};

function sleepWriter(db: Database): AiDomainWriter<SleepEntryInput> {
  return {
    async prepare(context, entries) {
      return entries.map((entry, index): PreparedSleep => {
        instantOf(index, entry.startAt, context.now);
        // The app's own sleep form rule (#440).
        const checked = checkManualSleepWindow(entry.startAt, entry.endAt, context.now);
        if (!checked.ok) badEntry(index, `Sleep window: ${SLEEP_ERRORS[checked.error]}`);
        return {
          startAt: checked.window.startAt,
          endAt: checked.window.endAt,
          quality: entry.quality ?? null,
        };
      });
    },
    async write(context, prepared) {
      const entry = prepared as PreparedSleep;
      const { id } = await insertManualSleepSession(db, {
        organizationId: context.scope.organizationId,
        userId: context.scope.userId,
        startAt: entry.startAt,
        endAt: entry.endAt,
        quality: entry.quality,
        dedupeHash: domainMutationId(context.entryKey, "sleep.manual"),
        aiApp: context.source,
      });
      const possibleDuplicate = await overlapsDeviceSleep(db, {
        organizationId: context.scope.organizationId,
        startAt: entry.startAt,
        endAt: entry.endAt,
      });
      return {
        kind: "sleep_session",
        targetTable: "health_event",
        targetIds: [id],
        possibleDuplicate,
      };
    },
  };
}

// ─── Custom trackers (M2b, #441) ──────────────────────────────

type PreparedTrackerEntry = {
  trackerId: string;
  value: number;
  loggedAt: string;
  note: string | null;
};

/** A tracker entry within this much of a platform-imported one is a possible duplicate. */
const TRACKER_OVERLAP_MS = 10 * 60_000;

function trackerValue(
  index: number,
  tracker: { name: string; type: string },
  value: number | boolean,
): number {
  const type = tracker.type as TrackerType;
  let stored: number;
  if (type === "yes_no") {
    if (typeof value === "boolean") stored = value ? 1 : 0;
    else stored = value;
  } else if (typeof value === "boolean") {
    return badEntry(index, `"${tracker.name}" takes a number, not true or false.`);
  } else if (type === "duration") {
    // Minutes, as `trackers.entries` reads them back; stored in seconds.
    stored = Math.round(value * 60);
  } else stored = value;
  const problem = trackerValueProblem(type, stored);
  if (problem) {
    const hint =
      type === "yes_no"
        ? "Give true or false."
        : type === "scale"
          ? "Give a whole number from 1 to 5."
          : type === "duration"
            ? "Give the minutes, more than 0 and at most 1440."
            : problem;
    badEntry(index, `"${tracker.name}": ${hint}`);
  }
  return stored;
}

function trackerWriter(db: Database): AiDomainWriter<TrackerEntryInput> {
  const service = createTrackerService({ db });
  return {
    async prepare(context, entries) {
      // Only the member's own trackers with the AI switch on, not archived: the same
      // trackers `trackers.list` shows this app.
      const own = await db
        .select({ id: customTracker.id, name: customTracker.name, type: customTracker.type })
        .from(customTracker)
        .where(
          and(
            eq(customTracker.organizationId, context.scope.organizationId),
            eq(customTracker.userId, context.scope.userId),
            eq(customTracker.aiVisible, true),
            isNull(customTracker.archivedAt),
          ),
        );
      const byId = new Map(own.map((row) => [row.id, row]));
      const listed = own
        .slice(0, 30)
        .map((row) => `${row.name} (${row.id})`)
        .join(", ");
      return entries.map((entry, index): PreparedTrackerEntry => {
        const tracker = byId.get(entry.trackerId);
        if (!tracker)
          badEntry(
            index,
            own.length
              ? `${entry.trackerId} is not one of the member's trackers that AI apps can use. Their trackers: ${listed}.`
              : "The member has no trackers that AI apps can use. They can add one, or turn on its AI switch, in the app.",
          );
        return {
          trackerId: tracker.id,
          value: trackerValue(index, tracker, entry.value),
          loggedAt: instantOf(index, entry.at, context.now).toISOString(),
          note: entry.note?.trim() || null,
        };
      });
    },
    async write(context, prepared) {
      const entry = prepared as PreparedTrackerEntry;
      let saved;
      try {
        saved = await service.log(
          { ...context.scope, canWrite: true },
          {
            trackerId: entry.trackerId,
            value: entry.value,
            loggedAt: entry.loggedAt,
            timeZone: context.timeZone,
            note: entry.note,
          },
          { aiApp: true, entryId: domainMutationUuid(context.entryKey, "tracker_entry") },
        );
      } catch (error) {
        if (error instanceof TrackerError) throw new ToolInputError(error.message);
        throw error;
      }
      const at = new Date(entry.loggedAt).getTime();
      const [platform] = await db
        .select({ id: customTrackerEntry.id })
        .from(customTrackerEntry)
        .where(
          and(
            eq(customTrackerEntry.organizationId, context.scope.organizationId),
            eq(customTrackerEntry.trackerId, entry.trackerId),
            ne(customTrackerEntry.source, "manual"),
            between(
              customTrackerEntry.loggedAt,
              new Date(at - TRACKER_OVERLAP_MS),
              new Date(at + TRACKER_OVERLAP_MS),
            ),
          ),
        )
        .limit(1);
      return {
        kind: "tracker_entry",
        targetTable: "custom_tracker_entry",
        targetIds: [],
        targetUuids: [saved.id],
        possibleDuplicate: platform !== undefined,
      };
    },
  };
}

// ─── Pain log (M2b, #442) ─────────────────────────────────────

type PreparedPain = {
  region: string;
  rating: number;
  type: PainType | null;
  loggedAt: string;
  note: string | null;
};

const PAIN_OFF = "The member's pain log is off. They can turn it on in the app; nothing was saved.";
const PAIN_AI_OFF =
  'The member has not let AI apps use their pain log: "Coach and connected AI apps can read my pain log" is off. They can turn it on in the app; nothing was saved.';

function painWriter(db: Database): AiDomainWriter<PainEntryInput> {
  const service = createPainService({ db });
  return {
    async prepare(context, entries) {
      const preference = await readPainPreference(db, context.scope.userId);
      if (!preference.enabled) throw new ToolInputError(PAIN_OFF);
      if (!preference.aiVisible) throw new ToolInputError(PAIN_AI_OFF);
      return entries.map((entry, index): PreparedPain => ({
        region: entry.region,
        rating: entry.rating,
        type: (entry.type as PainType | undefined) ?? null,
        loggedAt: instantOf(index, entry.at, context.now).toISOString(),
        note: entry.note?.trim() || null,
      }));
    },
    async write(context, prepared) {
      const entry = prepared as PreparedPain;
      try {
        // One entry per region, through the pain service; it re-checks both switches.
        const [saved] = await service.log(
          context.scope,
          {
            regions: [entry.region],
            rating: entry.rating,
            type: entry.type,
            loggedAt: entry.loggedAt,
            timeZone: context.timeZone,
            note: entry.note,
          },
          { aiApp: true, ids: [domainMutationUuid(context.entryKey, "pain_entry")] },
        );
        return {
          kind: "pain_entry",
          targetTable: "pain_entry",
          targetIds: [],
          targetUuids: [saved!.id],
          possibleDuplicate: false,
        };
      } catch (error) {
        if (error instanceof PainError) throw new ToolInputError(error.message);
        throw error;
      }
    },
  };
}

// ─── Drafts the member confirms (M2c) ─────────────────────────

/** What the review screen shows for a meal draft: items to match to foods (#73). */
export type FoodDraftPayload = {
  eatenAt: string;
  meal: MealSlot | null;
  /** The meal in the app's words, when it sent a description. */
  description: string | null;
  items: FoodDraftCandidate[];
};

/** A lab result waiting for review: one of the member's markers, in a unit it already uses. */
export type LabDraftPayload = {
  observedAt: string;
  markerCode: string;
  markerName: string;
  value: number;
  /** The marker's own unit, as the app has it on file. */
  unit: string;
  /** The range printed on the report, only when the app sent one. */
  referenceRange: {
    low: number | null;
    high: number | null;
    text: string | null;
    source: "report";
  } | null;
};

export type WorkoutDraftExercise = {
  name: string;
  /** `null`: not in the catalog; the member maps or creates it on review. */
  exerciseId: number | null;
  sets: Array<{ reps: number; weightKg: number | null; rpe: number | null }>;
};

/** A workout with an exercise that is not in the catalog, waiting for review. */
export type WorkoutDraftPayload = Omit<PreparedWorkout, "exercises"> & {
  exercises: WorkoutDraftExercise[];
};

export type AiAppDraftPayload = FoodDraftPayload | LabDraftPayload | WorkoutDraftPayload;

const DRAFT_ENTRY_KIND: Record<AiAppDraftKind, string> = {
  food: "food_draft",
  lab: "lab_result",
  workout: "workout",
};

/**
 * Saves one draft. Its id comes from the entry key, so a retried entry finds
 * the draft it already made instead of adding another.
 */
async function insertDraft(
  db: Database,
  context: AiWriteEntryContext,
  kind: AiAppDraftKind,
  payload: AiAppDraftPayload,
): Promise<string> {
  const id = domainMutationUuid(context.entryKey, `ai_app_draft:${kind}`);
  await db
    .insert(aiAppDraft)
    .values({
      id,
      grantId: context.source.grantId,
      organizationId: context.scope.organizationId,
      userId: context.scope.userId,
      kind,
      payload,
      // The insert's own time, so drafts of one call list in the order sent.
    })
    .onConflictDoNothing({ target: aiAppDraft.id });
  return id;
}

function draftEntry(kind: AiAppDraftKind, id: string): AiWrittenEntry {
  return {
    kind: DRAFT_ENTRY_KIND[kind],
    targetTable: "ai_app_draft",
    targetIds: [],
    targetUuids: [id],
    possibleDuplicate: false,
    pendingReview: true,
  };
}

function workoutFromDraft(
  session: Omit<WorkoutDraftPayload, "exercises">,
  exercises: readonly WorkoutDraftExercise[],
): PreparedWorkout {
  return {
    ...session,
    exercises: exercises.map((item): UpsertWorkoutExerciseInput => ({
      name: item.name,
      exerciseId: item.exerciseId,
      notes: null,
      sets: item.sets.map((set) => ({ ...set, notes: null })),
    })),
  };
}

// ─── Food: a meal draft (#73) ─────────────────────────────────

function foodWriter(db: Database): AiDomainWriter<FoodEntryInput> {
  return {
    async prepare(context, entries) {
      return entries.map((entry, index): FoodDraftPayload => {
        const eatenAt = instantOf(index, entry.at, context.now).toISOString();
        let items: FoodDraftCandidate[];
        if (entry.description !== undefined) {
          // The app's own "Describe a meal" parser: nothing is looked up or estimated.
          const parsed = parseFoodTranscript(entry.description);
          if (parsed.status !== "ready")
            badEntry(
              index,
              parsed.status === "too_long"
                ? `the description is longer than ${FOOD_DRAFT_LIMITS.maxTranscriptChars} characters.`
                : "no food was found in the description. Send `items` instead.",
            );
          items = parsed.candidates;
        } else {
          const given = entry.items ?? [];
          if (given.length === 0) badEntry(index, "give a description or at least one item.");
          if (given.length > FOOD_DRAFT_LIMITS.maxCandidates)
            badEntry(index, `a meal draft has at most ${FOOD_DRAFT_LIMITS.maxCandidates} items.`);
          items = given.map((item, position) => {
            const candidate = candidateFromParts(
              {
                food: item.food,
                quantity: item.quantity === undefined ? null : String(item.quantity),
                unit: item.unit ?? null,
              },
              position,
            );
            if (!candidate) badEntry(index, `item ${position} does not name a food.`);
            return candidate;
          });
        }
        return {
          eatenAt,
          meal: entry.meal ?? null,
          description: entry.description?.trim() || null,
          items,
        };
      });
    },
    async write(context, prepared) {
      const id = await insertDraft(db, context, "food", prepared as FoodDraftPayload);
      return draftEntry("food", id);
    },
  };
}

// ─── Labs: a lab result the member confirms ───────────────────

/** The member's lab markers: `blood_marker_*` definitions in this workspace. */
async function labMarkers(db: Database, organizationId: string) {
  return db
    .select({
      code: metricDefinition.code,
      displayName: metricDefinition.displayName,
      unit: metricDefinition.unit,
    })
    .from(metricDefinition)
    .where(
      and(
        eq(metricDefinition.organizationId, organizationId),
        like(metricDefinition.code, `${BLOOD_MARKER_CODE_PREFIX}%`),
      ),
    );
}

/** A marker reference as an app may write it: `ferritin`, `blood_marker_ferritin`, "Vitamin D". */
function markerKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^blood_marker_/, "")
    .replace(/[\s-]+/g, "_");
}

/**
 * A unit compared only for spelling: case, spaces and the micro sign. No
 * other equivalence, and never a conversion.
 */
export function labUnitKey(unit: string): string {
  return unit
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/μ/g, "µ")
    .replace(/^u(?=mol|g|iu)/, "µ");
}

/** Units a marker accepts: the one it already uses. A marker without one accepts none. */
function acceptedUnits(marker: { unit: string | null }): string[] {
  const unit = marker.unit?.trim();
  return unit && unit.toLowerCase() !== "varies" ? [unit] : [];
}

/** The Labs screen's own range for a typed-in value. */
const LAB_VALUE_RANGE = { min: 0, max: 100_000 } as const;

function labWriter(db: Database): AiDomainWriter<LabEntryInput> {
  return {
    async prepare(context, entries) {
      const markers = await labMarkers(db, context.scope.organizationId);
      const byKey = new Map<string, (typeof markers)[number]>();
      for (const marker of markers) {
        byKey.set(markerKey(marker.code), marker);
        if (!byKey.has(markerKey(marker.displayName)))
          byKey.set(markerKey(marker.displayName), marker);
      }
      const known = markers
        .map((marker) => ({
          marker: marker.code.slice(BLOOD_MARKER_CODE_PREFIX.length),
          name: marker.displayName,
          accepted_units: acceptedUnits(marker),
        }))
        .sort((a, b) => a.marker.localeCompare(b.marker))
        .slice(0, 50);
      return entries.map((entry, index): LabDraftPayload => {
        const marker = byKey.get(markerKey(entry.marker));
        if (!marker)
          throw new ToolInputError(
            known.length
              ? `Entry ${index}: "${entry.marker}" is not one of the member's lab markers. Their markers: ${known
                  .map(
                    (item) =>
                      `${item.name} (${item.marker}, ${item.accepted_units.join(" or ") || "no unit on file"})`,
                  )
                  .join(", ")}. Results for other markers are added by the member in the app.`
              : `Entry ${index}: the member has no lab markers yet. They add markers in the app first.`,
            { entry: index, known_markers: known },
          );
        const accepted = acceptedUnits(marker);
        const unit = accepted.find((item) => labUnitKey(item) === labUnitKey(entry.unit));
        if (!unit)
          throw new ToolInputError(
            accepted.length
              ? `Entry ${index}: "${entry.unit}" is not an accepted unit for ${marker.displayName}. Accepted units: ${accepted.join(", ")}. No conversion is made: send the value in an accepted unit as written on the report, or leave this result for the member to add in the app.`
              : `Entry ${index}: ${marker.displayName} has no unit on file, so no result can be checked. Accepted units: none. The member can add this result in the app.`,
            { entry: index, marker: marker.code, accepted_units: accepted },
          );
        inRange(
          index,
          marker.displayName,
          entry.value,
          LAB_VALUE_RANGE.min,
          LAB_VALUE_RANGE.max,
          unit,
        );
        const range = entry.referenceRange;
        if (range && range.low !== undefined && range.high !== undefined && range.low > range.high)
          badEntry(index, "the reference range's low is above its high.");
        return {
          observedAt: instantOf(index, entry.at, context.now).toISOString(),
          markerCode: marker.code,
          markerName: marker.displayName,
          value: entry.value,
          unit,
          // Saved only when the app sent one, as the range printed on the report.
          referenceRange: range
            ? {
                low: range.low ?? null,
                high: range.high ?? null,
                text: range.text?.trim() || null,
                source: "report",
              }
            : null,
        };
      });
    },
    async write(context, prepared) {
      const id = await insertDraft(db, context, "lab", prepared as LabDraftPayload);
      return draftEntry("lab", id);
    },
  };
}

// ─── Review: the member confirms or discards a draft ──────────

export type AiAppDraftRow = {
  id: string;
  kind: AiAppDraftKind;
  grantId: string;
  /** The app's name, shown as "via <app>". */
  appName: string;
  createdAt: string;
  payload: AiAppDraftPayload;
};

/** A workout draft confirmed without an exercise for every one that was not in the catalog. */
export class AiAppDraftReviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiAppDraftReviewError";
  }
}

/**
 * The member's side of the drafts (M2c): list the ones waiting, confirm one
 * (its domain rows are written through the same paths as every other AI
 * write, tagged with the app, and its `ai_app_entry` now points at them), or
 * discard one (the draft and its entry are deleted). Only the member's own
 * drafts in the active workspace; anything else is `null` / `false`.
 */
export function createAiAppDraftReview(db: Database) {
  const health = createHealthRecordRepository(db);
  const workouts = createWorkoutRepository(db);

  type Scope = { organizationId: string; userId: string };

  async function find(scope: Scope, draftId: string) {
    const [row] = await db
      .select({
        id: aiAppDraft.id,
        kind: aiAppDraft.kind,
        grantId: aiAppDraft.grantId,
        payload: aiAppDraft.payload,
        appName: aiAppGrant.label,
      })
      .from(aiAppDraft)
      .innerJoin(aiAppGrant, eq(aiAppGrant.id, aiAppDraft.grantId))
      .where(
        and(
          eq(aiAppDraft.id, draftId),
          eq(aiAppDraft.organizationId, scope.organizationId),
          eq(aiAppDraft.userId, scope.userId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /** Deletes the draft; its entry now points at the saved rows, or is deleted with it. */
  async function finish(
    scope: Scope,
    draftId: string,
    saved: { targetTable: "metric_sample" | "workout"; targetIds: number[] } | null,
  ) {
    await db.transaction(async (tx) => {
      const pointsHere = and(
        eq(aiAppEntry.organizationId, scope.organizationId),
        eq(aiAppEntry.userId, scope.userId),
        eq(aiAppEntry.targetTable, "ai_app_draft"),
        sql`${draftId}::uuid = any(${aiAppEntry.targetUuids})`,
      );
      if (saved)
        await tx
          .update(aiAppEntry)
          .set({ targetTable: saved.targetTable, targetIds: saved.targetIds, targetUuids: [] })
          .where(pointsHere);
      else await tx.delete(aiAppEntry).where(pointsHere);
      await tx
        .delete(aiAppDraft)
        .where(
          and(
            eq(aiAppDraft.id, draftId),
            eq(aiAppDraft.organizationId, scope.organizationId),
            eq(aiAppDraft.userId, scope.userId),
          ),
        );
    });
  }

  async function audit(
    scope: Scope,
    eventType: "RECORD_CREATED" | "RECORD_DELETED",
    target: { type: string; id: string },
    grantId: string,
    correlationId: string | undefined,
  ) {
    await writeAuditLog({
      db,
      organizationId: scope.organizationId,
      actorUserId: scope.userId,
      eventType,
      targetType: target.type,
      targetId: target.id,
      correlationId,
      metadata: { resource: "records", action: "write", via: "ai_app_draft", grantId },
    });
  }

  async function confirmLab(
    scope: Scope,
    draft: NonNullable<Awaited<ReturnType<typeof find>>>,
    correlationId: string | undefined,
  ): Promise<number> {
    const lab = draft.payload as LabDraftPayload;
    // Confirming twice finds the reading the first confirm saved.
    const dedupeHash = domainMutationId(draft.id, "lab.confirm");
    const [existing] = await db
      .select({ id: metricSample.id })
      .from(metricSample)
      .where(
        and(
          eq(metricSample.organizationId, scope.organizationId),
          eq(metricSample.dedupeHash, dedupeHash),
        ),
      )
      .limit(1);
    let savedId = existing?.id ?? null;
    if (savedId === null) {
      const row = await health.ingestMetricSample({
        organizationId: scope.organizationId,
        userId: scope.userId,
        payload: {
          metricCode: lab.markerCode,
          observedAt: lab.observedAt,
          valueNumeric: lab.value,
          dedupeHash,
          payload: {
            unit: lab.unit,
            // Only the range the report printed, and only when the app sent it.
            ...(lab.referenceRange
              ? {
                  refRangeLow: lab.referenceRange.low,
                  refRangeHigh: lab.referenceRange.high,
                  refRangeText: lab.referenceRange.text,
                  refRangeSource: "report",
                }
              : {}),
          },
        },
        aiApp: { grantId: draft.grantId, label: draft.appName },
      });
      savedId = row.id;
      await audit(
        scope,
        "RECORD_CREATED",
        { type: "metric_sample", id: String(savedId) },
        draft.grantId,
        correlationId,
      );
    }
    return savedId;
  }

  async function confirmWorkout(
    scope: Scope,
    draft: NonNullable<Awaited<ReturnType<typeof find>>>,
    mapping: ReadonlyMap<number, number>,
    correlationId: string | undefined,
  ): Promise<number> {
    const plan = draft.payload as WorkoutDraftPayload;
    const ids = plan.exercises.map((item, index) => item.exerciseId ?? mapping.get(index) ?? null);
    const missing = ids.findIndex((id) => id === null);
    if (missing !== -1)
      throw new AiAppDraftReviewError(
        `Choose an exercise for "${plan.exercises[missing]!.name}" before saving.`,
      );
    const chosen = ids as number[];
    const names = await visibleExercises(db, scope.organizationId, chosen);
    if (chosen.some((id) => !names.has(id)))
      throw new AiAppDraftReviewError("One of the chosen exercises was not found.");
    const { exercises, ...session } = plan;
    const saved = await db.transaction((tx) =>
      workouts.upsertWorkout(
        tx as Parameters<typeof workouts.upsertWorkout>[0],
        scope.organizationId,
        {
          ...workoutFromDraft(
            session,
            exercises.map((item, index) => ({
              ...item,
              exerciseId: chosen[index]!,
              name: names.get(chosen[index]!)!,
            })),
          ),
          userId: scope.userId,
          // Confirming twice replays the first save.
          clientMutationId: domainMutationUuid(draft.id, "workout.confirm"),
        },
      ),
    );
    if (saved.created !== false)
      await audit(
        scope,
        "RECORD_CREATED",
        { type: "workout", id: String(saved.id) },
        draft.grantId,
        correlationId,
      );
    return saved.id;
  }

  return Object.freeze({
    /** The member's drafts waiting for review, oldest first. */
    async list(input: Scope & { kind?: AiAppDraftKind }): Promise<AiAppDraftRow[]> {
      const rows = await db
        .select({
          id: aiAppDraft.id,
          kind: aiAppDraft.kind,
          grantId: aiAppDraft.grantId,
          payload: aiAppDraft.payload,
          createdAt: aiAppDraft.createdAt,
          appName: aiAppGrant.label,
        })
        .from(aiAppDraft)
        .innerJoin(aiAppGrant, eq(aiAppGrant.id, aiAppDraft.grantId))
        .where(
          and(
            eq(aiAppDraft.organizationId, input.organizationId),
            eq(aiAppDraft.userId, input.userId),
            input.kind ? eq(aiAppDraft.kind, input.kind) : undefined,
          ),
        )
        .orderBy(asc(aiAppDraft.createdAt), asc(aiAppDraft.id))
        .limit(200);
      return rows.map((row) => ({
        id: row.id,
        kind: row.kind as AiAppDraftKind,
        grantId: row.grantId,
        appName: row.appName,
        createdAt: row.createdAt.toISOString(),
        payload: row.payload as AiAppDraftPayload,
      }));
    },

    /**
     * Confirms one draft. A meal draft is done (the member logged its items in
     * the meal diary themselves, each with its own confirmation); a lab result
     * is saved as a reading of its marker with the range from the report; a
     * workout is saved once every exercise that was not in the catalog is
     * mapped to one the workspace can use (`exercises`: position → exercise
     * id, a catalog one or the member's own, made on review). The saved rows
     * keep the app's tag. Confirming twice saves once.
     */
    async confirm(
      input: Scope & {
        draftId: string;
        exercises?: ReadonlyArray<{ index: number; exerciseId: number }>;
        correlationId?: string;
      },
    ): Promise<{ kind: AiAppDraftKind; savedId: number | null } | null> {
      const scope = { organizationId: input.organizationId, userId: input.userId };
      const draft = await find(scope, input.draftId);
      if (!draft) return null;
      const kind = draft.kind as AiAppDraftKind;
      if (kind === "food") {
        await finish(scope, draft.id, null);
        return { kind, savedId: null };
      }
      if (kind === "lab") {
        const savedId = await confirmLab(scope, draft, input.correlationId);
        await finish(scope, draft.id, { targetTable: "metric_sample", targetIds: [savedId] });
        return { kind, savedId };
      }
      const mapping = new Map((input.exercises ?? []).map((item) => [item.index, item.exerciseId]));
      const savedId = await confirmWorkout(scope, draft, mapping, input.correlationId);
      await finish(scope, draft.id, { targetTable: "workout", targetIds: [savedId] });
      return { kind, savedId };
    },

    /** Discards one draft: it and its entry are deleted, and nothing is saved. */
    async discard(input: Scope & { draftId: string; correlationId?: string }): Promise<boolean> {
      const scope = { organizationId: input.organizationId, userId: input.userId };
      const draft = await find(scope, input.draftId);
      if (!draft) return false;
      await finish(scope, draft.id, null);
      await audit(
        scope,
        "RECORD_DELETED",
        { type: "ai_app_draft", id: draft.id },
        draft.grantId,
        input.correlationId,
      );
      return true;
    },
  });
}

export type AiAppDraftReview = ReturnType<typeof createAiAppDraftReview>;

// ─── Delete ───────────────────────────────────────────────────

/** The domain write paths for AI app writes, bound to one database. */
export function createAiAppWriteTargets(db: Database): McpWriteTargets {
  const diary = createPlainWaterDiary(db);
  const workouts = createWorkoutRepository(db);
  const trackers = createTrackerService({ db });
  const pain = createPainService({ db });

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
      case "workout": {
        for (const id of entry.targetIds) {
          for (let attempt = 0; attempt < 3; attempt += 1) {
            const [current] = await db
              .select({ version: workout.version })
              .from(workout)
              .where(
                and(
                  eq(workout.id, id),
                  eq(workout.organizationId, scope.organizationId),
                  eq(workout.userId, scope.userId),
                ),
              )
              .limit(1);
            if (!current) break;
            try {
              await db.transaction((tx) =>
                workouts.mutateWorkout(tx, {
                  organizationId: scope.organizationId,
                  userId: scope.userId,
                  clientMutationId: domainMutationUuid(
                    context.entryKey,
                    `workout.delete:${id}:${current.version}`,
                  ),
                  expectedScope: `${scope.userId}:${scope.organizationId}`,
                  operation: "delete",
                  id,
                  expectedVersion: current.version,
                }),
              );
              deleted += 1;
              break;
            } catch (error) {
              if (error instanceof WorkoutNotFoundError) break;
              if (
                error instanceof WorkoutVersionConflictError ||
                error instanceof WorkoutMutationConflictError
              )
                continue;
              throw error;
            }
          }
        }
        break;
      }
      case "health_event": {
        // Only a manual night this very grant wrote: never a device night.
        for (const id of entry.targetIds)
          if (
            await deleteManualSleepSession(db, {
              organizationId: scope.organizationId,
              userId: scope.userId,
              id,
              aiAppGrantId: context.source.grantId,
            })
          )
            deleted += 1;
        break;
      }
      case "custom_tracker_entry": {
        for (const id of entry.targetUuids) {
          try {
            await trackers.deleteEntry({ ...scope, canWrite: true }, id);
            deleted += 1;
          } catch (error) {
            if (!(error instanceof TrackerError)) throw error;
          }
        }
        break;
      }
      case "pain_entry": {
        for (const id of entry.targetUuids) if (await pain.delete(scope, id)) deleted += 1;
        break;
      }
      case "ai_app_draft": {
        // Only a draft this very grant made, still waiting for review.
        if (entry.targetUuids.length === 0) break;
        const rows = await db
          .delete(aiAppDraft)
          .where(
            and(
              inArray(aiAppDraft.id, [...entry.targetUuids]),
              eq(aiAppDraft.organizationId, scope.organizationId),
              eq(aiAppDraft.userId, scope.userId),
              eq(aiAppDraft.grantId, context.source.grantId),
            ),
          )
          .returning({ id: aiAppDraft.id });
        deleted += rows.length;
        break;
      }
    }
    return deleted > 0 ? "deleted" : "gone";
  };

  const removeDrafts: McpWriteTargets["removeDrafts"] = async ({ scope, grantId }) => {
    const rows = await db
      .delete(aiAppDraft)
      .where(
        and(
          eq(aiAppDraft.grantId, grantId),
          eq(aiAppDraft.organizationId, scope.organizationId),
          eq(aiAppDraft.userId, scope.userId),
        ),
      )
      .returning({ id: aiAppDraft.id });
    return rows.length;
  };

  return {
    water: waterWriter(db),
    body: metricWriter<BodyEntryInput>(db, prepareBody),
    vitals: metricWriter<VitalEntryInput>(db, prepareVital),
    supplements: supplementWriter(db),
    workouts: workoutWriter(db),
    sleep: sleepWriter(db),
    trackers: trackerWriter(db),
    pain: painWriter(db),
    food: foodWriter(db),
    labs: labWriter(db),
    remove,
    removeDrafts,
  };
}
