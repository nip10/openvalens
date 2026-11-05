import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";

import { createAuthorityTicket, invalidateDirectDeviceAuthority } from "./authority";
import { createSqliteDirectDeviceStore, type SyncSqliteDatabase } from "./persistence/store";
import { classifyDirectDeviceUploadError, drainDirectDeviceOutbox } from "./upload";

const scope = { serverUrl: "https://example.test/base", userId: "user-1", organizationId: "org-1" };
const deviceId = "11111111-1111-4111-8111-111111111111";
const request = (id: string) => ({
  expectedContext: { userId: scope.userId, organizationId: scope.organizationId },
  batch: {
    schemaVersion: 1 as const, deviceId, provider: "direct_device" as const, recordType: "steps" as const, mode: "backfill" as const,
    upserts: [{ type: "steps" as const, externalRecordId: id, sourceApp: null, startTime: "2026-01-01T00:00:00.000Z", endTime: "2026-01-01T00:01:00.000Z", count: 3 }],
    deletions: [] as [], clientTimezone: "UTC",
  },
});

function setup() {
  const db = new Database(":memory:");
  const adapter: SyncSqliteDatabase = {
    execSync: (sql) => db.exec(sql),
    runSync: (sql, ...params) => ({ changes: db.query(sql).run(...(params as never[])).changes }),
    getFirstSync: (sql, ...params) => db.query(sql).get(...(params as never[])) as never,
    getAllSync: (sql, ...params) => db.query(sql).all(...(params as never[])) as never,
    withTransactionSync: (callback) => db.transaction(callback)(),
  };
  const store = createSqliteDirectDeviceStore(adapter);
  const ticket = createAuthorityTicket(scope, `upload-${Math.random()}`);
  store.createBinding(ticket, deviceId);
  store.commitCapture(ticket, {
    deviceId, captureId: "capture", expectedPreviousCheckpoint: null, nextCheckpoint: "cursor",
    envelopes: [request("row-1"), request("row-2")],
  });
  return { db, sqlite: adapter, store, ticket };
}

const duplicateReceipt = {
  status: "duplicate" as const, rawArtifactId: 1, accepted: 1, duplicates: 1, rejected: 0, superseded: 0, targetId: "target",
};

test("authentication and read-only failures pause; contract-invalid and ownership failures block", () => {
  expect(classifyDirectDeviceUploadError({ code: "UNAUTHENTICATED" })).toEqual({ state: "pending", code: "UNAUTHENTICATED" });
  expect(classifyDirectDeviceUploadError({ code: "FORBIDDEN" })).toEqual({ state: "pending", code: "READ_ONLY" });
  expect(classifyDirectDeviceUploadError({ code: "ACCESS_READ_ONLY" })).toEqual({ state: "pending", code: "READ_ONLY" });
  expect(classifyDirectDeviceUploadError({ code: "BAD_REQUEST" })).toEqual({ state: "blocked", code: "INVALID_INPUT" });
  expect(classifyDirectDeviceUploadError({ code: "DIRECT_DEVICE_WRONG_OWNER" })).toEqual({ state: "blocked", code: "WRONG_OWNER" });
});

test("serialized backend device refusals block safely and generic permission errors remain retryable", async () => {
  expect(classifyDirectDeviceUploadError({ code: "PERMISSION_DENIED", data: { reason: "REVOKED" } }))
    .toEqual({ state: "blocked", code: "REVOKED" });
  expect(classifyDirectDeviceUploadError({ code: "PERMISSION_DENIED", data: { reason: "UNAVAILABLE" } }))
    .toEqual({ state: "blocked", code: "WRONG_OWNER" });
  expect(classifyDirectDeviceUploadError({ code: "PERMISSION_DENIED", data: {} }))
    .toEqual({ state: "pending", code: "NETWORK" });
  expect(classifyDirectDeviceUploadError({ code: "ACCESS_READ_ONLY" }))
    .toEqual({ state: "pending", code: "READ_ONLY" });

  const { db, store, ticket } = setup();
  let calls = 0;
  const summary = await drainDirectDeviceOutbox(ticket, {
    store,
    send: async () => {
      calls += 1;
      if (calls === 1) throw { code: "PERMISSION_DENIED", data: { reason: "UNAVAILABLE" } };
      return duplicateReceipt;
    },
  });
  expect(summary).toMatchObject({ blocked: 1, sent: 1, stopped: null });
  expect(calls).toBe(2);
  expect(db.query("SELECT last_error_code FROM direct_device_outbox WHERE seq=1").get()).toEqual({ last_error_code: "WRONG_OWNER" });

  const paused = setup();
  const pausedSummary = await drainDirectDeviceOutbox(paused.ticket, {
    store: paused.store,
    send: async () => { throw { code: "PERMISSION_DENIED", data: { reason: "other" } }; },
  });
  expect(pausedSummary).toMatchObject({ blocked: 0, stopped: "retryable_error" });
  expect(paused.store.listPending(paused.ticket, 10)).toHaveLength(2);
  expect(paused.db.query("SELECT state FROM direct_device_outbox ORDER BY seq").all()).toEqual([{ state: "pending" }, { state: "pending" }]);

  const readOnly = setup();
  expect(await drainDirectDeviceOutbox(readOnly.ticket, {
    store: readOnly.store,
    send: async () => { throw { code: "ACCESS_READ_ONLY" }; },
  })).toMatchObject({ blocked: 0, stopped: "retryable_error" });
  expect(readOnly.store.listPending(readOnly.ticket, 10)).toHaveLength(2);
});

test("lost response retries identical envelope and accepts duplicate receipt", async () => {
  const { db, store, ticket } = setup();
  const sent: unknown[] = [];
  const first = await drainDirectDeviceOutbox(ticket, {
    store,
    send: async (envelope) => {
      sent.push(envelope);
      throw Object.assign(new Error("ambiguous response"), { code: "NETWORK" });
    },
  });
  expect(first.stopped).toBe("retryable_error");
  const retry = await drainDirectDeviceOutbox(ticket, {
    store,
    send: async (envelope) => { sent.push(envelope); return duplicateReceipt; },
  });
  expect(retry.sent).toBe(2);
  expect(sent[0]).toEqual(sent[1]);
  expect(store.countUnaccepted()).toBe(0);
  expect(db.query("SELECT state FROM direct_device_outbox ORDER BY seq").all()).toEqual([{ state: "accepted" }, { state: "accepted" }]);
});

test("one in-flight drain per repository and partial receipt survives later retryable failure", async () => {
  const { db, sqlite, store, ticket } = setup();
  let release!: (value: typeof duplicateReceipt) => void;
  let started!: () => void;
  const entered = new Promise<void>((resolve) => { started = resolve; });
  const gate = new Promise<typeof duplicateReceipt>((resolve) => { release = resolve; });
  const firstDrain = drainDirectDeviceOutbox(ticket, {
    store,
    send: async () => { started(); return gate; },
  });
  await entered;
  const secondStore = createSqliteDirectDeviceStore(sqlite);
  expect(await drainDirectDeviceOutbox(ticket, { store: secondStore, send: async () => duplicateReceipt })).toMatchObject({ stopped: "already_draining" });
  release(duplicateReceipt);
  const summary = await firstDrain;
  expect(summary.sent).toBe(2);
  expect(store.countUnaccepted()).toBe(0);

  db.exec("UPDATE direct_device_outbox SET state='pending', receipt_json=NULL");
  const partial = await drainDirectDeviceOutbox(ticket, {
    store,
    send: async (envelope) => {
      if (envelope.batch.upserts[0]?.externalRecordId === "row-2") throw Object.assign(new Error("offline"), { code: "TIMEOUT" });
      return duplicateReceipt;
    },
  });
  expect(partial).toMatchObject({ sent: 1, stopped: "retryable_error" });
  expect(store.listPending(ticket, 10).map((row) => row.ref.envelopeIndex)).toEqual([1]);
});

test("late receipt after purge is ignored and stale ticket cannot recreate data", async () => {
  const { store, ticket } = setup();
  let release!: (value: typeof duplicateReceipt) => void;
  const gate = new Promise<typeof duplicateReceipt>((resolve) => { release = resolve; });
  const draining = drainDirectDeviceOutbox(ticket, { store, send: async () => gate });
  await Promise.resolve();
  store.purgeScope(scope);
  release(duplicateReceipt);
  expect(await draining).toMatchObject({ sent: 0, stopped: "stale_authority" });
  expect(store.countUnaccepted()).toBe(0);
  expect(() => store.createBinding(ticket, deviceId)).toThrow("STALE_DIRECT_DEVICE_AUTHORITY");
});

test("invalid receipt blocks fixed error code; revoked/wrong-owner failures block without leaking messages", async () => {
  const { store, ticket } = setup();
  const invalid = await drainDirectDeviceOutbox(ticket, { store, send: async () => ({ status: "bogus" } as never) });
  expect(invalid.blocked).toBe(2);
  expect(store.countUnaccepted()).toBe(2);
  expect(store.listPending(ticket, 10)).toHaveLength(0);

  const second = setup();
  const blocked = await drainDirectDeviceOutbox(second.ticket, {
    store: second.store,
    send: async () => { throw Object.assign(new Error("sensitive server details"), { code: "DIRECT_DEVICE_WRONG_OWNER" }); },
  });
  expect(blocked.blocked).toBe(2);
  expect(second.store.listPending(second.ticket, 10)).toHaveLength(0);
  expect(second.db.query("SELECT last_error_code FROM direct_device_outbox ORDER BY seq LIMIT 1").get()).toEqual({ last_error_code: "WRONG_OWNER" });
});

test("sign-out invalidation during send prevents late receipt writes", async () => {
  const { store, ticket } = setup();
  let release!: (value: typeof duplicateReceipt) => void;
  const gate = new Promise<typeof duplicateReceipt>((resolve) => { release = resolve; });
  const draining = drainDirectDeviceOutbox(ticket, { store, send: async () => gate });
  await Promise.resolve();
  invalidateDirectDeviceAuthority();
  release(duplicateReceipt);
  expect(await draining).toMatchObject({ sent: 0, stopped: "stale_authority" });
  expect(store.countUnaccepted()).toBe(2);
});
