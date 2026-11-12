import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  DirectDeviceBindingSummary,
  DirectDeviceIdentity,
  IngestDirectDeviceBatchInput,
} from "@openvalens/api/contracts/direct-device";
import {
  createAuthorityTicket,
  installDirectDeviceAuthority,
  invalidateDirectDeviceAuthority,
} from "../authority";
import { createSqliteDirectDeviceStore, type SyncSqliteDatabase } from "../persistence/store";
import type {
  HelioSetupController,
  HelioSetupSnapshot,
  DirectDeviceHistorySample,
  DirectDeviceLiveSample,
} from "../setup/types";
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
import { weightMeasurementExternalRecordId } from "../protocol/ble-scale";
import type { DirectDeviceConfirmationTarget, HelioSyncSnapshot } from "./types";
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

function confirmationTarget(snapshot: HelioSyncSnapshot): DirectDeviceConfirmationTarget {
  if (!snapshot.connectedDeviceId || !snapshot.connectedFamily || !snapshot.connectedModelId)
    throw new Error("TEST_EXPECTED_CONNECTED_IDENTITY");
  return {
    connectedDeviceId: snapshot.connectedDeviceId,
    family: snapshot.connectedFamily,
    modelId: snapshot.connectedModelId,
    connectionGeneration: snapshot.connectionGeneration,
  };
}
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
  family: "xiaomi",
  modelId: "xiaomi_mi_band_10",
  displayName: "Xiaomi Smart Band 10",
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

type MutableSetupController = HelioSetupController & {
  setSnapshot(snapshot: Partial<HelioSetupSnapshot>): void;
};

function setup(
  fetchSteps: HelioSetupController["fetchSteps"],
  connectedModelId: HelioSetupSnapshot["connectedModelId"] = "xiaomi_mi_band_10",
  overrides: {
    family?: HelioSetupSnapshot["connectedFamily"];
    stepsHistory?: boolean;
    liveCapture?: boolean;
    historySync?: boolean;
  } = {},
): MutableSetupController {
  const state: HelioSetupSnapshot = {
    phase: "connected",
    bluetooth: "powered_on",
    devices: [],
    connectedDeviceId: "native-1",
    connectedModelId,
    connectedFamily:
      overrides.family ?? (connectedModelId?.startsWith("xiaomi") ? "xiaomi" : "zepp_os"),
    capabilities: {
      stepsHistory: overrides.stepsHistory ?? connectedModelId !== null,
      liveCapture: overrides.liveCapture ?? false,
      historySync: overrides.historySync ?? false,
    },
    errorCode: null,
    crypto: { status: "passed", code: null },
  };
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    startScan: async () => {},
    stopScan: async () => {},
    connect: async () => {},
    disconnect: async () => {},
    runCryptoSelfTest: async () => {},
    fetchSteps,
    dispose: async () => {},
    setSnapshot(snapshot) {
      Object.assign(state, snapshot);
      for (const listener of listeners) listener();
    },
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
      deviceIdentity: { family: "xiaomi", modelId: "xiaomi_mi_band_10" },
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
  uuid?: () => string;
  localIdentity?: DirectDeviceIdentity | null;
  seedBinding?: boolean;
  onApplied?: () => Promise<void>;
  liveCapture?: { handler: ((sample: DirectDeviceLiveSample) => void) | null };
  historyCapture?: { handler: ((sample: DirectDeviceHistorySample) => void) | null };
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
  if (args.seedBinding !== false) {
    if (args.localIdentity === undefined)
      args.store.createBinding(ticket, deviceId, {
        family: "xiaomi",
        modelId: "xiaomi_mi_band_10",
      });
    else args.store.createBinding(ticket, deviceId, args.localIdentity ?? undefined);
    args.store.markRegistered(ticket, deviceId, 41);
  }
  const controller = createHelioSyncControllerWithDependencies(syncContext, {
    store: args.store,
    setup: args.setup,
    captureCookie: args.cookie ?? (async () => "session=old"),
    makeClient: args.makeClient,
    now: args.now ?? (() => Date.parse("2026-02-01T00:00:00.000Z")),
    uuid: args.uuid,
    onApplied: args.onApplied,
    liveCapture: args.liveCapture,
    historyCapture: args.historyCapture,
  });
  await controller.refreshBindings();
  controller.selectBinding(deviceId);
  return { controller, ticket };
}

test("ambiguous binding registration retries the same durable UUID and identity", async () => {
  const { db, store } = sqlite();
  const attempted: unknown[] = [];
  let calls = 0;
  let listCalls = 0;
  const { controller } = await readyController({
    store,
    setup: setup(async () => ({ pages: 0, minutes: 0, complete: true })),
    uuid: () => "33333333-3333-4333-8333-333333333333",
    makeClient: () => ({
      directDevice: {
        listDirectDevices: async () => {
          listCalls += 1;
          if (listCalls === 2) throw new Error("REFRESH_FAILED");
          return {
            devices:
              listCalls > 2
                ? [
                    binding,
                    {
                      ...binding,
                      deviceId: "33333333-3333-4333-8333-333333333333",
                      providerConnectionId: 42,
                    },
                  ]
                : [binding],
          };
        },
        registerDirectDevice: async (...args: unknown[]) => {
          attempted.push(args[0]);
          calls += 1;
          if (calls === 1) throw new Error("NETWORK");
          return { providerConnectionId: 42, targetId: "target" };
        },
        ingestDirectDeviceBatch: async () => ({
          status: "applied",
          rawArtifactId: 1,
          accepted: 1,
          duplicates: 0,
          rejected: 0,
          superseded: 0,
          targetId: "target",
        }),
      },
    }),
  });
  await controller.createBinding();
  await controller.createBinding();
  await controller.createBinding();
  expect(attempted).toHaveLength(3);
  expect(attempted[0]).toMatchObject({
    deviceId: "33333333-3333-4333-8333-333333333333",
    family: "xiaomi",
    modelId: "xiaomi_mi_band_10",
  });
  expect(attempted[1]).toMatchObject({ deviceId: "33333333-3333-4333-8333-333333333333" });
  expect(attempted[2]).toMatchObject({ deviceId: "33333333-3333-4333-8333-333333333333" });
  expect(controller.getSnapshot().selectedBindingId).toBe("33333333-3333-4333-8333-333333333333");
  expect(controller.getSnapshot().canSync).toBe(true);
  await controller.dispose();
  db.close();
  invalidateDirectDeviceAuthority();
});

test("legacy binding identity is adopted only through explicit confirmation", async () => {
  const { db, store } = sqlite();
  const legacyBinding = { ...binding, family: null, modelId: null, displayName: null };
  const registrations: unknown[] = [];
  let isConfirmed = false;
  const { controller, ticket } = await readyController({
    store,
    setup: setup(async () => ({ pages: 0, minutes: 0, complete: true })),
    localIdentity: null,
    makeClient: () => ({
      directDevice: {
        listDirectDevices: async () => ({ devices: [isConfirmed ? binding : legacyBinding] }),
        registerDirectDevice: async (...args: unknown[]) => {
          registrations.push(args[0]);
          isConfirmed = true;
          return { providerConnectionId: 41, targetId: "target" };
        },
        ingestDirectDeviceBatch: async () => ({
          status: "applied",
          rawArtifactId: 1,
          accepted: 1,
          duplicates: 0,
          rejected: 0,
          superseded: 0,
          targetId: "target",
        }),
      },
    }),
  });
  expect(registrations).toHaveLength(0);
  expect(store.getBinding(ticket, deviceId)?.family).toBeNull();
  await controller.connect("native-1");
  await controller.confirmBindingIdentity(deviceId, confirmationTarget(controller.getSnapshot()));
  expect(registrations).toHaveLength(1);
  expect(controller.getSnapshot().errorCode).toBeNull();
  expect(registrations[0]).toMatchObject({
    family: "xiaomi",
    modelId: "xiaomi_mi_band_10",
    confirmLegacyIdentity: true,
  });
  await controller.dispose();
  db.close();
  invalidateDirectDeviceAuthority();
});

test("confirmation consent becomes stale after model change, same-id reconnect, or cancel", async () => {
  for (const transition of ["model", "reconnect-same-id", "cancel"] as const) {
    const { db, store } = sqlite();
    const setupController = setup(async () => ({ pages: 0, minutes: 0, complete: true }));
    const legacyBinding = { ...binding, family: null, modelId: null, displayName: null };
    let registrations = 0;
    const { controller, ticket } = await readyController({
      store,
      setup: setupController,
      localIdentity: null,
      makeClient: () => ({
        directDevice: {
          listDirectDevices: async () => ({ devices: [legacyBinding] }),
          registerDirectDevice: async () => {
            registrations += 1;
            return { providerConnectionId: 41 };
          },
          ingestDirectDeviceBatch: async () => ({
            status: "applied",
            rawArtifactId: 1,
            accepted: 1,
            duplicates: 0,
            rejected: 0,
            superseded: 0,
            targetId: "target",
          }),
        },
      }),
    });
    await controller.connect("native-1");
    const expected = confirmationTarget(controller.getSnapshot());
    if (transition === "model") {
      setupController.setSnapshot({
        connectedDeviceId: "native-2",
        connectedModelId: "xiaomi_mi_band_11",
      });
    } else if (transition === "reconnect-same-id") {
      setupController.setSnapshot({
        phase: "idle",
        connectedDeviceId: null,
        connectedModelId: null,
        connectedFamily: null,
        capabilities: { stepsHistory: false, liveCapture: false, historySync: false },
      });
      setupController.setSnapshot({
        phase: "connected",
        connectedDeviceId: "native-1",
        connectedModelId: "xiaomi_mi_band_10",
        connectedFamily: "xiaomi",
        capabilities: { stepsHistory: true, liveCapture: false, historySync: false },
      });
    } else {
      await controller.cancel();
    }
    await controller.confirmBindingIdentity(deviceId, expected);
    expect(registrations).toBe(0);
    expect(controller.getSnapshot().errorCode).toBe("CONFIRMATION_STALE");
    expect(store.getBinding(ticket, deviceId)).toMatchObject({ family: null, modelId: null });
    await controller.dispose();
    db.close();
    invalidateDirectDeviceAuthority();
  }
});

test("cancelling an in-flight confirmation prevents local identity adoption", async () => {
  const { db, store } = sqlite();
  const legacyBinding = { ...binding, family: null, modelId: null, displayName: null };
  let resolveRegistration!: (value: { providerConnectionId: number; targetId: string }) => void;
  let registrationStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    registrationStarted = resolve;
  });
  const { controller, ticket } = await readyController({
    store,
    setup: setup(async () => ({ pages: 0, minutes: 0, complete: true })),
    localIdentity: null,
    makeClient: () => ({
      directDevice: {
        listDirectDevices: async () => ({ devices: [legacyBinding] }),
        registerDirectDevice: async () => {
          registrationStarted();
          return new Promise((resolve) => {
            resolveRegistration = resolve;
          });
        },
        ingestDirectDeviceBatch: async () => ({
          status: "applied",
          rawArtifactId: 1,
          accepted: 1,
          duplicates: 0,
          rejected: 0,
          superseded: 0,
          targetId: "target",
        }),
      },
    }),
  });
  await controller.connect("native-1");
  const confirming = controller.confirmBindingIdentity(
    deviceId,
    confirmationTarget(controller.getSnapshot()),
  );
  await started;
  await controller.cancel();
  resolveRegistration({ providerConnectionId: 41, targetId: "target" });
  await confirming;
  expect(store.getBinding(ticket, deviceId)).toMatchObject({ family: null, modelId: null });
  expect(controller.getSnapshot().connectionGeneration).toBeGreaterThan(1);
  await controller.dispose();
  db.close();
  invalidateDirectDeviceAuthority();
});

test("connection is allowed before a server binding exists", async () => {
  const { db, store } = sqlite();
  let connects = 0;
  const setupController = setup(async () => ({ pages: 0, minutes: 0, complete: true }));
  setupController.connect = async () => {
    connects += 1;
  };
  const { controller } = await readyController({
    store,
    setup: setupController,
    makeClient: () => ({
      directDevice: {
        listDirectDevices: async () => ({ devices: [] }),
        registerDirectDevice: async () => ({ providerConnectionId: 41 }),
        ingestDirectDeviceBatch: async () => ({
          status: "applied",
          rawArtifactId: 1,
          accepted: 1,
          duplicates: 0,
          rejected: 0,
          superseded: 0,
          targetId: "target",
        }),
      },
    }),
  });
  expect(controller.getSnapshot().selectedBindingId).toBeNull();
  expect(controller.getSnapshot().connectionGeneration).toBe(0);
  await controller.connect("native-1");
  expect(connects).toBe(1);
  const connectedGeneration = controller.getSnapshot().connectionGeneration;
  expect(connectedGeneration).toBeGreaterThan(0);
  await controller.connect("native-1");
  expect(connects).toBe(2);
  expect(controller.getSnapshot().connectionGeneration).toBeGreaterThan(connectedGeneration);
  const reconnectGeneration = controller.getSnapshot().connectionGeneration;
  await controller.cancel();
  expect(controller.getSnapshot().connectionGeneration).toBeGreaterThan(reconnectGeneration);
  await controller.dispose();
  db.close();
  invalidateDirectDeviceAuthority();
});

test("fresh SQLite materializes a confirmed server binding and can sync without registration", async () => {
  const { db, store } = sqlite();
  let registrations = 0;
  const setupController = setup(async (options) => {
    await options.onPage(page);
    return { pages: 1, minutes: 1, complete: true };
  });
  const { controller, ticket } = await readyController({
    store,
    setup: setupController,
    seedBinding: false,
    makeClient: () => ({
      directDevice: {
        listDirectDevices: async () => ({ devices: [binding] }),
        registerDirectDevice: async () => {
          registrations += 1;
          return { providerConnectionId: 41 };
        },
        ingestDirectDeviceBatch: async () => ({
          status: "applied",
          rawArtifactId: 1,
          accepted: 1,
          duplicates: 0,
          rejected: 0,
          superseded: 0,
          targetId: "target",
        }),
      },
    }),
  });
  expect(store.getBinding(ticket, deviceId)).toMatchObject({
    providerConnectionId: 41,
    family: "xiaomi",
    modelId: "xiaomi_mi_band_10",
    captureCheckpoint: null,
  });
  expect(registrations).toBe(0);
  await controller.connect("native-1");
  expect(controller.getSnapshot().canSync).toBe(true);
  await controller.syncSteps("00112233445566778899aabbccddeeff");
  expect(store.getBinding(ticket, deviceId)?.captureCheckpoint).toContain(cursor1.nextMinuteUtc);
  expect(registrations).toBe(0);
  await controller.dispose();
  db.close();
  invalidateDirectDeviceAuthority();
});

test("fresh SQLite materializes an unconfirmed server binding and explicit confirmation makes it usable", async () => {
  const { db, store } = sqlite();
  const legacyBinding = { ...binding, family: null, modelId: null, displayName: null };
  let isConfirmed = false;
  let registrations = 0;
  const { controller, ticket } = await readyController({
    store,
    setup: setup(async () => ({ pages: 0, minutes: 0, complete: true })),
    seedBinding: false,
    makeClient: () => ({
      directDevice: {
        listDirectDevices: async () => ({ devices: [isConfirmed ? binding : legacyBinding] }),
        registerDirectDevice: async () => {
          registrations += 1;
          isConfirmed = true;
          return { providerConnectionId: 41, targetId: "target" };
        },
        ingestDirectDeviceBatch: async () => ({
          status: "applied",
          rawArtifactId: 1,
          accepted: 1,
          duplicates: 0,
          rejected: 0,
          superseded: 0,
          targetId: "target",
        }),
      },
    }),
  });
  expect(store.getBinding(ticket, deviceId)).toMatchObject({
    providerConnectionId: 41,
    family: null,
    modelId: null,
    captureCheckpoint: null,
  });
  expect(controller.getSnapshot().canSync).toBe(false);
  expect(registrations).toBe(0);
  await controller.connect("native-1");
  await controller.confirmBindingIdentity(deviceId, confirmationTarget(controller.getSnapshot()));
  expect(registrations).toBe(1);
  expect(controller.getSnapshot().errorCode).toBeNull();
  expect(store.getBinding(ticket, deviceId)).toMatchObject({
    providerConnectionId: 41,
    family: "xiaomi",
    modelId: "xiaomi_mi_band_10",
    captureCheckpoint: null,
  });
  expect(controller.getSnapshot().canSync).toBe(true);
  expect(registrations).toBe(1);
  await controller.dispose();
  db.close();
  invalidateDirectDeviceAuthority();
});

test("refresh adopts a server-confirmed identity onto an existing legacy local row", async () => {
  const { db, store } = sqlite();
  let registrations = 0;
  const { controller, ticket } = await readyController({
    store,
    setup: setup(async () => ({ pages: 0, minutes: 0, complete: true })),
    localIdentity: null,
    makeClient: () => ({
      directDevice: {
        listDirectDevices: async () => ({ devices: [binding] }),
        registerDirectDevice: async () => {
          registrations += 1;
          return { providerConnectionId: 41, targetId: "target" };
        },
        ingestDirectDeviceBatch: async () => ({
          status: "applied",
          rawArtifactId: 1,
          accepted: 1,
          duplicates: 0,
          rejected: 0,
          superseded: 0,
          targetId: "target",
        }),
      },
    }),
  });
  expect(store.getBinding(ticket, deviceId)).toMatchObject({
    family: "xiaomi",
    modelId: "xiaomi_mi_band_10",
    captureCheckpoint: null,
  });
  expect(registrations).toBe(0);
  await controller.connect("native-1");
  expect(controller.getSnapshot().canSync).toBe(true);
  await controller.dispose();
  db.close();
  invalidateDirectDeviceAuthority();
});

test("sync eligibility requires exact identity and advertised history capability", async () => {
  for (const candidate of [
    { modelId: "xiaomi_mi_band_11", family: "xiaomi" as const, stepsHistory: true },
    { modelId: "huawei_band_8", family: "huawei" as const, stepsHistory: false },
  ]) {
    const { db, store } = sqlite();
    let historyCalls = 0;
    const { controller } = await readyController({
      store,
      setup: setup(
        async () => {
          historyCalls += 1;
          return { pages: 0, minutes: 0, complete: true };
        },
        candidate.modelId as "xiaomi_mi_band_11" | "huawei_band_8",
        candidate,
      ),
      makeClient: () =>
        client(async () => ({
          status: "applied",
          rawArtifactId: 1,
          accepted: 1,
          duplicates: 0,
          rejected: 0,
          superseded: 0,
          targetId: "target",
        })),
    });
    await controller.connect("native-1");
    expect(controller.getSnapshot().canSync).toBe(false);
    await controller.syncSteps("not-a-key");
    expect(historyCalls).toBe(0);
    expect(controller.getSnapshot().errorCode).toBeNull();
    await controller.dispose();
    db.close();
    invalidateDirectDeviceAuthority();
  }
});

test("snapshot counts only fenced IDENTITY_REQUIRED quarantine and retry cannot release it", async () => {
  const { db, store } = sqlite();
  const ticket = createAuthorityTicket(
    {
      serverUrl: context.serverUrl,
      userId: context.userId,
      organizationId: context.organizationId,
    },
    `quarantine-${++sessionSequence}`,
  );
  store.createBinding(ticket, deviceId, { family: "xiaomi", modelId: "xiaomi_mi_band_10" });
  store.markRegistered(ticket, deviceId, 41);
  store.commitCapture(ticket, {
    deviceId,
    deviceIdentity: { family: "xiaomi", modelId: "xiaomi_mi_band_10" },
    captureId: "legacy-shaped",
    expectedPreviousCheckpoint: null,
    nextCheckpoint: "cursor",
    envelopes: [envelope(page.minutes)],
  });
  const [row] = store.listPending(ticket, 1);
  store.markBlocked(ticket, row!.ref, "IDENTITY_REQUIRED");
  db.exec(
    "UPDATE direct_device_outbox SET request_json = json_remove(request_json, '$.batch.deviceIdentity')",
  );

  let sends = 0;
  const { controller } = await readyController({
    store,
    setup: setup(async () => ({ pages: 0, minutes: 0, complete: true })),
    makeClient: () =>
      client(async () => {
        sends += 1;
        return {
          status: "applied",
          rawArtifactId: 1,
          accepted: 1,
          duplicates: 0,
          rejected: 0,
          superseded: 0,
          targetId: "target",
        };
      }),
  });
  expect(controller.getSnapshot().blockedIdentityEnvelopes).toBe(1);
  await controller.retryUpload();
  expect(sends).toBe(0);
  expect(controller.getSnapshot().blockedIdentityEnvelopes).toBe(1);
  expect(store.countBlockedIdentityEnvelopes(ticket)).toBe(1);
  await controller.dispose();
  db.close();
  invalidateDirectDeviceAuthority();
});

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
  expect(row.request.batch.deviceIdentity).toEqual({
    family: "xiaomi",
    modelId: "xiaomi_mi_band_10",
  });
  expect(row.ref.captureId.startsWith("dd-v2:")).toBe(true);
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
    firstDb.store.createBinding(firstTicket, deviceId, {
      family: "xiaomi",
      modelId: "xiaomi_mi_band_10",
    });
    firstDb.store.markRegistered(firstTicket, deviceId, 41);
    firstDb.store.commitCapture(firstTicket, {
      deviceId,
      deviceIdentity: { family: "xiaomi", modelId: "xiaomi_mi_band_10" },
      captureId: "seed",
      expectedPreviousCheckpoint: null,
      nextCheckpoint: JSON.stringify(cursor1),
      envelopes: [
        {
          expectedContext: { userId: context.userId, organizationId: context.organizationId },
          batch: {
            schemaVersion: 1,
            deviceId,
            deviceIdentity: { family: "xiaomi", modelId: "xiaomi_mi_band_10" },
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

test("selection cannot redirect an in-flight capture or upload destination", async () => {
  const { db, store } = sqlite();
  const otherId = "22222222-2222-4222-8222-222222222222";
  const otherBinding = { ...binding, deviceId: otherId };
  let release!: (value: unknown) => void;
  const setupController = setup(async (options) => {
    await options.onPage(page);
    return { pages: 1, minutes: 1, complete: true };
  });
  const { controller, ticket } = await readyController({
    store,
    setup: setupController,
    makeClient: () => ({
      directDevice: {
        listDirectDevices: async () => ({ devices: [binding, otherBinding] }),
        registerDirectDevice: async () => ({ providerConnectionId: 41 }),
        ingestDirectDeviceBatch: async () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      },
    }),
  });
  await controller.connect("native-1");
  const syncing = controller.syncSteps("00112233445566778899aabbccddeeff");
  while (!release) await Promise.resolve();
  controller.selectBinding(otherId);
  expect(controller.getSnapshot().selectedBindingId).toBe(deviceId);
  const pending = store.listPending(ticket, 10);
  expect(pending).toHaveLength(1);
  expect(pending[0]!.ref.deviceId).toBe(deviceId);
  release({
    status: "applied",
    rawArtifactId: 7,
    accepted: 1,
    duplicates: 0,
    rejected: 0,
    superseded: 0,
    targetId: "target",
  });
  await syncing;
  await controller.dispose();
  db.close();
  invalidateDirectDeviceAuthority();
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
  const page1CaptureId = `dd-v2:${deviceId}:2026-02-01T00:00:00.000Z:0:2026-02-01T00:01:00.000Z:0`;
  const page2CaptureId = `dd-v2:${deviceId}:2026-02-01T00:01:00.000Z:0:2026-02-01T00:02:00.000Z:0`;
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
    deviceIdentity: { family: "xiaomi", modelId: "xiaomi_mi_band_10" },
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
      "SELECT capture_id, checkpoint_json FROM direct_device_capture WHERE capture_id LIKE 'dd-v2:%' ORDER BY capture_id",
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
  const page2CaptureId = `dd-v2:${deviceId}:2026-02-01T00:01:00.000Z:0:2026-02-01T00:02:00.000Z:0`;
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
    deviceIdentity: { family: "xiaomi", modelId: "xiaomi_mi_band_10" },
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
  const setupController = setup(async () => ({ pages: 0, minutes: 0, complete: true }), null);
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

test("live GATT samples are committed as short backfill batches", async () => {
  const { db, store } = sqlite();
  const liveCapture: { handler: ((sample: DirectDeviceLiveSample) => void) | null } = {
    handler: null,
  };
  const gattBinding: DirectDeviceBindingSummary = {
    ...binding,
    family: "ble_gatt",
    modelId: "polar_h10",
    displayName: "Polar H10",
  };
  const { controller, ticket } = await readyController({
    store,
    setup: setup(async () => ({ pages: 0, minutes: 0, complete: true }), "polar_h10", {
      family: "ble_gatt",
      stepsHistory: false,
      liveCapture: true,
    }),
    localIdentity: { family: "ble_gatt", modelId: "polar_h10" },
    liveCapture,
    makeClient: () => ({
      directDevice: {
        listDirectDevices: async () => ({ devices: [gattBinding] }),
        registerDirectDevice: async () => ({ providerConnectionId: 41 }),
        ingestDirectDeviceBatch: async () => ({ status: "applied" }),
      },
    }),
  });
  expect(liveCapture.handler).not.toBeNull();
  const base = Date.parse("2026-02-01T00:00:00.000Z");
  for (let index = 0; index < 8; index += 1)
    liveCapture.handler!({
      type: "heart_rate",
      time: new Date(base + index * 1000).toISOString(),
      bpm: 70 + index,
      sensorContact: "detected",
      energyExpended: null,
      rrIntervalsMs: [],
    });
  liveCapture.handler!({
    type: "body_temperature",
    time: new Date(base + 8000).toISOString(),
    celsius: 36.5,
    site: 2,
    deviceTimestamp: false,
  });
  liveCapture.handler!({
    type: "blood_pressure",
    time: new Date(base + 9000).toISOString(),
    systolic: 120,
    diastolic: 80,
    meanArterialPressure: 100,
    pulseRate: 72,
    userId: null,
    deviceTimestamp: false,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const pending = store.listPending(ticket, 10);
  expect(pending).toHaveLength(3);
  const byType = new Map(pending.map((row) => [row.request.batch.recordType, row.request.batch]));
  expect([...byType.keys()].sort()).toEqual(["blood_pressure", "body_temperature", "heart_rate"]);
  for (const batch of byType.values())
    expect(batch).toMatchObject({
      mode: "backfill",
      deviceIdentity: { family: "ble_gatt", modelId: "polar_h10" },
    });
  const heartRate = byType.get("heart_rate")!.upserts[0]!;
  expect(heartRate.type).toBe("heart_rate");
  if (heartRate.type === "heart_rate") {
    expect(heartRate.samples).toHaveLength(8);
    expect(heartRate.samples[0]!.bpm).toBe(70);
  }
  expect(byType.get("body_temperature")!.upserts[0]).toMatchObject({
    type: "body_temperature",
    celsius: 36.5,
  });
  expect(byType.get("blood_pressure")!.upserts[0]).toMatchObject({
    type: "blood_pressure",
    systolic: 120,
    diastolic: 80,
    meanArterialPressure: 100,
    pulseRate: 72,
  });
  await controller.dispose();
  db.close();
  invalidateDirectDeviceAuthority();
});

test("live smart-scale weights are committed as weight_measurement batches", async () => {
  const { db, store } = sqlite();
  const liveCapture: { handler: ((sample: DirectDeviceLiveSample) => void) | null } = {
    handler: null,
  };
  const scaleBinding: DirectDeviceBindingSummary = {
    ...binding,
    family: "ble_scale",
    modelId: "xiaomi_smart_scale_2",
    displayName: "Xiaomi Smart Scale 2",
  };
  const { controller, ticket } = await readyController({
    store,
    setup: setup(async () => ({ pages: 0, minutes: 0, complete: true }), "xiaomi_smart_scale_2", {
      family: "ble_scale",
      stepsHistory: false,
      liveCapture: true,
    }),
    localIdentity: { family: "ble_scale", modelId: "xiaomi_smart_scale_2" },
    liveCapture,
    makeClient: () => ({
      directDevice: {
        listDirectDevices: async () => ({ devices: [scaleBinding] }),
        registerDirectDevice: async () => ({ providerConnectionId: 41 }),
        ingestDirectDeviceBatch: async () => ({ status: "applied" }),
      },
    }),
  });
  expect(liveCapture.handler).not.toBeNull();
  const base = Date.parse("2026-02-01T00:00:00.000Z");
  for (let index = 0; index < 10; index += 1)
    liveCapture.handler!({
      type: "weight_measurement",
      time: new Date(base + index * 1000).toISOString(),
      weightKg: 72.5 + index / 10,
      impedanceOhm: index === 0 ? 500 : null,
      deviceTimestamp: true,
    });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const pending = store.listPending(ticket, 10);
  expect(pending).toHaveLength(1);
  const batch = pending[0]!.request.batch;
  expect(batch).toMatchObject({
    recordType: "weight_measurement",
    mode: "backfill",
    deviceIdentity: { family: "ble_scale", modelId: "xiaomi_smart_scale_2" },
  });
  expect(batch.upserts).toHaveLength(10);
  expect(batch.upserts[0]).toMatchObject({
    type: "weight_measurement",
    weightKg: 72.5,
    impedanceOhm: 500,
  });
  expect(batch.upserts[1]).toMatchObject({ type: "weight_measurement", weightKg: 72.6 });
  expect(batch.upserts[1]).not.toHaveProperty("impedanceOhm");
  expect(batch.upserts[0]!.externalRecordId).toBe(
    weightMeasurementExternalRecordId("xiaomi_smart_scale_2", {
      time: new Date(base).toISOString(),
      weightKg: 72.5,
      impedanceOhm: 500,
    }),
  );
  await controller.dispose();
  db.close();
  invalidateDirectDeviceAuthority();
});

test("ring history is committed as steps_interval, sleep_session and heart_rate batches", async () => {
  const { db, store } = sqlite();
  const historyCapture: { handler: ((sample: DirectDeviceHistorySample) => void) | null } = {
    handler: null,
  };
  const ringBinding: DirectDeviceBindingSummary = {
    ...binding,
    family: "colmi_ring",
    modelId: "colmi_r02",
    displayName: "Colmi R02",
  };
  const { controller, ticket } = await readyController({
    store,
    setup: setup(async () => ({ pages: 0, minutes: 0, complete: true }), "colmi_r02", {
      family: "colmi_ring",
      stepsHistory: false,
      liveCapture: false,
      historySync: true,
    }),
    localIdentity: { family: "colmi_ring", modelId: "colmi_r02" },
    historyCapture,
    makeClient: () => ({
      directDevice: {
        listDirectDevices: async () => ({ devices: [ringBinding] }),
        registerDirectDevice: async () => ({ providerConnectionId: 41 }),
        ingestDirectDeviceBatch: async () => ({ status: "applied" }),
      },
    }),
  });
  expect(historyCapture.handler).not.toBeNull();

  const dayStart = new Date(2026, 1, 1, 0, 0, 0);
  // 46 quarter-hour buckets + one sleep session + three heart-rate samples
  // reaches the 50-sample flush threshold in one commit.
  for (let index = 0; index < 46; index += 1) {
    const start = new Date(dayStart.getTime() + index * 15 * 60_000);
    historyCapture.handler!({
      type: "steps_interval",
      startTime: start.toISOString(),
      endTime: new Date(start.getTime() + 15 * 60_000).toISOString(),
      count: index,
    });
  }
  historyCapture.handler!({
    type: "sleep_session",
    startTime: new Date(2026, 1, 1, 23, 0, 0).toISOString(),
    endTime: new Date(2026, 1, 2, 7, 0, 0).toISOString(),
    stages: [
      {
        stage: "light",
        startTime: new Date(2026, 1, 1, 23, 0, 0).toISOString(),
        endTime: new Date(2026, 1, 2, 1, 0, 0).toISOString(),
      },
    ],
  });
  for (let index = 0; index < 3; index += 1)
    historyCapture.handler!({
      type: "heart_rate",
      time: new Date(2026, 1, 1, 8, index * 5, 0).toISOString(),
      bpm: 60 + index,
    });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const pending = store.listPending(ticket, 10);
  expect(pending).toHaveLength(3);
  const byType = new Map(pending.map((row) => [row.request.batch.recordType, row.request.batch]));
  expect([...byType.keys()].sort()).toEqual(["heart_rate", "sleep_session", "steps_interval"]);
  for (const batch of byType.values())
    expect(batch).toMatchObject({
      mode: "backfill",
      deviceIdentity: { family: "colmi_ring", modelId: "colmi_r02" },
    });

  const steps = byType.get("steps_interval")!.upserts;
  expect(steps).toHaveLength(46);
  expect(steps[0]).toMatchObject({
    type: "steps_interval",
    count: 0,
    startTime: dayStart.toISOString(),
    endTime: new Date(dayStart.getTime() + 15 * 60_000).toISOString(),
  });

  const sleep = byType.get("sleep_session")!.upserts;
  expect(sleep).toHaveLength(1);
  expect(sleep[0]).toMatchObject({
    type: "sleep_session",
    startTime: new Date(2026, 1, 1, 23, 0, 0).toISOString(),
    endTime: new Date(2026, 1, 2, 7, 0, 0).toISOString(),
  });
  expect(sleep[0]).toHaveProperty("stages");

  const heartRate = byType.get("heart_rate")!.upserts;
  expect(heartRate).toHaveLength(1);
  expect(heartRate[0]).toMatchObject({ type: "heart_rate" });
  if (heartRate[0]!.type === "heart_rate") {
    expect(heartRate[0]!.samples).toHaveLength(3);
    expect(heartRate[0]!.samples[0]).toMatchObject({ bpm: 60 });
  }

  await controller.dispose();
  db.close();
  invalidateDirectDeviceAuthority();
});

test("Moyoung history is committed as heart_rate and sleep_session batches", async () => {
  const { db, store } = sqlite();
  const historyCapture: { handler: ((sample: DirectDeviceHistorySample) => void) | null } = {
    handler: null,
  };
  const moyoungBinding: DirectDeviceBindingSummary = {
    ...binding,
    family: "moyoung",
    modelId: "moyoung_l70",
    displayName: "L 70",
  };
  const { controller, ticket } = await readyController({
    store,
    setup: setup(async () => ({ pages: 0, minutes: 0, complete: true }), "moyoung_l70", {
      family: "moyoung",
      stepsHistory: false,
      liveCapture: false,
      historySync: true,
    }),
    localIdentity: { family: "moyoung", modelId: "moyoung_l70" },
    historyCapture,
    makeClient: () => ({
      directDevice: {
        listDirectDevices: async () => ({ devices: [moyoungBinding] }),
        registerDirectDevice: async () => ({ providerConnectionId: 41 }),
        ingestDirectDeviceBatch: async () => ({ status: "applied" }),
      },
    }),
  });
  expect(historyCapture.handler).not.toBeNull();

  // 49 heart-rate samples + one sleep session reaches the 50-sample flush
  // threshold in one commit. Moyoung never emits steps.
  const dayStart = new Date(2026, 1, 1, 0, 0, 0);
  for (let index = 0; index < 49; index += 1)
    historyCapture.handler!({
      type: "heart_rate",
      time: new Date(dayStart.getTime() + index * 5 * 60_000).toISOString(),
      bpm: 60 + (index % 20),
    });
  historyCapture.handler!({
    type: "sleep_session",
    startTime: new Date(2026, 1, 1, 23, 0, 0).toISOString(),
    endTime: new Date(2026, 1, 2, 7, 0, 0).toISOString(),
    stages: [
      {
        stage: "light",
        startTime: new Date(2026, 1, 1, 23, 0, 0).toISOString(),
        endTime: new Date(2026, 1, 2, 1, 0, 0).toISOString(),
      },
      {
        stage: "deep",
        startTime: new Date(2026, 1, 2, 1, 0, 0).toISOString(),
        endTime: new Date(2026, 1, 2, 7, 0, 0).toISOString(),
      },
    ],
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const pending = store.listPending(ticket, 10);
  expect(pending).toHaveLength(2);
  const byType = new Map(pending.map((row) => [row.request.batch.recordType, row.request.batch]));
  expect([...byType.keys()].sort()).toEqual(["heart_rate", "sleep_session"]);
  for (const batch of byType.values())
    expect(batch).toMatchObject({
      mode: "backfill",
      deviceIdentity: { family: "moyoung", modelId: "moyoung_l70" },
    });

  const heartRate = byType.get("heart_rate")!.upserts;
  expect(heartRate).toHaveLength(1);
  expect(heartRate[0]).toMatchObject({ type: "heart_rate" });
  expect(heartRate[0]!.externalRecordId).toStartWith(`dd-moyoung:${deviceId}:hr:`);
  if (heartRate[0]!.type === "heart_rate") {
    expect(heartRate[0]!.samples).toHaveLength(49);
    expect(heartRate[0]!.samples[0]).toMatchObject({ bpm: 60 });
  }

  const sleep = byType.get("sleep_session")!.upserts;
  expect(sleep).toHaveLength(1);
  expect(sleep[0]).toMatchObject({
    type: "sleep_session",
    startTime: new Date(2026, 1, 1, 23, 0, 0).toISOString(),
    endTime: new Date(2026, 1, 2, 7, 0, 0).toISOString(),
  });
  expect(sleep[0]!.externalRecordId).toStartWith(`dd-moyoung:${deviceId}:sleep:`);
  expect(sleep[0]).toHaveProperty("stages");

  await controller.dispose();
  db.close();
  invalidateDirectDeviceAuthority();
});

test("FitPro history is committed as steps_interval, sleep_session and heart_rate batches", async () => {
  const { db, store } = sqlite();
  const historyCapture: { handler: ((sample: DirectDeviceHistorySample) => void) | null } = {
    handler: null,
  };
  const fitproBinding: DirectDeviceBindingSummary = {
    ...binding,
    family: "fitpro",
    modelId: "fitpro_m6",
    displayName: "FitPro M6",
  };
  const { controller, ticket } = await readyController({
    store,
    setup: setup(async () => ({ pages: 0, minutes: 0, complete: true }), "fitpro_m6", {
      family: "fitpro",
      stepsHistory: true,
      liveCapture: false,
      historySync: true,
    }),
    localIdentity: { family: "fitpro", modelId: "fitpro_m6" },
    historyCapture,
    makeClient: () => ({
      directDevice: {
        listDirectDevices: async () => ({ devices: [fitproBinding] }),
        registerDirectDevice: async () => ({ providerConnectionId: 41 }),
        ingestDirectDeviceBatch: async () => ({ status: "applied" }),
      },
    }),
  });
  expect(historyCapture.handler).not.toBeNull();

  // 48 fifteen-minute step buckets + one sleep session + one realtime heart
  // rate sample reaches the 50-sample flush threshold in one commit.
  const dayStart = new Date(2026, 1, 1, 0, 0, 0);
  for (let index = 0; index < 48; index += 1) {
    const start = new Date(dayStart.getTime() + index * 15 * 60_000);
    historyCapture.handler!({
      type: "steps_interval",
      startTime: start.toISOString(),
      endTime: new Date(start.getTime() + 15 * 60_000).toISOString(),
      count: 10 + index,
    });
  }
  historyCapture.handler!({
    type: "sleep_session",
    startTime: new Date(2026, 1, 1, 23, 0, 0).toISOString(),
    endTime: new Date(2026, 1, 2, 7, 0, 0).toISOString(),
    stages: [
      {
        stage: "light",
        startTime: new Date(2026, 1, 1, 23, 0, 0).toISOString(),
        endTime: new Date(2026, 1, 2, 1, 0, 0).toISOString(),
      },
      {
        stage: "deep",
        startTime: new Date(2026, 1, 2, 1, 0, 0).toISOString(),
        endTime: new Date(2026, 1, 2, 7, 0, 0).toISOString(),
      },
    ],
  });
  historyCapture.handler!({
    type: "heart_rate",
    time: new Date(2026, 1, 1, 12, 0, 0).toISOString(),
    bpm: 71,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const pending = store.listPending(ticket, 10);
  expect(pending).toHaveLength(3);
  const byType = new Map(pending.map((row) => [row.request.batch.recordType, row.request.batch]));
  expect([...byType.keys()].sort()).toEqual(["heart_rate", "sleep_session", "steps_interval"]);
  for (const batch of byType.values())
    expect(batch).toMatchObject({
      mode: "backfill",
      deviceIdentity: { family: "fitpro", modelId: "fitpro_m6" },
    });

  const steps = byType.get("steps_interval")!.upserts;
  expect(steps).toHaveLength(48);
  expect(steps[0]).toMatchObject({
    type: "steps_interval",
    startTime: new Date(2026, 1, 1, 0, 0, 0).toISOString(),
    endTime: new Date(2026, 1, 1, 0, 15, 0).toISOString(),
    count: 10,
  });
  expect(steps[0]!.externalRecordId).toStartWith(`dd-fitpro:${deviceId}:steps:`);

  const sleep = byType.get("sleep_session")!.upserts;
  expect(sleep).toHaveLength(1);
  expect(sleep[0]).toMatchObject({
    type: "sleep_session",
    startTime: new Date(2026, 1, 1, 23, 0, 0).toISOString(),
    endTime: new Date(2026, 1, 2, 7, 0, 0).toISOString(),
  });
  expect(sleep[0]!.externalRecordId).toStartWith(`dd-fitpro:${deviceId}:sleep:`);
  expect(sleep[0]).toHaveProperty("stages");

  const heartRate = byType.get("heart_rate")!.upserts;
  expect(heartRate).toHaveLength(1);
  expect(heartRate[0]).toMatchObject({ type: "heart_rate" });
  expect(heartRate[0]!.externalRecordId).toStartWith(`dd-fitpro:${deviceId}:hr:`);
  if (heartRate[0]!.type === "heart_rate") {
    expect(heartRate[0]!.samples).toHaveLength(1);
    expect(heartRate[0]!.samples[0]).toMatchObject({ bpm: 71 });
  }

  await controller.dispose();
  db.close();
  invalidateDirectDeviceAuthority();
});

test("Pebble history samples never enter the generic history buffer or outbox", async () => {
  const { db, store } = sqlite();
  const historyCapture: { handler: ((sample: DirectDeviceHistorySample) => void) | null } = {
    handler: null,
  };
  const pebbleBinding: DirectDeviceBindingSummary = {
    ...binding,
    family: "pebble",
    modelId: "pebble_classic_2",
    displayName: "Pebble 2",
  };
  const { controller, ticket } = await readyController({
    store,
    setup: setup(async () => ({ pages: 0, minutes: 0, complete: true }), "pebble_classic_2", {
      family: "pebble",
      stepsHistory: true,
      liveCapture: false,
      historySync: true,
    }),
    localIdentity: {
      family: "pebble" as DirectDeviceIdentity["family"],
      modelId: "pebble_classic_2",
    },
    historyCapture,
    makeClient: () => ({
      directDevice: {
        listDirectDevices: async () => ({ devices: [pebbleBinding] }),
        registerDirectDevice: async () => ({ providerConnectionId: 41 }),
        ingestDirectDeviceBatch: async () => ({ status: "applied" }),
      },
    }),
  });
  expect(historyCapture.handler).not.toBeNull();

  // 48 one-minute step records + one sleep session + one heart-rate point +
  // two more steps reaches the 50-sample flush threshold in one commit.
  const dayStart = new Date(Date.UTC(2026, 1, 1, 0, 0, 0));
  for (let index = 0; index < 48; index += 1) {
    const start = new Date(dayStart.getTime() + index * 60_000);
    historyCapture.handler!({
      type: "steps",
      startTime: start.toISOString(),
      endTime: new Date(start.getTime() + 60_000).toISOString(),
      count: 10 + index,
    });
  }
  historyCapture.handler!({
    type: "sleep_session",
    startTime: new Date(Date.UTC(2026, 1, 1, 23, 0, 0)).toISOString(),
    endTime: new Date(Date.UTC(2026, 1, 2, 7, 0, 0)).toISOString(),
    stages: [
      {
        stage: "light",
        startTime: new Date(Date.UTC(2026, 1, 1, 23, 0, 0)).toISOString(),
        endTime: new Date(Date.UTC(2026, 1, 2, 1, 0, 0)).toISOString(),
      },
      {
        stage: "deep",
        startTime: new Date(Date.UTC(2026, 1, 2, 1, 0, 0)).toISOString(),
        endTime: new Date(Date.UTC(2026, 1, 2, 7, 0, 0)).toISOString(),
      },
    ],
  });
  historyCapture.handler!({
    type: "heart_rate",
    time: new Date(Date.UTC(2026, 1, 1, 12, 0, 0)).toISOString(),
    bpm: 71,
  });
  for (let index = 48; index < 50; index += 1) {
    const start = new Date(dayStart.getTime() + index * 60_000);
    historyCapture.handler!({
      type: "steps",
      startTime: start.toISOString(),
      endTime: new Date(start.getTime() + 60_000).toISOString(),
      count: 10 + index,
    });
  }
  await new Promise((resolve) => setTimeout(resolve, 0));

  // Pebble history only reaches the outbox via the durable inbox + projector.
  expect(store.listPending(ticket, 10)).toHaveLength(0);

  await controller.dispose();
  db.close();
  invalidateDirectDeviceAuthority();
});

test("Bangle.js history is committed as steps_interval and heart_rate batches", async () => {
  const { db, store } = sqlite();
  const historyCapture: { handler: ((sample: DirectDeviceHistorySample) => void) | null } = {
    handler: null,
  };
  const bangleBinding: DirectDeviceBindingSummary = {
    ...binding,
    family: "bangle_js",
    modelId: "bangle_js_2",
    displayName: "Bangle.js 2",
  };
  const { controller, ticket } = await readyController({
    store,
    setup: setup(async () => ({ pages: 0, minutes: 0, complete: true }), "bangle_js_2", {
      family: "bangle_js",
      stepsHistory: false,
      liveCapture: false,
      historySync: true,
    }),
    localIdentity: { family: "bangle_js", modelId: "bangle_js_2" },
    historyCapture,
    makeClient: () => ({
      directDevice: {
        listDirectDevices: async () => ({ devices: [bangleBinding] }),
        registerDirectDevice: async () => ({ providerConnectionId: 41 }),
        ingestDirectDeviceBatch: async () => ({ status: "applied" }),
      },
    }),
  });
  expect(historyCapture.handler).not.toBeNull();

  // 47 ten-minute buckets + three realtime heart-rate points reaches the
  // 50-sample flush threshold in one commit.
  const dayStart = new Date(2026, 1, 1, 0, 0, 0);
  for (let index = 0; index < 47; index += 1) {
    const end = new Date(dayStart.getTime() + (index + 1) * 10 * 60_000);
    historyCapture.handler!({
      type: "steps_interval",
      startTime: new Date(end.getTime() - 10 * 60_000).toISOString(),
      endTime: end.toISOString(),
      count: index,
    });
  }
  for (let index = 0; index < 3; index += 1)
    historyCapture.handler!({
      type: "heart_rate",
      time: new Date(2026, 1, 1, 8, index * 10, 0).toISOString(),
      bpm: 70 + index,
    });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const pending = store.listPending(ticket, 10);
  expect(pending).toHaveLength(2);
  const byType = new Map(pending.map((row) => [row.request.batch.recordType, row.request.batch]));
  expect([...byType.keys()].sort()).toEqual(["heart_rate", "steps_interval"]);
  for (const batch of byType.values())
    expect(batch).toMatchObject({
      mode: "backfill",
      deviceIdentity: { family: "bangle_js", modelId: "bangle_js_2" },
    });

  const steps = byType.get("steps_interval")!.upserts;
  expect(steps).toHaveLength(47);
  expect(steps[0]).toMatchObject({
    type: "steps_interval",
    count: 0,
    startTime: dayStart.toISOString(),
    endTime: new Date(dayStart.getTime() + 10 * 60_000).toISOString(),
  });
  expect(steps[0]).toHaveProperty("externalRecordId");
  expect((steps[0] as { externalRecordId: string }).externalRecordId).toStartWith(
    `dd-bangle:${deviceId}:steps:`,
  );

  const heartRate = byType.get("heart_rate")!.upserts;
  expect(heartRate).toHaveLength(1);
  expect(heartRate[0]).toMatchObject({ type: "heart_rate" });
  if (heartRate[0]!.type === "heart_rate") {
    expect(heartRate[0]!.samples).toHaveLength(3);
    expect(heartRate[0]!.samples[0]).toMatchObject({ bpm: 70 });
    expect(heartRate[0]!.externalRecordId).toStartWith(`dd-bangle:${deviceId}:hr:`);
  }

  await controller.dispose();
  db.close();
  invalidateDirectDeviceAuthority();
});

test("legacy Huami history is committed as exact-minute steps, sleep_session and heart_rate batches", async () => {
  const { db, store } = sqlite();
  const historyCapture: { handler: ((sample: DirectDeviceHistorySample) => void) | null } = {
    handler: null,
  };
  const huamiBinding: DirectDeviceBindingSummary = {
    ...binding,
    family: "huami_legacy",
    modelId: "amazfit_bip_u",
    displayName: "Amazfit Bip U",
  };
  const { controller, ticket } = await readyController({
    store,
    setup: setup(async () => ({ pages: 0, minutes: 0, complete: true }), "amazfit_bip_u", {
      family: "huami_legacy",
      stepsHistory: true,
      liveCapture: false,
      historySync: true,
    }),
    localIdentity: { family: "huami_legacy", modelId: "amazfit_bip_u" },
    historyCapture,
    makeClient: () => ({
      directDevice: {
        listDirectDevices: async () => ({ devices: [huamiBinding] }),
        registerDirectDevice: async () => ({ providerConnectionId: 41 }),
        ingestDirectDeviceBatch: async () => ({ status: "applied" }),
      },
    }),
  });
  expect(historyCapture.handler).not.toBeNull();

  const dayStart = new Date(Date.UTC(2026, 1, 1, 0, 0, 0));
  // 46 exact minutes + one sleep session + three heart-rate samples reaches
  // the 50-sample flush threshold in one commit.
  for (let index = 0; index < 46; index += 1) {
    const start = new Date(dayStart.getTime() + index * 60_000);
    historyCapture.handler!({
      type: "steps",
      startTime: start.toISOString(),
      endTime: new Date(start.getTime() + 60_000).toISOString(),
      count: index,
    });
  }
  historyCapture.handler!({
    type: "sleep_session",
    startTime: new Date(Date.UTC(2026, 1, 1, 23, 0, 0)).toISOString(),
    endTime: new Date(Date.UTC(2026, 1, 2, 7, 0, 0)).toISOString(),
    stages: [
      {
        stage: "light",
        startTime: new Date(Date.UTC(2026, 1, 1, 23, 0, 0)).toISOString(),
        endTime: new Date(Date.UTC(2026, 1, 2, 1, 0, 0)).toISOString(),
      },
    ],
  });
  for (let index = 0; index < 3; index += 1)
    historyCapture.handler!({
      type: "heart_rate",
      time: new Date(Date.UTC(2026, 1, 1, 8, index, 0)).toISOString(),
      bpm: 60 + index,
    });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const pending = store.listPending(ticket, 10);
  expect(pending).toHaveLength(3);
  const byType = new Map(pending.map((row) => [row.request.batch.recordType, row.request.batch]));
  expect([...byType.keys()].sort()).toEqual(["heart_rate", "sleep_session", "steps"]);
  for (const batch of byType.values())
    expect(batch).toMatchObject({
      mode: "backfill",
      deviceIdentity: { family: "huami_legacy", modelId: "amazfit_bip_u" },
    });

  const steps = byType.get("steps")!.upserts;
  expect(steps).toHaveLength(46);
  expect(steps[0]).toMatchObject({
    type: "steps",
    count: 0,
    startTime: dayStart.toISOString(),
    endTime: new Date(dayStart.getTime() + 60_000).toISOString(),
  });
  expect((steps[0] as { externalRecordId: string }).externalRecordId).toStartWith(
    `dd-huami:${deviceId}:steps:`,
  );

  const sleep = byType.get("sleep_session")!.upserts;
  expect(sleep).toHaveLength(1);
  expect(sleep[0]).toHaveProperty("stages");

  const heartRate = byType.get("heart_rate")!.upserts;
  expect(heartRate).toHaveLength(1);
  if (heartRate[0]!.type === "heart_rate") {
    expect(heartRate[0]!.samples).toHaveLength(3);
    expect(heartRate[0]!.externalRecordId).toStartWith(`dd-huami:${deviceId}:hr:`);
  }

  await controller.dispose();
  db.close();
  invalidateDirectDeviceAuthority();
});

test("Garmin FIT history is committed as exact-minute steps, sleep_session and heart_rate batches", async () => {
  const { db, store } = sqlite();
  const historyCapture: { handler: ((sample: DirectDeviceHistorySample) => void) | null } = {
    handler: null,
  };
  const garminBinding: DirectDeviceBindingSummary = {
    ...binding,
    family: "garmin",
    modelId: "garmin_fenix_7",
    displayName: "Garmin Fenix 7",
  };
  const { controller, ticket } = await readyController({
    store,
    setup: setup(async () => ({ pages: 0, minutes: 0, complete: true }), "garmin_fenix_7", {
      family: "garmin",
      stepsHistory: true,
      liveCapture: false,
      historySync: true,
    }),
    localIdentity: { family: "garmin", modelId: "garmin_fenix_7" },
    historyCapture,
    makeClient: () => ({
      directDevice: {
        listDirectDevices: async () => ({ devices: [garminBinding] }),
        registerDirectDevice: async () => ({ providerConnectionId: 42 }),
        ingestDirectDeviceBatch: async () => ({ status: "applied" }),
      },
    }),
  });
  expect(historyCapture.handler).not.toBeNull();

  const dayStart = new Date(Date.UTC(2026, 2, 1, 0, 0, 0));
  for (let index = 0; index < 46; index += 1) {
    const start = new Date(dayStart.getTime() + index * 60_000);
    historyCapture.handler!({
      type: "steps",
      startTime: start.toISOString(),
      endTime: new Date(start.getTime() + 60_000).toISOString(),
      count: index,
    });
  }
  historyCapture.handler!({
    type: "sleep_session",
    startTime: new Date(Date.UTC(2026, 2, 1, 23, 0, 0)).toISOString(),
    endTime: new Date(Date.UTC(2026, 2, 2, 7, 0, 0)).toISOString(),
    stages: [
      {
        stage: "deep",
        startTime: new Date(Date.UTC(2026, 2, 1, 23, 0, 0)).toISOString(),
        endTime: new Date(Date.UTC(2026, 2, 2, 1, 0, 0)).toISOString(),
      },
      {
        stage: "rem",
        startTime: new Date(Date.UTC(2026, 2, 2, 1, 0, 0)).toISOString(),
        endTime: new Date(Date.UTC(2026, 2, 2, 2, 0, 0)).toISOString(),
      },
    ],
  });
  for (let index = 0; index < 3; index += 1)
    historyCapture.handler!({
      type: "heart_rate",
      time: new Date(Date.UTC(2026, 2, 1, 8, index, 0)).toISOString(),
      bpm: 60 + index,
    });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const pending = store.listPending(ticket, 10);
  expect(pending).toHaveLength(3);
  const byType = new Map(pending.map((row) => [row.request.batch.recordType, row.request.batch]));
  expect([...byType.keys()].sort()).toEqual(["heart_rate", "sleep_session", "steps"]);
  for (const batch of byType.values())
    expect(batch).toMatchObject({
      mode: "backfill",
      deviceIdentity: { family: "garmin", modelId: "garmin_fenix_7" },
    });

  const steps = byType.get("steps")!.upserts;
  expect(steps).toHaveLength(46);
  expect(steps[0]).toMatchObject({
    type: "steps",
    count: 0,
    startTime: dayStart.toISOString(),
    endTime: new Date(dayStart.getTime() + 60_000).toISOString(),
  });
  expect((steps[0] as { externalRecordId: string }).externalRecordId).toStartWith(
    `dd-garmin:${deviceId}:steps:`,
  );

  const sleep = byType.get("sleep_session")!.upserts;
  expect(sleep).toHaveLength(1);
  expect(sleep[0]).toHaveProperty("stages");
  expect((sleep[0] as { externalRecordId: string }).externalRecordId).toStartWith(
    `dd-garmin:${deviceId}:sleep:`,
  );

  const heartRate = byType.get("heart_rate")!.upserts;
  expect(heartRate).toHaveLength(1);
  if (heartRate[0]!.type === "heart_rate") {
    expect(heartRate[0]!.samples).toHaveLength(3);
    expect(heartRate[0]!.externalRecordId).toStartWith(`dd-garmin:${deviceId}:hr:`);
  }

  await controller.dispose();
  db.close();
  invalidateDirectDeviceAuthority();
});

test("Huawei BLE history is committed as exact-minute steps, sleep_session and heart_rate batches", async () => {
  const { db, store } = sqlite();
  const historyCapture: { handler: ((sample: DirectDeviceHistorySample) => void) | null } = {
    handler: null,
  };
  const huaweiBinding: DirectDeviceBindingSummary = {
    ...binding,
    family: "huawei",
    modelId: "huawei_band_9",
    displayName: "Huawei Band 9",
  };
  const { controller, ticket } = await readyController({
    store,
    setup: setup(async () => ({ pages: 0, minutes: 0, complete: true }), "huawei_band_9", {
      family: "huawei",
      stepsHistory: true,
      liveCapture: false,
      historySync: true,
    }),
    localIdentity: { family: "huawei", modelId: "huawei_band_9" },
    historyCapture,
    makeClient: () => ({
      directDevice: {
        listDirectDevices: async () => ({ devices: [huaweiBinding] }),
        registerDirectDevice: async () => ({ providerConnectionId: 41 }),
        ingestDirectDeviceBatch: async () => ({ status: "applied" }),
      },
    }),
  });
  expect(historyCapture.handler).not.toBeNull();

  const dayStart = new Date(Date.UTC(2026, 1, 1, 0, 0, 0));
  // 46 exact minutes + one sleep session + three heart-rate samples reaches
  // the 50-sample flush threshold in one commit.
  for (let index = 0; index < 46; index += 1) {
    const start = new Date(dayStart.getTime() + index * 60_000);
    historyCapture.handler!({
      type: "steps",
      startTime: start.toISOString(),
      endTime: new Date(start.getTime() + 60_000).toISOString(),
      count: index,
    });
  }
  historyCapture.handler!({
    type: "sleep_session",
    startTime: new Date(Date.UTC(2026, 1, 1, 23, 0, 0)).toISOString(),
    endTime: new Date(Date.UTC(2026, 1, 2, 7, 0, 0)).toISOString(),
    stages: [
      {
        stage: "light",
        startTime: new Date(Date.UTC(2026, 1, 1, 23, 0, 0)).toISOString(),
        endTime: new Date(Date.UTC(2026, 1, 2, 1, 0, 0)).toISOString(),
      },
    ],
  });
  for (let index = 0; index < 3; index += 1)
    historyCapture.handler!({
      type: "heart_rate",
      time: new Date(Date.UTC(2026, 1, 1, 8, index, 0)).toISOString(),
      bpm: 60 + index,
    });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const pending = store.listPending(ticket, 10);
  expect(pending).toHaveLength(3);
  const byType = new Map(pending.map((row) => [row.request.batch.recordType, row.request.batch]));
  expect([...byType.keys()].sort()).toEqual(["heart_rate", "sleep_session", "steps"]);
  for (const batch of byType.values())
    expect(batch).toMatchObject({
      mode: "backfill",
      deviceIdentity: { family: "huawei", modelId: "huawei_band_9" },
    });

  const steps = byType.get("steps")!.upserts;
  expect(steps).toHaveLength(46);
  expect(steps[0]).toMatchObject({
    type: "steps",
    count: 0,
    startTime: dayStart.toISOString(),
    endTime: new Date(dayStart.getTime() + 60_000).toISOString(),
  });
  expect((steps[0] as { externalRecordId: string }).externalRecordId).toStartWith(
    `dd-huawei:${deviceId}:steps:`,
  );

  const sleep = byType.get("sleep_session")!.upserts;
  expect(sleep).toHaveLength(1);
  expect(sleep[0]).toHaveProperty("stages");

  const heartRate = byType.get("heart_rate")!.upserts;
  expect(heartRate).toHaveLength(1);
  if (heartRate[0]!.type === "heart_rate") {
    expect(heartRate[0]!.samples).toHaveLength(3);
    expect(heartRate[0]!.externalRecordId).toStartWith(`dd-huawei:${deviceId}:hr:`);
  }

  await controller.dispose();
  db.close();
  invalidateDirectDeviceAuthority();
});

test("GloryFit history is committed as steps_interval, sleep_session and heart_rate batches", async () => {
  const { db, store } = sqlite();
  const historyCapture: { handler: ((sample: DirectDeviceHistorySample) => void) | null } = {
    handler: null,
  };
  const gloryFitBinding: DirectDeviceBindingSummary = {
    ...binding,
    family: "gloryfit",
    modelId: "gloryfit_d3",
    displayName: "GloryFit D3",
  };
  const { controller, ticket } = await readyController({
    store,
    setup: setup(async () => ({ pages: 0, minutes: 0, complete: true }), "gloryfit_d3", {
      family: "gloryfit",
      stepsHistory: false,
      liveCapture: false,
      historySync: true,
    }),
    localIdentity: { family: "gloryfit", modelId: "gloryfit_d3" },
    historyCapture,
    makeClient: () => ({
      directDevice: {
        listDirectDevices: async () => ({ devices: [gloryFitBinding] }),
        registerDirectDevice: async () => ({ providerConnectionId: 41 }),
        ingestDirectDeviceBatch: async () => ({ status: "applied" }),
      },
    }),
  });
  expect(historyCapture.handler).not.toBeNull();

  // 46 hourly buckets + one sleep session + three heart-rate samples reaches
  // the 50-sample flush threshold in one commit.
  const dayStart = new Date(2026, 1, 1, 0, 0, 0);
  for (let index = 0; index < 46; index += 1) {
    const start = new Date(dayStart.getTime() + index * 60 * 60_000);
    historyCapture.handler!({
      type: "steps_interval",
      startTime: start.toISOString(),
      endTime: new Date(start.getTime() + 60 * 60_000).toISOString(),
      count: index,
    });
  }
  historyCapture.handler!({
    type: "sleep_session",
    startTime: new Date(2026, 1, 1, 23, 0, 0).toISOString(),
    endTime: new Date(2026, 1, 2, 7, 0, 0).toISOString(),
    stages: [
      {
        stage: "deep",
        startTime: new Date(2026, 1, 1, 23, 0, 0).toISOString(),
        endTime: new Date(2026, 1, 2, 1, 0, 0).toISOString(),
      },
    ],
  });
  for (let index = 0; index < 3; index += 1)
    historyCapture.handler!({
      type: "heart_rate",
      time: new Date(2026, 1, 1, 8, index * 10, 0).toISOString(),
      bpm: 60 + index,
    });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const pending = store.listPending(ticket, 10);
  expect(pending).toHaveLength(3);
  const byType = new Map(pending.map((row) => [row.request.batch.recordType, row.request.batch]));
  expect([...byType.keys()].sort()).toEqual(["heart_rate", "sleep_session", "steps_interval"]);
  for (const batch of byType.values())
    expect(batch).toMatchObject({
      mode: "backfill",
      deviceIdentity: { family: "gloryfit", modelId: "gloryfit_d3" },
    });

  const steps = byType.get("steps_interval")!.upserts;
  expect(steps).toHaveLength(46);
  expect(steps[0]).toMatchObject({
    type: "steps_interval",
    count: 0,
    startTime: dayStart.toISOString(),
    endTime: new Date(dayStart.getTime() + 60 * 60_000).toISOString(),
  });
  expect((steps[0] as { externalRecordId: string }).externalRecordId).toStartWith(
    `dd-gloryfit:${deviceId}:steps:`,
  );

  const sleep = byType.get("sleep_session")!.upserts;
  expect(sleep).toHaveLength(1);
  expect(sleep[0]).toMatchObject({
    type: "sleep_session",
    startTime: new Date(2026, 1, 1, 23, 0, 0).toISOString(),
    endTime: new Date(2026, 1, 2, 7, 0, 0).toISOString(),
  });
  expect(sleep[0]).toHaveProperty("stages");
  expect((sleep[0] as { externalRecordId: string }).externalRecordId).toStartWith(
    `dd-gloryfit:${deviceId}:sleep:`,
  );

  const heartRate = byType.get("heart_rate")!.upserts;
  expect(heartRate).toHaveLength(1);
  expect(heartRate[0]).toMatchObject({ type: "heart_rate" });
  if (heartRate[0]!.type === "heart_rate") {
    expect(heartRate[0]!.samples).toHaveLength(3);
    expect(heartRate[0]!.samples[0]).toMatchObject({ bpm: 60 });
    expect(heartRate[0]!.externalRecordId).toStartWith(`dd-gloryfit:${deviceId}:hr:`);
  }

  await controller.dispose();
  db.close();
  invalidateDirectDeviceAuthority();
});

test("Casio hourly bins are committed as a steps_interval batch", async () => {
  const { db, store } = sqlite();
  const historyCapture: { handler: ((sample: DirectDeviceHistorySample) => void) | null } = {
    handler: null,
  };
  const casioBinding: DirectDeviceBindingSummary = {
    ...binding,
    family: "casio",
    modelId: "casio_gbx-100",
    displayName: "Casio GBX-100",
  };
  const { controller, ticket } = await readyController({
    store,
    setup: setup(async () => ({ pages: 0, minutes: 0, complete: true }), "casio_gbx-100", {
      family: "casio",
      stepsHistory: true,
      liveCapture: false,
      historySync: true,
    }),
    localIdentity: { family: "casio", modelId: "casio_gbx-100" },
    historyCapture,
    makeClient: () => ({
      directDevice: {
        listDirectDevices: async () => ({ devices: [casioBinding] }),
        registerDirectDevice: async () => ({ providerConnectionId: 41 }),
        ingestDirectDeviceBatch: async () => ({ status: "applied" }),
      },
    }),
  });
  expect(historyCapture.handler).not.toBeNull();

  // 50 hourly bins reach the 50-sample flush threshold in one commit.
  const dayStart = new Date(2026, 1, 1, 0, 0, 0);
  for (let index = 0; index < 50; index += 1)
    historyCapture.handler!({
      type: "steps_interval",
      startTime: new Date(dayStart.getTime() + index * 60 * 60_000).toISOString(),
      endTime: new Date(dayStart.getTime() + (index + 1) * 60 * 60_000).toISOString(),
      count: index * 3,
    });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const pending = store.listPending(ticket, 10);
  expect(pending).toHaveLength(1);
  const batch = pending[0]!.request.batch;
  expect(batch).toMatchObject({
    recordType: "steps_interval",
    mode: "backfill",
    deviceIdentity: { family: "casio", modelId: "casio_gbx-100" },
  });
  expect(batch.upserts).toHaveLength(50);
  expect(batch.upserts[0]).toEqual({
    type: "steps_interval",
    externalRecordId: `dd-casio:${deviceId}:steps:${dayStart.toISOString()}`,
    sourceApp: null,
    startTime: dayStart.toISOString(),
    endTime: new Date(dayStart.getTime() + 60 * 60_000).toISOString(),
    count: 0,
  });
  // No heart rate or sleep batches exist for this family.
  expect(new Set(pending.map((row) => row.request.batch.recordType))).toEqual(
    new Set(["steps_interval"]),
  );

  await controller.dispose();
  db.close();
  invalidateDirectDeviceAuthority();
});
