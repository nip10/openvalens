import type { Database } from "@openvalens/db";
import {
  bodyCompEvent,
  dailyWeight,
  dexaRegional,
  dexaScan,
  weightCheckin,
  weightEvent,
} from "@openvalens/db/schema/body";
import { and, asc, between, desc, eq } from "drizzle-orm";

/** Historical check-ins, intentionally independent of the materialized daily canonical view. */
export async function listLegacyCheckins(db: Database, organizationId: string, limit: number) {
  return db
    .select()
    .from(weightCheckin)
    .where(eq(weightCheckin.organizationId, organizationId))
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

/** Latest canonical row for the org, or `null`. */
export async function getLatestCanonicalWeight(db: Database, organizationId: string) {
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
    .where(eq(dailyWeight.organizationId, organizationId))
    .orderBy(desc(dailyWeight.date), desc(dailyWeight.id))
    .limit(1);
  return rows[0] ?? null;
}

/** Latest legacy check-in (pre-materialized fallback), or `null`. */
export async function getLatestLegacyWeight(db: Database, organizationId: string) {
  const rows = await db
    .select()
    .from(weightCheckin)
    .where(eq(weightCheckin.organizationId, organizationId))
    .orderBy(desc(weightCheckin.date), desc(weightCheckin.id))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Mirrors anchovy `getLatestWeight`: prefer the latest canonical row, fall back
 * to the latest legacy check-in. Returns the legacy shape so the caller can
 * consume a single envelope without further mapping. Returns `null` when the
 * org has neither.
 */
export async function getLatestWeight(db: Database, organizationId: string) {
  const canonical = await getLatestCanonicalWeight(db, organizationId);
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
  return getLatestLegacyWeight(db, organizationId);
}

/**
 * Body-composition timeline (Issue #21): canonical daily weight points plus
 * `body_comp_event` markers. Both projections are org-scoped.
 */
export async function getBodyCompositionTimeline(
  db: Database,
  organizationId: string,
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
    .where(eq(dailyWeight.organizationId, organizationId))
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
    .where(eq(bodyCompEvent.organizationId, organizationId))
    .orderBy(desc(bodyCompEvent.date), desc(bodyCompEvent.measuredAt), desc(bodyCompEvent.id))
    .limit(limit);

  return {
    canonicalDailyPoints: await canonical,
    compositionMarkers: await markers,
  };
}
