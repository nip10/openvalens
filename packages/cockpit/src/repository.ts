import type { Database } from "@openhealth/db";
import { weeklyReview } from "@openhealth/db/schema/plans";
import { and, eq, gte, lte } from "drizzle-orm";

/**
 * Cockpit repository (Issue #16).
 *
 * Persists the `weekly_review` row that anchors the cockpit weekly
 * review surface. The table is org-scoped; the handler always passes
 * `organizationId` from authz. No PHI is logged; review notes are
 * clipped at the boundary.
 *
 * Reads from this repository are intentionally scoped to a single
 * org's most-recent row in a date window — the cockpit does not need
 * a full review history to compute the weekly report, and any UI
 * listing is owned by a separate `plans` procedure in a future
 * issue. Cross-domain slices (weight, sleep, goals, insights) are
 * consumed via typed contracts in `cockpit/repository.facade.ts`.
 */

export type CockpitReviewRow = {
  id: number;
  organizationId: string;
  weekStart: string;
  adherence: number | null;
  energy: number | null;
  sleep: number | null;
  notes: string | null;
  createdAt: string;
};

export type LogReviewInput = {
  weekStart: string;
  adherence: number | null;
  energy: number | null;
  sleep: number | null;
  notes: string | null;
};

export type CockpitRepository = ReturnType<typeof createCockpitRepository>;

export function createCockpitRepository(db: Database) {
  return {
    async logReview(organizationId: string, input: LogReviewInput): Promise<CockpitReviewRow> {
      const inserted = (await db
        .insert(weeklyReview)
        .values({
          organizationId,
          weekStart: input.weekStart,
          adherence: input.adherence,
          energy: input.energy,
          sleep: input.sleep,
          notes: input.notes,
        })
        .returning()) as CockpitReviewRow[];
      const row = inserted[0];
      if (!row) throw new Error("Cockpit review insert did not return a row");
      return row;
    },

    async findReviewForWeek(
      organizationId: string,
      start: string,
      end: string,
    ): Promise<CockpitReviewRow | null> {
      const rows = (await db
        .select()
        .from(weeklyReview)
        .where(
          and(
            eq(weeklyReview.organizationId, organizationId),
            gte(weeklyReview.weekStart, start),
            lte(weeklyReview.weekStart, end),
          ),
        )
        .limit(1)) as CockpitReviewRow[];
      return rows[0] ?? null;
    },
  };
}
