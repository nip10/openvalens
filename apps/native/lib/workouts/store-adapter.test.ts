import { Database } from "bun:sqlite";
import { describe, expect, mock, test } from "bun:test";
mock.module("expo-crypto", () => ({ randomUUID: () => "33333333-3333-4333-8333-333333333333" }));
import { OFFLINE_SCHEMA_SQL } from "../offline/schema";
import type { WorkoutSqlite } from "./store-adapter";
import type { WorkoutDraft } from "./model";
import type { WorkoutQueueItem } from "./sync";
// Loaded after the expo-crypto mock: the real module pulls in React Native, which Bun cannot parse.
const { classifyWorkoutSyncError, createWorkoutStore } = await import("./store-adapter");
const { createWorkoutSyncEngine } = await import("./engine");
const { createWorkoutDraft, resolveAcknowledgedDraft, validateWorkoutDraft } =
  await import("./model");

function setup(db = new Database(":memory:")) {
  db.exec(OFFLINE_SCHEMA_SQL);
  const sqlite: WorkoutSqlite = {
    getAllSync: (sql, ...params) => db.query(sql).all(...(params as never[])) as never,
    getFirstSync: (sql, ...params) => db.query(sql).get(...(params as never[])) as never,
    runSync: (sql, ...params) => ({ changes: db.query(sql).run(...(params as never[])).changes }),
    withTransactionSync: (callback) => {
      db.transaction(() => {
        callback();
      })();
    },
  };
  const store = createWorkoutStore(sqlite);
  return { db, sqlite, store };
}
const draft = (id: string) => ({
  ...createWorkoutDraft(new Date("2026-02-03T04:00:00Z"), () => id),
  scope: "user:org",
});
const itemFor = (scope: string, id: string, payloadId: string): WorkoutQueueItem => ({
  id,
  scope,
  payload: {
    clientMutationId: payloadId,
    date: "2026-02-03",
    type: "weights",
    notes: null,
    intensity: null,
    effortRating: null,
    exercises: [],
  },
  finishedAt: "2026-02-03T04:10:00.000Z",
  state: "pending",
  attempts: 0,
  error: null,
  createdAt: 1,
});

describe("workout SQLite store", () => {
  test("draft survives a new store instance and scope isolation holds", () => {
    const { sqlite, store } = setup();
    const value = draft("11111111-1111-4111-8111-111111111111");
    store.saveDraft("user:org", value);
    expect(createWorkoutStore(sqlite).readDraft("user:org")?.id).toBe(value.id);
    expect(store.readDraft("user:other")).toBeNull();
  });
  test("finish atomically inserts queue row and clears matching draft, duplicate retains original queue row", () => {
    const { sqlite, store } = setup();
    const value = draft("11111111-1111-4111-8111-111111111111");
    store.saveDraft("user:org", value);
    const first = itemFor("user:org", value.id, value.id);
    expect(store.finish("user:org", value, first)).toBe(true);
    expect(store.readDraft("user:org")).toBeNull();
    expect(createWorkoutStore(sqlite).list("user:org")).toHaveLength(1);
    expect(store.finish("user:org", value, first)).toBe(true);
    expect(store.list("user:other")).toHaveLength(0);
  });
  test("finish cannot clear a newer/different draft and rolls back if insert fails", () => {
    const { db, store } = setup();
    const old = draft("11111111-1111-4111-8111-111111111111"),
      newer = draft("22222222-2222-4222-8222-222222222222");
    store.saveDraft("user:org", newer);
    expect(store.finish("user:org", old, itemFor("user:org", old.id, old.id))).toBe(false);
    expect(store.readDraft("user:org")?.id).toBe(newer.id);
    store.discardDraft("user:org");
    store.saveDraft("user:org", old);
    db.exec(
      "CREATE TRIGGER fail_workout_insert BEFORE INSERT ON workout_outbox BEGIN SELECT RAISE(ABORT, 'fail'); END",
    );
    expect(() => store.finish("user:org", old, itemFor("user:org", old.id, old.id))).toThrow(
      "unavailable",
    );
    expect(store.readDraft("user:org")?.id).toBe(old.id);
    expect(store.list("user:org")).toHaveLength(0);
  });
  test("void-return transaction reports false when no matching draft or queue row exists", () => {
    const { store } = setup();
    expect(
      store.finish(
        "user:org",
        draft("11111111-1111-4111-8111-111111111111"),
        itemFor(
          "user:org",
          "11111111-1111-4111-8111-111111111111",
          "11111111-1111-4111-8111-111111111111",
        ),
      ),
    ).toBe(false);
    expect(store.list("user:org")).toHaveLength(0);
  });
  test("corrupt persisted envelopes fail visibly instead of masquerading as empty", () => {
    const { db, store } = setup();
    db.query("INSERT INTO workout_drafts(scope,item) VALUES(?,?)").run(
      "user:org",
      JSON.stringify({ id: "x", exercises: [], scope: "user:else" }),
    );
    expect(() => store.readDraft("user:org")).toThrow("unavailable");
    expect(() =>
      store.saveDraft("user:org", draft("11111111-1111-4111-8111-111111111111")),
    ).toThrow("unavailable");
  });
  test("drafts missing a UUID or containing malformed nested rows cannot be loaded or overwritten", () => {
    for (const malformed of [
      {
        scope: "user:org",
        startedAt: "2026-02-03T04:00:00Z",
        date: "2026-02-03",
        type: "weights",
        notes: "",
        intensity: null,
        effortRating: null,
        exercises: [],
      },
      {
        ...draft("11111111-1111-4111-8111-111111111111"),
        exercises: [
          {
            id: "22222222-2222-4222-8222-222222222222",
            exerciseId: null,
            name: "Squat",
            sets: null,
          },
        ],
      },
    ]) {
      const { db, store } = setup();
      db.query("INSERT INTO workout_drafts(scope,item) VALUES(?,?)").run(
        "user:org",
        JSON.stringify(malformed),
      );
      expect(() => store.readDraft("user:org")).toThrow("unavailable");
      expect(() =>
        store.saveDraft("user:org", draft("11111111-1111-4111-8111-111111111111")),
      ).toThrow("unavailable");
    }
  });
  test("saveDraft rejects structurally invalid incoming values without changing a readable draft", () => {
    const { db, store } = setup();
    const original = {
      ...draft(idFixture),
      exercises: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          exerciseId: null,
          name: "Squat",
          sets: [
            {
              id: "33333333-3333-4333-8333-333333333333",
              weightKg: 10,
              reps: ".",
              rpe: ".",
              done: false,
            },
          ],
        },
      ],
    };
    store.saveDraft("user:org", original);
    const originalBytes = db
      .query("SELECT item FROM workout_drafts WHERE scope=?")
      .get("user:org") as { item: string };
    const invalid: WorkoutDraft[] = [
      { ...original, duration: 0 },
      { ...original, effortRating: 11 },
      {
        ...original,
        exercises: [
          {
            ...original.exercises[0]!,
            sets: [{ ...original.exercises[0]!.sets[0]!, weightKg: -1 }],
          },
        ],
      },
      {
        ...original,
        exercises: [
          {
            ...original.exercises[0]!,
            sets: [{ ...original.exercises[0]!.sets[0]!, rpe: "123456789" }],
          },
        ],
      },
    ];
    for (const bad of invalid) {
      expect(() => store.saveDraft("user:org", bad)).toThrow("unavailable");
      expect(
        (
          db.query("SELECT item FROM workout_drafts WHERE scope=?").get("user:org") as {
            item: string;
          }
        ).item,
      ).toBe(originalBytes.item);
      expect(store.readDraft("user:org")?.id).toBe(original.id);
    }
    // In-progress numeric fields remain structurally valid; finish-time validation owns them.
    const repaired = { ...original, notes: "repaired" };
    store.saveDraft("user:org", repaired);
    expect(store.readDraft("user:org")?.notes).toBe("repaired");
  });
  test("invalid first draft writes no row", () => {
    const { db, store } = setup();
    expect(() => store.saveDraft("user:org", { ...draft(idFixture), effortRating: 11 })).toThrow(
      "unavailable",
    );
    expect(
      (db.query("SELECT count(*) AS count FROM workout_drafts").get() as { count: number }).count,
    ).toBe(0);
  });
  test("queue parser rejects missing mutation UUIDs and malformed nested payloads", () => {
    for (const [id, brokenPayload] of [
      ["not-a-uuid", { ...payloadFor("not-a-uuid") }],
      [
        idFixture,
        { ...payloadFor(idFixture), exercises: [{ name: "Squat", notes: null, sets: null }] },
      ],
    ] as const) {
      const { db, store } = setup();
      const row = { ...itemFor("user:org", id, id), payload: brokenPayload };
      db.query("INSERT INTO workout_outbox(scope,id,item) VALUES(?,?,?)").run(
        "user:org",
        id,
        JSON.stringify(row),
      );
      expect(() => store.list("user:org")).toThrow("unavailable");
    }
  });
  test("scope-only, payload-less and non-object rows fail before real engine transport", async () => {
    for (const serialized of [
      JSON.stringify({ scope: "user:org" }),
      JSON.stringify({ ...itemFor("user:org", idFixture, idFixture), payload: undefined }),
      "null",
      "[]",
    ]) {
      const { db, store } = setup();
      db.query("INSERT INTO workout_outbox(scope,id,item) VALUES(?,?,?)").run(
        "user:org",
        idFixture,
        serialized,
      );
      let sends = 0;
      const engine = createWorkoutSyncEngine({
        store,
        isCurrentScope: () => true,
        send: async () => {
          sends++;
        },
      });
      await expect(engine.sync("user:org")).rejects.toThrow("unavailable");
      expect(sends).toBe(0);
    }
  });
  test("ambiguous network failure is retryable without changing the mutation ID or payload", () => {
    const { store } = setup();
    const queued = itemFor(
      "user:org",
      "11111111-1111-4111-8111-111111111111",
      "11111111-1111-4111-8111-111111111111",
    );
    expect(classifyWorkoutSyncError(new TypeError("failed fetch")).transient).toBe(true);
    expect(classifyWorkoutSyncError({ code: "TIMEOUT" }).transient).toBe(true);
    store.update({ ...queued, attempts: 1, error: "NETWORK" });
    // update on a missing ID is intentionally not an insert; enqueueing remains explicit.
    const draftValue = draft(queued.id);
    store.saveDraft("user:org", draftValue);
    expect(store.finish("user:org", draftValue, queued)).toBe(true);
    const retained = store.list("user:org")[0]!;
    expect(retained.id).toBe(queued.id);
    expect(retained.payload).toEqual(queued.payload);
    store.update({ ...retained, state: "pending", error: null });
    expect(store.list("user:org")[0]?.id).toBe(queued.id);
  });
  test("create acknowledgement and queue removal commit atomically and survive remount", () => {
    const { db, store, sqlite } = setup();
    const queued = itemFor("user:org", idFixture, idFixture);
    db.query("INSERT INTO workout_outbox(scope,id,item) VALUES(?,?,?)").run(
      queued.scope,
      queued.id,
      JSON.stringify(queued),
    );
    store.acknowledge(queued.scope, queued, { id: 91, version: 1 });
    expect(createWorkoutStore(sqlite).list(queued.scope)).toHaveLength(0);
    expect(createWorkoutStore(sqlite).acknowledgement(queued.scope, queued.id)).toMatchObject({
      scope: queued.scope,
      clientMutationId: queued.id,
      serverId: 91,
      version: 1,
      result: { id: 91, version: 1 },
    });
    db.exec(
      "CREATE TRIGGER fail_ack BEFORE INSERT ON workout_acks BEGIN SELECT RAISE(ABORT, 'fail'); END",
    );
    db.query("INSERT INTO workout_outbox(scope,id,item) VALUES(?,?,?)").run(
      queued.scope,
      "22222222-2222-4222-8222-222222222222",
      JSON.stringify({
        ...queued,
        id: "22222222-2222-4222-8222-222222222222",
        payload: payloadFor("22222222-2222-4222-8222-222222222222"),
      }),
    );
    const failed = {
      ...queued,
      id: "22222222-2222-4222-8222-222222222222",
      payload: payloadFor("22222222-2222-4222-8222-222222222222"),
    } as WorkoutQueueItem;
    expect(() => store.acknowledge(failed.scope, failed, { id: 92, version: 1 })).toThrow(
      "unavailable",
    );
    expect(store.list(failed.scope)).toHaveLength(1);
  });
  test("unauthenticated authorization failures remain retryable", () => {
    expect(classifyWorkoutSyncError({ code: "UNAUTHENTICATED" })).toMatchObject({
      transient: true,
      code: "UNAUTHENTICATED",
    });
  });
  test("acknowledged create remains as an overlay after queue removal and resolves dependent edit", () => {
    const { store, sqlite } = setup();
    const created = itemFor("user:org", idFixture, idFixture);
    store.acknowledge(created.scope, created, { id: 73, version: 1 });
    const mountedAgain = createWorkoutStore(sqlite);
    const acks = mountedAgain.listAcknowledgements(created.scope);
    expect(acks).toHaveLength(1);
    const dependent: WorkoutQueueItem = {
      ...created,
      id: "22222222-2222-4222-8222-222222222222",
      operation: "update",
      predecessorMutationId: created.id,
      payload: {
        clientMutationId: "22222222-2222-4222-8222-222222222222",
        id: 1,
        expectedVersion: 1,
        workout: {
          date: "2026-02-04",
          type: "weights",
          notes: null,
          intensity: null,
          effortRating: null,
          exercises: [],
        },
      },
    };
    expect(mountedAgain.resolveDependency(dependent)).toMatchObject({
      targetId: 73,
      payload: { id: 73, expectedVersion: 1 },
    });
  });
  test("ACK-backed open draft becomes a valid server edit and finishes as update, not duplicate create", () => {
    const { store } = setup();
    const created = itemFor("user:org", idFixture, idFixture);
    store.acknowledge(created.scope, created, { id: 73, version: 2 });
    const opened = {
      ...draft("22222222-2222-4222-8222-222222222222"),
      targetMutationId: idFixture,
    };
    const edit = resolveAcknowledgedDraft(opened, 73, 2);
    expect(edit.targetMutationId).toBeUndefined();
    expect(edit).toMatchObject({ workoutId: 73, expectedVersion: 2, mode: "edit" });
    expect(validateWorkoutDraft(edit)).toBeNull();
    store.saveDraft("user:org", edit);
    const update: WorkoutQueueItem = {
      ...itemFor("user:org", edit.id, edit.id),
      operation: "update",
      targetId: 73,
      payload: {
        clientMutationId: edit.id,
        id: 73,
        expectedVersion: 2,
        workout: {
          date: edit.date,
          type: edit.type,
          notes: null,
          intensity: null,
          effortRating: null,
          exercises: [],
        },
      },
    };
    expect(store.finish("user:org", edit, update)).toBe(true);
    expect(store.list("user:org")).toHaveLength(1);
    expect(store.list("user:org")[0]).toMatchObject({
      operation: "update",
      payload: { id: 73, expectedVersion: 2 },
    });
    expect(store.readDraft("user:org")).toBeNull();
  });
  test("postcommit materialization preserves dependency mapping across cache invalidation/pruning", () => {
    const { store } = setup();
    const created = itemFor("user:org", idFixture, idFixture);
    store.acknowledge(created.scope, created, { id: 73, version: 4 });
    const editId = "22222222-2222-4222-8222-222222222222";
    const edit: WorkoutQueueItem = {
      ...created,
      id: editId,
      operation: "update",
      targetId: 1,
      predecessorMutationId: created.id,
      payload: {
        clientMutationId: editId,
        id: 1,
        expectedVersion: 1,
        workout: {
          date: "2026-02-04",
          type: "weights",
          notes: null,
          intensity: null,
          effortRating: null,
          exercises: [],
        },
      },
    };
    expect(store.enqueue(edit.scope, edit)).toBe(true);
    expect(store.materializeAndPruneAcknowledgements(edit.scope, [{ id: 73, version: 4 }])).toBe(
      true,
    );
    expect(store.listAcknowledgements(edit.scope)).toHaveLength(0);
    expect(store.list(edit.scope)[0]).toMatchObject({
      targetId: 73,
      payload: { id: 73, expectedVersion: 4 },
    });
    expect(store.list(edit.scope)[0]?.predecessorMutationId).toBeUndefined();
  });
  test("repair requires an explicit current server version and preserves edit identity", () => {
    const { store } = setup();
    const id = "22222222-2222-4222-8222-222222222222";
    const blocked: WorkoutQueueItem = {
      ...itemFor("user:org", id, id),
      operation: "update",
      targetId: 12,
      state: "blocked",
      payload: {
        clientMutationId: id,
        id: 12,
        expectedVersion: 1,
        workout: {
          date: "2026-02-03",
          type: "weights",
          duration: null,
          notes: null,
          intensity: null,
          effortRating: null,
          exercises: [
            {
              name: "Squat",
              exerciseId: 3,
              notes: "exercise",
              sets: [{ reps: 5, weightKg: 80, notes: "set" }],
            },
          ],
        },
      },
    };
    store.enqueue(blocked.scope, blocked);
    expect(store.repairAsDraft(blocked.scope, id, 2)).toBe(true);
    expect(store.readDraft(blocked.scope)).toMatchObject({
      workoutId: 12,
      expectedVersion: 2,
      mode: "edit",
      duration: null,
      exercises: [{ notes: "exercise", sets: [{ reps: "5", notes: "set", done: true }] }],
    });
  });
  test("repair replaces a blocked root and reconnects unattempted successors without a cycle", () => {
    const { store } = setup();
    // Successor ids avoid the mocked randomUUID value, which the repaired draft receives.
    const rootId = "22222222-2222-4222-8222-222222222222",
      nextId = "55555555-5555-4555-8555-555555555555",
      lastId = "44444444-4444-4444-8444-444444444444";
    const root: WorkoutQueueItem = {
      ...itemFor("user:org", rootId, rootId),
      operation: "update",
      targetId: 12,
      state: "blocked",
      payload: {
        clientMutationId: rootId,
        id: 12,
        expectedVersion: 1,
        workout: {
          date: "2026-02-03",
          type: "weights",
          notes: null,
          intensity: null,
          effortRating: null,
          exercises: [],
        },
      },
    };
    const successor = (id: string, predecessorMutationId: string): WorkoutQueueItem => ({
      ...root,
      id,
      state: "pending",
      predecessorMutationId,
      payload: { ...root.payload, clientMutationId: id },
    });
    store.enqueue("user:org", root);
    store.enqueue("user:org", successor(nextId, rootId));
    store.enqueue("user:org", successor(lastId, nextId));
    expect(store.repairAsDraft("user:org", rootId, 2)).toBe(true);
    const repaired = store.readDraft("user:org")!;
    expect(repaired.replacesMutationId).toBe(rootId);
    const replacement: WorkoutQueueItem = {
      ...root,
      id: repaired.id,
      state: "pending",
      payload: { ...root.payload, clientMutationId: repaired.id, expectedVersion: 2 },
    };
    expect(store.finish("user:org", repaired, replacement)).toBe(true);
    const rows = store.list("user:org");
    expect(rows.map((item) => item.id)).not.toContain(rootId);
    expect(rows.find((item) => item.id === nextId)?.predecessorMutationId).toBe(repaired.id);
    expect(rows.find((item) => item.id === lastId)?.predecessorMutationId).toBe(nextId);
  });
  test("discard of a referenced blocked root is unchanged unless unattempted cascade is explicit", () => {
    const { store } = setup();
    const rootId = "22222222-2222-4222-8222-222222222222",
      childId = "33333333-3333-4333-8333-333333333333";
    const root: WorkoutQueueItem = {
      ...itemFor("user:org", rootId, rootId),
      operation: "create",
      state: "blocked",
    };
    const child = dependentEdit(childId, rootId);
    store.enqueue("user:org", root);
    store.enqueue("user:org", child);
    expect(store.discardBlocked("user:org", rootId)).toBe(false);
    expect(store.list("user:org").map((item) => item.id)).toEqual([rootId, childId]);
    expect(store.discardBlocked("user:org", rootId, true)).toBe(true);
    expect(store.list("user:org")).toHaveLength(0);
  });
  test("cascade discard rolls back the entire dependency chain when a delete fails", () => {
    const { db, store } = setup();
    const ids = [
      "22222222-2222-4222-8222-222222222222",
      "33333333-3333-4333-8333-333333333333",
      "44444444-4444-4444-8444-444444444444",
    ];
    const root: WorkoutQueueItem = {
      ...itemFor("user:org", ids[0]!, ids[0]!),
      operation: "create",
      state: "blocked",
    };
    const child = dependentEdit(ids[1]!, ids[0]!);
    const grandchild = dependentEdit(ids[2]!, ids[1]!);
    store.enqueue("user:org", root);
    store.enqueue("user:org", child);
    store.enqueue("user:org", grandchild);
    const before = db
      .query("SELECT id,item FROM workout_outbox WHERE scope=? ORDER BY seq")
      .all("user:org");
    db.exec(
      `CREATE TRIGGER fail_workout_cascade BEFORE DELETE ON workout_outbox WHEN OLD.id='${ids[1]}' BEGIN SELECT RAISE(ABORT, 'injected delete failure'); END`,
    );
    expect(() => store.discardBlocked("user:org", ids[0]!, true)).toThrow();
    expect(
      db.query("SELECT id,item FROM workout_outbox WHERE scope=? ORDER BY seq").all("user:org"),
    ).toEqual(before);
  });
  test("invalid complete update envelope leaves saved draft intact", () => {
    const { store } = setup();
    const editDraft = {
      ...draft(idFixture),
      workoutId: 9,
      expectedVersion: 2,
      mode: "edit" as const,
    };
    store.saveDraft("user:org", editDraft);
    const bad: WorkoutQueueItem = {
      ...itemFor("user:org", idFixture, idFixture),
      operation: "update",
      targetId: 9,
      payload: {
        clientMutationId: idFixture,
        id: 9,
        expectedVersion: 0,
        workout: {
          date: "2026-02-03",
          type: "weights",
          notes: null,
          intensity: null,
          effortRating: null,
          exercises: [],
        },
      },
    };
    expect(store.finish("user:org", editDraft, bad)).toBe(false);
    expect(store.readDraft("user:org")?.id).toBe(idFixture);
    expect(store.list("user:org")).toHaveLength(0);
  });
  test("two edits then delete chain through successive acknowledged versions", () => {
    const { store } = setup();
    const seed = itemFor("user:org", idFixture, idFixture);
    store.acknowledge(seed.scope, seed, { id: 41, version: 1 });
    const ids = [
      "22222222-2222-4222-8222-222222222222",
      "33333333-3333-4333-8333-333333333333",
      "44444444-4444-4444-8444-444444444444",
    ];
    const makeEdit = (id: string, predecessorMutationId: string): WorkoutQueueItem => ({
      ...seed,
      id,
      operation: "update",
      targetId: 41,
      predecessorMutationId,
      payload: {
        clientMutationId: id,
        id: 41,
        expectedVersion: 1,
        workout: {
          date: "2026-02-03",
          type: "weights",
          notes: null,
          intensity: null,
          effortRating: null,
          exercises: [],
        },
      },
    });
    const first = makeEdit(ids[0]!, seed.id),
      second = makeEdit(ids[1]!, ids[0]!);
    const deleted: WorkoutQueueItem = {
      ...seed,
      id: ids[2]!,
      operation: "delete",
      targetId: 41,
      predecessorMutationId: ids[1]!,
      payload: { clientMutationId: ids[2]!, id: 41, expectedVersion: 1 },
    };
    store.enqueue("user:org", first);
    store.enqueue("user:org", second);
    store.enqueue("user:org", deleted);
    const resolvedFirst = store.resolveDependency(first)!;
    expect(resolvedFirst.payload).toMatchObject({ id: 41, expectedVersion: 1 });
    store.acknowledge("user:org", resolvedFirst, { id: 41, version: 2 });
    const resolvedSecond = store.resolveDependency(second)!;
    expect(resolvedSecond.payload).toMatchObject({ id: 41, expectedVersion: 2 });
    store.acknowledge("user:org", resolvedSecond, { id: 41, version: 3 });
    const resolvedDelete = store.resolveDependency(deleted)!;
    expect(resolvedDelete.payload).toMatchObject({ id: 41, expectedVersion: 3 });
  });
  test("unattempted pending create coalesces edits without changing mutation identity", () => {
    const { store } = setup();
    const queued = itemFor("user:org", idFixture, idFixture);
    store.enqueue("user:org", { ...queued, operation: "create" });
    const editingDraft = {
      ...draft("22222222-2222-4222-8222-222222222222"),
      targetMutationId: idFixture,
    };
    store.saveDraft("user:org", editingDraft);
    const replacement = { ...payloadFor(idFixture), notes: "updated before first send" };
    expect(
      store.coalesceUnattemptedCreate("user:org", idFixture, replacement, editingDraft.id),
    ).toBe(true);
    expect(store.readDraft("user:org")).toBeNull();
    expect(store.list("user:org")[0]).toMatchObject({
      id: idFixture,
      payload: { clientMutationId: idFixture, notes: "updated before first send" },
    });
  });
});
const idFixture = "11111111-1111-4111-8111-111111111111";
const dependentEdit = (id: string, predecessorMutationId: string): WorkoutQueueItem => ({
  ...itemFor("user:org", id, id),
  operation: "update",
  targetId: 1,
  predecessorMutationId,
  payload: {
    clientMutationId: id,
    id: 1,
    expectedVersion: 1,
    workout: {
      date: "2026-02-03",
      type: "weights",
      notes: null,
      intensity: null,
      effortRating: null,
      exercises: [],
    },
  },
});
const payloadFor = (id: string) => ({
  clientMutationId: id,
  date: "2026-02-03",
  type: "weights" as const,
  notes: null,
  intensity: null,
  effortRating: null,
  exercises: [],
});
