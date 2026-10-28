import type { Database } from "@openvalens/db";
import { workout, workoutExercise, workoutSet } from "@openvalens/db/schema/plans";
import { and, asc, desc, eq, inArray, lt, or, sql } from "drizzle-orm";

export type ExerciseRef = { exerciseId: number } | { name: string };
export function normalizeExerciseName(name: string): string {
  return name.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("und");
}
export function estimateEpley1Rm(weightKg: number | null, reps: number | null): number | null {
  return weightKg !== null && weightKg > 0 && reps !== null && reps >= 1 && reps <= 12
    ? weightKg * (1 + reps / 30)
    : null;
}
export type HistoryPR = {
  kind: "heaviest_weight" | "estimated_1rm" | "reps_at_weight";
  weightKg: number;
  reps?: number;
  estimated1RmKg?: number;
};
export type HistorySet = {
  reps: number | null;
  weightKg: number | null;
  rpe: number | null;
  sortOrder: number;
};
export type HistoryExercise = { id: number; name: string; sets: HistorySet[] };
export type HistorySession = {
  workoutId: number;
  date: string;
  createdAt: string;
  exercises: HistoryExercise[];
  topSetWeightKg: number | null;
  estimated1RmKg: number | null;
  volumeKg: number;
  prs: HistoryPR[];
};
type Cursor = { date: string; createdAt: string; id: number };
const tupleBefore = (date: string, createdAt: string, id: number) =>
  or(
    lt(workout.date, date),
    and(eq(workout.date, date), lt(workout.createdAt, createdAt)),
    and(eq(workout.date, date), eq(workout.createdAt, createdAt), lt(workout.id, id)),
  );
const compare = (a: Cursor, b: Cursor) =>
  a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt) || a.id - b.id;
const emptySession = (row: {
  workoutId: number;
  date: string;
  createdAt: string;
}): HistorySession => ({
  ...row,
  exercises: [],
  topSetWeightKg: null,
  estimated1RmKg: null,
  volumeKg: 0,
  prs: [],
});
const namePredicate = (name: string) =>
  sql`lower(regexp_replace(btrim(normalize(${workoutExercise.name}, NFKC)), '\\s+', ' ', 'g')) = ${normalizeExerciseName(name)}`;
const matchPredicate = (ref: ExerciseRef) =>
  "exerciseId" in ref
    ? eq(workoutExercise.exerciseId, ref.exerciseId)
    : and(sql`${workoutExercise.exerciseId} IS NULL`, namePredicate(ref.name));

function decodeCursor(raw?: string): Cursor | undefined {
  if (!raw) return undefined;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(raw)) return undefined;
    const v: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (!v || typeof v !== "object") return undefined;
    const c = v as Record<string, unknown>;
    if (
      typeof c.date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(c.date) ||
      !Number.isSafeInteger(Date.parse(c.date)) ||
      typeof c.createdAt !== "string" ||
      !Number.isFinite(Date.parse(c.createdAt)) ||
      !Number.isSafeInteger(c.id) ||
      (c.id as number) < 1
    )
      return undefined;
    return { date: c.date, createdAt: c.createdAt, id: c.id as number };
  } catch {
    return undefined;
  }
}

export function createWorkoutHistoryRepository(db: Database) {
  async function fetchRows(org: string, userId: string, target: ExerciseRef, ids: number[]) {
    if (!ids.length) return [];
    return db
      .select({
        workoutId: workout.id,
        date: workout.date,
        createdAt: workout.createdAt,
        exerciseId: workoutExercise.id,
        name: workoutExercise.name,
        order: workoutExercise.sortOrder,
        setId: workoutSet.id,
        reps: workoutSet.reps,
        weightKg: workoutSet.weightKg,
        rpe: workoutSet.rpe,
        setOrder: workoutSet.sortOrder,
      })
      .from(workout)
      .innerJoin(
        workoutExercise,
        and(eq(workoutExercise.workoutId, workout.id), eq(workoutExercise.organizationId, org)),
      )
      .leftJoin(
        workoutSet,
        and(eq(workoutSet.exerciseId, workoutExercise.id), eq(workoutSet.organizationId, org)),
      )
      .where(
        and(
          eq(workout.organizationId, org),
          eq(workout.userId, userId),
          inArray(workout.id, ids),
          matchPredicate(target),
        ),
      )
      .orderBy(
        asc(workout.date),
        asc(workout.createdAt),
        asc(workout.id),
        asc(workoutExercise.sortOrder),
        asc(workoutSet.sortOrder),
      );
  }
  function group(rows: Awaited<ReturnType<typeof fetchRows>>) {
    const grouped = new Map<number, HistorySession>();
    for (const row of rows) {
      let session = grouped.get(row.workoutId);
      if (!session) {
        session = emptySession({
          workoutId: row.workoutId,
          date: row.date,
          createdAt: row.createdAt,
        });
        grouped.set(row.workoutId, session);
      }
      let exercise = session.exercises.find((item) => item.id === row.exerciseId);
      if (!exercise) {
        exercise = { id: row.exerciseId, name: row.name, sets: [] };
        session.exercises.push(exercise);
      }
      if (row.setId !== null)
        exercise.sets.push({
          reps: row.reps,
          weightKg: row.weightKg,
          rpe: row.rpe,
          sortOrder: row.setOrder!,
        });
      if (row.setId !== null && row.weightKg !== null && row.reps !== null)
        session.volumeKg += row.weightKg * row.reps;
      if (
        row.setId !== null &&
        row.weightKg !== null &&
        (session.topSetWeightKg === null || row.weightKg > session.topSetWeightKg)
      )
        session.topSetWeightKg = row.weightKg;
      const estimate = estimateEpley1Rm(row.weightKg, row.reps);
      if (
        estimate !== null &&
        (session.estimated1RmKg === null || estimate > session.estimated1RmKg)
      )
        session.estimated1RmKg = estimate;
    }
    return [...grouped.values()];
  }
  return {
    async sessionPRs(org: string, userId: string, workoutIds: number[]) {
      if (!workoutIds.length)
        return {} as Record<
          number,
          Array<HistoryPR & { exerciseId: number | null; exerciseName: string }>
        >;
      const requested = await db
        .select({ exerciseId: workoutExercise.exerciseId, name: workoutExercise.name })
        .from(workoutExercise)
        .innerJoin(
          workout,
          and(
            eq(workout.id, workoutExercise.workoutId),
            eq(workout.organizationId, org),
            eq(workout.userId, userId),
          ),
        )
        .where(and(eq(workoutExercise.organizationId, org), inArray(workout.id, workoutIds)));
      const identities: ExerciseRef[] = [];
      for (const r of requested) {
        const ref: ExerciseRef =
          r.exerciseId === null ? { name: r.name } : { exerciseId: r.exerciseId };
        if (
          !identities.some((i) =>
            "exerciseId" in i
              ? "exerciseId" in ref && i.exerciseId === ref.exerciseId
              : "name" in ref && normalizeExerciseName(i.name) === normalizeExerciseName(ref.name),
          )
        )
          identities.push(ref);
      }
      if (!identities.length) return Object.fromEntries(workoutIds.map((id) => [id, []]));
      const rows = await db
        .select({
          workoutId: workout.id,
          date: workout.date,
          createdAt: workout.createdAt,
          exerciseId: workoutExercise.exerciseId,
          name: workoutExercise.name,
          setId: workoutSet.id,
          reps: workoutSet.reps,
          weightKg: workoutSet.weightKg,
        })
        .from(workout)
        .innerJoin(
          workoutExercise,
          and(eq(workoutExercise.workoutId, workout.id), eq(workoutExercise.organizationId, org)),
        )
        .innerJoin(
          workoutSet,
          and(eq(workoutSet.exerciseId, workoutExercise.id), eq(workoutSet.organizationId, org)),
        )
        .where(
          and(
            eq(workout.organizationId, org),
            eq(workout.userId, userId),
            or(...identities.map(matchPredicate)),
          ),
        )
        .orderBy(asc(workout.date), asc(workout.createdAt), asc(workout.id));
      const buckets = new Map<
        string,
        Map<
          number,
          {
            date: string;
            createdAt: string;
            workoutId: number;
            exerciseId: number | null;
            exerciseName: string;
            weights: number[];
            e1rms: Array<{ weightKg: number; reps: number; value: number }>;
            reps: Map<number, number>;
          }
        >
      >();
      for (const r of rows) {
        const ident =
          r.exerciseId === null ? `name:${normalizeExerciseName(r.name)}` : `id:${r.exerciseId}`;
        let bySession = buckets.get(ident);
        if (!bySession) {
          bySession = new Map();
          buckets.set(ident, bySession);
        }
        let s = bySession.get(r.workoutId);
        if (!s) {
          s = {
            date: r.date,
            createdAt: r.createdAt,
            workoutId: r.workoutId,
            exerciseId: r.exerciseId,
            exerciseName: r.name,
            weights: [],
            e1rms: [],
            reps: new Map(),
          };
          bySession.set(r.workoutId, s);
        }
        if (r.weightKg !== null && r.weightKg > 0) {
          s.weights.push(r.weightKg);
          if (r.reps !== null) {
            s.reps.set(r.weightKg, Math.max(s.reps.get(r.weightKg) ?? 0, r.reps));
            const e1rm = estimateEpley1Rm(r.weightKg, r.reps);
            if (e1rm !== null) s.e1rms.push({ weightKg: r.weightKg, reps: r.reps, value: e1rm });
          }
        }
      }
      const result: Record<
        number,
        Array<HistoryPR & { exerciseId: number | null; exerciseName: string }>
      > = Object.fromEntries(workoutIds.map((id) => [id, []]));
      for (const sessions of buckets.values()) {
        let bestWeight = 0,
          bestE1rm = 0;
        const bestReps = new Map<number, number>();
        for (const s of [...sessions.values()].sort((a, b) =>
          compare({ ...a, id: a.workoutId }, { ...b, id: b.workoutId }),
        )) {
          const badges: Array<HistoryPR & { exerciseId: number | null; exerciseName: string }> = [];
          const weight = Math.max(0, ...s.weights);
          if (weight > bestWeight) {
            badges.push({
              kind: "heaviest_weight",
              weightKg: weight,
              exerciseId: s.exerciseId,
              exerciseName: s.exerciseName,
            });
            bestWeight = weight;
          }
          const e1rm = s.e1rms.reduce((best, e) => (e.value > best.value ? e : best), {
            weightKg: 0,
            reps: 0,
            value: 0,
          });
          if (e1rm.value > bestE1rm) {
            badges.push({
              kind: "estimated_1rm",
              weightKg: e1rm.weightKg,
              reps: e1rm.reps,
              estimated1RmKg: e1rm.value,
              exerciseId: s.exerciseId,
              exerciseName: s.exerciseName,
            });
            bestE1rm = e1rm.value;
          }
          for (const [weightKg, reps] of s.reps)
            if (reps > (bestReps.get(weightKg) ?? 0)) {
              badges.push({
                kind: "reps_at_weight",
                weightKg,
                reps,
                exerciseId: s.exerciseId,
                exerciseName: s.exerciseName,
              });
              bestReps.set(weightKg, reps);
            }
          if (result[s.workoutId]) result[s.workoutId]!.push(...badges);
        }
      }
      return result;
    },
    async lastPerformance(
      org: string,
      userId: string,
      input: {
        exerciseIds: number[];
        names?: string[];
        onOrBeforeDate?: string;
        excludeWorkoutId?: number;
      },
    ) {
      const refs: ExerciseRef[] = [...new Set(input.exerciseIds)].map((exerciseId) => ({
        exerciseId,
      }));
      for (const name of input.names ?? [])
        if (
          !refs.some(
            (r) => "name" in r && normalizeExerciseName(r.name) === normalizeExerciseName(name),
          )
        )
          refs.push({ name });
      if (!refs.length) return { items: [] };
      const identityKey = sql<string>`case when ${workoutExercise.exerciseId} is null then 'name:' || lower(regexp_replace(btrim(normalize(${workoutExercise.name}, NFKC)), '\\s+', ' ', 'g')) else 'id:' || ${workoutExercise.exerciseId}::text end`;
      const matches = await db
        .selectDistinctOn([identityKey], {
          workoutId: workout.id,
          date: workout.date,
          createdAt: workout.createdAt,
          exerciseId: workoutExercise.exerciseId,
          name: workoutExercise.name,
        })
        .from(workout)
        .innerJoin(
          workoutExercise,
          and(eq(workoutExercise.workoutId, workout.id), eq(workoutExercise.organizationId, org)),
        )
        .where(
          and(
            eq(workout.organizationId, org),
            eq(workout.userId, userId),
            or(...refs.map(matchPredicate)),
            ...(input.onOrBeforeDate ? [sql`${workout.date} <= ${input.onOrBeforeDate}`] : []),
            ...(input.excludeWorkoutId ? [sql`${workout.id} <> ${input.excludeWorkoutId}`] : []),
          ),
        )
        .orderBy(identityKey, desc(workout.date), desc(workout.createdAt), desc(workout.id));
      const latest = new Map<string, (typeof matches)[number]>();
      for (const row of matches)
        for (const ref of refs) {
          const isMatch =
            "exerciseId" in ref
              ? row.exerciseId === ref.exerciseId
              : row.exerciseId === null &&
                normalizeExerciseName(row.name) === normalizeExerciseName(ref.name);
          const key =
            "exerciseId" in ref
              ? `id:${ref.exerciseId}`
              : `name:${normalizeExerciseName(ref.name)}`;
          if (isMatch && !latest.has(key)) latest.set(key, row);
        }
      const chosen = refs.map((ref) => {
        const key =
          "exerciseId" in ref ? `id:${ref.exerciseId}` : `name:${normalizeExerciseName(ref.name)}`;
        return { ref, row: latest.get(key) };
      });
      const ids = [...new Set(chosen.flatMap(({ row }) => (row ? [row.workoutId] : [])))];
      const allRows = ids.length
        ? await db
            .select({
              workoutId: workout.id,
              date: workout.date,
              createdAt: workout.createdAt,
              exerciseId: workoutExercise.id,
              catalogId: workoutExercise.exerciseId,
              name: workoutExercise.name,
              setId: workoutSet.id,
              reps: workoutSet.reps,
              weightKg: workoutSet.weightKg,
              rpe: workoutSet.rpe,
              sortOrder: workoutSet.sortOrder,
            })
            .from(workout)
            .innerJoin(
              workoutExercise,
              and(
                eq(workoutExercise.workoutId, workout.id),
                eq(workoutExercise.organizationId, org),
              ),
            )
            .leftJoin(
              workoutSet,
              and(
                eq(workoutSet.exerciseId, workoutExercise.id),
                eq(workoutSet.organizationId, org),
              ),
            )
            .where(
              and(
                eq(workout.organizationId, org),
                eq(workout.userId, userId),
                inArray(workout.id, ids),
              ),
            )
            .orderBy(asc(workoutExercise.sortOrder), asc(workoutSet.sortOrder))
        : [];
      return {
        items: chosen.map(({ ref, row }) => {
          if (!row) return { ref, performance: null };
          const selected = allRows.filter(
            (r) =>
              r.workoutId === row.workoutId &&
              ("exerciseId" in ref
                ? r.catalogId === ref.exerciseId
                : r.catalogId === null &&
                  normalizeExerciseName(r.name) === normalizeExerciseName(ref.name)),
          );
          const exercises = new Map<number, { id: number; sets: HistorySet[] }>();
          for (const r of selected) {
            let e = exercises.get(r.exerciseId);
            if (!e) {
              e = { id: r.exerciseId, sets: [] };
              exercises.set(r.exerciseId, e);
            }
            if (r.setId !== null)
              e.sets.push({
                reps: r.reps,
                weightKg: r.weightKg,
                rpe: r.rpe,
                sortOrder: r.sortOrder!,
              });
          }
          return {
            ref,
            performance: {
              workoutId: row.workoutId,
              date: row.date,
              exercises: [...exercises.values()],
            },
          };
        }),
      };
    },
    async exerciseHistory(
      org: string,
      userId: string,
      input: { exercise: ExerciseRef; limit?: number; cursor?: string },
    ) {
      const limit = Math.max(1, Math.min(input.limit ?? 20, 100));
      const before = decodeCursor(input.cursor);
      const predicates = [
        eq(workout.organizationId, org),
        eq(workout.userId, userId),
        matchPredicate(input.exercise),
      ];
      if (before) predicates.push(tupleBefore(before.date, before.createdAt, before.id) as never);
      const ids = await db
        .selectDistinct({ id: workout.id, date: workout.date, createdAt: workout.createdAt })
        .from(workout)
        .innerJoin(
          workoutExercise,
          and(eq(workoutExercise.workoutId, workout.id), eq(workoutExercise.organizationId, org)),
        )
        .where(and(...predicates))
        .orderBy(desc(workout.date), desc(workout.createdAt), desc(workout.id))
        .limit(limit + 1);
      const more = ids.length > limit;
      const pageIds = ids.slice(0, limit).map((r) => r.id);
      const items = group(await fetchRows(org, userId, input.exercise, pageIds)).sort((a, b) =>
        compare({ ...a, id: a.workoutId }, { ...b, id: b.workoutId }),
      );
      // Aggregate all sets in earlier sessions in SQL; no arbitrary history cap.
      const earliest = items[0];
      let baseline: {
        maxWeight: number | null;
        maxE1rm: number | null;
        reps: Array<{ weightKg: number; reps: number }>;
      } = { maxWeight: null, maxE1rm: null, reps: [] };
      if (earliest) {
        const base = [
          eq(workout.organizationId, org),
          eq(workout.userId, userId),
          matchPredicate(input.exercise),
          tupleBefore(earliest.date, earliest.createdAt, earliest.workoutId),
        ];
        const [maxRow] = await db
          .select({
            maxWeight: sql<number | null>`max(${workoutSet.weightKg})`,
            maxE1rm: sql<
              number | null
            >`max(case when ${workoutSet.weightKg} > 0 and ${workoutSet.reps} between 1 and 12 then ${workoutSet.weightKg} * (1 + ${workoutSet.reps}::numeric / 30) end)`,
          })
          .from(workout)
          .innerJoin(
            workoutExercise,
            and(eq(workoutExercise.workoutId, workout.id), eq(workoutExercise.organizationId, org)),
          )
          .innerJoin(
            workoutSet,
            and(eq(workoutSet.exerciseId, workoutExercise.id), eq(workoutSet.organizationId, org)),
          )
          .where(and(...base));
        const repRows = await db
          .select({ weightKg: workoutSet.weightKg, reps: sql<number>`max(${workoutSet.reps})` })
          .from(workout)
          .innerJoin(
            workoutExercise,
            and(eq(workoutExercise.workoutId, workout.id), eq(workoutExercise.organizationId, org)),
          )
          .innerJoin(
            workoutSet,
            and(eq(workoutSet.exerciseId, workoutExercise.id), eq(workoutSet.organizationId, org)),
          )
          .where(and(...base, sql`${workoutSet.weightKg} > 0 and ${workoutSet.reps} is not null`))
          .groupBy(workoutSet.weightKg);
        baseline = {
          maxWeight: maxRow?.maxWeight ?? null,
          maxE1rm: maxRow?.maxE1rm ?? null,
          reps: repRows.map((r) => ({ weightKg: r.weightKg!, reps: r.reps })),
        };
      }
      let maxWeight = baseline.maxWeight ?? 0,
        maxEstimate = baseline.maxE1rm ?? 0;
      const repsAt = new Map(baseline.reps.map(({ weightKg, reps }) => [weightKg, reps]));
      for (const session of items) {
        const sessionReps = new Map<number, number>();
        let sessionWeight = 0,
          sessionEstimate = 0;
        for (const e of session.exercises)
          for (const s of e.sets) {
            if (s.weightKg !== null && s.weightKg > 0) {
              sessionWeight = Math.max(sessionWeight, s.weightKg);
              if (s.reps !== null)
                sessionReps.set(s.weightKg, Math.max(sessionReps.get(s.weightKg) ?? 0, s.reps));
            }
            const est = estimateEpley1Rm(s.weightKg, s.reps);
            if (est !== null) sessionEstimate = Math.max(sessionEstimate, est);
          }
        if (sessionWeight > maxWeight) {
          session.prs.push({ kind: "heaviest_weight", weightKg: sessionWeight });
          maxWeight = sessionWeight;
        }
        if (sessionEstimate > maxEstimate) {
          const best = session.exercises
            .flatMap((e) => e.sets)
            .find((s) => estimateEpley1Rm(s.weightKg, s.reps) === sessionEstimate)!;
          session.prs.push({
            kind: "estimated_1rm",
            weightKg: best.weightKg!,
            reps: best.reps!,
            estimated1RmKg: sessionEstimate,
          });
          maxEstimate = sessionEstimate;
        }
        for (const [weightKg, reps] of sessionReps) {
          if (reps > (repsAt.get(weightKg) ?? 0))
            session.prs.push({ kind: "reps_at_weight", weightKg, reps });
          repsAt.set(weightKg, Math.max(repsAt.get(weightKg) ?? 0, reps));
        }
      }
      const allPredicates = [
        eq(workout.organizationId, org),
        eq(workout.userId, userId),
        matchPredicate(input.exercise),
      ];
      const [totalRow] = await db
        .select({
          maxWeight: sql<
            number | null
          >`max(${workoutSet.weightKg}) filter (where ${workoutSet.weightKg} > 0)`,
          maxE1rm: sql<
            number | null
          >`max(case when ${workoutSet.weightKg} > 0 and ${workoutSet.reps} between 1 and 12 then ${workoutSet.weightKg} * (1 + ${workoutSet.reps}::numeric / 30) end)`,
        })
        .from(workout)
        .innerJoin(
          workoutExercise,
          and(eq(workoutExercise.workoutId, workout.id), eq(workoutExercise.organizationId, org)),
        )
        .innerJoin(
          workoutSet,
          and(eq(workoutSet.exerciseId, workoutExercise.id), eq(workoutSet.organizationId, org)),
        )
        .where(and(...allPredicates));
      const totalReps = await db
        .select({ weightKg: workoutSet.weightKg, reps: sql<number>`max(${workoutSet.reps})` })
        .from(workout)
        .innerJoin(
          workoutExercise,
          and(eq(workoutExercise.workoutId, workout.id), eq(workoutExercise.organizationId, org)),
        )
        .innerJoin(
          workoutSet,
          and(eq(workoutSet.exerciseId, workoutExercise.id), eq(workoutSet.organizationId, org)),
        )
        .where(
          and(...allPredicates, sql`${workoutSet.weightKg} > 0 and ${workoutSet.reps} is not null`),
        )
        .groupBy(workoutSet.weightKg);
      const last = ids[limit - 1];
      return {
        items,
        nextCursor:
          more && last
            ? Buffer.from(
                JSON.stringify({ date: last.date, createdAt: last.createdAt, id: last.id }),
              ).toString("base64url")
            : null,
        records: {
          heaviestWeightKg: totalRow?.maxWeight ?? null,
          bestEstimated1RmKg: totalRow?.maxE1rm ?? null,
          mostRepsAtWeight: totalReps.map((r) => ({ weightKg: r.weightKg!, reps: r.reps })),
        },
      };
    },
  };
}
