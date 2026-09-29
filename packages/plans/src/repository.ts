import type { Database } from "@openhealth/db";
import {
  medication,
  supplement,
  supplementChange,
  supplementSchedule,
} from "@openhealth/db/schema/plans";
import { and, desc, eq, inArray } from "drizzle-orm";

import { countActiveSchedules, deriveChangeHistory, reshapeSupplementList } from "./derived";
import type {
  Medication,
  Supplement,
  SupplementChange,
  SupplementChangeType,
  SupplementListItem,
  SupplementSchedule,
  SupplementScheduleStatus,
} from "./types";

/**
 * Org-scoped CRUD repository for supplements & medications (Issue #22).
 *
 * Tables:
 *
 * - `supplement`            — global catalog, no org column. We surface only
 *   supplements with at least one schedule row in the active org.
 * - `supplement_schedule`   — org-scoped; `userId` from authz on writes.
 * - `supplement_change`     — org-scoped history.
 * - `medication`            — directly org + user scoped.
 *
 * No PHI is logged. Notes / reasons round-trip but never appear in any log.
 */

export type UpsertSupplementInput =
  | {
      kind?: "create";
      name: string;
      dose: string;
      form?: string | null;
      category?: string | null;
    }
  | {
      kind: "update";
      id: number;
      name?: string;
      dose?: string;
      form?: string | null;
      category?: string | null;
    };

export type UpsertSupplementResult = {
  id: number;
  created: boolean;
};

export type UpsertMedicationInput = {
  id?: number;
  userId: string;
  name: string;
  dose?: string | null;
  route?: string | null;
  protocol?: string | null;
  frequency?: string | null;
  status?: Medication["status"];
  interactions?: string | null;
  notes?: string | null;
};

export type UpsertMedicationResult = {
  id: number;
  created: boolean;
};

export type UpsertScheduleInput = {
  id?: number;
  organizationId: string;
  userId: string;
  supplementId: number;
  timeOfDay: string;
  frequency?: string | null;
  quantity?: string | null;
  notes?: string | null;
  status?: SupplementScheduleStatus;
};

export type UpsertScheduleResult = {
  id: number;
  created: boolean;
};

export type DeleteCascadeCounts = {
  schedulesDeleted: number;
  changesDeleted: number;
};

export type Repository = ReturnType<typeof createPlansRepository>;

export function createPlansRepository(db: Database) {
  return {
    // ─── supplements ────────────────────────────────────────────

    async listSupplements(organizationId: string): Promise<SupplementListItem[]> {
      // 1. Find every supplement that has at least one schedule in this org.
      const scheduleRows = await db
        .select({
          supplementId: supplementSchedule.supplementId,
          status: supplementSchedule.status,
        })
        .from(supplementSchedule)
        .where(eq(supplementSchedule.organizationId, organizationId));

      const supplementIds = Array.from(new Set(scheduleRows.map((r) => r.supplementId)));
      if (supplementIds.length === 0) return [];

      const supplements = (await db
        .select()
        .from(supplement)
        .where(inArray(supplement.id, supplementIds))) as Supplement[];

      // 2. Aggregate latest change per supplement.
      const changes = (await db
        .select()
        .from(supplementChange)
        .where(
          and(
            eq(supplementChange.organizationId, organizationId),
            inArray(supplementChange.supplementId, supplementIds),
          ),
        )
        .orderBy(desc(supplementChange.date), desc(supplementChange.id))) as SupplementChange[];

      const changesBySupplementId = new Map<number, SupplementChange[]>();
      for (const change of changes) {
        if (change.supplementId == null) continue;
        const list = changesBySupplementId.get(change.supplementId) ?? [];
        list.push(change);
        changesBySupplementId.set(change.supplementId, list);
      }

      // 3. Active-schedule count per supplement.
      const schedulesBySupplementId = new Map<number, Array<Pick<SupplementSchedule, "status">>>();
      for (const row of scheduleRows) {
        const list = schedulesBySupplementId.get(row.supplementId) ?? [];
        list.push({ status: row.status as SupplementScheduleStatus });
        schedulesBySupplementId.set(row.supplementId, list);
      }

      return reshapeSupplementList(supplements, changesBySupplementId, schedulesBySupplementId);
    },

    async getSupplement(id: number): Promise<Supplement | null> {
      const rows = (await db
        .select()
        .from(supplement)
        .where(eq(supplement.id, id))
        .limit(1)) as Supplement[];
      return rows[0] ?? null;
    },

    async upsertSupplement(input: UpsertSupplementInput): Promise<UpsertSupplementResult> {
      if (input.kind === "update") {
        const update: Partial<Supplement> = {};
        if (input.name !== undefined) update.name = input.name;
        if (input.dose !== undefined) update.dose = input.dose;
        if (input.form !== undefined) update.form = input.form;
        if (input.category !== undefined) update.category = input.category;

        await db.update(supplement).set(update).where(eq(supplement.id, input.id));
        return { id: input.id, created: false };
      }

      const insertValues: Supplement = {
        id: 0,
        name: input.name,
        dose: input.dose,
        form: input.form ?? null,
        category: input.category ?? null,
      };
      const [row] = (await db.insert(supplement).values(insertValues).returning()) as Supplement[];
      if (!row) throw new Error("Supplement insert did not return a row");
      return { id: row.id, created: true };
    },

    /**
     * Delete a supplement and its schedules/changes. The schema's FKs use
     * default `NO ACTION`, so the delete must be ordered: changes, schedules,
     * supplement. The org check runs on schedules (the only org-scoped link).
     */
    async deleteSupplement(organizationId: string, id: number): Promise<DeleteCascadeCounts> {
      // Confirm org ownership via the schedule rows. Returns 0 when the
      // supplement has no schedules in this org.
      const ownSchedules = (await db
        .select({ id: supplementSchedule.id })
        .from(supplementSchedule)
        .where(
          and(
            eq(supplementSchedule.organizationId, organizationId),
            eq(supplementSchedule.supplementId, id),
          ),
        )) as Array<{ id: number }>;

      if (ownSchedules.length === 0) {
        // Even if the supplement has no schedules in this org, we must still
        // verify there are no schedules in *any* org before deleting the
        // catalog row — supplements are shared.
        const anySchedules = (await db
          .select({ id: supplementSchedule.id })
          .from(supplementSchedule)
          .where(eq(supplementSchedule.supplementId, id))
          .limit(1)) as Array<{ id: number }>;
        if (anySchedules.length > 0) {
          throw new Error(
            "Supplement is referenced by schedules outside the active organization; refusing to delete.",
          );
        }
        // No schedules anywhere — safe to delete the catalog row + any change history.
        await db.delete(supplementChange).where(eq(supplementChange.supplementId, id));
        await db.delete(supplement).where(eq(supplement.id, id));
        return { schedulesDeleted: 0, changesDeleted: 0 };
      }

      // Owned by this org via at least one schedule — cascade.
      const scheduleIds = ownSchedules.map((s) => s.id);
      await db
        .delete(supplementChange)
        .where(
          and(
            eq(supplementChange.organizationId, organizationId),
            eq(supplementChange.supplementId, id),
          ),
        );
      await db
        .delete(supplementSchedule)
        .where(
          and(
            eq(supplementSchedule.organizationId, organizationId),
            eq(supplementSchedule.supplementId, id),
          ),
        );
      await db.delete(supplement).where(eq(supplement.id, id));
      return { schedulesDeleted: scheduleIds.length, changesDeleted: 0 };
    },

    // ─── medications ────────────────────────────────────────────

    async listMedications(organizationId: string): Promise<Medication[]> {
      return (await db
        .select()
        .from(medication)
        .where(eq(medication.organizationId, organizationId))
        .orderBy(desc(medication.id))) as Medication[];
    },

    async getMedication(organizationId: string, id: number): Promise<Medication | null> {
      const rows = (await db
        .select()
        .from(medication)
        .where(and(eq(medication.organizationId, organizationId), eq(medication.id, id)))
        .limit(1)) as Medication[];
      return rows[0] ?? null;
    },

    async upsertMedication(
      organizationId: string,
      input: UpsertMedicationInput,
    ): Promise<UpsertMedicationResult> {
      if (input.id !== undefined) {
        const update: Partial<Medication> = {};
        if (input.name !== undefined) update.name = input.name;
        if (input.dose !== undefined) update.dose = input.dose;
        if (input.route !== undefined) update.route = input.route;
        if (input.protocol !== undefined) update.protocol = input.protocol;
        if (input.frequency !== undefined) update.frequency = input.frequency;
        if (input.status !== undefined) update.status = input.status;
        if (input.interactions !== undefined) update.interactions = input.interactions;
        if (input.notes !== undefined) update.notes = input.notes;

        await db
          .update(medication)
          .set(update)
          .where(and(eq(medication.organizationId, organizationId), eq(medication.id, input.id)));
        return { id: input.id, created: false };
      }

      const insertValues: Medication = {
        id: 0,
        organizationId,
        userId: input.userId,
        name: input.name,
        dose: input.dose ?? null,
        route: input.route ?? null,
        protocol: input.protocol ?? null,
        frequency: input.frequency ?? null,
        status: input.status ?? "active",
        interactions: input.interactions ?? null,
        notes: input.notes ?? null,
      };
      const [row] = (await db.insert(medication).values(insertValues).returning()) as Medication[];
      if (!row) throw new Error("Medication insert did not return a row");
      return { id: row.id, created: true };
    },

    async deleteMedication(organizationId: string, id: number): Promise<{ id: number } | null> {
      const existing = await this.getMedication(organizationId, id);
      if (!existing) return null;
      await db
        .delete(medication)
        .where(and(eq(medication.organizationId, organizationId), eq(medication.id, id)));
      return { id };
    },

    // ─── schedules ──────────────────────────────────────────────

    async listSchedules(
      organizationId: string,
      supplementId: number,
    ): Promise<SupplementSchedule[]> {
      return (await db
        .select()
        .from(supplementSchedule)
        .where(
          and(
            eq(supplementSchedule.organizationId, organizationId),
            eq(supplementSchedule.supplementId, supplementId),
          ),
        )
        .orderBy(desc(supplementSchedule.id))) as SupplementSchedule[];
    },

    async getSchedule(organizationId: string, id: number): Promise<SupplementSchedule | null> {
      const rows = (await db
        .select()
        .from(supplementSchedule)
        .where(
          and(eq(supplementSchedule.organizationId, organizationId), eq(supplementSchedule.id, id)),
        )
        .limit(1)) as SupplementSchedule[];
      return rows[0] ?? null;
    },

    async upsertSchedule(input: UpsertScheduleInput): Promise<UpsertScheduleResult> {
      if (input.id !== undefined) {
        const update: Partial<SupplementSchedule> = {};
        if (input.timeOfDay !== undefined) update.timeOfDay = input.timeOfDay;
        if (input.frequency !== undefined) update.frequency = input.frequency;
        if (input.quantity !== undefined) update.quantity = input.quantity;
        if (input.notes !== undefined) update.notes = input.notes;
        if (input.status !== undefined) update.status = input.status;

        await db
          .update(supplementSchedule)
          .set(update)
          .where(
            and(
              eq(supplementSchedule.organizationId, input.organizationId),
              eq(supplementSchedule.id, input.id),
            ),
          );
        return { id: input.id, created: false };
      }

      const insertValues: SupplementSchedule = {
        id: 0,
        organizationId: input.organizationId,
        userId: input.userId,
        supplementId: input.supplementId,
        timeOfDay: input.timeOfDay,
        quantity: input.quantity ?? null,
        frequency: input.frequency ?? null,
        notes: input.notes ?? null,
        status: input.status ?? "active",
      };
      const [row] = (await db
        .insert(supplementSchedule)
        .values(insertValues)
        .returning()) as SupplementSchedule[];
      if (!row) throw new Error("Supplement schedule insert did not return a row");
      return { id: row.id, created: true };
    },

    async deleteSchedule(organizationId: string, id: number): Promise<{ id: number } | null> {
      const existing = await this.getSchedule(organizationId, id);
      if (!existing) return null;
      await db
        .delete(supplementSchedule)
        .where(
          and(eq(supplementSchedule.organizationId, organizationId), eq(supplementSchedule.id, id)),
        );
      return { id };
    },

    // ─── change history ─────────────────────────────────────────

    async listChanges(
      organizationId: string,
      supplementId: number,
      limit = 50,
    ): Promise<SupplementChange[]> {
      const rows = (await db
        .select()
        .from(supplementChange)
        .where(
          and(
            eq(supplementChange.organizationId, organizationId),
            eq(supplementChange.supplementId, supplementId),
          ),
        )
        .orderBy(desc(supplementChange.date), desc(supplementChange.id))
        .limit(limit)) as SupplementChange[];
      return deriveChangeHistory(rows);
    },

    async recordChange(
      organizationId: string,
      input: {
        supplementId: number;
        changeType: SupplementChangeType;
        date: string;
        reason?: string | null;
        details?: string | null;
      },
    ): Promise<SupplementChange> {
      const [row] = (await db
        .insert(supplementChange)
        .values({
          organizationId,
          date: input.date,
          supplementId: input.supplementId,
          changeType: input.changeType,
          reason: input.reason ?? null,
          details: input.details ?? null,
        })
        .returning()) as SupplementChange[];
      if (!row) throw new Error("Supplement change insert did not return a row");
      return row;
    },
  };
}

// Re-export helpers used by tests so the test file can reach them without
// importing the derived module directly.
export { countActiveSchedules };
