import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createAuthorityTicket,
  directDeviceScopeKey,
  invalidateDirectDeviceAuthority,
} from "../authority";
import { directDeviceBatch } from "@openvalens/api/contracts/direct-device";
import { projectPebbleCapture } from "../sync/pebble-capture";
import type { PebbleIdentity, PebblePacket } from "../pebble-types";
import type { SyncSqliteDatabase } from "./store";
import { createSqliteDirectDeviceStore } from "./store";

const scope = { serverUrl: "https://pebble.test", userId: "u1", organizationId: "o1" };
const deviceId = "11111111-1111-4111-8111-111111111111";
const identity: PebbleIdentity = { family: "pebble", modelId: "pebble_classic_2" };
const nativeId = "native-watch-1";

function adapter(db: Database): SyncSqliteDatabase {
  return {
    execSync: (sql) => db.exec(sql),
    runSync: (sql, ...params) => ({ changes: db.query(sql).run(...(params as never[])).changes }),
    getFirstSync: (sql, ...params) => db.query(sql).get(...(params as never[])) as never,
    getAllSync: (sql, ...params) => db.query(sql).all(...(params as never[])) as never,
    withTransactionSync: (callback) => db.transaction(callback)(),
  };
}

function open(filename = ":memory:") {
  const db = new Database(filename);
  const store = createSqliteDirectDeviceStore(adapter(db), () => 1234);
  const ticket = createAuthorityTicket(scope, `pebble-${Math.random()}`);
  store.createBinding(ticket, deviceId, identity);
  store.markRegistered(ticket, deviceId, 12);
  store.attachPebblePeripheral(ticket, deviceId, identity, nativeId);
  return { db, store, ticket };
}

function le16(value: number) {
  return [value & 255, (value >>> 8) & 255];
}
function le32(value: number) {
  return [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255];
}

function bounds(start: number, end: number): Uint8Array {
  return Uint8Array.from([...le16(1), ...le32(0), ...le32(start), ...le32(end), ...le32(0)]);
}

function overlay(type: number, start: number, duration: number): Uint8Array {
  return Uint8Array.from([
    ...le16(1),
    ...le16(0),
    ...le16(type),
    ...le32(0),
    ...le32(start),
    ...le32(duration),
  ]);
}

function steps(timestamp: number, count: number): Uint8Array {
  // Tag-81 v5 record with one minute sample.
  return Uint8Array.from([...le16(5), ...le32(timestamp), 0, 6, 1, count, 0, 0, 0, 0, 0]);
}

function stepsWithHr(timestamp: number, count: number, bpm: number): Uint8Array {
  return Uint8Array.from([
    ...le16(7),
    ...le32(timestamp),
    0,
    13,
    1,
    count,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    bpm,
  ]);
}

function packet(
  logTag: 81 | 83 | 84,
  data: Uint8Array,
  sessionTimestamp = 1_700_000_000,
): PebblePacket {
  return {
    uuid: "00000000-0000-0000-0000-000000000000",
    sessionTimestamp,
    logTag,
    itemType: 0,
    itemSize: data.length,
    data,
  };
}

function target() {
  return { deviceId, identity, nativeId };
}

test("durable inbox commit returns receipt only after transaction; real SQLite reopen reprojects retained sleep inputs", () => {
  const dir = mkdtempSync(join(tmpdir(), "pebble-inbox-"));
  const filename = join(dir, "capture.db");
  try {
    const first = open(filename);
    const start = 1_700_000_000;
    const receipt = first.store.appendPebblePacket(
      first.ticket,
      target(),
      packet(83, bounds(start + 100, start + 300)),
    );
    expect(receipt).toEqual({ durable: true, insertedItems: 1, throughSeq: 1 });
    first.store.appendPebblePacket(
      first.ticket,
      target(),
      packet(84, overlay(3, start, 600), start + 99),
    );
    first.db.close();

    const db = new Database(filename);
    const store = createSqliteDirectDeviceStore(adapter(db));
    const ticket = createAuthorityTicket(scope, "restart");
    expect(store.readPebbleItems(ticket, deviceId)).toHaveLength(2);
    const projected = projectPebbleCapture({ store, ticket, deviceId, identity });
    expect(projected.sleepSessions).toBe(3);
    const outbox = store.listPending(ticket, 10);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.request.batch.upserts).toHaveLength(3);
    expect(
      outbox[0]!.request.batch.upserts.every(
        (record) =>
          directDeviceBatch.safeParse({ ...outbox[0]!.request.batch, upserts: [record] }).success,
      ),
    ).toBe(true);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("whole packets validate before append; dedupe is independent of session timestamp and preserves seq", () => {
  const { store, ticket, db } = open();
  const sample = packet(81, steps(1_700_000_040, 4));
  const malformed = Uint8Array.from(sample.data);
  malformed[2] = malformed[2]! + 1;
  expect(() => store.appendPebblePacket(ticket, target(), { ...sample, data: malformed })).toThrow(
    "PEBBLE_PACKET_INVALID",
  );
  expect(store.readPebbleItems(ticket, deviceId)).toHaveLength(0);
  const validBounds = bounds(1_700_000_000, 1_700_000_100);
  const invalidBounds = bounds(1_700_000_200, 1_700_000_300);
  invalidBounds[0] = 2;
  expect(() =>
    store.appendPebblePacket(ticket, target(), {
      ...packet(83, Uint8Array.from([...validBounds, ...invalidBounds])),
      itemSize: 18,
    }),
  ).toThrow("PEBBLE_PACKET_INVALID");
  expect(store.readPebbleItems(ticket, deviceId)).toHaveLength(0);
  expect(store.appendPebblePacket(ticket, target(), sample)).toMatchObject({
    insertedItems: 1,
    throughSeq: 1,
  });
  expect(
    store.appendPebblePacket(ticket, target(), {
      ...sample,
      sessionTimestamp: sample.sessionTimestamp + 60,
    }),
  ).toMatchObject({ insertedItems: 0, throughSeq: 1 });
  expect(store.readPebbleItems(ticket, deviceId)[0]!.seq).toBe(1);
  db.close();
});

test("activity projection processes at most 16 items, emits stable minute/point IDs, and suppresses Duo HR", () => {
  const { store, ticket, db } = open();
  const start = 1_700_000_040;
  const records = Array.from({ length: 17 }, (_, index) =>
    stepsWithHr(start + index * 60, index + 1, 65 + index),
  );
  store.appendPebblePacket(ticket, target(), {
    ...packet(81, Uint8Array.from(records.flatMap((record) => [...record])), start),
    itemSize: records[0]!.length,
  });
  const first = projectPebbleCapture({ store, ticket, deviceId, identity });
  expect(first.activityItems).toBe(16);
  const firstRows = store.listPending(ticket, 10);
  expect(firstRows).toHaveLength(2);
  const types = firstRows.map((row) => row.request.batch.recordType);
  expect(types).toEqual(["steps", "heart_rate"]);
  const stepIds = firstRows[0]!.request.batch.upserts.map((record) => record.externalRecordId);
  expect(stepIds[0]).toBe(`dd-pebble:${deviceId}:steps:${start / 60}`);
  const hrIds = firstRows[1]!.request.batch.upserts.map((record) => record.externalRecordId);
  expect(hrIds[0]).toBe(`dd-pebble:${deviceId}:hr:${start}`);
  for (const row of firstRows)
    expect(directDeviceBatch.safeParse(row.request.batch).success).toBe(true);
  expect(projectPebbleCapture({ store, ticket, deviceId, identity }).activityItems).toBe(1);

  const duoId = "22222222-2222-4222-8222-222222222222";
  const duo: PebbleIdentity = { family: "pebble", modelId: "pebble_2_duo" };
  store.createBinding(ticket, duoId, duo);
  store.markRegistered(ticket, duoId, 13);
  store.attachPebblePeripheral(ticket, duoId, duo, "native-duo");
  store.appendPebblePacket(
    ticket,
    { deviceId: duoId, identity: duo, nativeId: "native-duo" },
    packet(81, stepsWithHr(start, 10, 70)),
  );
  projectPebbleCapture({ store, ticket, deviceId: duoId, identity: duo });
  expect(
    store
      .listPending(ticket, 10)
      .filter((row) => row.ref.deviceId === duoId)
      .map((row) => row.request.batch.recordType),
  ).toEqual(["steps"]);
  db.close();
});

test("SQLite failure rolls back the entire packet and exposes no durability receipt", () => {
  const { store, ticket, db } = open();
  const first = bounds(1_700_000_000, 1_700_000_100);
  const second = bounds(1_700_000_200, 1_700_000_300);
  const secondHex = Array.from(second, (byte) => byte.toString(16).padStart(2, "0")).join("");
  db.query(
    `CREATE TRIGGER reject_second BEFORE INSERT ON direct_device_pebble_item WHEN NEW.raw_hex = '${secondHex}' BEGIN SELECT RAISE(ABORT, 'injected'); END`,
  ).run();
  expect(() =>
    store.appendPebblePacket(ticket, target(), {
      ...packet(83, Uint8Array.from([...first, ...second])),
      itemSize: first.length,
    }),
  ).toThrow();
  expect(store.readPebbleItems(ticket, deviceId)).toHaveLength(0);
  db.close();
});

test("native peer association is immutable and authority purge clears inbox and projection", () => {
  const { store, ticket, db } = open();
  expect(() => store.attachPebblePeripheral(ticket, deviceId, identity, "other-peer")).toThrow(
    "PEBBLE_NATIVE_ID_IMMUTABLE",
  );
  store.appendPebblePacket(ticket, target(), packet(83, bounds(1_700_000_000, 1_700_000_100)));
  projectPebbleCapture({ store, ticket, deviceId, identity });
  invalidateDirectDeviceAuthority();
  expect(() =>
    store.appendPebblePacket(ticket, target(), packet(83, bounds(1_700_000_200, 1_700_000_300))),
  ).toThrow("STALE_DIRECT_DEVICE_AUTHORITY");
  store.purgeScope(scope);
  const replacement = createAuthorityTicket(scope, "after-purge");
  expect(store.readPebbleItems(replacement, deviceId)).toHaveLength(0);
  expect(db.query("SELECT COUNT(*) AS count FROM direct_device_pebble_projection").get()).toEqual({
    count: 0,
  });
  db.close();
});

test("projection outbox and cursor roll back atomically when outbox insertion fails", () => {
  const { store, ticket, db } = open();
  store.appendPebblePacket(ticket, target(), packet(83, bounds(1_700_000_000, 1_700_000_100)));
  const snapshot = store.readPebbleProjection(ticket, deviceId, "sleep");
  db.exec(
    "CREATE TRIGGER reject_outbox BEFORE INSERT ON direct_device_outbox BEGIN SELECT RAISE(ABORT, 'injected'); END",
  );
  expect(() => projectPebbleCapture({ store, ticket, deviceId, identity })).toThrow();
  expect(store.readPebbleProjection(ticket, deviceId, "sleep")).toEqual(snapshot);
  expect(store.listPending(ticket, 10)).toHaveLength(0);
  db.close();
});

function sleepUpserts(
  store: ReturnType<typeof open>["store"],
  ticket: ReturnType<typeof open>["ticket"],
) {
  return store
    .listPending(ticket, 100)
    .filter((row) => row.request.batch.recordType === "sleep_session")
    .map((row) => row.request.batch.upserts);
}

test("sleep manifest reuses one-to-one ids and holds a merge without republishing it", () => {
  const { store, ticket, db } = open();
  const start = 1_700_000_000;
  store.appendPebblePacket(ticket, target(), {
    ...packet(
      83,
      Uint8Array.from([...bounds(start, start + 100), ...bounds(start + 300, start + 400)]),
    ),
    itemSize: 18,
  });
  projectPebbleCapture({ store, ticket, deviceId, identity });
  const before = store.readPebbleProjection(ticket, deviceId, "sleep");
  store.appendPebblePacket(
    ticket,
    target(),
    packet(83, bounds(start + 10, start + 110), start + 1),
  );
  expect(projectPebbleCapture({ store, ticket, deviceId, identity }).sleepHeld).toBe(0);
  expect(store.readPebbleProjection(ticket, deviceId, "sleep").manifest[0]!.recordId).toBe(
    before.manifest[0]!.recordId,
  );
  const publishedBeforeMerge = sleepUpserts(store, ticket).length;
  // One bound now spans both published sessions: a merge the upsert-only
  // contract cannot express. It is held, the old entries stay, nothing is sent.
  store.appendPebblePacket(ticket, target(), packet(83, bounds(start, start + 400), start + 3));
  const merged = projectPebbleCapture({ store, ticket, deviceId, identity });
  expect(merged.sleepHeld).toBe(1);
  const after = store.readPebbleProjection(ticket, deviceId, "sleep");
  expect(after.manifest.map((entry) => entry.recordId)).toEqual(
    before.manifest.map((entry) => entry.recordId),
  );
  // Nothing is queued for the held group, not even an empty batch.
  expect(sleepUpserts(store, ticket).length).toBe(publishedBeforeMerge);
  db.close();
});

test("a held sleep split does not block publication of later nights", () => {
  const { store, ticket, db } = open();
  const start = 1_700_000_000;
  store.appendPebblePacket(ticket, target(), packet(84, overlay(1, start, 600)));
  projectPebbleCapture({ store, ticket, deviceId, identity });
  const nights = () =>
    store
      .readPebbleProjection(ticket, deviceId, "sleep")
      .manifest.filter((entry) => !entry.recordId.endsWith(":sleep-settled"));
  const original = nights();
  expect(original).toHaveLength(1);
  // An activity overlay splits the published session in two: held.
  store.appendPebblePacket(
    ticket,
    target(),
    packet(84, overlay(0xffff, start + 200, 200), start + 1),
  );
  expect(projectPebbleCapture({ store, ticket, deviceId, identity }).sleepHeld).toBe(1);
  // The next night is unrelated and still publishes, alongside the held entry.
  const nextNight = start + 86_400;
  store.appendPebblePacket(ticket, target(), packet(84, overlay(1, nextNight, 600), nextNight));
  const projected = projectPebbleCapture({ store, ticket, deviceId, identity });
  expect(projected.sleepHeld).toBe(1);
  const manifest = nights();
  expect(manifest.map((entry) => entry.recordId)).toEqual([
    original[0]!.recordId,
    `dd-pebble:${deviceId}:sleep:${nextNight}`,
  ]);
  expect(
    sleepUpserts(store, ticket)
      .at(-1)!
      .map((record) => record.externalRecordId),
  ).toEqual([`dd-pebble:${deviceId}:sleep:${nextNight}`]);
  db.close();
});

test("a minute is published once: earliest item wins within and across projections", () => {
  const { store, ticket, db } = open();
  const minute = 1_700_000_040;
  store.appendPebblePacket(ticket, target(), packet(81, steps(minute, 4)));
  // Same minute, different count (e.g. after a watch clock change).
  store.appendPebblePacket(ticket, target(), packet(81, steps(minute, 9), minute + 1));
  store.appendPebblePacket(ticket, target(), packet(81, steps(minute + 60, 2), minute + 2));
  projectPebbleCapture({ store, ticket, deviceId, identity });
  const stepBatches = () =>
    store
      .listPending(ticket, 100)
      .filter((row) => row.request.batch.recordType === "steps")
      .map(
        (row) =>
          row.request.batch.upserts as readonly { externalRecordId: string; count: number }[],
      );
  expect(stepBatches()).toHaveLength(1);
  expect(stepBatches()[0]!.map((record) => [record.externalRecordId, record.count])).toEqual([
    [`dd-pebble:${deviceId}:steps:${minute / 60}`, 4],
    [`dd-pebble:${deviceId}:steps:${minute / 60 + 1}`, 2],
  ]);
  // A later projection carrying an already-published minute sends nothing for it.
  store.appendPebblePacket(ticket, target(), packet(81, steps(minute, 7), minute + 3));
  projectPebbleCapture({ store, ticket, deviceId, identity });
  expect(stepBatches()).toHaveLength(1);
  db.close();
});

test("projected step items are compacted out of the inbox; sleep inputs are retained", () => {
  const { store, ticket, db } = open();
  const start = 1_700_000_040;
  for (let index = 0; index < 20; index += 1)
    store.appendPebblePacket(
      ticket,
      target(),
      packet(81, steps(start + index * 60, index + 1), start + index),
    );
  store.appendPebblePacket(ticket, target(), packet(83, bounds(start, start + 600)));
  projectPebbleCapture({ store, ticket, deviceId, identity });
  // 16 step items are projected and removed; 4 remain for the next call.
  expect(store.readPebbleItems(ticket, deviceId).filter((item) => item.logTag === 81)).toHaveLength(
    4,
  );
  projectPebbleCapture({ store, ticket, deviceId, identity });
  const remaining = store.readPebbleItems(ticket, deviceId);
  expect(remaining.map((item) => item.logTag)).toEqual([83]);
  // Coverage stays compact: 20 contiguous minutes are one range.
  expect(store.readPebbleProjection(ticket, deviceId, "activity").manifest).toEqual([
    {
      recordId: `dd-pebble:${deviceId}:steps-coverage:${start / 60}`,
      startTime: new Date(start * 1000).toISOString(),
      endTime: new Date((start + 20 * 60) * 1000).toISOString(),
    },
  ]);
  // A replay of a compacted item is re-admitted but publishes nothing new.
  store.appendPebblePacket(ticket, target(), packet(81, steps(start, 1), start + 99));
  const before = store.listPending(ticket, 100).length;
  projectPebbleCapture({ store, ticket, deviceId, identity });
  expect(
    store.listPending(ticket, 100).filter((row) => row.request.batch.recordType === "steps").length,
  ).toBe(
    store
      .listPending(ticket, 100)
      .slice(0, before)
      .filter((row) => row.request.batch.recordType === "steps").length,
  );
  expect(store.readPebbleItems(ticket, deviceId).filter((item) => item.logTag === 81)).toHaveLength(
    0,
  );
  db.close();
});

test("item capacity excludes already-retained duplicates and never evicts acknowledged data", () => {
  const { store, ticket, db } = open();
  const duplicate = bounds(1_700_000_000, 1_700_000_100);
  const duplicateHex = Array.from(duplicate, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const scopeKey = directDeviceScopeKey(scope);
  const insert = db.query(
    `INSERT INTO direct_device_pebble_item(scope, device_id, log_tag, item_type, item_size, session_timestamp, raw_hex, created_at) VALUES (?, ?, 83, 0, 18, 1, ?, 1)`,
  );
  db.transaction(() => {
    for (let index = 0; index < 50_000; index += 1)
      insert.run(
        scopeKey,
        deviceId,
        index === 0 ? duplicateHex : index.toString(16).padStart(36, "0"),
      );
  })();
  expect(store.appendPebblePacket(ticket, target(), packet(83, duplicate))).toMatchObject({
    insertedItems: 0,
    throughSeq: 50_000,
  });
  expect(() =>
    store.appendPebblePacket(ticket, target(), packet(83, bounds(1_700_000_200, 1_700_000_300))),
  ).toThrow("PEBBLE_INBOX_FULL");
  expect(db.query("SELECT COUNT(*) AS count FROM direct_device_pebble_item").get()).toEqual({
    count: 50_000,
  });
  db.close();
});

test("raw-byte capacity is eight MiB and exact duplicates remain admissible", () => {
  const { store, ticket, db } = open();
  const data = new Uint8Array(8 * 1024 * 1024);
  data.set(bounds(1_700_000_000, 1_700_000_100));
  const fullPacket: PebblePacket = {
    ...packet(83, data),
    itemSize: data.length,
  };
  expect(store.appendPebblePacket(ticket, target(), fullPacket)).toMatchObject({
    insertedItems: 1,
  });
  expect(
    store.appendPebblePacket(ticket, target(), { ...fullPacket, sessionTimestamp: 9 }),
  ).toMatchObject({ insertedItems: 0 });
  expect(() =>
    store.appendPebblePacket(ticket, target(), packet(83, bounds(1_700_000_200, 1_700_000_300))),
  ).toThrow("PEBBLE_INBOX_FULL");
  db.close();
});

test("v2 migration adds Pebble tables and native association without dropping prior binding rows", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE direct_device_binding(scope TEXT NOT NULL, device_id TEXT NOT NULL, provider_connection_id INTEGER, capture_checkpoint TEXT, family TEXT, model_id TEXT, PRIMARY KEY(scope, device_id));
    CREATE TABLE direct_device_capture(scope TEXT NOT NULL, device_id TEXT NOT NULL, capture_id TEXT NOT NULL, checkpoint_json TEXT NOT NULL, envelope_count INTEGER NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(scope, device_id, capture_id));
    CREATE TABLE direct_device_outbox(seq INTEGER PRIMARY KEY AUTOINCREMENT, scope TEXT NOT NULL, device_id TEXT NOT NULL, capture_id TEXT NOT NULL, envelope_index INTEGER NOT NULL, request_json TEXT NOT NULL, state TEXT NOT NULL, receipt_json TEXT, last_error_code TEXT, created_at INTEGER NOT NULL, UNIQUE(scope, device_id, capture_id, envelope_index));
    PRAGMA user_version = 2;
  `);
  const scopeKey = directDeviceScopeKey(scope);
  db.query(
    "INSERT INTO direct_device_binding VALUES (?, ?, 12, NULL, 'pebble', 'pebble_classic_2')",
  ).run(scopeKey, deviceId);
  const store = createSqliteDirectDeviceStore(adapter(db));
  const ticket = createAuthorityTicket(scope, "v2");
  expect(store.getBinding(ticket, deviceId)).toMatchObject({
    family: "pebble",
    modelId: "pebble_classic_2",
    pebbleNativeId: null,
  });
  expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: 3 });
  db.close();
});

test("Pebble store paths accept only capture models, and the generic capture path refuses Pebble", () => {
  const { store, ticket, db } = open();
  const classicId = "33333333-3333-4333-8333-333333333333";
  const classic = { family: "pebble", modelId: "pebble_time" } as const;
  store.createBinding(ticket, classicId, classic as never);
  store.markRegistered(ticket, classicId, 14);
  expect(() =>
    store.attachPebblePeripheral(ticket, classicId, classic as never, "native-classic"),
  ).toThrow("DIRECT_DEVICE_IDENTITY_MISMATCH");
  expect(() =>
    store.appendPebblePacket(
      ticket,
      { deviceId: classicId, identity: classic as never, nativeId: "native-classic" },
      packet(83, bounds(1_700_000_000, 1_700_000_100)),
    ),
  ).toThrow("DIRECT_DEVICE_IDENTITY_MISMATCH");
  expect(() =>
    store.commitCapture(ticket, {
      deviceId,
      deviceIdentity: identity,
      captureId: "bypass",
      nextCheckpoint: "{}",
      envelopes: [
        {
          expectedContext: { userId: scope.userId, organizationId: scope.organizationId },
          batch: {
            schemaVersion: 1,
            deviceId,
            deviceIdentity: identity,
            provider: "direct_device",
            recordType: "steps",
            mode: "backfill",
            upserts: [],
            deletions: [],
            clientTimezone: "UTC",
          },
        },
      ],
    } as never),
  ).toThrow("PEBBLE_CAPTURE_REQUIRES_INBOX");
  db.close();
});

test("unchanged sleep sessions are not republished when a new night arrives", () => {
  const { store, ticket, db } = open();
  const night = 1_700_000_000;
  store.appendPebblePacket(ticket, target(), packet(84, overlay(1, night, 600)));
  projectPebbleCapture({ store, ticket, deviceId, identity });
  const nextNight = night + 86_400;
  store.appendPebblePacket(ticket, target(), packet(84, overlay(1, nextNight, 600), nextNight));
  projectPebbleCapture({ store, ticket, deviceId, identity });
  const batches = store
    .listPending(ticket, 100)
    .filter((row) => row.request.batch.recordType === "sleep_session")
    .map((row) => row.request.batch.upserts.map((record) => record.externalRecordId));
  expect(batches).toEqual([
    [`dd-pebble:${deviceId}:sleep:${night}`],
    [`dd-pebble:${deviceId}:sleep:${nextNight}`],
  ]);
  db.close();
});

test("nights older than the settle horizon are compacted and leave the manifest", () => {
  const { store, ticket, db } = open();
  const old = 1_700_000_000;
  store.appendPebblePacket(ticket, target(), packet(83, bounds(old, old + 3_600)));
  store.appendPebblePacket(ticket, target(), packet(84, overlay(1, old, 3_600), old + 1));
  projectPebbleCapture({ store, ticket, deviceId, identity });
  const recent = old + 20 * 86_400;
  store.appendPebblePacket(ticket, target(), packet(84, overlay(1, recent, 600), recent));
  const projected = projectPebbleCapture({ store, ticket, deviceId, identity });
  expect(projected.sleepHeld).toBe(0);
  // Only the recent night's input remains, and only it is tracked.
  expect(store.readPebbleItems(ticket, deviceId).map((item) => item.logTag)).toEqual([84]);
  expect(
    store
      .readPebbleProjection(ticket, deviceId, "sleep")
      .manifest.map((entry) => entry.recordId)
      .filter((id) => !id.endsWith(":sleep-settled")),
  ).toEqual([`dd-pebble:${deviceId}:sleep:${recent}`]);
  // The old night was published before it settled; nothing disappears or is held later.
  const published = store
    .listPending(ticket, 100)
    .filter((row) => row.request.batch.recordType === "sleep_session")
    .flatMap((row) => row.request.batch.upserts.map((record) => record.externalRecordId));
  expect(published).toContain(`dd-pebble:${deviceId}:sleep:${old}`);
  store.appendPebblePacket(
    ticket,
    target(),
    packet(84, overlay(1, recent + 86_400, 600), recent + 9),
  );
  expect(projectPebbleCapture({ store, ticket, deviceId, identity }).sleepHeld).toBe(0);
  db.close();
});

test("a late sleep bound for a settled night is held, never published as a second record", () => {
  const { store, ticket, db } = open();
  const old = 1_700_000_000;
  store.appendPebblePacket(ticket, target(), packet(84, overlay(1, old + 600, 1_200)));
  projectPebbleCapture({ store, ticket, deviceId, identity });
  // More than the settle horizon of newer data: the old night settles.
  const recent = old + 20 * 86_400;
  store.appendPebblePacket(ticket, target(), packet(84, overlay(1, recent, 600), recent));
  projectPebbleCapture({ store, ticket, deviceId, identity });
  const published = () =>
    store
      .listPending(ticket, 100)
      .filter((row) => row.request.batch.recordType === "sleep_session")
      .flatMap((row) => row.request.batch.upserts.map((record) => record.externalRecordId));
  const before = published();
  expect(before).toContain(`dd-pebble:${deviceId}:sleep:${old + 600}`);
  // The old night's tag-83 bound finally arrives.
  store.appendPebblePacket(ticket, target(), packet(83, bounds(old, old + 3_600), old + 5));
  const projected = projectPebbleCapture({ store, ticket, deviceId, identity });
  expect(projected.sleepHeld).toBe(1);
  expect(published()).toEqual(before);
  expect(published()).not.toContain(`dd-pebble:${deviceId}:sleep:${old}`);
  db.close();
});
