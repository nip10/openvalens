import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  DirectDeviceBindingSummary,
  IngestDirectDeviceBatchInput,
} from "@openvalens/api/contracts/direct-device";
import {
  createAuthorityTicket,
  installDirectDeviceAuthority,
  invalidateDirectDeviceAuthority,
} from "../authority";
import { createSqliteDirectDeviceStore, type SyncSqliteDatabase } from "../persistence/store";
import type { HelioSetupController, HelioSetupSnapshot } from "../setup/types";
import { historyStart } from "../protocol/codec";
import { crc32 } from "../protocol/chunked";
import {
  encodeXiaomiActivityFileId,
  XIAOMI_ACTIVITY_DAILY,
  XIAOMI_ACTIVITY_TYPE,
  XIAOMI_DETAIL_DETAILS,
} from "../protocol/xiaomi-activity";
import { runXiaomiStepsHistory, type XiaomiHistoryTransport } from "../protocol/xiaomi-history";
import type { XiaomiCommand } from "../protocol/xiaomi-proto";
import type { HelioCursor, HelioStepsPage } from "../protocol/types";
import {
  createHelioSyncControllerWithDependencies,
  immutableClient,
  immutableOperationFetch,
} from "./controller";

const context = {
  serverUrl: "https://old.example.test/base/path",
  userId: "user-a",
  organizationId: "org-a",
  sessionId: "session-a",
};
const deviceId = "11111111-1111-4111-8111-111111111111";
const cursor1: HelioCursor = {
  version: 1,
  nextMinuteUtc: "2026-02-01T00:01:00.000Z",
  offsetQuarterHours: 0,
};
const cursor2: HelioCursor = {
  version: 1,
  nextMinuteUtc: "2026-02-01T00:02:00.000Z",
  offsetQuarterHours: 0,
};
const cursor0: HelioCursor = {
  version: 1,
  nextMinuteUtc: "2026-02-01T00:00:00.000Z",
  offsetQuarterHours: 0,
};
const page: HelioStepsPage = {
  minutes: [
    {
      externalRecordId: "minute:2026-02-01T00:00:00.000Z",
      startTime: "2026-02-01T00:00:00.000Z",
      endTime: "2026-02-01T00:01:00.000Z",
      count: 8,
    },
  ],
  nextCursor: cursor1,
};
const page2: HelioStepsPage = {
  minutes: [
    {
      externalRecordId: "minute:2026-02-01T00:01:00.000Z",
      startTime: "2026-02-01T00:01:00.000Z",
      endTime: "2026-02-01T00:02:00.000Z",
      count: 9,
    },
  ],
  nextCursor: cursor2,
};
const binding: DirectDeviceBindingSummary = {
  deviceId,
  providerConnectionId: 41,
  family: "amazfit_helio_strap",
  connectedAt: "2026-01-01T00:00:00.000Z",
  lastSyncedAt: null,
  publication: { policy: "phone_cloud_first_utc_day", publishedRecords: 0, shadowedRecords: 0 },
};
let sessionSequence = 0;

function sqlite() {
  const db = new Database(":memory:");
  const adapter: SyncSqliteDatabase = {
    execSync: (sql) => db.exec(sql),
    runSync: (sql, ...params) => ({ changes: db.query(sql).run(...(params as never[])).changes }),
    getFirstSync: (sql, ...params) => db.query(sql).get(...(params as never[])) as never,
    getAllSync: (sql, ...params) => db.query(sql).all(...(params as never[])) as never,
    withTransactionSync: (callback) => db.transaction(callback)(),
  };
  return { db, store: createSqliteDirectDeviceStore(adapter) };
}

function setup(
  fetchSteps: HelioSetupController["fetchSteps"],
  connectedModelId: HelioSetupSnapshot["connectedModelId"] = null,
): HelioSetupController {
  const state: HelioSetupSnapshot = {
    phase: "connected",
    bluetooth: "powered_on",
    devices: [],
    connectedDeviceId: "native-1",
    connectedModelId,
    errorCode: null,
    crypto: { status: "passed", code: null },
  };
  return {
    getSnapshot: () => state,
    subscribe: () => () => undefined,
    startScan: async () => {},
    stopScan: async () => {},
    connect: async () => {},
    disconnect: async () => {},
    runCryptoSelfTest: async () => {},
    fetchSteps,
    dispose: async () => {},
  };
}

function client(receive: (input: IngestDirectDeviceBatchInput) => Promise<unknown> | unknown) {
  return {
    directDevice: {
      listDirectDevices: async () => ({ devices: [binding] }),
      registerDirectDevice: async () => ({ providerConnectionId: 41 }),
      ingestDirectDeviceBatch: async (input: unknown) =>
        receive(input as IngestDirectDeviceBatchInput),
    },
  };
}

function envelope(minutes: HelioStepsPage["minutes"]): IngestDirectDeviceBatchInput {
  return {
    expectedContext: { userId: context.userId, organizationId: context.organizationId },
    batch: {
      schemaVersion: 1,
      deviceId,
      provider: "direct_device",
      recordType: "steps",
      mode: "backfill",
      upserts: minutes.map((minute) => ({
        type: "steps" as const,
        externalRecordId: minute.externalRecordId,
        sourceApp: null,
        startTime: minute.startTime,
        endTime: minute.endTime,
        count: minute.count,
      })),
      deletions: [],
      clientTimezone: "UTC",
    },
  };
}

async function readyController(args: {
  store: ReturnType<typeof sqlite>["store"];
  setup: HelioSetupController;
  makeClient: (url: string, cookie: string, signal?: AbortSignal) => ReturnType<typeof client>;
  cookie?: () => Promise<string>;
  now?: () => number;
  onApplied?: () => Promise<void>;
}) {
  const sessionId = `${context.sessionId}-${++sessionSequence}`;
  const syncContext = { ...context, sessionId };
  installDirectDeviceAuthority(
    {
      serverUrl: context.serverUrl,
      userId: context.userId,
      organizationId: context.organizationId,
    },
    sessionId,
  );
  const ticket = createAuthorityTicket(
    {
      serverUrl: context.serverUrl,
      userId: context.userId,
      organizationId: context.organizationId,
    },
    sessionId,
  );
  args.store.createBinding(ticket, deviceId);
  args.store.markRegistered(ticket, deviceId, 41);
  const controller = createHelioSyncControllerWithDependencies(syncContext, {
    store: args.store,
    setup: args.setup,
    captureCookie: args.cookie ?? (async () => "session=old"),
    makeClient: args.makeClient,
    now: args.now ?? (() => Date.parse("2026-02-01T00:00:00.000Z")),
    onApplied: args.onApplied,
  });
  await controller.refreshBindings();
  controller.selectBinding(deviceId);
  return { controller, ticket };
}

test("page capture commits atomically before acknowledgement and persists immutable request context", async () => {
  const { db, store } = sqlite();
  let acknowledged = false;
  let delivered!: (page: HelioStepsPage) => Promise<void>;
  const setupController = setup(async (options) => {
    delivered = options.onPage;
    await options.onPage(page);
    acknowledged = true;
    return { pages: 1, minutes: 1, complete: true };
  });
  const { controller, ticket } = await readyController({
    store,
    setup: setupController,
    makeClient: () =>
      client(async () => {
        throw { code: "NETWORK" };
      }),
  });
  await controller.connect("native-1");
  await controller.syncSteps("00112233445566778899aabbccddeeff");
  expect(acknowledged).toBe(true);
  expect(store.getBinding(ticket, deviceId)?.captureCheckpoint).toContain(cursor1.nextMinuteUtc);
  const row = store.listPending(ticket, 1)[0]!;
  expect(row.request.expectedContext).toEqual({
    userId: context.userId,
    organizationId: context.organizationId,
  });
  expect(row.request.batch.upserts[0]?.externalRecordId).toBe(page.minutes[0]?.externalRecordId);
  expect(Object.isFrozen(row.request.batch.upserts[0])).toBe(true);
  expect(delivered).toBeFunction();
  await controller.dispose();
  db.close();
  invalidateDirectDeviceAuthority();
});

test("failed atomic capture rejects onPage and leaves checkpoint/outbox untouched", async () => {
  const { db, store } = sqlite();
  let acked = false;
  const setupController = setup(async (options) => {
    await options.onPage(page);
    acked = true;
    return { pages: 1, minutes: 1, complete: true };
  });
  const { controller, ticket } = await readyController({
    store,
    setup: setupController,
    makeClient: () =>
      client(() => {
        throw { code: "NETWORK" };
      }),
  });
  db.exec(
    "CREATE TRIGGER fail_capture BEFORE INSERT ON direct_device_outbox BEGIN SELECT RAISE(ABORT, 'capture-failure'); END",
  );
  await controller.connect("native-1");
  await controller.syncSteps("00112233445566778899aabbccddeeff");
  expect(controller.getSnapshot().phase).toBe("error");
  expect(acked).toBe(false);
  expect(store.getBinding(ticket, deviceId)?.captureCheckpoint).toBeNull();
  expect(store.listPending(ticket, 10)).toHaveLength(0);
  await controller.dispose();
  db.close();
  invalidateDirectDeviceAuthority();
});

test("facade resumes from committed cursor after restart using REAL SQLite", async () => {
  const dir = mkdtempSync(join(tmpdir(), "direct-sync-resume-"));
  const filename = join(dir, "capture.db");
  try {
    const open = () => {
      const db = new Database(filename);
      const adapter: SyncSqliteDatabase = {
        execSync: (sql) => db.exec(sql),
        runSync: (sql, ...params) => ({
          changes: db.query(sql).run(...(params as never[])).changes,
        }),
        getFirstSync: (sql, ...params) => db.query(sql).get(...(params as never[])) as never,
        getAllSync: (sql, ...params) => db.query(sql).all(...(params as never[])) as never,
        withTransactionSync: (callback) => db.transaction(callback)(),
      };
      return { db, store: createSqliteDirectDeviceStore(adapter) };
    };
    const firstDb = open();
    const firstTicket = createAuthorityTicket(
      {
        serverUrl: context.serverUrl,
        userId: context.userId,
        organizationId: context.organizationId,
      },
      `restart-${++sessionSequence}`,
    );
    firstDb.store.createBinding(firstTicket, deviceId);
    firstDb.store.markRegistered(firstTicket, deviceId, 41);
    firstDb.store.commitCapture(firstTicket, {
      deviceId,
      captureId: "seed",
      expectedPreviousCheckpoint: null,
      nextCheckpoint: JSON.stringify(cursor1),
      envelopes: [
        {
          expectedContext: { userId: context.userId, organizationId: context.organizationId },
          batch: {
            schemaVersion: 1,
            deviceId,
            provider: "direct_device",
            recordType: "steps",
            mode: "backfill",
            upserts: page.minutes.map((m) => ({
              type: "steps" as const,
              externalRecordId: m.externalRecordId,
              sourceApp: null,
              startTime: m.startTime,
              endTime: m.endTime,
              count: m.count,
            })),
            deletions: [],
            clientTimezone: "UTC",
          },
        },
      ],
    });
    firstDb.db.close();
    const reopened = open();
    let resumed: HelioCursor | undefined;
    const setupController = setup(async (options) => {
      resumed = options.since;
      await options.onPage({ ...page, nextCursor: cursor2 });
      return { pages: 1, minutes: 1, complete: false };
    });
    const { controller, ticket } = await readyController({
      store: reopened.store,
      setup: setupController,
      makeClient: () =>
        client(() => ({
          status: "queued",
          rawArtifactId: 9,
          accepted: 1,
          duplicates: 0,
          rejected: 0,
          superseded: 0,
          targetId: "target",
        })),
    });
    await controller.connect("native-1");
    await controller.syncSteps("00112233445566778899aabbccddeeff");
    expect(resumed).toEqual(cursor1);
    expect(reopened.store.getBinding(ticket, deviceId)?.captureCheckpoint).toContain(
      cursor2.nextMinuteUtc,
    );
    await controller.dispose();
    reopened.db.close();
    invalidateDirectDeviceAuthority();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("captured sender policy preserves server basepath/cookie and enforces omit, redirect error, and abort", async () => {
  const abort = new AbortController();
  let captured: { input: RequestInfo | URL; init?: RequestInit } | undefined;
  const fetcher = immutableOperationFetch(async (input, init) => {
    captured = { input, init };
    throw new Error("synthetic transport stop");
  }, abort.signal);
  await expect(
    fetcher(
      new Request("https://old.example.test/base/path/rpc/directDevice/listDirectDevices", {
        headers: { Cookie: "session=old" },
      }),
    ),
  ).rejects.toThrow();
  expect(
    captured?.input instanceof Request ? captured.input.url : String(captured?.input),
  ).toContain("/base/path/rpc/directDevice/");
  expect(
    captured?.input instanceof Request
      ? captured.input.headers.get("cookie")
      : new Headers(captured?.init?.headers).get("cookie"),
  ).toBe("session=old");
  expect(captured?.init?.credentials).toBe("omit");
  expect(captured?.init?.redirect).toBe("error");
  expect(captured?.init?.signal).toBe(abort.signal);
});

test("real RPCLink sender targets captured basepath and carries its captured cookie and abort signal", async () => {
  const abort = new AbortController();
  let observed: { input: RequestInfo | URL; init?: RequestInit } | undefined;
  const api = immutableClient(
    context.serverUrl,
    "session=old-cookie",
    async (input, init) => {
      observed = { input, init };
      return new Promise<Response>((_resolve, reject) =>
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }),
      );
    },
    abort.signal,
  );
  const call = api.directDevice.listDirectDevices({
    expectedContext: { userId: context.userId, organizationId: context.organizationId },
  });
  while (!observed) await Promise.resolve();
  const request =
    observed.input instanceof Request ? observed.input : new Request(observed.input, observed.init);
  expect(new URL(request.url).pathname).toBe("/base/path/rpc/directDevice/listDirectDevices");
  expect(request.headers.get("cookie")).toBe("session=old-cookie");
  expect(observed.init?.credentials).toBe("omit");
  expect(observed.init?.redirect).toBe("error");
  expect(observed.init?.signal).toBe(abort.signal);
  abort.abort();
  await expect(call).rejects.toThrow();
});

test("delayed cookie capture crossing scope transition is rejected before client dispatch", async () => {
  const { db, store } = sqlite();
  let releaseCookie!: (cookie: string) => void;
  let dispatched = 0;
  let cookieCalls = 0;
  const setupController = setup(async () => ({ pages: 0, minutes: 0, complete: true }));
  const { controller } = await readyController({
    store,
    setup: setupController,
    cookie: () =>
      ++cookieCalls === 1
        ? Promise.resolve("session=old")
        : new Promise((resolve) => {
            releaseCookie = resolve;
          }),
    makeClient: () => {
      dispatched += 1;
      return client(() => ({ devices: [binding] }));
    },
  });
  const beforeTransition = dispatched;
  const refresh = controller.refreshBindings();
  while (!releaseCookie) await Promise.resolve();
  invalidateDirectDeviceAuthority();
  releaseCookie("session=new");
  await refresh;
  expect(dispatched).toBe(beforeTransition);
  await controller.dispose();
  db.close();
});

test("queued receipts stay processing; only applied receipts trigger canonical refresh", async () => {
  for (const [status, expectedApplied] of [
    ["queued", 0],
    ["applied", 1],
  ] as const) {
    const { db, store } = sqlite();
    let applied = 0;
    const setupController = setup(async (options) => {
      await options.onPage(page);
      return { pages: 1, minutes: 1, complete: true };
    });
    const { controller } = await readyController({
      store,
      setup: setupController,
      onApplied: async () => {
        applied += 1;
      },
      makeClient: () =>
        client(() => ({
          status,
          rawArtifactId: 7,
          accepted: 1,
          duplicates: 0,
          rejected: 0,
          superseded: 0,
          targetId: "target",
        })),
    });
    await controller.connect("native-1");
    await controller.syncSteps("00112233445566778899aabbccddeeff");
    expect(applied).toBe(expectedApplied);
    expect(controller.getSnapshot().queuedEnvelopes).toBe(status === "queued" ? 1 : 0);
    await controller.dispose();
    db.close();
    invalidateDirectDeviceAuthority();
  }
});

test("stale authority aborts captured request and radio, and late response cannot accept a purged row", async () => {
  const { db, store } = sqlite();
  let requestSignal: AbortSignal | undefined;
  let radioStopped = 0;
  let resolveRequest!: (value: unknown) => void;
  const setupController = setup(async (options) => {
    await options.onPage(page);
    return { pages: 1, minutes: 1, complete: true };
  });
  const oldDisconnect = setupController.disconnect;
  setupController.disconnect = async () => {
    radioStopped += 1;
    await oldDisconnect();
  };
  const { controller } = await readyController({
    store,
    setup: setupController,
    makeClient: (_url, _cookie, signal) => {
      requestSignal = signal;
      return client(
        () =>
          new Promise((resolve) => {
            resolveRequest = resolve;
          }),
      );
    },
  });
  await controller.connect("native-1");
  const syncing = controller.syncSteps("00112233445566778899aabbccddeeff");
  while (!resolveRequest) await Promise.resolve();
  invalidateDirectDeviceAuthority();
  expect(requestSignal?.aborted).toBe(true);
  expect(radioStopped).toBeGreaterThan(0);
  store.purgeAll();
  resolveRequest({
    status: "applied",
    rawArtifactId: 7,
    accepted: 1,
    duplicates: 0,
    rejected: 0,
    superseded: 0,
    targetId: "target",
  });
  await syncing;
  expect(store.countUnaccepted()).toBe(0);
  await controller.dispose();
  db.close();
});

test("first-ever sync floors the default cursor to an exact minute accepted by real historyStart and commits page one", async () => {
  const { db, store } = sqlite();
  let requested: HelioCursor | undefined;
  let validated = false;
  const setupController = setup(async (options) => {
    requested = options.since;
    // Real protocol validation: a seconds/millis-bearing cursor throws INVALID_CURSOR here.
    historyStart(options.since);
    validated = true;
    await options.onPage(page);
    return { pages: 1, minutes: 1, complete: true };
  });
  const { controller, ticket } = await readyController({
    store,
    setup: setupController,
    now: () => Date.parse("2026-02-01T00:00:30.000Z"),
    makeClient: () =>
      client(() => ({
        status: "applied",
        rawArtifactId: 7,
        accepted: 1,
        duplicates: 0,
        rejected: 0,
        superseded: 0,
        targetId: "target",
      })),
  });
  await controller.connect("native-1");
  await controller.syncSteps("00112233445566778899aabbccddeeff");
  expect(validated).toBe(true);
  expect(requested).toEqual({
    version: 1,
    nextMinuteUtc: "2026-01-31T00:00:00.000Z",
    offsetQuarterHours: 0,
  });
  expect(store.getBinding(ticket, deviceId)?.captureCheckpoint).toContain(cursor1.nextMinuteUtc);
  expect(store.listPending(ticket, 10)).toHaveLength(0);
  expect(controller.getSnapshot().errorCode).toBeNull();
  await controller.dispose();
  db.close();
  invalidateDirectDeviceAuthority();
});

test("multi-page backfill commits each page against the advanced checkpoint through REAL SQLite", async () => {
  const { db, store } = sqlite();
  const page1CaptureId = `helio-v1:${deviceId}:2026-02-01T00:00:00.000Z:0:2026-02-01T00:01:00.000Z:0`;
  const page2CaptureId = `helio-v1:${deviceId}:2026-02-01T00:01:00.000Z:0:2026-02-01T00:02:00.000Z:0`;
  let requested: HelioCursor | undefined;
  const setupController = setup(async (options) => {
    requested = options.since;
    await options.onPage(page);
    await options.onPage(page2);
    return { pages: 2, minutes: 2, complete: true };
  });
  const { controller, ticket } = await readyController({
    store,
    setup: setupController,
    makeClient: () =>
      client(() => ({
        status: "applied",
        rawArtifactId: 7,
        accepted: 1,
        duplicates: 0,
        rejected: 0,
        superseded: 0,
        targetId: "target",
      })),
  });
  store.commitCapture(ticket, {
    deviceId,
    captureId: "seed",
    expectedPreviousCheckpoint: null,
    nextCheckpoint: JSON.stringify(cursor0),
    envelopes: [envelope(page.minutes)],
  });
  await controller.connect("native-1");
  await controller.syncSteps("00112233445566778899aabbccddeeff");
  expect(requested).toEqual(cursor0);
  expect(store.getBinding(ticket, deviceId)?.captureCheckpoint).toBe(JSON.stringify(cursor2));
  const captures = db
    .query(
      "SELECT capture_id, checkpoint_json FROM direct_device_capture WHERE capture_id LIKE 'helio-v1:%' ORDER BY capture_id",
    )
    .all() as { capture_id: string; checkpoint_json: string }[];
  expect(captures.map((row) => row.capture_id)).toEqual([page1CaptureId, page2CaptureId]);
  expect(captures.map((row) => JSON.parse(row.checkpoint_json))).toEqual([
    { previous: JSON.stringify(cursor0), next: JSON.stringify(cursor1) },
    { previous: JSON.stringify(cursor1), next: JSON.stringify(cursor2) },
  ]);
  expect(store.listPending(ticket, 10)).toHaveLength(0);
  expect(controller.getSnapshot().errorCode).toBeNull();
  await controller.dispose();
  db.close();
  invalidateDirectDeviceAuthority();
});

test("failed second page commit leaves the first checkpoint without a second ACK", async () => {
  const { db, store } = sqlite();
  const page2CaptureId = `helio-v1:${deviceId}:2026-02-01T00:01:00.000Z:0:2026-02-01T00:02:00.000Z:0`;
  let acks = 0;
  const setupController = setup(async (options) => {
    await options.onPage(page);
    acks += 1;
    await options.onPage(page2);
    acks += 1;
    return { pages: 2, minutes: 2, complete: true };
  });
  const { controller, ticket } = await readyController({
    store,
    setup: setupController,
    makeClient: () =>
      client(() => ({
        status: "applied",
        rawArtifactId: 7,
        accepted: 1,
        duplicates: 0,
        rejected: 0,
        superseded: 0,
        targetId: "target",
      })),
  });
  store.commitCapture(ticket, {
    deviceId,
    captureId: "seed",
    expectedPreviousCheckpoint: null,
    nextCheckpoint: JSON.stringify(cursor0),
    envelopes: [envelope(page.minutes)],
  });
  db.exec(
    `CREATE TRIGGER fail_second_capture BEFORE INSERT ON direct_device_capture WHEN NEW.capture_id = '${page2CaptureId}' BEGIN SELECT RAISE(ABORT, 'capture-failure'); END`,
  );
  await controller.connect("native-1");
  await controller.syncSteps("00112233445566778899aabbccddeeff");
  expect(acks).toBe(1);
  expect(controller.getSnapshot().phase).toBe("error");
  expect(controller.getSnapshot().errorCode).not.toBe("DIRECT_DEVICE_CHECKPOINT_CONFLICT");
  expect(store.getBinding(ticket, deviceId)?.captureCheckpoint).toBe(JSON.stringify(cursor1));
  const failed = db
    .query("SELECT COUNT(*) AS total FROM direct_device_capture WHERE capture_id = ?")
    .get(page2CaptureId) as { total: number };
  expect(failed.total).toBe(0);
  await controller.dispose();
  db.close();
  invalidateDirectDeviceAuthority();
});

test("surfaces the connected Zepp OS model id from the setup snapshot", async () => {
  const { db, store } = sqlite();
  const setupController = setup(
    async () => ({ pages: 0, minutes: 0, complete: true }),
    "amazfit_gtr_4",
  );
  const { controller } = await readyController({
    store,
    setup: setupController,
    makeClient: () =>
      client(() => ({
        status: "applied",
        rawArtifactId: 7,
        accepted: 1,
        duplicates: 0,
        rejected: 0,
        superseded: 0,
        targetId: "target",
      })),
  });

  await controller.connect("native-1");

  expect(controller.getSnapshot().connectedDeviceId).toBe("native-1");
  expect(controller.getSnapshot().connectedModelId).toBe("amazfit_gtr_4");
  await controller.dispose();
  db.close();
  invalidateDirectDeviceAuthority();
});

test("defaults the connected model id to null when the setup snapshot has none", async () => {
  const { db, store } = sqlite();
  const setupController = setup(async () => ({ pages: 0, minutes: 0, complete: true }));
  const { controller } = await readyController({
    store,
    setup: setupController,
    makeClient: () =>
      client(() => ({
        status: "applied",
        rawArtifactId: 7,
        accepted: 1,
        duplicates: 0,
        rejected: 0,
        superseded: 0,
        targetId: "target",
      })),
  });

  await controller.connect("native-1");

  expect(controller.getSnapshot().connectedModelId).toBeNull();
  await controller.dispose();
  db.close();
  invalidateDirectDeviceAuthority();
});

test("Xiaomi history pages flow through capture and outbox", async () => {
  const { db, store } = sqlite();
  const fileId = {
    timestamp: 1_769_904_000, // 2026-02-01T00:00:00Z
    timezone: 0,
    type: XIAOMI_ACTIVITY_TYPE,
    subtype: XIAOMI_ACTIVITY_DAILY,
    detailType: XIAOMI_DETAIL_DETAILS,
    version: 3,
  };
  const header = Uint8Array.of(0x90, 0, 0, 0, 0);
  const body = new Uint8Array(7 + 1 + header.length + 2);
  body.set(encodeXiaomiActivityFileId(fileId), 0);
  body[7] = 0;
  body.set(header, 8);
  body[13] = 42;
  const file = new Uint8Array(body.length + 4);
  file.set(body);
  const checksum = crc32(body);
  file[body.length] = checksum & 0xff;
  file[body.length + 1] = (checksum >>> 8) & 0xff;
  file[body.length + 2] = (checksum >>> 16) & 0xff;
  file[body.length + 3] = (checksum >>> 24) & 0xff;

  const commands: XiaomiCommand[] = [];
  const files: Uint8Array[] = [];
  const transport: XiaomiHistoryTransport = {
    async start() {},
    async sendCommand(command) {
      if (command.subtype === 1) {
        commands.push({
          type: 8,
          subtype: 1,
          health: { activityRequestFileIds: encodeXiaomiActivityFileId(fileId) },
        });
      } else if (command.subtype === 2) {
        commands.push({
          type: 8,
          subtype: 2,
          health: { activityRequestFileIds: new Uint8Array(0) },
        });
      } else if (command.subtype === 3) {
        files.push(file);
      }
    },
    async nextCommand() {
      const command = commands.shift();
      if (!command) throw new Error("NO_COMMAND");
      return command;
    },
    async nextActivityFile() {
      const next = files.shift();
      if (!next) throw new Error("NO_FILE");
      return next;
    },
    async close() {},
  };
  const received: IngestDirectDeviceBatchInput[] = [];
  const setupController = setup((options) => runXiaomiStepsHistory(transport, options));
  const { controller, ticket } = await readyController({
    store,
    setup: setupController,
    makeClient: () =>
      client((input) => {
        received.push(input);
        return {
          status: "applied",
          rawArtifactId: 7,
          accepted: 1,
          duplicates: 0,
          rejected: 0,
          superseded: 0,
          targetId: "target",
        };
      }),
  });

  await controller.connect("native-1");
  await controller.syncSteps("00112233445566778899aabbccddeeff");

  expect(received).toHaveLength(1);
  expect(received[0]!.batch.upserts).toHaveLength(1);
  expect(received[0]!.batch.upserts[0]).toMatchObject({ type: "steps", count: 42 });
  expect(store.getBinding(ticket, deviceId)?.captureCheckpoint).toContain(
    "2026-02-01T00:01:00.000Z",
  );
  expect(store.listPending(ticket, 10)).toHaveLength(0);
  await controller.dispose();
  db.close();
  invalidateDirectDeviceAuthority();
});
