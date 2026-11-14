import type { Database } from "@openvalens/db";
import { ownOrUnattributed } from "@openvalens/db/member-private";
import {
  bodyCompEvent,
  dailyWeight,
  dexaRegional,
  dexaScan,
  weightCheckin,
  weightEvent,
} from "@openvalens/db/schema/body";
import { and, asc, between, desc, eq } from "drizzle-orm";

/**
 * Weigh-ins are private to their member (#509), like workouts: every weight
 * read here takes the reading member. Canonical daily rows and
 * body-composition events always carry an author; legacy check-ins saved
 * before authors were recorded have none and stay visible to the workspace.
 * DEXA scans are imported clinical reports with no author, like blood panels,
 * and belong to the workspace.
 */

/** Historical check-ins, intentionally independent of the materialized daily canonical view. */
export async function listLegacyCheckins(
  db: Database,
  organizationId: string,
  userId: string | null,
  limit: number,
) {
  return db
    .select()
    .from(weightCheckin)
    .where(
      and(
        eq(weightCheckin.organizationId, organizationId),
        ownOrUnattributed(weightCheckin.userId, userId),
      ),
    )
    .orderBy(desc(weightCheckin.date), desc(weightCheckin.id))
    .limit(limit);
}

/** Reads the materialized canonical daily rows, not raw events or the legacy check-in table. */
export async function listCanonicalDailyWeights(
  db: Database,
  organizationId: string,
  userId: string,
  limit: number,
) {
  return db
    .select({
      id: dailyWeight.id,
      date: dailyWeight.date,
      weightKg: dailyWeight.weightKg,
      source: dailyWeight.source,
      resolvedFromEventId: dailyWeight.resolvedFromEventId,
      confidence: weightEvent.confidence,
      createdAt: dailyWeight.createdAt,
      updatedAt: dailyWeight.updatedAt,
    })
    .from(dailyWeight)
    .leftJoin(
      weightEvent,
      and(
        eq(dailyWeight.resolvedFromEventId, weightEvent.id),
        eq(dailyWeight.organizationId, weightEvent.organizationId),
      ),
    )
    .where(and(eq(dailyWeight.organizationId, organizationId), eq(dailyWeight.userId, userId)))
    .orderBy(desc(dailyWeight.date), desc(dailyWeight.id))
    .limit(limit);
}

/**
 * One member's canonical daily rows for an inclusive range of local dates,
 * oldest first (Issue #87 trend input). Scoped by organization AND user.
 */
export async function listCanonicalDailyWeightsBetween(
  db: Pick<Database, "select">,
  scope: { organizationId: string; userId: string },
  from: string,
  to: string,
) {
  return db
    .select({ date: dailyWeight.date, weightKg: dailyWeight.weightKg, source: dailyWeight.source })
    .from(dailyWeight)
    .where(
      and(
        eq(dailyWeight.organizationId, scope.organizationId),
        eq(dailyWeight.userId, scope.userId),
        between(dailyWeight.date, from, to),
      ),
    )
    .orderBy(asc(dailyWeight.date), asc(dailyWeight.id));
}

// ─── DEXA scans (Issue #21, second half) ────────────────────────

export async function listAllDexaScans(db: Database, organizationId: string) {
  return db
    .select()
    .from(dexaScan)
    .where(eq(dexaScan.organizationId, organizationId))
    .orderBy(desc(dexaScan.date), desc(dexaScan.id));
}

export async function getLatestDexaScan(db: Database, organizationId: string) {
  const rows = await db
    .select()
    .from(dexaScan)
    .where(eq(dexaScan.organizationId, organizationId))
    .orderBy(desc(dexaScan.date), desc(dexaScan.id))
    .limit(1);
  return rows[0] ?? null;
}

export async function listDexaRegionals(db: Database, organizationId: string, scanId: number) {
  return db
    .select()
    .from(dexaRegional)
    .where(and(eq(dexaRegional.organizationId, organizationId), eq(dexaRegional.scanId, scanId)));
}

// ─── Latest weight + body-composition timeline (Issue #21) ──────

/** The member's latest canonical row, or `null` (always `null` with no member). */
export async function getLatestCanonicalWeight(
  db: Database,
  organizationId: string,
  userId: string | null,
) {
  if (!userId) return null;
  const rows = await db
    .select({
      id: dailyWeight.id,
      organizationId: dailyWeight.organizationId,
      userId: dailyWeight.userId,
      date: dailyWeight.date,
      weightKg: dailyWeight.weightKg,
      source: dailyWeight.source,
      confidence: weightEvent.confidence,
      resolvedFromEventId: dailyWeight.resolvedFromEventId,
      createdAt: dailyWeight.createdAt,
      updatedAt: dailyWeight.updatedAt,
    })
    .from(dailyWeight)
    .leftJoin(
      weightEvent,
      and(
        eq(dailyWeight.resolvedFromEventId, weightEvent.id),
        eq(dailyWeight.organizationId, weightEvent.organizationId),
      ),
    )
    .where(and(eq(dailyWeight.organizationId, organizationId), eq(dailyWeight.userId, userId)))
    .orderBy(desc(dailyWeight.date), desc(dailyWeight.id))
    .limit(1);
  return rows[0] ?? null;
}

/** Latest legacy check-in (pre-materialized fallback) the member may see, or `null`. */
export async function getLatestLegacyWeight(
  db: Database,
  organizationId: string,
  userId: string | null,
) {
  const rows = await listLegacyCheckins(db, organizationId, userId, 1);
  return rows[0] ?? null;
}

/**
 * Mirrors anchovy `getLatestWeight`: prefer the member's latest canonical row,
 * fall back to the latest legacy check-in they may see. Returns the legacy
 * shape so the caller can consume a single envelope without further mapping.
 * Returns `null` when there is neither.
 */
export async function getLatestWeight(db: Database, organizationId: string, userId: string | null) {
  const canonical = await getLatestCanonicalWeight(db, organizationId, userId);
  if (canonical) {
    return {
      id: canonical.id,
      organizationId: canonical.organizationId,
      date: canonical.date,
      weightKg: canonical.weightKg,
      bodyFatPct: null,
      notes: null,
      createdAt: canonical.createdAt,
    };
  }
  return getLatestLegacyWeight(db, organizationId, userId);
}

/**
 * Body-composition timeline (Issue #21): canonical daily weight points plus
 * `body_comp_event` markers, both the member's own (#509).
 */
export async function getBodyCompositionTimeline(
  db: Database,
  organizationId: string,
  userId: string,
  limit: number,
) {
  const canonical = db
    .select({
      date: dailyWeight.date,
      weightKg: dailyWeight.weightKg,
      source: dailyWeight.source,
      confidence: weightEvent.confidence,
    })
    .from(dailyWeight)
    .leftJoin(
      weightEvent,
      and(
        eq(dailyWeight.resolvedFromEventId, weightEvent.id),
        eq(dailyWeight.organizationId, weightEvent.organizationId),
      ),
    )
    .where(and(eq(dailyWeight.organizationId, organizationId), eq(dailyWeight.userId, userId)))
    .orderBy(desc(dailyWeight.date), desc(dailyWeight.id))
    .limit(limit);

  const markers = db
    .select({
      date: bodyCompEvent.date,
      measuredAt: bodyCompEvent.measuredAt,
      source: bodyCompEvent.source,
      confidence: bodyCompEvent.confidence,
      weightKg: bodyCompEvent.weightKg,
      bodyFatPct: bodyCompEvent.bodyFatPct,
      fatMassKg: bodyCompEvent.fatMassKg,
      leanMassKg: bodyCompEvent.leanMassKg,
      boneMassKg: bodyCompEvent.boneMassKg,
    })
    .from(bodyCompEvent)
    .where(and(eq(bodyCompEvent.organizationId, organizationId), eq(bodyCompEvent.userId, userId)))
    .orderBy(desc(bodyCompEvent.date), desc(bodyCompEvent.measuredAt), desc(bodyCompEvent.id))
    .limit(limit);

  return {
    canonicalDailyPoints: await canonical,
    compositionMarkers: await markers,
  };
}
