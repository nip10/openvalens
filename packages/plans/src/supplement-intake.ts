import { createHash } from "node:crypto";
import type { Database, DbTransaction } from "@openvalens/db";
import { supplement, supplementIntake, goalMutation } from "@openvalens/db/schema/plans";
import { and, asc, eq, gte, isNull, lte, sql } from "drizzle-orm";

export type SupplementIntake = {
  id: number;
  supplementId: number;
  occurredAt: string;
  timeZone: string;
  dose: string;
  note: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

type OwnerScope = { organizationId: string; userId: string };
type IntakePayload = {
  supplementId: number;
  occurredAt: string;
  timeZone: string;
  dose: string;
  note?: string | null;
};
type ReceiptInput = { clientMutationId: string };

export class SupplementIntakeNotFoundError extends Error {}
export class SupplementIntakeConflictError extends Error {}
export class SupplementIntakeValidationError extends Error {}
export class SupplementIntakeMutationConflictError extends Error {}

const OPERATION = "supplement_intake";
const MAX_FUTURE_SKEW_MS = 60_000;

export function isValidIntakeTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function parseIsoInstant(value: string): Date | null {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|([+-])(\d{2}):(\d{2}))$/.exec(
      value,
    );
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > (daysInMonth ?? 0) ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    (match[9] !== undefined && (Number(match[9]) > 23 || Number(match[10]) > 59))
  )
    return null;
  const instant = new Date(value);
  return Number.isFinite(instant.getTime()) ? instant : null;
}

/** Validate a complete RFC3339 instant, IANA zone and non-future occurrence. */
export function validateSupplementIntakePayload(input: IntakePayload): IntakePayload {
  if (!Number.isSafeInteger(input.supplementId) || input.supplementId <= 0)
    throw new SupplementIntakeValidationError("A selected supplement is required");
  if (typeof input.occurredAt !== "string")
    throw new SupplementIntakeValidationError("occurredAt must be an ISO instant");
  const occurredAt = parseIsoInstant(input.occurredAt);
  if (!occurredAt)
    throw new SupplementIntakeValidationError("occurredAt must be a valid ISO instant");
  if (occurredAt.getTime() > Date.now() + MAX_FUTURE_SKEW_MS)
    throw new SupplementIntakeValidationError("Future supplement intakes are not allowed");
  if (!isValidIntakeTimeZone(input.timeZone))
    throw new SupplementIntakeValidationError("timeZone must be a valid IANA timezone");
  if (typeof input.dose !== "string" || input.dose.trim().length === 0 || input.dose.length > 120)
    throw new SupplementIntakeValidationError("dose must contain 1 to 120 characters");
  if (input.note != null && (typeof input.note !== "string" || input.note.length > 2000))
    throw new SupplementIntakeValidationError("note must be at most 2000 characters");
  return {
    ...input,
    occurredAt: occurredAt.toISOString(),
    timeZone: input.timeZone,
    dose: input.dose.trim(),
    note: input.note?.trim() || null,
  };
}

function toIntake(row: typeof supplementIntake.$inferSelect): SupplementIntake {
  return {
    id: row.id,
    supplementId: row.supplementId,
    occurredAt: row.occurredAt.toISOString(),
    timeZone: row.timezone,
    dose: row.dose,
    note: row.note,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function fingerprint(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function mutationLockKey(scope: OwnerScope, id: string): string {
  return `supplement-intake:${scope.organizationId}:${scope.userId}:${id.toLowerCase()}`;
}

function validateMutationId(value: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
    throw new SupplementIntakeValidationError("clientMutationId must be a UUID");
}

/** Owner-scoped actual supplement intake CRUD with transactional retry receipts. */
export function createSupplementIntakeRepository(db: Database, scope: OwnerScope) {
  if (!scope.organizationId || !scope.userId)
    throw new TypeError("Organization and authenticated user are required");

  const ownerWhere = (id?: number) =>
    and(
      eq(supplementIntake.organizationId, scope.organizationId),
      eq(supplementIntake.userId, scope.userId),
      isNull(supplementIntake.deletedAt),
      ...(id === undefined ? [] : [eq(supplementIntake.id, id)]),
    );

  async function withReceipt<T extends object>(
    input: ReceiptInput,
    operation: "create" | "update" | "delete",
    request: unknown,
    apply: (tx: DbTransaction) => Promise<T>,
  ): Promise<T> {
    validateMutationId(input.clientMutationId);
    const requestFingerprint = fingerprint({ operation, request });
    return db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${mutationLockKey(scope, input.clientMutationId)}, 0))`,
      );
      const existing = (
        await tx
          .select()
          .from(goalMutation)
          .where(
            and(
              eq(goalMutation.organizationId, scope.organizationId),
              eq(goalMutation.userId, scope.userId),
              eq(goalMutation.clientMutationId, input.clientMutationId),
            ),
          )
          .limit(1)
      )[0];
      if (existing) {
        if (
          existing.operation !== `${OPERATION}.${operation}` ||
          existing.fingerprint !== requestFingerprint
        )
          throw new SupplementIntakeMutationConflictError(
            "Mutation key was already used for a different request",
          );
        const prior = existing.result as T;
        // A replay returns the original row/result without claiming a second
        // creation; distinct mutation IDs still preserve separate doses.
        if (operation === "create" && "created" in prior) return { ...prior, created: false } as T;
        return prior;
      }
      const result = await apply(tx);
      await tx.insert(goalMutation).values({
        organizationId: scope.organizationId,
        userId: scope.userId,
        clientMutationId: input.clientMutationId,
        operation: `${OPERATION}.${operation}`,
        targetId: "id" in result && typeof result.id === "number" ? result.id : null,
        fingerprint: requestFingerprint,
        result,
      });
      return result;
    });
  }

  async function assertSelectedSupplement(tx: DbTransaction, id: number) {
    const [selected] = await tx
      .select({ id: supplement.id })
      .from(supplement)
      .where(eq(supplement.id, id))
      .limit(1);
    if (!selected) throw new SupplementIntakeNotFoundError("Supplement not found");
  }

  return {
    async list(range: { from?: string; to?: string } = {}): Promise<SupplementIntake[]> {
      const from = range.from === undefined ? undefined : parseRangeInstant(range.from, "from");
      const to = range.to === undefined ? undefined : parseRangeInstant(range.to, "to");
      if (from && to && from > to)
        throw new SupplementIntakeValidationError("from must not be after to");
      const rows = await db
        .select()
        .from(supplementIntake)
        .where(
          and(
            eq(supplementIntake.organizationId, scope.organizationId),
            eq(supplementIntake.userId, scope.userId),
            isNull(supplementIntake.deletedAt),
            ...(from ? [gte(supplementIntake.occurredAt, from)] : []),
            ...(to ? [lte(supplementIntake.occurredAt, to)] : []),
          ),
        )
        .orderBy(asc(supplementIntake.occurredAt), asc(supplementIntake.id));
      return rows.map(toIntake);
    },

    async create(
      input: IntakePayload & ReceiptInput,
    ): Promise<{ intake: SupplementIntake; created: boolean }> {
      const payload = validateSupplementIntakePayload(input);
      return withReceipt(input, "create", payload, async (tx) => {
        await assertSelectedSupplement(tx, payload.supplementId);
        const [row] = await tx
          .insert(supplementIntake)
          .values({
            organizationId: scope.organizationId,
            userId: scope.userId,
            supplementId: payload.supplementId,
            occurredAt: new Date(payload.occurredAt),
            timezone: payload.timeZone,
            dose: payload.dose,
            note: payload.note ?? null,
          })
          .returning();
        return { intake: toIntake(row!), created: true };
      });
    },

    async update(
      input: { id: number; version: number; clientMutationId: string } & Partial<IntakePayload>,
    ): Promise<SupplementIntake> {
      if (
        !Number.isSafeInteger(input.id) ||
        input.id <= 0 ||
        !Number.isSafeInteger(input.version) ||
        input.version <= 0
      )
        throw new SupplementIntakeValidationError("id and version must be positive integers");
      const currentFields = { ...input };
      delete (currentFields as Partial<typeof input>).id;
      delete (currentFields as Partial<typeof input>).version;
      delete (currentFields as Partial<typeof input>).clientMutationId;
      if (!Object.keys(currentFields).length)
        throw new SupplementIntakeValidationError("At least one intake field must be changed");
      return withReceipt(
        input,
        "update",
        { id: input.id, version: input.version, fields: currentFields },
        async (tx) => {
          const current = (
            await tx.select().from(supplementIntake).where(ownerWhere(input.id)).limit(1)
          )[0];
          if (!current) throw new SupplementIntakeNotFoundError("Supplement intake not found");
          if (current.version !== input.version)
            throw new SupplementIntakeConflictError("Supplement intake version changed");
          const merged = validateSupplementIntakePayload({
            supplementId: input.supplementId ?? current.supplementId,
            occurredAt: input.occurredAt ?? current.occurredAt.toISOString(),
            timeZone: input.timeZone ?? current.timezone,
            dose: input.dose ?? current.dose,
            note: input.note !== undefined ? input.note : current.note,
          });
          if (input.supplementId !== undefined)
            await assertSelectedSupplement(tx, input.supplementId);
          const now = new Date();
          const retired = await tx
            .update(supplementIntake)
            .set({ deletedAt: now, version: current.version + 1, updatedAt: now })
            .where(and(ownerWhere(input.id), eq(supplementIntake.version, input.version)))
            .returning({ id: supplementIntake.id });
          if (!retired.length)
            throw new SupplementIntakeConflictError("Supplement intake version changed");
          const [correction] = await tx
            .insert(supplementIntake)
            .values({
              organizationId: scope.organizationId,
              userId: scope.userId,
              supplementId: merged.supplementId,
              occurredAt: new Date(merged.occurredAt),
              timezone: merged.timeZone,
              dose: merged.dose,
              note: merged.note ?? null,
              version: current.version + 1,
              correctedFromId: current.id,
            })
            .returning();
          return toIntake(correction!);
        },
      );
    },

    async delete(input: {
      id: number;
      version: number;
      clientMutationId: string;
    }): Promise<{ id: number; version: number; deleted: true }> {
      if (
        !Number.isSafeInteger(input.id) ||
        input.id <= 0 ||
        !Number.isSafeInteger(input.version) ||
        input.version <= 0
      )
        throw new SupplementIntakeValidationError("id and version must be positive integers");
      return withReceipt(input, "delete", { id: input.id, version: input.version }, async (tx) => {
        const [deleted] = await tx
          .update(supplementIntake)
          .set({ deletedAt: new Date(), version: input.version + 1, updatedAt: new Date() })
          .where(and(ownerWhere(input.id), eq(supplementIntake.version, input.version)))
          .returning({ id: supplementIntake.id, version: supplementIntake.version });
        if (!deleted) {
          const current = (
            await tx
              .select({ version: supplementIntake.version })
              .from(supplementIntake)
              .where(
                and(
                  eq(supplementIntake.organizationId, scope.organizationId),
                  eq(supplementIntake.userId, scope.userId),
                  eq(supplementIntake.id, input.id),
                ),
              )
              .limit(1)
          )[0];
          if (!current) throw new SupplementIntakeNotFoundError("Supplement intake not found");
          throw new SupplementIntakeConflictError(
            "Supplement intake version changed or is deleted",
          );
        }
        return { id: deleted.id, version: deleted.version, deleted: true };
      });
    },
  };
}

function parseRangeInstant(value: string, field: "from" | "to"): Date {
  const parsed = parseIsoInstant(value);
  if (!parsed) throw new SupplementIntakeValidationError(`${field} must be a valid ISO instant`);
  return parsed;
}
