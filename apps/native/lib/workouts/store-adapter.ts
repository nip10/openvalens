import type { WorkoutDraft } from "./model";
import type { WorkoutAcknowledgement, WorkoutMutationPayload, WorkoutQueueItem } from "./sync";
import * as Crypto from "expo-crypto";

export type WorkoutSqlite = {
  getAllSync<T>(sql: string, ...params: unknown[]): T[];
  getFirstSync<T>(sql: string, ...params: unknown[]): T | null;
  runSync(sql: string, ...params: unknown[]): { changes: number };
  withTransactionSync(callback: () => void): void;
};
export class WorkoutStorageError extends Error {
  readonly code = "STORAGE";
}
export function classifyWorkoutSyncError(error: unknown): { transient: boolean; code: string } {
  const e = error as { code?: unknown; status?: unknown; name?: unknown } | null;
  const raw = typeof e?.code === "string" ? e.code : "";
  const status = Number(e?.status);
  const transient =
    ["NETWORK", "FETCH_ERROR", "TIMEOUT", "SERVICE_UNAVAILABLE", "INTERNAL_SERVER_ERROR"].includes(
      raw,
    ) ||
    e?.name === "TypeError" ||
    status === 0 ||
    status === 401 ||
    raw === "UNAUTHENTICATED" ||
    status === 408 ||
    status === 429 ||
    status >= 500;
  const code =
    status === 401 || raw === "UNAUTHENTICATED"
      ? "UNAUTHENTICATED"
      : [
            "INVALID_INPUT",
            "PERMISSION_DENIED",
            "TENANT_VIOLATION",
            "NOT_FOUND",
            "CONFLICT",
          ].includes(raw)
        ? raw
        : transient
          ? status >= 500
            ? "SERVER"
            : "NETWORK"
          : "REJECTED";
  return { transient, code };
}
const safe = <T>(fn: () => T): T => {
  try {
    return fn();
  } catch {
    throw new WorkoutStorageError("Workout storage unavailable");
  }
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function validDraft(value: unknown): value is WorkoutDraft & { scope: string } {
  if (!value || typeof value !== "object") return false;
  const draft = value as Record<string, unknown>;
  return (
    draft.scope !== undefined &&
    typeof draft.scope === "string" &&
    UUID.test(String(draft.id)) &&
    typeof draft.startedAt === "string" &&
    Number.isFinite(Date.parse(draft.startedAt)) &&
    validDate(draft.date) &&
    ["weights", "tennis", "running", "cycling", "swimming", "other"].includes(String(draft.type)) &&
    (draft.duration === undefined ||
      draft.duration === null ||
      (Number.isInteger(draft.duration) &&
        Number(draft.duration) >= 1 &&
        Number(draft.duration) <= 1440)) &&
    typeof draft.notes === "string" &&
    draft.notes.length <= 2000 &&
    (draft.intensity === null ||
      ["light", "moderate", "vigorous"].includes(String(draft.intensity))) &&
    (draft.effortRating === null ||
      (Number.isInteger(draft.effortRating) &&
        Number(draft.effortRating) >= 0 &&
        Number(draft.effortRating) <= 10)) &&
    (draft.workoutId === undefined ||
      (Number.isInteger(draft.workoutId) && Number(draft.workoutId) > 0)) &&
    (draft.expectedVersion === undefined ||
      (Number.isInteger(draft.expectedVersion) && Number(draft.expectedVersion) > 0)) &&
    (draft.workoutId === undefined) === (draft.expectedVersion === undefined) &&
    (draft.targetMutationId === undefined || UUID.test(String(draft.targetMutationId))) &&
    (draft.predecessorMutationId === undefined || UUID.test(String(draft.predecessorMutationId))) &&
    (draft.replacesMutationId === undefined || UUID.test(String(draft.replacesMutationId))) &&
    (draft.routineId === undefined ||
      draft.routineId === null ||
      (Number.isInteger(draft.routineId) && Number(draft.routineId) > 0)) &&
    (draft.mode === undefined || draft.mode === "create" || draft.mode === "edit") &&
    Array.isArray(draft.exercises) &&
    draft.exercises.length <= 24 &&
    draft.exercises.every((entry) => {
      if (!entry || typeof entry !== "object") return false;
      const exercise = entry as Record<string, unknown>;
      return (
        UUID.test(String(exercise.id)) &&
        (exercise.exerciseId === null ||
          (Number.isInteger(exercise.exerciseId) && Number(exercise.exerciseId) > 0)) &&
        typeof exercise.name === "string" &&
        exercise.name.trim().length > 0 &&
        exercise.name.length <= 200 &&
        (exercise.notes === undefined ||
          exercise.notes === null ||
          (typeof exercise.notes === "string" && exercise.notes.length <= 2000)) &&
        Array.isArray(exercise.sets) &&
        exercise.sets.length <= 20 &&
        exercise.sets.every((row) => {
          if (!row || typeof row !== "object") return false;
          const set = row as Record<string, unknown>;
          return (
            UUID.test(String(set.id)) &&
            (set.weightKg === null ||
              (typeof set.weightKg === "number" &&
                Number.isFinite(set.weightKg) &&
                set.weightKg >= 0 &&
                set.weightKg <= 1000)) &&
            typeof set.reps === "string" &&
            set.reps.length <= 8 &&
            typeof set.rpe === "string" &&
            set.rpe.length <= 8 &&
            (set.notes === undefined ||
              set.notes === null ||
              (typeof set.notes === "string" && set.notes.length <= 2000)) &&
            typeof set.done === "boolean"
          );
        })
      );
    })
  );
}
function validPayload(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const p = value as Record<string, unknown>;
  return (
    UUID.test(String(p.clientMutationId)) &&
    validDate(p.date) &&
    ["weights", "tennis", "running", "cycling", "swimming", "other"].includes(String(p.type)) &&
    (p.duration === undefined ||
      p.duration === null ||
      (Number.isInteger(p.duration) && Number(p.duration) >= 1 && Number(p.duration) <= 1440)) &&
    (p.notes === null || (typeof p.notes === "string" && p.notes.length <= 2000)) &&
    (p.intensity === null || ["light", "moderate", "vigorous"].includes(String(p.intensity))) &&
    (p.effortRating === null ||
      (Number.isInteger(p.effortRating) &&
        Number(p.effortRating) >= 0 &&
        Number(p.effortRating) <= 10)) &&
    Array.isArray(p.exercises) &&
    p.exercises.length <= 24 &&
    p.exercises.every((entry) => {
      if (!entry || typeof entry !== "object") return false;
      const e = entry as Record<string, unknown>;
      return (
        typeof e.name === "string" &&
        e.name.trim().length > 0 &&
        e.name.length <= 200 &&
        (e.notes === null || (typeof e.notes === "string" && e.notes.length <= 2000)) &&
        (e.exerciseId === undefined ||
          e.exerciseId === null ||
          (Number.isInteger(e.exerciseId) && Number(e.exerciseId) > 0)) &&
        Array.isArray(e.sets) &&
        e.sets.length <= 20 &&
        e.sets.every((row) => {
          if (!row || typeof row !== "object") return false;
          const s = row as Record<string, unknown>;
          return (
            Number.isInteger(s.reps) &&
            Number(s.reps) > 0 &&
            Number(s.reps) <= 1000 &&
            (s.weightKg === undefined ||
              s.weightKg === null ||
              (typeof s.weightKg === "number" &&
                Number.isFinite(s.weightKg) &&
                s.weightKg >= 0 &&
                s.weightKg <= 1000)) &&
            (s.rpe === undefined ||
              s.rpe === null ||
              (typeof s.rpe === "number" && Number.isFinite(s.rpe) && s.rpe >= 0 && s.rpe <= 10)) &&
            (s.notes === undefined ||
              s.notes === null ||
              (typeof s.notes === "string" && s.notes.length <= 2000))
          );
        })
      );
    })
  );
}
function validQueueEnvelope(item: WorkoutQueueItem, scope: string): boolean {
  if (
    item.scope !== scope ||
    !UUID.test(item.id) ||
    item.payload.clientMutationId !== item.id ||
    !Number.isFinite(Date.parse(item.finishedAt)) ||
    !Number.isFinite(item.createdAt) ||
    !Number.isInteger(item.attempts) ||
    item.attempts < 0 ||
    !["pending", "blocked", "failed"].includes(item.state)
  )
    return false;
  if (!item.operation || item.operation === "create") return validPayload(item.payload);
  if (
    !("id" in item.payload) ||
    !Number.isInteger(item.payload.id) ||
    item.payload.id < 1 ||
    !Number.isInteger(item.payload.expectedVersion) ||
    item.payload.expectedVersion < 1
  )
    return false;
  if (item.operation === "delete") return !("workout" in item.payload);
  return (
    "workout" in item.payload &&
    validPayload({ ...item.payload.workout, clientMutationId: item.id })
  );
}
function parseQueue(item: string, scope: string): WorkoutQueueItem {
  const value: unknown = JSON.parse(item);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("invalid queue row");
  const queued = value as Record<string, unknown>;
  if (
    !UUID.test(String(queued.id)) ||
    queued.id !== (queued.payload as { clientMutationId?: unknown } | null)?.clientMutationId ||
    queued.scope !== scope ||
    !(
      queued.operation === undefined ||
      ["create", "update", "delete"].includes(String(queued.operation))
    ) ||
    (queued.operation === "create" || queued.operation === undefined
      ? !validPayload(queued.payload)
      : !queued.payload ||
        typeof queued.payload !== "object" ||
        !Number.isInteger((queued.payload as Record<string, unknown>).id) ||
        Number((queued.payload as Record<string, unknown>).id) <= 0 ||
        !Number.isInteger((queued.payload as Record<string, unknown>).expectedVersion) ||
        Number((queued.payload as Record<string, unknown>).expectedVersion) < 1 ||
        (queued.operation === "update" &&
          !validPayload({
            ...((queued.payload as Record<string, unknown>).workout as object),
            clientMutationId: queued.id,
          }))) ||
    !["pending", "blocked", "failed"].includes(String(queued.state)) ||
    !Number.isInteger(queued.attempts) ||
    Number(queued.attempts) < 0 ||
    typeof queued.createdAt !== "number" ||
    !Number.isFinite(queued.createdAt) ||
    typeof queued.finishedAt !== "string" ||
    !Number.isFinite(Date.parse(queued.finishedAt)) ||
    !(queued.error === null || typeof queued.error === "string")
  )
    throw new Error("invalid queue row");
  return queued as unknown as WorkoutQueueItem;
}
export function createWorkoutStore(db: WorkoutSqlite) {
  return {
    list(scope: string): WorkoutQueueItem[] {
      return safe(() =>
        db
          .getAllSync<{ item: string }>(
            "SELECT item FROM workout_outbox WHERE scope=? ORDER BY seq",
            scope,
          )
          .map((row) => parseQueue(row.item, scope)),
      );
    },
    readDraft(scope: string): WorkoutDraft | null {
      return safe(() => {
        const row = db.getFirstSync<{ item: string }>(
          "SELECT item FROM workout_drafts WHERE scope=?",
          scope,
        );
        if (!row) return null;
        const draft = JSON.parse(row.item) as WorkoutDraft & { scope?: string };
        if (!validDraft(draft) || draft.scope !== scope) throw new Error("corrupt draft");
        return draft;
      });
    },
    saveDraft(scope: string, draft: WorkoutDraft): void {
      safe(() => {
        if (!validDraft({ ...draft, scope })) throw new Error("invalid draft");
        const row = db.getFirstSync<{ item: string }>(
          "SELECT item FROM workout_drafts WHERE scope=?",
          scope,
        );
        if (row) {
          const current = JSON.parse(row.item) as WorkoutDraft & { scope?: string };
          if (!validDraft(current) || current.scope !== scope || current.id !== draft.id)
            throw new Error("unreadable or different draft");
        }
        const item = JSON.stringify({ ...draft, scope });
        db.runSync(
          "INSERT INTO workout_drafts(scope,item) VALUES(?,?) ON CONFLICT(scope) DO UPDATE SET item=excluded.item",
          scope,
          item,
        );
      });
    },
    discardDraft(scope: string): void {
      safe(() => {
        db.runSync("DELETE FROM workout_drafts WHERE scope=?", scope);
      });
    },
    finish(scope: string, draft: WorkoutDraft, item: WorkoutQueueItem): boolean {
      return safe(() => {
        let result = false;
        db.withTransactionSync(() => {
          const queued = db.getFirstSync<{ item: string }>(
            "SELECT item FROM workout_outbox WHERE scope=? AND id=?",
            scope,
            item.id,
          );
          if (queued) {
            const previous = parseQueue(queued.item, scope);
            result = JSON.stringify(previous.payload) === JSON.stringify(item.payload);
            return;
          }
          const saved = db.getFirstSync<{ item: string }>(
            "SELECT item FROM workout_drafts WHERE scope=?",
            scope,
          );
          if (!saved) return;
          const current = JSON.parse(saved.item) as WorkoutDraft & { scope?: string };
          if (!validDraft(current) || current.scope !== scope || current.id !== draft.id) return;
          if (
            item.id !== draft.id ||
            item.id !== item.payload.clientMutationId ||
            !validQueueEnvelope(item, scope)
          )
            return;
          if (draft.replacesMutationId) {
            const oldRow = db.getFirstSync<{ item: string }>(
              "SELECT item FROM workout_outbox WHERE scope=? AND id=?",
              scope,
              draft.replacesMutationId,
            );
            if (!oldRow) return;
            const old = parseQueue(oldRow.item, scope);
            if (old.state !== "blocked") return;
            const queuedItems = this.list(scope);
            const descendants = queuedItems.filter(
              (candidate) =>
                candidate.id !== old.id &&
                (candidate.predecessorMutationId === old.id ||
                  candidate.targetMutationId === old.id),
            );
            if (descendants.some((candidate) => candidate.attempted)) return;
            for (const successor of descendants) {
              const replaced = {
                ...successor,
                ...(successor.predecessorMutationId === old.id
                  ? { predecessorMutationId: item.id }
                  : {}),
                ...(successor.targetMutationId === old.id ? { targetMutationId: item.id } : {}),
              };
              db.runSync(
                "UPDATE workout_outbox SET item=? WHERE scope=? AND id=?",
                JSON.stringify(replaced),
                scope,
                successor.id,
              );
            }
            db.runSync("DELETE FROM workout_outbox WHERE scope=? AND id=?", scope, old.id);
          }
          db.runSync(
            "INSERT INTO workout_outbox(scope,id,item) VALUES(?,?,?)",
            scope,
            item.id,
            JSON.stringify(item),
          );
          db.runSync("DELETE FROM workout_drafts WHERE scope=? AND item=?", scope, saved.item);
          result = true;
        });
        return result;
      });
    },
    enqueue(scope: string, item: WorkoutQueueItem): boolean {
      return safe(() => {
        if (
          !validQueueEnvelope(item, scope) ||
          !item.operation ||
          (item.operation !== "create" &&
            !item.targetId &&
            !item.targetMutationId &&
            !item.predecessorMutationId)
        )
          return false;
        db.runSync(
          "INSERT INTO workout_outbox(scope,id,item) VALUES(?,?,?)",
          scope,
          item.id,
          JSON.stringify(item),
        );
        return true;
      });
    },
    latestForTarget(scope: string, targetId: number): WorkoutQueueItem | null {
      return safe(
        () =>
          this.list(scope)
            .filter(
              (item) =>
                item.targetId === targetId ||
                ("id" in item.payload && item.payload.id === targetId),
            )
            .sort((a, b) => a.createdAt - b.createdAt)
            .at(-1) ?? null,
      );
    },
    cancelUnattemptedCreate(scope: string, mutationId: string): boolean {
      return safe(() => {
        const row = db.getFirstSync<{ item: string }>(
          "SELECT item FROM workout_outbox WHERE scope=? AND id=?",
          scope,
          mutationId,
        );
        if (!row) return false;
        const item = parseQueue(row.item, scope);
        if ((item.operation ?? "create") !== "create" || item.attempted) return false;
        db.runSync("DELETE FROM workout_outbox WHERE scope=? AND id=?", scope, mutationId);
        return true;
      });
    },
    coalesceUnattemptedCreate(
      scope: string,
      mutationId: string,
      payload: WorkoutMutationPayload,
      draftId: string,
    ): boolean {
      return safe(() => {
        let result = false;
        db.withTransactionSync(() => {
          const row = db.getFirstSync<{ item: string }>(
            "SELECT item FROM workout_outbox WHERE scope=? AND id=?",
            scope,
            mutationId,
          );
          const saved = db.getFirstSync<{ item: string }>(
            "SELECT item FROM workout_drafts WHERE scope=?",
            scope,
          );
          if (!row || !saved) return;
          const item = parseQueue(row.item, scope);
          const draft = JSON.parse(saved.item) as WorkoutDraft & { scope?: string };
          if (
            (item.operation ?? "create") !== "create" ||
            item.attempted ||
            payload.clientMutationId !== item.id ||
            !validPayload(payload) ||
            !validDraft(draft) ||
            draft.scope !== scope ||
            draft.id !== draftId
          )
            return;
          db.runSync(
            "UPDATE workout_outbox SET item=? WHERE scope=? AND id=?",
            JSON.stringify({ ...item, payload }),
            scope,
            mutationId,
          );
          db.runSync("DELETE FROM workout_drafts WHERE scope=? AND item=?", scope, saved.item);
          result = true;
        });
        return result;
      });
    },
    discardBlocked(scope: string, id: string, cascadeUnattempted = false): boolean {
      return safe(() => {
        let discarded = false;
        db.withTransactionSync(() => {
          const row = db.getFirstSync<{ item: string }>(
            "SELECT item FROM workout_outbox WHERE scope=? AND id=?",
            scope,
            id,
          );
          if (!row) return;
          const item = parseQueue(row.item, scope);
          if (item.state !== "blocked") return;
          const queued = this.list(scope);
          const descendants = queued.filter(
            (candidate) =>
              candidate.predecessorMutationId === id || candidate.targetMutationId === id,
          );
          if (descendants.length && !cascadeUnattempted) return;
          const ids = new Set(descendants.map((candidate) => candidate.id));
          let changed = true;
          while (changed) {
            changed = false;
            for (const candidate of queued)
              if (
                !ids.has(candidate.id) &&
                (ids.has(candidate.predecessorMutationId ?? "") ||
                  ids.has(candidate.targetMutationId ?? ""))
              ) {
                ids.add(candidate.id);
                changed = true;
              }
          }
          const all = queued.filter((candidate) => ids.has(candidate.id));
          // Validate the complete dependency closure before the first write.
          if (all.some((candidate) => candidate.attempted)) return;
          for (const candidate of all)
            db.runSync("DELETE FROM workout_outbox WHERE scope=? AND id=?", scope, candidate.id);
          db.runSync("DELETE FROM workout_outbox WHERE scope=? AND id=?", scope, id);
          discarded = true;
        });
        return discarded;
      });
    },
    repairAsDraft(scope: string, id: string, currentVersion: number): boolean {
      return safe(() => {
        if (!Number.isInteger(currentVersion) || currentVersion < 1) return false;
        const row = db.getFirstSync<{ item: string }>(
          "SELECT item FROM workout_outbox WHERE scope=? AND id=?",
          scope,
          id,
        );
        if (!row) return false;
        const item = parseQueue(row.item, scope);
        if (item.operation !== "update" || item.state !== "blocked") return false;
        if (!("workout" in item.payload)) return false;
        const queued = this.list(scope);
        const descendants = queued.filter(
          (candidate) =>
            candidate.predecessorMutationId === id || candidate.targetMutationId === id,
        );
        if (descendants.some((candidate) => candidate.attempted)) return false;
        const p = item.payload;
        const workout = p.workout;
        const draft: WorkoutDraft = {
          id: Crypto.randomUUID(),
          startedAt: new Date().toISOString(),
          date: workout.date,
          type: workout.type,
          duration: workout.duration ?? null,
          notes: workout.notes ?? "",
          intensity: workout.intensity,
          effortRating: workout.effortRating,
          routineId: workout.routineId,
          routineSnapshot: workout.routineSnapshot,
          workoutId: p.id,
          expectedVersion: currentVersion,
          mode: "edit",
          replacesMutationId: id,
          exercises: workout.exercises.map((exercise) => ({
            id: Crypto.randomUUID(),
            exerciseId: exercise.exerciseId ?? null,
            name: exercise.name,
            notes: exercise.notes ?? null,
            sets: exercise.sets.map((set) => ({
              id: Crypto.randomUUID(),
              reps: String(set.reps),
              weightKg: set.weightKg ?? null,
              rpe: set.rpe == null ? "" : String(set.rpe),
              notes: set.notes ?? null,
              done: true,
            })),
          })),
        };
        if (!validDraft({ ...draft, scope })) return false;
        const existing = db.getFirstSync<{ item: string }>(
          "SELECT item FROM workout_drafts WHERE scope=?",
          scope,
        );
        if (existing) return false;
        let repaired = false;
        db.withTransactionSync(() => {
          db.runSync(
            "INSERT INTO workout_drafts(scope,item) VALUES(?,?)",
            scope,
            JSON.stringify({ ...draft, scope }),
          );
          repaired = true;
        });
        return repaired;
      });
    },
    update(item: WorkoutQueueItem): void {
      safe(() => {
        db.runSync(
          "UPDATE workout_outbox SET item=? WHERE scope=? AND id=?",
          JSON.stringify(item),
          item.scope,
          item.id,
        );
      });
    },
    markAttempted(item: WorkoutQueueItem): WorkoutQueueItem {
      return safe(() => {
        const attempted = { ...item, attempted: true };
        const changed = db.runSync(
          "UPDATE workout_outbox SET item=? WHERE scope=? AND id=?",
          JSON.stringify(attempted),
          item.scope,
          item.id,
        ).changes;
        if (changed !== 1) throw new Error("missing queue item");
        return attempted;
      });
    },
    acknowledge(scope: string, item: WorkoutQueueItem, result: unknown): void {
      safe(() => {
        if (!result || typeof result !== "object") throw new Error("invalid acknowledgement");
        const value = result as Record<string, unknown>;
        const serverId = value.id;
        const version = value.version;
        if (
          !Number.isInteger(serverId) ||
          Number(serverId) < 1 ||
          !Number.isInteger(version) ||
          Number(version) < 1
        )
          throw new Error("invalid acknowledgement");
        db.withTransactionSync(() => {
          db.runSync(
            "INSERT INTO workout_acks(scope,clientMutationId,serverId,version,result,acknowledgedAt) VALUES(?,?,?,?,?,?) ON CONFLICT(scope,clientMutationId) DO UPDATE SET serverId=excluded.serverId,version=excluded.version,result=excluded.result",
            scope,
            item.id,
            serverId,
            version,
            JSON.stringify({ result, item }),
            Date.now(),
          );
          db.runSync("DELETE FROM workout_outbox WHERE scope=? AND id=?", scope, item.id);
        });
      });
    },
    acknowledgement(
      scope: string,
      clientMutationId: string,
    ): { serverId: number; version: number; result: unknown } | null {
      return safe(() => {
        const row = db.getFirstSync<{ serverId: number; version: number; result: string }>(
          "SELECT serverId,version,result FROM workout_acks WHERE scope=? AND clientMutationId=?",
          scope,
          clientMutationId,
        );
        if (!row) return null;
        const saved = JSON.parse(row.result) as { result: unknown; item: WorkoutQueueItem };
        return {
          scope,
          clientMutationId,
          serverId: row.serverId,
          version: row.version,
          result: saved.result,
          item: saved.item,
        };
      });
    },
    listAcknowledgements(scope: string): WorkoutAcknowledgement[] {
      return safe(() =>
        db
          .getAllSync<{
            clientMutationId: string;
            serverId: number;
            version: number;
            result: string;
          }>(
            "SELECT clientMutationId,serverId,version,result FROM workout_acks WHERE scope=? ORDER BY acknowledgedAt",
            scope,
          )
          .map((row) => {
            const saved = JSON.parse(row.result) as { result: unknown; item: WorkoutQueueItem };
            return {
              scope,
              clientMutationId: row.clientMutationId,
              serverId: row.serverId,
              version: row.version,
              result: saved.result,
              item: saved.item,
            };
          }),
      );
    },
    materializeAndPruneAcknowledgements<T extends { id: number; version?: number }>(
      scope: string,
      serverWorkouts: readonly T[],
    ): boolean {
      return safe(() => {
        let changed = false;
        db.withTransactionSync(() => {
          const acks = this.listAcknowledgements(scope);
          const queued = this.list(scope);
          const draftRow = db.getFirstSync<{ item: string }>(
            "SELECT item FROM workout_drafts WHERE scope=?",
            scope,
          );
          const savedDraft = draftRow
            ? (JSON.parse(draftRow.item) as WorkoutDraft & {
                predecessorMutationId?: string;
                targetMutationId?: string;
              })
            : null;
          for (const ack of acks) {
            for (const item of queued) {
              if (
                (item.predecessorMutationId ?? item.targetMutationId) !== ack.clientMutationId ||
                item.attempted
              )
                continue;
              if (item.operation === "update" && "workout" in item.payload) {
                const next: WorkoutQueueItem = {
                  ...item,
                  targetId: ack.serverId,
                  payload: { ...item.payload, id: ack.serverId, expectedVersion: ack.version },
                  predecessorMutationId: undefined,
                  targetMutationId: undefined,
                };
                changed =
                  db.runSync(
                    "UPDATE workout_outbox SET item=? WHERE scope=? AND id=?",
                    JSON.stringify(next),
                    scope,
                    item.id,
                  ).changes > 0 || changed;
              } else if (item.operation === "delete" && !("workout" in item.payload)) {
                const next: WorkoutQueueItem = {
                  ...item,
                  targetId: ack.serverId,
                  payload: { ...item.payload, id: ack.serverId, expectedVersion: ack.version },
                  predecessorMutationId: undefined,
                  targetMutationId: undefined,
                };
                changed =
                  db.runSync(
                    "UPDATE workout_outbox SET item=? WHERE scope=? AND id=?",
                    JSON.stringify(next),
                    scope,
                    item.id,
                  ).changes > 0 || changed;
              }
            }
            const server = serverWorkouts.find((row) => row.id === ack.serverId);
            const deleting = ack.item.operation === "delete";
            const referencedByDraft =
              savedDraft?.predecessorMutationId === ack.clientMutationId ||
              savedDraft?.targetMutationId === ack.clientMutationId;
            if (
              !referencedByDraft &&
              ((deleting && !server) ||
                (!deleting && server && (server.version ?? 0) >= ack.version))
            )
              changed =
                db.runSync(
                  "DELETE FROM workout_acks WHERE scope=? AND clientMutationId=?",
                  scope,
                  ack.clientMutationId,
                ).changes > 0 || changed;
          }
        });
        return changed;
      });
    },
    resolveDependency(item: WorkoutQueueItem): WorkoutQueueItem | null {
      return safe(() => {
        if (item.attempted) return item;
        const dependency = item.predecessorMutationId ?? item.targetMutationId;
        if (!dependency) return item;
        const ack = this.acknowledgement(item.scope, dependency);
        if (!ack) return null;
        if (item.operation === "update" && "workout" in item.payload)
          return {
            ...item,
            targetId: ack.serverId,
            payload: { ...item.payload, id: ack.serverId, expectedVersion: ack.version },
          };
        if (item.operation === "delete" && !("workout" in item.payload))
          return {
            ...item,
            targetId: ack.serverId,
            payload: { ...item.payload, id: ack.serverId, expectedVersion: ack.version },
          };
        return item;
      });
    },
    remove(scope: string, id: string): void {
      safe(() => {
        db.runSync("DELETE FROM workout_outbox WHERE scope=? AND id=?", scope, id);
      });
    },
  };
}
