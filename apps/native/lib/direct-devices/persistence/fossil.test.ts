import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";

import { createAuthorityTicket, directDeviceScopeKey } from "../authority";
import {
  directDeviceBatch,
  type DirectDeviceIdentity,
} from "@openvalens/api/contracts/direct-device";
import { crc32 } from "../protocol/fossil-hr";
import { FOSSIL_CHUNK_MINUTES, projectFossilFiles } from "../sync/fossil-capture";
import type { SyncSqliteDatabase } from "./store";
import { createSqliteDirectDeviceStore } from "./store";

const scope = { serverUrl: "https://fossil.test", userId: "u1", organizationId: "o1" };
const deviceId = "66666666-6666-4666-8666-666666666666";
const identity = { family: "fossil_hr", modelId: "fossil_gen_6_hybrid" } as DirectDeviceIdentity;

function adapter(db: Database): SyncSqliteDatabase {
  return {
    execSync: (sql) => db.exec(sql),
    runSync: (sql, ...params) => ({ changes: db.query(sql).run(...(params as never[])).changes }),
    getFirstSync: (sql, ...params) => db.query(sql).get(...(params as never[])) as never,
    getAllSync: (sql, ...params) => db.query(sql).all(...(params as never[])) as never,
    withTransactionSync: (callback) => db.transaction(callback)(),
  };
}

function open() {
  const db = new Database(":memory:");
  const store = createSqliteDirectDeviceStore(adapter(db), () => 1234);
  const ticket = createAuthorityTicket(scope, `fossil-${Math.random()}`);
  store.createBinding(ticket, deviceId, identity);
  store.markRegistered(ticket, deviceId, 21);
  return { db, store, ticket };
}

const le16 = (value: number) => [value & 0xff, (value >> 8) & 0xff];
const le32 = (value: number) => [
  value & 0xff,
  (value >>> 8) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 24) & 0xff,
];

/** HR-variant activity file: one E2 04 resync, then `minutes` 8-byte records. */
function activityFile(
  start: number,
  minutes: readonly { steps: number; hr: number; wear?: number }[],
) {
  const head = Array.from({ length: 52 }, () => 0);
  head.splice(2, 2, ...le16(22));
  head.splice(8, 4, ...le32(start));
  const body: number[] = [];
  minutes.forEach(({ steps, hr, wear = 0x08 }, index) => {
    if (index === 0) body.push(0xce, wear, 0xe2, 0x04, ...le32(start), ...le16(60), ...le16(0));
    else body.push(0xce, wear, 0x11, 0x22);
    body.push(steps & 0xfe, 0x00, hr, 0x00);
  });
  return Uint8Array.from([...head, ...body, 0xde, 0xad, 0xbe, 0xef]);
}

function store(s: ReturnType<typeof open>, file: Uint8Array) {
  return s.store.storeFossilFile(s.ticket, {
    deviceId,
    identity,
    nativeId: "AA:BB:CC:DD:EE:FF",
    data: file,
    crc: crc32(file),
  });
}

test("a stored file is durable and re-downloads of it are no-ops", () => {
  const s = open();
  const file = activityFile(1_700_000_040, [{ steps: 10, hr: 70 }]);
  expect(store(s, file)).toEqual({ durable: true, inserted: true, seq: 1 });
  expect(store(s, file)).toEqual({ durable: true, inserted: false, seq: 1 });
  expect(s.store.readFossilFiles(s.ticket, deviceId)).toHaveLength(1);
  // Same CRC and size, different bytes: refused rather than silently merged.
  const forged = file.slice();
  s.db
    .query(
      "UPDATE direct_device_fossil_file SET raw_hex = 'ff' || substr(raw_hex, 3) WHERE seq = 1",
    )
    .run();
  expect(() => store(s, forged)).toThrow("FOSSIL_FILE_COLLISION");
  s.db.close();
});

test("only a registered binding with the matching Fossil identity can store files", () => {
  const s = open();
  const file = activityFile(1_700_000_040, [{ steps: 10, hr: 70 }]);
  expect(() =>
    s.store.storeFossilFile(s.ticket, {
      deviceId,
      identity: { family: "fossil_hr", modelId: "fossil_hybrid_hr" } as DirectDeviceIdentity,
      nativeId: "AA:BB:CC:DD:EE:FF",
      data: file,
      crc: crc32(file),
    }),
  ).toThrow("DIRECT_DEVICE_IDENTITY_MISMATCH");
  expect(() =>
    s.store.commitCapture(s.ticket, {
      deviceId,
      deviceIdentity: identity,
      captureId: "bypass",
      nextCheckpoint: "{}",
      envelopes: [],
    } as never),
  ).toThrow("FOSSIL_CAPTURE_REQUIRES_FILE_STORE");
  s.db.close();
});

test("projection publishes minute steps and worn heart rate, removes the file and never republishes", () => {
  const s = open();
  const start = 1_700_000_040;
  store(
    s,
    activityFile(start, [
      { steps: 10, hr: 70 },
      { steps: 4, hr: 0 },
      { steps: 6, hr: 90, wear: 0x00 }, // not worn: no heart rate
    ]),
  );
  expect(projectFossilFiles({ store: s.store, ticket: s.ticket, deviceId, identity })).toEqual({
    projectedFiles: 1,
    unreadableFiles: 0,
    minutes: 3,
  });
  const rows = s.store.listPending(s.ticket, 100);
  expect(rows.map((row) => row.request.batch.recordType)).toEqual(["steps", "heart_rate"]);
  for (const row of rows) expect(directDeviceBatch.safeParse(row.request.batch).success).toBe(true);
  const minute = start / 60;
  expect(
    rows[0]!.request.batch.upserts.map((record) => [
      record.externalRecordId,
      (record as { count: number }).count,
    ]),
  ).toEqual([
    [`dd-fossil:${deviceId}:steps:${minute}`, 10],
    [`dd-fossil:${deviceId}:steps:${minute + 1}`, 4],
    [`dd-fossil:${deviceId}:steps:${minute + 2}`, 6],
  ]);
  expect(rows[1]!.request.batch.upserts.map((record) => record.externalRecordId)).toEqual([
    `dd-fossil:${deviceId}:hr:${minute}`,
  ]);
  expect(s.store.readFossilFiles(s.ticket, deviceId)).toHaveLength(0);
  expect(s.store.readFossilCoverage(s.ticket, deviceId).ranges).toEqual([[minute, minute + 3]]);
  // A later file overlapping published minutes (e.g. after a resync) sends only the new one.
  store(
    s,
    activityFile(start + 120, [
      { steps: 8, hr: 60 },
      { steps: 2, hr: 61 },
    ]),
  );
  projectFossilFiles({ store: s.store, ticket: s.ticket, deviceId, identity });
  const later = s.store.listPending(s.ticket, 100).slice(2);
  expect(later[0]!.request.batch.upserts.map((record) => record.externalRecordId)).toEqual([
    `dd-fossil:${deviceId}:steps:${minute + 3}`,
  ]);
  s.db.close();
});

test("an unreadable file is kept and flagged, and does not block later files", () => {
  const s = open();
  const bad = activityFile(1_700_000_040, [{ steps: 10, hr: 70 }]);
  bad[2] = 21; // wrong version
  store(s, bad);
  store(s, activityFile(1_700_086_440, [{ steps: 12, hr: 72 }]));
  expect(
    projectFossilFiles({ store: s.store, ticket: s.ticket, deviceId, identity }),
  ).toMatchObject({
    projectedFiles: 1,
    unreadableFiles: 1,
  });
  expect(s.store.readFossilFiles(s.ticket, deviceId).map((file) => file.state)).toEqual([
    "unreadable",
  ]);
  expect(
    projectFossilFiles({ store: s.store, ticket: s.ticket, deviceId, identity }),
  ).toMatchObject({
    projectedFiles: 0,
    unreadableFiles: 0,
  });
  s.db.close();
});

test("a long file is published in chunks; only the last chunk removes it", () => {
  const s = open();
  const count = FOSSIL_CHUNK_MINUTES + 10;
  store(
    s,
    activityFile(
      1_700_000_040,
      Array.from({ length: count }, (_, index) => ({ steps: index % 100, hr: 60 })),
    ),
  );
  expect(projectFossilFiles({ store: s.store, ticket: s.ticket, deviceId, identity }).minutes).toBe(
    count,
  );
  const captures = s.db
    .query("SELECT capture_id FROM direct_device_capture ORDER BY capture_id")
    .all();
  expect(captures).toEqual([{ capture_id: "fossil-1-1" }, { capture_id: "fossil-1-2" }]);
  const stepRecords = s.store
    .listPending(s.ticket, 1000)
    .filter((row) => row.request.batch.recordType === "steps")
    .reduce((total, row) => total + row.request.batch.upserts.length, 0);
  expect(stepRecords).toBe(count);
  expect(s.store.readFossilFiles(s.ticket, deviceId)).toHaveLength(0);
  s.db.close();
});

test("a failed projection commit rolls back: the file stays stored and coverage is unchanged", () => {
  const s = open();
  store(s, activityFile(1_700_000_040, [{ steps: 10, hr: 70 }]));
  s.db.exec(
    "CREATE TRIGGER reject_outbox BEFORE INSERT ON direct_device_outbox BEGIN SELECT RAISE(ABORT, 'injected'); END",
  );
  expect(() =>
    projectFossilFiles({ store: s.store, ticket: s.ticket, deviceId, identity }),
  ).toThrow();
  expect(s.store.readFossilFiles(s.ticket, deviceId).map((file) => file.state)).toEqual(["stored"]);
  expect(s.store.readFossilCoverage(s.ticket, deviceId)).toEqual({ revision: 0, ranges: [] });
  s.db.close();
});

test("purging the scope removes stored files and coverage", () => {
  const s = open();
  store(s, activityFile(1_700_000_040, [{ steps: 10, hr: 70 }]));
  s.store.purgeScope(scope);
  const count = (table: string) =>
    (
      s.db
        .query(`SELECT COUNT(*) AS n FROM ${table} WHERE scope = ?`)
        .get(directDeviceScopeKey(scope)) as { n: number }
    ).n;
  expect(count("direct_device_fossil_file")).toBe(0);
  expect(count("direct_device_fossil_projection")).toBe(0);
  s.db.close();
});

test("a binding is tied to the first watch that stores into it", () => {
  const s = open();
  const file = activityFile(1_700_000_040, [{ steps: 10, hr: 70 }]);
  store(s, file);
  const other = activityFile(1_700_086_440, [{ steps: 4, hr: 60 }]);
  expect(() =>
    s.store.storeFossilFile(s.ticket, {
      deviceId,
      identity,
      nativeId: "11:22:33:44:55:66",
      data: other,
      crc: crc32(other),
    }),
  ).toThrow("FOSSIL_NATIVE_ID_IMMUTABLE");
  s.db.close();
});

test("only the newest unreadable copy is kept, so a growing unreadable file cannot fill the inbox", () => {
  const s = open();
  for (let day = 0; day < 3; day += 1) {
    const bad = activityFile(1_700_000_040 + day * 86_400, [{ steps: 10, hr: 70 }]);
    bad[2] = 21;
    store(s, bad);
    projectFossilFiles({ store: s.store, ticket: s.ticket, deviceId, identity });
  }
  expect(s.store.readFossilFiles(s.ticket, deviceId).map((file) => [file.seq, file.state])).toEqual(
    [[3, "unreadable"]],
  );
  s.db.close();
});

test("sign-out (purgeAll) removes stored Fossil files and coverage", () => {
  const s = open();
  store(s, activityFile(1_700_000_040, [{ steps: 10, hr: 70 }]));
  s.store.purgeAll();
  expect(s.db.query("SELECT COUNT(*) AS n FROM direct_device_fossil_file").get()).toEqual({ n: 0 });
  expect(s.db.query("SELECT COUNT(*) AS n FROM direct_device_fossil_projection").get()).toEqual({
    n: 0,
  });
  s.db.close();
});

test("heart rate needs a confirmed worn state, and implausible clock values are not published", () => {
  const s = open();
  const start = 1_700_000_040;
  // wear 0x10 = "unknown": steps publish, heart rate does not.
  store(s, activityFile(start, [{ steps: 10, hr: 70, wear: 0x10 }]));
  // A watch whose clock was never set reports 1970.
  store(s, activityFile(60, [{ steps: 4, hr: 60 }]));
  projectFossilFiles({
    store: s.store,
    ticket: s.ticket,
    deviceId,
    identity,
    now: () => start * 1000,
  });
  const rows = s.store.listPending(s.ticket, 100);
  expect(rows.map((row) => row.request.batch.recordType)).toEqual(["steps"]);
  expect(rows[0]!.request.batch.upserts).toHaveLength(1);
  s.db.close();
});

test("a large unreadable copy never blocks storing the next copy", () => {
  const s = open();
  const big = (minutes: number) => {
    const file = activityFile(
      1_700_000_040,
      Array.from({ length: minutes }, () => ({ steps: 2, hr: 60 })),
    );
    file[2] = 21; // unreadable
    return file;
  };
  // ~4.5 MiB each; two of them would exceed the 8 MiB inbox if both counted.
  store(s, big(560_000));
  projectFossilFiles({ store: s.store, ticket: s.ticket, deviceId, identity });
  expect(() => store(s, big(570_000))).not.toThrow();
  projectFossilFiles({ store: s.store, ticket: s.ticket, deviceId, identity });
  expect(s.store.readFossilFiles(s.ticket, deviceId).map((file) => file.state)).toEqual([
    "unreadable",
  ]);
  s.db.close();
});

test("minutes ahead of the phone clock are deferred: the file is kept until they are due", () => {
  const s = open();
  const start = 1_700_000_040;
  store(
    s,
    activityFile(start, [
      { steps: 10, hr: 70 },
      { steps: 4, hr: 71 },
    ]),
  );
  // The phone clock is two days behind the watch.
  const behind = () => (start - 2 * 86_400) * 1000;
  projectFossilFiles({ store: s.store, ticket: s.ticket, deviceId, identity, now: behind });
  expect(s.store.listPending(s.ticket, 100)).toHaveLength(0);
  expect(s.store.readFossilFiles(s.ticket, deviceId)).toHaveLength(1);
  // Repeated passes while still deferred write nothing.
  const revision = s.store.readFossilCoverage(s.ticket, deviceId).revision;
  projectFossilFiles({ store: s.store, ticket: s.ticket, deviceId, identity, now: behind });
  expect(s.store.readFossilCoverage(s.ticket, deviceId).revision).toBe(revision);
  // Once the minutes are due they publish, and the file is removed.
  projectFossilFiles({
    store: s.store,
    ticket: s.ticket,
    deviceId,
    identity,
    now: () => start * 1000,
  });
  const steps = s.store
    .listPending(s.ticket, 100)
    .filter((row) => row.request.batch.recordType === "steps")
    .flatMap((row) => row.request.batch.upserts);
  expect(steps).toHaveLength(2);
  expect(s.store.readFossilFiles(s.ticket, deviceId)).toHaveLength(0);
  s.db.close();
});
