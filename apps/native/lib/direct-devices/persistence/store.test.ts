import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SyncSqliteDatabase } from "./store";
import {
  createSqliteDirectDeviceStore,
  DirectDeviceAdmissionError,
  DirectDeviceConflictError,
  DirectDeviceStorageError,
} from "./store";
import {
  createAuthorityTicket,
  directDeviceScopeKey,
  installDirectDeviceAuthority,
  invalidateDirectDeviceAuthority,
} from "../authority";
import type { CaptureInput } from "./store";

const deviceId = "11111111-1111-4111-8111-111111111111";
const scope = {
  serverUrl: "https://example.test/openvalens",
  userId: "user-1",
  organizationId: "org-1",
};
const context = { userId: scope.userId, organizationId: scope.organizationId };
const identity = { family: "xiaomi" as const, modelId: "xiaomi_mi_band_10" };

function adapter(db: Database): SyncSqliteDatabase {
  return {
    execSync: (sql) => db.exec(sql),
    runSync: (sql, ...params) => ({ changes: db.query(sql).run(...(params as never[])).changes }),
    getFirstSync: (sql, ...params) => db.query(sql).get(...(params as never[])) as never,
    getAllSync: (sql, ...params) => db.query(sql).all(...(params as never[])) as never,
    withTransactionSync: (callback) => db.transaction(callback)(),
  };
}

function setup(filename = ":memory:") {
  const db = new Database(filename);
  const sqlite = adapter(db);
  const store = createSqliteDirectDeviceStore(sqlite, () => 1234);
  const ticket = createAuthorityTicket(scope, `session-${Math.random()}`);
  return { db, sqlite, store, ticket };
}

function request(recordId = "record-1", expectedContext = context) {
  return {
    expectedContext,
    batch: {
      schemaVersion: 1 as const,
      deviceId,
      deviceIdentity: identity,
      provider: "direct_device" as const,
      recordType: "steps" as const,
      mode: "backfill" as const,
      upserts: [
        {
          type: "steps" as const,
          externalRecordId: recordId,
          sourceApp: null,
          startTime: "2026-01-01T00:00:00.000Z",
          endTime: "2026-01-01T00:01:00.000Z",
          count: 4,
        },
      ],
      deletions: [] as [],
      clientTimezone: "UTC",
    },
  };
}

function capture(
  envelopes: readonly ReturnType<typeof request>[] = [request()],
  captureId = "capture-1",
  expectedPreviousCheckpoint: string | null = null,
  nextCheckpoint = "cursor-1",
): CaptureInput {
  return {
    deviceId,
    deviceIdentity: identity,
    captureId,
    expectedPreviousCheckpoint,
    nextCheckpoint,
    envelopes,
  };
}

function prepare(
  store: ReturnType<typeof setup>["store"],
  ticket: ReturnType<typeof setup>["ticket"],
) {
  store.createBinding(ticket, deviceId, identity);
  store.markRegistered(ticket, deviceId, 42);
}

test("capture inserts are atomic, replay-safe, and checkpoint CAS rejects divergent histories", () => {
  const { db, store, ticket } = setup();
  prepare(store, ticket);
  const first = capture([request("one"), request("two")]);
  store.commitCapture(ticket, first);
  store.commitCapture(ticket, first);
  expect(store.listPending(ticket, 10)).toHaveLength(2);
  expect(() =>
    store.commitCapture(ticket, { ...first, envelopes: [request("different"), request("two")] }),
  ).toThrow(DirectDeviceConflictError);
  expect(() =>
    store.commitCapture(ticket, capture([request("third")], "capture-2", null, "cursor-2")),
  ).toThrow(DirectDeviceConflictError);
  expect(db.query("SELECT capture_checkpoint FROM direct_device_binding").get()).toEqual({
    capture_checkpoint: "cursor-1",
  });

  db.exec(
    "CREATE TRIGGER fail_outbox BEFORE INSERT ON direct_device_outbox BEGIN SELECT RAISE(ABORT, 'injected'); END",
  );
  expect(() =>
    store.commitCapture(ticket, capture([request("three")], "capture-3", "cursor-1", "cursor-3")),
  ).toThrow();
  expect(db.query("SELECT capture_checkpoint FROM direct_device_binding").get()).toEqual({
    capture_checkpoint: "cursor-1",
  });
  expect(db.query("SELECT COUNT(*) AS count FROM direct_device_capture").get()).toEqual({
    count: 1,
  });
  expect(db.query("SELECT COUNT(*) AS count FROM direct_device_outbox").get()).toEqual({
    count: 2,
  });
});

test("real file-backed SQLite survives store/connection restart and retains exact request bytes", () => {
  const dir = mkdtempSync(join(tmpdir(), "direct-device-sqlite-"));
  const filename = join(dir, "outbox.db");
  try {
    const first = setup(filename);
    prepare(first.store, first.ticket);
    const original = request("durable-record");
    first.store.commitCapture(first.ticket, capture([original]));
    first.db.close();

    const reopenedDb = new Database(filename);
    const reopened = createSqliteDirectDeviceStore(adapter(reopenedDb));
    const ticket = createAuthorityTicket(scope, "session-after-restart");
    const row = reopened.listPending(ticket, 10)[0]!;
    expect(row.request).toEqual(original);
    expect(row.state).toBe("pending");
    reopenedDb.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("admission snapshots the complete envelope and returned retry identity is frozen", () => {
  const { store, ticket } = setup();
  prepare(store, ticket);
  const mutable = request("immutable-before-commit");
  store.commitCapture(ticket, capture([mutable]));
  mutable.batch.upserts[0]!.externalRecordId = "mutated-after-commit";
  const row = store.listPending(ticket, 1)[0]!;
  expect(row.request.batch.upserts[0]?.externalRecordId).toBe("immutable-before-commit");
  expect(Object.isFrozen(row.request)).toBe(true);
  expect(Object.isFrozen(row.request.batch.upserts[0])).toBe(true);
});

test("receipts are partial, schema-validated, and accepted rows remain durable", () => {
  const { store, ticket } = setup();
  prepare(store, ticket);
  store.commitCapture(ticket, capture([request("one"), request("two")]));
  const [first, second] = store.listPending(ticket, 10);
  const receipt = {
    status: "queued" as const,
    rawArtifactId: 9,
    accepted: 1,
    duplicates: 0,
    rejected: 0,
    superseded: 0,
    targetId: "target",
  };
  store.recordServerReceipt(ticket, first!.ref, receipt);
  store.recordServerReceipt(ticket, first!.ref, receipt);
  expect(() =>
    store.recordServerReceipt(ticket, second!.ref, { ...receipt, status: "nope" } as never),
  ).toThrow();
  expect(store.listPending(ticket, 10).map((row) => row.ref.envelopeIndex)).toEqual([1]);
  expect(store.countUnaccepted()).toBe(1);
  expect(store.countUnaccepted(scope)).toBe(1);
  expect(store.listPending(ticket, 10)).toHaveLength(1);
});

test("registrations, scope fences, purge callbacks and counts are immutable and isolated", () => {
  const first = setup();
  prepare(first.store, first.ticket);
  expect(() => first.store.markRegistered(first.ticket, deviceId, 43)).toThrow(
    DirectDeviceConflictError,
  );
  first.store.commitCapture(first.ticket, capture());
  const otherScope = { ...scope, organizationId: "org-2" };
  const otherTicket = createAuthorityTicket(otherScope, "other-org");
  expect(first.store.listPending(otherTicket, 10)).toHaveLength(0);
  expect(first.store.countUnaccepted(otherScope)).toBe(0);
  first.store.purgeScope(scope);
  expect(() => first.store.listPending(first.ticket, 10)).toThrow("STALE_DIRECT_DEVICE_AUTHORITY");
  expect(first.store.countUnaccepted()).toBe(0);
  first.store.createBinding(otherTicket, deviceId, identity);
  first.store.commitCapture(
    otherTicket,
    capture([request("org2-record", { userId: scope.userId, organizationId: "org-2" })]),
  );
  first.store.purgeAll();
  expect(() => first.store.listPending(otherTicket, 10)).toThrow("STALE_DIRECT_DEVICE_AUTHORITY");
  expect(first.store.countUnaccepted()).toBe(0);
});

test("capture admission limits reject new work without evicting accepted history", () => {
  const { store, ticket } = setup();
  prepare(store, ticket);
  store.commitCapture(ticket, capture());
  const accepted = store.listPending(ticket, 1)[0]!;
  store.recordServerReceipt(ticket, accepted.ref, {
    status: "applied",
    rawArtifactId: 2,
    accepted: 1,
    duplicates: 0,
    rejected: 0,
    superseded: 0,
    targetId: "target",
  });
  const oversized = capture(
    Array.from({ length: 101 }, (_, index) => request(`r-${index}`)),
    "too-many",
    "cursor-1",
    "cursor-2",
  );
  expect(() => store.commitCapture(ticket, oversized)).toThrow(DirectDeviceAdmissionError);
  expect(store.countUnaccepted()).toBe(0);
  expect(store.listPending(ticket, 10)).toHaveLength(0);
  expect(store.countUnaccepted(scope)).toBe(0);
});

test("corrupt rows fail closed instead of appearing as an empty queue", () => {
  const { db, store, ticket } = setup();
  prepare(store, ticket);
  store.commitCapture(ticket, capture());
  db.query("UPDATE direct_device_outbox SET request_json = 'not-json'").run();
  expect(() => store.listPending(ticket, 10)).toThrow(DirectDeviceStorageError);
});

test("authority purge invalidates immediately and does not permit stale inserts", () => {
  const { store, ticket } = setup();
  prepare(store, ticket);
  invalidateDirectDeviceAuthority();
  expect(() => store.commitCapture(ticket, capture())).toThrow("STALE_DIRECT_DEVICE_AUTHORITY");
  expect(store.countUnaccepted()).toBe(0);
});

test("organization switch fences old scope without deleting it; failed global purge remains fenced", () => {
  const { db, store, ticket } = setup();
  prepare(store, ticket);
  store.commitCapture(ticket, capture());
  invalidateDirectDeviceAuthority();
  const switchedOrg = createAuthorityTicket({ ...scope, organizationId: "org-2" }, "switched-org");
  expect(store.listPending(switchedOrg, 10)).toHaveLength(0);
  expect(store.countUnaccepted(scope)).toBe(1);

  db.exec(
    "CREATE TRIGGER fail_binding_purge BEFORE DELETE ON direct_device_binding BEGIN SELECT RAISE(ABORT, 'purge failure'); END",
  );
  expect(() => store.purgeAll()).toThrow();
  expect(() => store.listPending(switchedOrg, 10)).toThrow("STALE_DIRECT_DEVICE_AUTHORITY");
  // The transaction rolled back; failure is visible and no rows were silently evicted.
  expect(store.countUnaccepted(scope)).toBe(1);
});

test("v1 SQLite upgrades in place, preserves legacy rows, resets cursor once, and quarantines legacy work", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE direct_device_binding(scope TEXT NOT NULL, device_id TEXT NOT NULL, provider_connection_id INTEGER, capture_checkpoint TEXT, PRIMARY KEY(scope, device_id));
    CREATE TABLE direct_device_capture(scope TEXT NOT NULL, device_id TEXT NOT NULL, capture_id TEXT NOT NULL, checkpoint_json TEXT NOT NULL, envelope_count INTEGER NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(scope, device_id, capture_id));
    CREATE TABLE direct_device_outbox(seq INTEGER PRIMARY KEY AUTOINCREMENT, scope TEXT NOT NULL, device_id TEXT NOT NULL, capture_id TEXT NOT NULL, envelope_index INTEGER NOT NULL, request_json TEXT NOT NULL, state TEXT NOT NULL, receipt_json TEXT, last_error_code TEXT, created_at INTEGER NOT NULL, UNIQUE(scope, device_id, capture_id, envelope_index));
    PRAGMA user_version = 1;
  `);
  const key = directDeviceScopeKey(scope);
  const legacyRequest = request("legacy");
  delete (legacyRequest.batch as { deviceIdentity?: unknown }).deviceIdentity;
  db.query("INSERT INTO direct_device_binding VALUES (?, ?, ?, ?)").run(
    key,
    deviceId,
    42,
    "old-cursor",
  );
  db.query("INSERT INTO direct_device_capture VALUES (?, ?, ?, ?, ?, ?)").run(
    key,
    deviceId,
    "old-capture",
    "old-checkpoints",
    1,
    7,
  );
  db.query(
    "INSERT INTO direct_device_outbox(scope, device_id, capture_id, envelope_index, request_json, state, created_at) VALUES (?, ?, ?, 0, ?, 'pending', 7)",
  ).run(key, deviceId, "old-capture", JSON.stringify(legacyRequest));
  const store = createSqliteDirectDeviceStore(adapter(db));
  const ticket = createAuthorityTicket(scope, "v1-upgrade");
  expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: 2 });
  expect(store.getBinding(ticket, deviceId)?.captureCheckpoint).toBe("old-cursor");
  store.adoptBindingIdentity(ticket, deviceId, identity);
  expect(store.getBinding(ticket, deviceId)).toMatchObject({
    family: "xiaomi",
    modelId: "xiaomi_mi_band_10",
    captureCheckpoint: null,
  });
  expect(db.query("SELECT COUNT(*) AS count FROM direct_device_capture").get()).toEqual({
    count: 1,
  });
  expect(db.query("SELECT state, last_error_code FROM direct_device_outbox").get()).toEqual({
    state: "blocked",
    last_error_code: "IDENTITY_REQUIRED",
  });
  expect(store.countBlockedIdentityEnvelopes(ticket)).toBe(1);
  expect(store.listPending(ticket, 10)).toHaveLength(0);
  expect(store.countBlockedIdentityEnvelopes(ticket)).toBe(1);
  const preservedRequest = db.query("SELECT request_json FROM direct_device_outbox").get() as {
    request_json: string;
  };
  expect(JSON.parse(preservedRequest.request_json).batch.deviceIdentity).toBeUndefined();
  store.commitCapture(
    ticket,
    capture([request("after-adoption")], "new-capture", null, "new-cursor"),
  );
  invalidateDirectDeviceAuthority();
  installDirectDeviceAuthority(scope, "second-phone-session");
  const secondPhoneTicket = createAuthorityTicket(scope, "second-phone-session");
  store.adoptBindingIdentity(secondPhoneTicket, deviceId, identity);
  expect(db.query("SELECT COUNT(*) AS count FROM direct_device_capture").get()).toEqual({
    count: 2,
  });
  expect(store.getBinding(secondPhoneTicket, deviceId)?.captureCheckpoint).toBe("new-cursor");
  invalidateDirectDeviceAuthority();
  db.close();
});
