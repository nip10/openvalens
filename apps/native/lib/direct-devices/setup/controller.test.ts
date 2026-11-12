import { expect, test } from "bun:test";
import { DIRECT_DEVICE_MODELS } from "../../../../../packages/health-record/src/direct-device-models";
import type { Device, State, Subscription } from "react-native-ble-plx";

import { createHelioSetupController } from "./controller";
import type { PebblePacketSink, PebblePeer, PebbleSessionOutcome } from "../pebble-types";
import { BLE_GATT_MODELS } from "../models/ble-gatt";
import { BANGLE_JS_MODELS } from "../models/bangle-js";
import { BANGLE_JS_RX_UUID, BANGLE_JS_SERVICE_UUID, BANGLE_JS_TX_UUID } from "../models/bangle-js";
import { BLE_SCALE_MODELS } from "../models/ble-scale";
import { CASIO_MODELS } from "../models/casio";
import {
  COLMI_RING_MODELS,
  COLMI_V1_NOTIFY_UUID,
  COLMI_V1_SERVICE_UUID,
  COLMI_V1_WRITE_UUID,
  COLMI_V2_COMMAND_UUID,
  COLMI_V2_NOTIFY_UUID,
  COLMI_V2_SERVICE_UUID,
} from "../models/colmi-ring";
import { GLORYFIT_MODELS } from "../models/gloryfit";
import { HUAMI_LEGACY_MODELS } from "../models/huami-legacy";
import { MOYOUNG_MODELS } from "../models/moyoung";
import { FITPRO_MODELS } from "../models/fitpro";
import { PEBBLE_MODELS } from "../models/pebble";
import {
  HUAMI_ACTIVITY_CONTROL_UUID,
  HUAMI_ACTIVITY_DATA_UUID,
  HUAMI_AUTH_UUID,
  HUAMI_SERVICE_UUID,
} from "../models/huami-legacy";
import { GARMIN_MODELS } from "../models/garmin";
import { HUAWEI_MODELS } from "../models/huawei";
import { XIAOMI_MODELS } from "../models/xiaomi";
import { ZEPP_OS_MODELS } from "../models/zepp-os";
import { crc32 } from "../protocol/chunked";
import {
  encodeXiaomiActivityFileId,
  XIAOMI_ACTIVITY_DAILY,
  XIAOMI_ACTIVITY_TYPE,
  XIAOMI_DETAIL_DETAILS,
} from "../protocol/xiaomi-activity";
import type { XiaomiHistoryTransport } from "../protocol/xiaomi-history";
import type { HelioHistoryOptions, HelioStepsPage } from "../protocol/types";
import type { XiaomiCommand } from "../protocol/xiaomi-proto";
import type { XiaomiBleProfile } from "../transport/xiaomi-link";

test("native model registries remain in parity with the shared identity catalog", () => {
  const native = [
    ...ZEPP_OS_MODELS.map((model) => ({
      family: "zepp_os",
      modelId: model.id,
      displayName: model.displayName,
    })),
    ...XIAOMI_MODELS.map((model) => ({
      family: "xiaomi",
      modelId: model.id,
      displayName: model.displayName,
    })),
    ...HUAWEI_MODELS.map((model) => ({
      family: "huawei",
      modelId: model.id,
      displayName: model.displayName,
    })),
    ...GARMIN_MODELS.map((model) => ({
      family: "garmin",
      modelId: model.id,
      displayName: model.displayName,
    })),
    ...BLE_GATT_MODELS.map((model) => ({
      family: "ble_gatt",
      modelId: model.id,
      displayName: model.displayName,
    })),
    ...BANGLE_JS_MODELS.map((model) => ({
      family: "bangle_js",
      modelId: model.id,
      displayName: model.displayName,
    })),
    ...BLE_SCALE_MODELS.map((model) => ({
      family: "ble_scale",
      modelId: model.id,
      displayName: model.displayName,
    })),
    ...COLMI_RING_MODELS.map((model) => ({
      family: "colmi_ring",
      modelId: model.id,
      displayName: model.displayName,
    })),
    ...GLORYFIT_MODELS.map((model) => ({
      family: "gloryfit",
      modelId: model.id,
      displayName: model.displayName,
    })),
    ...HUAMI_LEGACY_MODELS.map((model) => ({
      family: "huami_legacy",
      modelId: model.id,
      displayName: model.displayName,
    })),
    ...MOYOUNG_MODELS.map((model) => ({
      family: "moyoung",
      modelId: model.id,
      displayName: model.displayName,
    })),
    ...FITPRO_MODELS.map((model) => ({
      family: "fitpro",
      modelId: model.id,
      displayName: model.displayName,
    })),
    ...CASIO_MODELS.map((model) => ({
      family: "casio",
      modelId: model.id,
      displayName: model.displayName,
    })),
    ...PEBBLE_MODELS.map((model) => ({
      family: "pebble",
      modelId: model.id,
      displayName: model.displayName,
    })),
  ].sort((left, right) =>
    `${left.family}:${left.modelId}`.localeCompare(`${right.family}:${right.modelId}`),
  );
  expect(native).toHaveLength(473);
  expect(native as unknown).toEqual(
    [...DIRECT_DEVICE_MODELS].sort((left, right) =>
      `${left.family}:${left.modelId}`.localeCompare(`${right.family}:${right.modelId}`),
    ),
  );
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
async function within<T>(promise: Promise<T>, timeoutMs = 1000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("TEST_OPERATION_TIMEOUT")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function fixture(
  options: {
    runtime?: { platform: string; version: number; result?: string };
    initialState?: State;
    readyTimeoutMs?: number;
    scanTimeoutMs?: number;
    connect?: () => Promise<Device>;
    discover?: () => Promise<Device>;
    services?: () => Promise<Array<{ uuid: string }>>;
    characteristics?: (serviceUuid: string) => Promise<Array<{ uuid: string }>>;
    cryptoTest?: () => Promise<boolean>;
    startScan?: () => Promise<void>;
    stopScan?: () => Promise<void>;
    destroy?: () => Promise<void>;
    cancelConnection?: () => Promise<void>;
    deviceName?: string;
    serviceUuids?: string[];
    xiaomiHistoryTransport?: (
      device: Device,
      profile: XiaomiBleProfile,
      options: HelioHistoryOptions,
    ) => XiaomiHistoryTransport;
    onHistorySample?: (sample: import("./types").DirectDeviceHistorySample) => void;
    createPebbleSession?: Parameters<typeof createHelioSetupController>[0] extends infer D
      ? D extends { createPebbleSession?: infer C }
        ? C
        : never
      : never;
  } = {},
) {
  let scanCallback: ((error: unknown, device: Device | null) => void) | undefined;
  let stateCallback: ((state: State) => void) | undefined;
  let disconnectCallback: (() => void) | undefined;
  let permissionRequests: string[][] = [];
  let stateSubscriptions = 0;
  let removedSubscriptions = 0;
  let cancelCount = 0;
  let scanStarts = 0;
  let radioLoads = 0;
  let destroyed = 0;
  let currentState = options.initialState ?? ("PoweredOn" as State);
  const serviceRows =
    options.services ?? (async () => [{ uuid: "0000fee0-0000-1000-8000-00805f9b34fb" }]);
  const discovered = {
    discoverAllServicesAndCharacteristics: options.discover ?? (async () => discovered),
    services: serviceRows,
    requestMTU: async () => discovered,
    characteristicsForService:
      options.characteristics ??
      (async (serviceUuid: string) =>
        serviceUuid.toLowerCase() === "0000fe95-0000-1000-8000-00805f9b34fb"
          ? [
              { uuid: "00000051-0000-1000-8000-00805f9b34fb" },
              { uuid: "00000052-0000-1000-8000-00805f9b34fb" },
              { uuid: "00000053-0000-1000-8000-00805f9b34fb" },
              { uuid: "00000055-0000-1000-8000-00805f9b34fb" },
            ]
          : []),
    cancelConnection: async () => {
      cancelCount += 1;
      await options.cancelConnection?.();
    },
  } as unknown as Device;
  const selected = {
    id: "local-id",
    name: options.deviceName ?? "Amazfit Helio Strap",
    rssi: -50,
    serviceUUIDs: options.serviceUuids ?? null,
    connect: options.connect ?? (async () => discovered),
    cancelConnection: async () => {
      cancelCount += 1;
      await options.cancelConnection?.();
    },
  } as unknown as Device;
  const manager = {
    state: async () => currentState,
    onStateChange: (callback: (state: State) => void) => {
      stateSubscriptions += 1;
      stateCallback = callback;
      return {
        remove() {
          removedSubscriptions += 1;
        },
      } as Subscription;
    },
    startDeviceScan: (
      _services: string[] | null,
      _settings: unknown,
      callback: typeof scanCallback,
    ) => {
      scanStarts += 1;
      scanCallback = callback;
      return options.startScan?.() ?? Promise.resolve();
    },
    stopDeviceScan: async () => {
      await options.stopScan?.();
    },
    destroy: async () => {
      destroyed += 1;
      await options.destroy?.();
    },
    onDeviceDisconnected: (_id: string, callback: () => void) => {
      disconnectCallback = callback;
      return { remove() {} };
    },
  };
  const controller = createHelioSetupController({
    runtime: () => {
      const platform = options.runtime ?? { platform: "ios", version: 0 };
      return {
        ...platform,
        granted: "granted",
        requestPermissions: async (requested) => {
          permissionRequests.push(requested);
          return Object.fromEntries(
            requested.map((p) => [p, options.runtime?.result ?? "granted"]),
          );
        },
      };
    },
    readyTimeoutMs: options.readyTimeoutMs ?? 50,
    scanTimeoutMs: options.scanTimeoutMs ?? 10000,
    loadRadio: () => {
      radioLoads += 1;
      return { manager, devices: new Map() } as never;
    },
    cryptoTest: options.cryptoTest,
    xiaomiHistoryTransport: options.xiaomiHistoryTransport,
    onHistorySample: options.onHistorySample,
    createPebbleSession: options.createPebbleSession,
    pebbleBondAdapter: () => ({
      getState: async () => "bonded",
      ensureBonded: async () => undefined,
      cancelWait: async () => undefined,
    }),
  });
  return {
    controller,
    emit: () => scanCallback?.(null, selected),
    setState: (state: State) => {
      currentState = state;
      stateCallback?.(state);
    },
    disconnect: () => disconnectCallback?.(),
    permissionRequests: () => permissionRequests,
    counts: () => ({
      stateSubscriptions,
      removedSubscriptions,
      cancelCount,
      scanStarts,
      radioLoads,
      destroyed,
    }),
  };
}

const PEBBLE_SERVICES = async () => [
  { uuid: "0000fed9-0000-1000-8000-00805f9b34fb" },
  { uuid: "30000003-328e-0fbb-c642-1aa6699bdada" },
];

function fakePebbleSessions(
  prepare: (signal: AbortSignal) => Promise<PebblePeer> = async () => ({
    nativeId: "local-id",
    hardwareId: 15,
    identity: { family: "pebble", modelId: "pebble_2_duo" },
  }),
) {
  const calls: { nativeId: string; advertisedName?: string | null }[] = [];
  let closes = 0;
  let capture: (options: {
    signal: AbortSignal;
    sink: PebblePacketSink;
  }) => Promise<PebbleSessionOutcome> = async () => ({
    status: "idle",
    receivedPackets: 0,
    durableItems: 0,
    rejectedPackets: 0,
  });
  const factory = ((options: { nativeId: string; advertisedName?: string | null }) => {
    calls.push({ nativeId: options.nativeId, advertisedName: options.advertisedName });
    return {
      prepare,
      capture: (args: { signal: AbortSignal; sink: PebblePacketSink }) => capture(args),
      close: async () => {
        closes += 1;
      },
    };
  }) as never;
  return {
    factory,
    calls,
    closes: () => closes,
    setCapture(next: typeof capture) {
      capture = next;
    },
  };
}

test("every Pebble-shaped name connects only through the durable prepare; the model comes from firmware", async () => {
  const names = [
    "Pebble",
    "Pebble Steel",
    "Pebble Time",
    "Pebble Time Steel",
    "Pebble Time Round",
    "Pebble 1A2B",
    "Pebble 2D0A",
  ];
  for (const deviceName of names) {
    let healthWrites = 0;
    const sessions = fakePebbleSessions();
    const f = fixture({
      deviceName,
      services: PEBBLE_SERVICES,
      createPebbleSession: sessions.factory,
      onHistorySample: () => {
        healthWrites += 1;
      },
    });
    await f.controller.startScan();
    f.emit();
    const listed = f.controller.getSnapshot().devices.find((device) => device.id === "local-id");
    expect(listed?.family, deviceName).toBe("pebble");
    // Generic BLE names are candidates only: no model is guessed before firmware identity.
    if (/^Pebble [0-9A-F]{4}$/.test(deviceName))
      expect(listed?.modelId, deviceName).toBeUndefined();
    await f.controller.connect("local-id");
    const snapshot = f.controller.getSnapshot();
    // Release the module-wide device lease even if an assertion below fails.
    if (snapshot.phase !== "connected") await f.controller.dispose();
    expect(sessions.calls, deviceName).toEqual([
      { nativeId: "local-id", advertisedName: deviceName },
    ]);
    expect(snapshot.phase, deviceName).toBe("connected");
    expect(snapshot.connectedFamily, deviceName).toBe("pebble");
    expect(snapshot.connectedModelId, deviceName).toBe("pebble_2_duo");
    expect(snapshot.capabilities, deviceName).toEqual({
      stepsHistory: true,
      liveCapture: false,
      historySync: true,
    });
    expect(f.controller.getPebblePeer()?.hardwareId, deviceName).toBe(15);
    // History never flows through the legacy sample callback or fetchSteps.
    await expect(
      f.controller.fetchSteps({ signal: new AbortController().signal } as never),
    ).rejects.toThrow("PEBBLE_USE_DURABLE_CAPTURE");
    expect(healthWrites, deviceName).toBe(0);
    await f.controller.dispose();
    expect(sessions.closes(), deviceName).toBeGreaterThan(0);
  }
});

test("a refused Pebble prepare surfaces its code and leaves nothing connected", async () => {
  const sessions = fakePebbleSessions(async () => {
    throw new Error("PEBBLE_IDENTITY_UNSUPPORTED");
  });
  const f = fixture({
    deviceName: "Pebble 1A2B",
    services: PEBBLE_SERVICES,
    createPebbleSession: sessions.factory,
  });
  await f.controller.startScan();
  f.emit();
  await f.controller.connect("local-id");
  const snapshot = f.controller.getSnapshot();
  expect(snapshot.phase).toBe("error");
  expect(snapshot.errorCode).toBe("PEBBLE_IDENTITY_UNSUPPORTED");
  expect(snapshot.connectedDeviceId).toBeNull();
  expect(f.controller.getPebblePeer()).toBeNull();
  expect(sessions.closes()).toBe(1);
  await expect(
    f.controller.capturePebble({
      signal: new AbortController().signal,
      sink: async () => ({ durable: true, insertedItems: 0, throughSeq: 0 }),
    }),
  ).resolves.toEqual({ status: "failed", code: "PEBBLE_NOT_CONNECTED" });
  await f.controller.dispose();
});

test("a Pebble without the pairing service never reaches prepare", async () => {
  const sessions = fakePebbleSessions();
  const f = fixture({ deviceName: "Pebble 1A2B", createPebbleSession: sessions.factory });
  await f.controller.startScan();
  f.emit();
  await f.controller.connect("local-id");
  expect(f.controller.getSnapshot().errorCode).toBe("PEBBLE_SERVICE_MISSING");
  expect(sessions.calls).toHaveLength(0);
  await f.controller.dispose();
});

test("capturePebble forwards the sink, and its own link teardown is not reported as a drop", async () => {
  const sessions = fakePebbleSessions();
  const f = fixture({
    deviceName: "Pebble 1A2B",
    services: PEBBLE_SERVICES,
    createPebbleSession: sessions.factory,
  });
  await f.controller.startScan();
  f.emit();
  await f.controller.connect("local-id");
  const receipts: unknown[] = [];
  sessions.setCapture(async ({ sink }) => {
    receipts.push(
      await sink({
        uuid: "00000000-0000-0000-0000-000000000000",
        sessionTimestamp: 1,
        logTag: 81,
        itemType: 0,
        itemSize: 1,
        data: Uint8Array.of(1),
      }),
    );
    // The transport ends the link at its terminal outcome.
    f.disconnect();
    return { status: "idle", receivedPackets: 1, durableItems: 1, rejectedPackets: 0 };
  });
  const outcome = await f.controller.capturePebble({
    signal: new AbortController().signal,
    sink: async () => ({ durable: true, insertedItems: 1, throughSeq: 7 }),
  });
  expect(outcome).toMatchObject({ status: "idle", receivedPackets: 1 });
  expect(receipts).toEqual([{ durable: true, insertedItems: 1, throughSeq: 7 }]);
  const snapshot = f.controller.getSnapshot();
  expect(snapshot.phase).toBe("idle");
  expect(snapshot.errorCode).toBeNull();
  expect(snapshot.connectedDeviceId).toBeNull();
  expect(f.controller.getPebblePeer()).toBeNull();
  await f.controller.dispose();
});

test("factory is inert; real injected Android runtime asks both Android 12 permissions", async () => {
  const f = fixture({ runtime: { platform: "android", version: 32 } });
  expect(f.counts().radioLoads).toBe(0);
  await f.controller.startScan();
  expect(f.permissionRequests()).toEqual([
    [
      "android.permission.BLUETOOTH_SCAN",
      "android.permission.BLUETOOTH_CONNECT",
      "android.permission.ACCESS_COARSE_LOCATION",
      "android.permission.ACCESS_FINE_LOCATION",
    ],
  ]);
  expect(f.counts().scanStarts).toBe(1);
  await f.controller.dispose();
});

test("Android 12 denial prevents scanning; legacy Android requests location only", async () => {
  const denied = fixture({ runtime: { platform: "android", version: 34, result: "denied" } });
  await denied.controller.startScan();
  expect(denied.permissionRequests()).toEqual([
    [
      "android.permission.BLUETOOTH_SCAN",
      "android.permission.BLUETOOTH_CONNECT",
      "android.permission.ACCESS_COARSE_LOCATION",
      "android.permission.ACCESS_FINE_LOCATION",
    ],
  ]);
  expect(denied.controller.getSnapshot()).toMatchObject({
    errorCode: "PERMISSION_DENIED",
    bluetooth: "unauthorized",
  });
  expect(denied.counts().scanStarts).toBe(0);

  const legacy = fixture({ runtime: { platform: "android", version: 30 } });
  await legacy.controller.startScan();
  expect(legacy.permissionRequests()).toEqual([["android.permission.ACCESS_FINE_LOCATION"]]);
  await legacy.controller.dispose();
});

test("unknown Bluetooth state waits for PoweredOn and repeated scan timeout removes subscriptions", async () => {
  const f = fixture({ initialState: "Unknown" as State, scanTimeoutMs: 5 });
  const scanning = f.controller.startScan();
  for (let i = 0; i < 8 && f.counts().stateSubscriptions === 0; i += 1) await Promise.resolve();
  f.setState("PoweredOn" as State);
  await scanning;
  expect(f.controller.getSnapshot().phase).toBe("scanning");
  await new Promise((resolve) => setTimeout(resolve, 10));
  f.setState("PoweredOn" as State);
  await f.controller.startScan();
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(f.counts().stateSubscriptions).toBe(3); // 1 readiness observer + 2 scan observers
  expect(f.counts().removedSubscriptions).toBe(3);
  await f.controller.dispose();
});

test("permission and state awaits resolving after stop/dispose cannot start scans or publish", async () => {
  const permission = deferred<Record<string, string>>();
  const f = fixture({ runtime: { platform: "android", version: 32 } });
  // Override permission helper through a second injected runtime controller.
  const stopped = createHelioSetupController({
    runtime: () => ({
      platform: "android",
      version: 32,
      granted: "granted",
      requestPermissions: () => permission.promise,
    }),
    loadRadio: () => {
      throw new Error("radio should remain lazy until permission passes");
    },
  });
  const action = stopped.startScan();
  await stopped.stopScan();
  permission.resolve({
    "android.permission.BLUETOOTH_SCAN": "granted",
    "android.permission.BLUETOOTH_CONNECT": "granted",
  });
  await action;
  expect(stopped.getSnapshot().phase).toBe("idle");
  expect(f.counts().radioLoads).toBe(0);
  await stopped.dispose();

  const stateGate = deferred<State>();
  const late = fixture();
  const stateController = createHelioSetupController({
    readyTimeoutMs: 10,
    runtime: () => ({
      platform: "ios",
      version: 0,
      granted: "granted",
      requestPermissions: async () => ({}),
    }),
    loadRadio: () => ({
      manager: {
        state: () => stateGate.promise,
        onStateChange: () => ({ remove() {} }),
        startDeviceScan: async () => {},
        stopDeviceScan: async () => {},
        destroy: async () => {},
        onDeviceDisconnected: () => ({ remove() {} }),
      } as never,
      devices: new Map(),
    }),
  });
  const stateAction = stateController.startScan();
  await stateController.dispose();
  stateGate.resolve("PoweredOn" as State);
  await stateAction;
  expect(stateController.getSnapshot().phase).toBe("idle");
  await late.controller.dispose();
});

test("BLE scan/stop/destroy promise rejections are consumed and surface only fixed safe state", async () => {
  const startRejected = fixture({
    startScan: async () => {
      throw new Error("native peripheral identifier detail");
    },
  });
  await startRejected.controller.startScan();
  expect(startRejected.controller.getSnapshot()).toMatchObject({
    phase: "error",
    errorCode: "CONNECTION_FAILED",
  });
  await startRejected.controller.dispose();

  const stopRejected = fixture({
    stopScan: async () => {
      throw new Error("private radio detail");
    },
  });
  await stopRejected.controller.startScan();
  await expect(stopRejected.controller.stopScan()).resolves.toBeUndefined();
  await expect(stopRejected.controller.dispose()).resolves.toBeUndefined();

  const destroyRejected = fixture({
    destroy: async () => {
      throw new Error("manager implementation detail");
    },
  });
  await destroyRejected.controller.startScan();
  await expect(destroyRejected.controller.dispose()).resolves.toBeUndefined();
});

test("scan-start cancellation serializes native start/stop so an old start cannot stop a newer scan", async () => {
  const startGate = deferred<void>();
  const started = deferred<void>();
  const f = fixture({
    startScan: () => {
      started.resolve();
      return startGate.promise;
    },
  });
  const oldStart = f.controller.startScan();
  await started.promise;
  await f.controller.stopScan();
  await f.controller.startScan();
  expect(f.counts().scanStarts).toBe(1);
  startGate.resolve();
  await oldStart;
  await f.controller.startScan();
  expect(f.counts().scanStarts).toBe(2);
  await f.controller.dispose();
});

test("a delayed stop completes before a replacement scan starts", async () => {
  const stopGate = deferred<void>();
  const stopStarted = deferred<void>();
  const f = fixture({
    stopScan: () => {
      stopStarted.resolve();
      return stopGate.promise;
    },
  });
  await f.controller.startScan();
  const stopping = f.controller.stopScan();
  await stopStarted.promise;
  const replacement = f.controller.startScan();
  await Promise.resolve();
  await Promise.resolve();
  expect(f.counts().scanStarts).toBe(1);
  stopGate.resolve();
  await stopping;
  await replacement;
  expect(f.counts().scanStarts).toBe(2);
  await f.controller.dispose();
});

test("replacement manager acquisition waits for prior asynchronous manager teardown", async () => {
  const destroyGate = deferred<void>();
  const oldManager = fixture({ destroy: () => destroyGate.promise });
  await oldManager.controller.startScan();
  const disposing = oldManager.controller.dispose();

  const replacement = fixture();
  const starting = replacement.controller.startScan();
  await Promise.resolve();
  await Promise.resolve();
  expect(replacement.counts().radioLoads).toBe(0);
  destroyGate.resolve();
  await disposing;
  await starting;
  expect(replacement.counts().radioLoads).toBe(1);
  await replacement.controller.dispose();
});

test("connecting selected Helio verifies only FEE0, duplicate connect cannot orphan it, disconnect callback clears state", async () => {
  const f = fixture();
  await f.controller.startScan();
  f.emit();
  await f.controller.connect("local-id");
  expect(f.controller.getSnapshot()).toMatchObject({
    phase: "connected",
    connectedDeviceId: "local-id",
  });
  await f.controller.connect("local-id");
  expect(f.counts().cancelCount).toBe(0);
  f.disconnect();
  expect(f.controller.getSnapshot()).toMatchObject({
    phase: "idle",
    connectedDeviceId: null,
    errorCode: "DEVICE_DISCONNECTED",
  });
  await f.controller.dispose();

  const missing = fixture({ services: async () => [{ uuid: "180d" }] });
  await missing.controller.startScan();
  missing.emit();
  await missing.controller.connect("local-id");
  expect(missing.controller.getSnapshot().errorCode).toBe("HUAMI_SERVICE_MISSING");
  expect(missing.counts().cancelCount).toBe(1);
  await missing.controller.dispose();
});

test("stop/dispose during connect or services wait cancels eventual connection and suppresses stale errors", async () => {
  const connected = deferred<Device>();
  const connectStarted = deferred<void>();
  const first = fixture({
    connect: () => {
      connectStarted.resolve();
      return connected.promise;
    },
  });
  await first.controller.startScan();
  first.emit();
  const connecting = first.controller.connect("local-id");
  await connectStarted.promise;
  const firstDisconnect = first.controller.disconnect();
  connected.resolve({
    cancelConnection: async () => {
      /* cancellation acknowledged */
    },
  } as unknown as Device);
  await Promise.all([connecting, firstDisconnect]);
  expect(first.controller.getSnapshot().phase).toBe("idle");

  const services = deferred<Array<{ uuid: string }>>();
  const servicesStarted = deferred<void>();
  const second = fixture({
    services: () => {
      servicesStarted.resolve();
      return services.promise;
    },
  });
  await second.controller.startScan();
  second.emit();
  const pending = second.controller.connect("local-id");
  await servicesStarted.promise;
  const secondDisconnect = second.controller.disconnect();
  services.reject(new Error("sensitive native error"));
  await Promise.all([pending, secondDisconnect]);
  expect(second.controller.getSnapshot().errorCode).toBeNull();
  await second.controller.dispose();
});

test("pending connect is cancelled immediately; discovery failures cancel their acquired device", async () => {
  const connectGate = deferred<Device>();
  const connectStarted = deferred<void>();
  let cancelled = 0;
  const f = fixture({
    connect: () => {
      connectStarted.resolve();
      return connectGate.promise;
    },
    cancelConnection: async () => {
      cancelled += 1;
    },
  });
  await f.controller.startScan();
  f.emit();
  const connecting = f.controller.connect("local-id");
  await connectStarted.promise;
  const disconnecting = f.controller.disconnect();
  expect(cancelled).toBe(1);
  connectGate.resolve({
    cancelConnection: async () => {
      cancelled += 1;
    },
  } as unknown as Device);
  await Promise.all([connecting, disconnecting]);
  expect(cancelled).toBe(2);

  const discoveryFailure = fixture({
    discover: async () => {
      throw new Error("discovery detail");
    },
  });
  await discoveryFailure.controller.startScan();
  discoveryFailure.emit();
  await discoveryFailure.controller.connect("local-id");
  expect(discoveryFailure.counts().cancelCount).toBe(1);
  expect(discoveryFailure.controller.getSnapshot().errorCode).toBe("CONNECTION_FAILED");
  await discoveryFailure.controller.dispose();
});

test("dispose starts cancellation before waiting for a pending native connect to settle", async () => {
  const started = deferred<void>();
  const nativeConnect = deferred<Device>();
  let cancelRequested = false;
  const f = fixture({
    connect: () => {
      started.resolve();
      return nativeConnect.promise;
    },
    cancelConnection: async () => {
      cancelRequested = true;
      nativeConnect.reject(new Error("native connect cancelled"));
    },
  });
  await f.controller.startScan();
  f.emit();
  const connecting = f.controller.connect("local-id");
  await started.promise;
  await within(f.controller.dispose());
  await within(connecting);
  expect(cancelRequested).toBe(true);
  expect(f.counts().destroyed).toBe(1);
});

test("delayed disconnect only cancels detached handles and cannot reset a newer connection", async () => {
  const cancellation = deferred<void>();
  const native = { currentConnection: null as string | null };
  const first = {
    id: "same-ble-id",
    discoverAllServicesAndCharacteristics: async () => first,
    services: async () => [{ uuid: "0000fee0-0000-1000-8000-00805f9b34fb" }],
    cancelConnection: async () => {
      await cancellation.promise;
      native.currentConnection = null;
    },
  } as unknown as Device;
  const second = {
    id: "same-ble-id",
    discoverAllServicesAndCharacteristics: async () => second,
    services: async () => [{ uuid: "0000fee0-0000-1000-8000-00805f9b34fb" }],
    cancelConnection: async () => {
      native.currentConnection = null;
    },
  } as unknown as Device;
  let call = 0;
  const f = fixture({
    connect: async () => {
      const device = call++ === 0 ? first : second;
      native.currentConnection = device === first ? "old" : "new";
      return device;
    },
  });
  await f.controller.startScan();
  f.emit();
  await f.controller.connect("local-id");
  const disconnecting = f.controller.disconnect();
  const reconnecting = f.controller.connect("local-id");
  await Promise.resolve();
  await Promise.resolve();
  expect(call).toBe(1);
  expect(native.currentConnection).toBe("old");
  cancellation.resolve();
  await reconnecting;
  await disconnecting;
  expect(call).toBe(2);
  expect(native.currentConnection).toBe("new");
  expect(f.controller.getSnapshot()).toMatchObject({
    phase: "connected",
    connectedDeviceId: "local-id",
  });
  expect(f.controller.getSnapshot()).toMatchObject({
    phase: "connected",
    connectedDeviceId: "local-id",
  });
  await f.controller.dispose();
});

test("same-ID replacement waits for stale services rejection and cleanup", async () => {
  const services = deferred<Array<{ uuid: string }>>();
  const oldStarted = deferred<void>();
  const externalCancel = deferred<void>();
  let calls = 0;
  let cancelCalls = 0;
  let oldCleanupDone = false;
  const nativeConnection: { value: string | null } = { value: null };
  const oldDevice = {
    id: "same-ble-id",
    discoverAllServicesAndCharacteristics: async () => oldDevice,
    services: () => {
      oldStarted.resolve();
      return services.promise;
    },
    cancelConnection: async () => {
      cancelCalls += 1;
      if (cancelCalls === 1) await externalCancel.promise;
      else oldCleanupDone = true;
      nativeConnection.value = null;
    },
  } as unknown as Device;
  const newDevice = {
    id: "same-ble-id",
    discoverAllServicesAndCharacteristics: async () => newDevice,
    services: async () => [{ uuid: "0000fee0-0000-1000-8000-00805f9b34fb" }],
    cancelConnection: async () => {
      nativeConnection.value = null;
    },
  } as unknown as Device;
  const f = fixture({
    connect: async () => {
      const device = calls++ === 0 ? oldDevice : newDevice;
      nativeConnection.value = device === oldDevice ? "old" : "new";
      return device;
    },
  });
  await f.controller.startScan();
  f.emit();
  const oldAttempt = f.controller.connect("local-id");
  await oldStarted.promise;
  const disconnecting = f.controller.disconnect();
  const replacement = f.controller.connect("local-id");
  await Promise.resolve();
  await Promise.resolve();
  expect(calls).toBe(1);
  services.reject(new Error("old service discovery rejected"));
  await within(oldAttempt);
  expect(oldCleanupDone).toBe(true);
  expect(calls).toBe(1);
  expect(nativeConnection.value).toBeNull();
  externalCancel.resolve();
  await within(Promise.all([disconnecting, replacement]));
  expect(calls).toBe(2);
  expect(nativeConnection.value).toBe("new");
  expect(f.controller.getSnapshot()).toMatchObject({
    phase: "connected",
    connectedDeviceId: "local-id",
  });
  await f.controller.dispose();
});

test("new controller acquisition waits for disposed controller's same-ID operation cleanup and manager teardown", async () => {
  const services = deferred<Array<{ uuid: string }>>();
  const servicesStarted = deferred<void>();
  let connectCalls = 0;
  const nativeConnection: { value: string | null } = { value: null };
  const oldHandle = {
    id: "same-ble-id",
    discoverAllServicesAndCharacteristics: async () => oldHandle,
    services: () => {
      servicesStarted.resolve();
      return services.promise;
    },
    cancelConnection: async () => {
      nativeConnection.value = null;
    },
  } as unknown as Device;
  const newHandle = {
    id: "same-ble-id",
    discoverAllServicesAndCharacteristics: async () => newHandle,
    services: async () => [{ uuid: "0000fee0-0000-1000-8000-00805f9b34fb" }],
    cancelConnection: async () => {
      nativeConnection.value = null;
    },
  } as unknown as Device;
  const old = fixture({
    connect: async () => {
      connectCalls += 1;
      nativeConnection.value = "old";
      return oldHandle;
    },
  });
  await old.controller.startScan();
  old.emit();
  const oldConnection = old.controller.connect("local-id");
  await servicesStarted.promise;
  const disposing = old.controller.dispose();

  const replacement = fixture({
    connect: async () => {
      connectCalls += 1;
      nativeConnection.value = "new";
      return newHandle;
    },
  });
  const replacementScan = replacement.controller.startScan();
  await Promise.resolve();
  await Promise.resolve();
  expect(replacement.counts().radioLoads).toBe(0);
  expect(connectCalls).toBe(1);
  services.reject(new Error("disposed old service request rejected"));
  await Promise.all([oldConnection, disposing]);
  await replacementScan;
  replacement.emit();
  await replacement.controller.connect("local-id");
  expect(connectCalls).toBe(2);
  expect(nativeConnection.value).toBe("new");
  expect(replacement.controller.getSnapshot()).toMatchObject({
    phase: "connected",
    connectedDeviceId: "local-id",
  });
  await replacement.controller.dispose();
});

test("late crypto completion after dispose is ignored; native error text never becomes an error code", async () => {
  const gate = deferred<boolean>();
  const f = fixture({ cryptoTest: () => gate.promise });
  const crypto = f.controller.runCryptoSelfTest();
  await f.controller.dispose();
  gate.resolve(true);
  await crypto;
  expect(f.controller.getSnapshot().crypto.status).toBe("running");

  const bad = fixture({
    cryptoTest: async () => {
      throw new Error("MAC address and private details");
    },
  });
  await bad.controller.runCryptoSelfTest();
  expect(bad.controller.getSnapshot().crypto).toEqual({
    status: "unavailable",
    code: "CRYPTO_UNAVAILABLE",
  });
  await bad.controller.dispose();
});

test("discovers a registered non-Helio Zepp OS model and connects with its model id", async () => {
  const f = fixture({ deviceName: "Amazfit GTR 4" });
  await f.controller.startScan();
  f.emit();
  expect(f.controller.getSnapshot().devices).toEqual([
    {
      id: "local-id",
      name: "Amazfit GTR 4",
      rssi: -50,
      modelId: "amazfit_gtr_4",
      family: "zepp_os",
      serviceUuids: [],
    },
  ]);
  await f.controller.connect("local-id");
  expect(f.controller.getSnapshot()).toMatchObject({
    phase: "connected",
    connectedDeviceId: "local-id",
    connectedModelId: "amazfit_gtr_4",
  });
  f.disconnect();
  expect(f.controller.getSnapshot()).toMatchObject({
    phase: "idle",
    connectedDeviceId: null,
    connectedModelId: null,
  });
  await f.controller.dispose();
});

test("discovers a MAC-suffixed registered name and still verifies FEE0", async () => {
  const f = fixture({ deviceName: "Amazfit GTR 4 AB12" });
  await f.controller.startScan();
  f.emit();
  expect(f.controller.getSnapshot().devices[0]).toMatchObject({
    name: "Amazfit GTR 4 AB12",
    modelId: "amazfit_gtr_4",
  });
  await f.controller.connect("local-id");
  expect(f.controller.getSnapshot()).toMatchObject({
    phase: "connected",
    connectedModelId: "amazfit_gtr_4",
  });
  await f.controller.dispose();

  const missing = fixture({
    deviceName: "Amazfit GTR 4",
    services: async () => [{ uuid: "180d" }],
  });
  await missing.controller.startScan();
  missing.emit();
  await missing.controller.connect("local-id");
  expect(missing.controller.getSnapshot().errorCode).toBe("HUAMI_SERVICE_MISSING");
  expect(missing.counts().cancelCount).toBe(1);
  await missing.controller.dispose();
});

test("unknown BLE names are ignored by discovery and cannot be connected", async () => {
  const f = fixture({ deviceName: "Random Device" });
  await f.controller.startScan();
  f.emit();
  expect(f.controller.getSnapshot().devices).toEqual([]);
  await f.controller.connect("local-id");
  expect(f.controller.getSnapshot()).toMatchObject({
    phase: "error",
    connectedDeviceId: null,
    connectedModelId: null,
    errorCode: "DEVICE_NOT_DISCOVERED",
  });
  await f.controller.dispose();
});

test("Helio discovery and connection still carry the Helio model id", async () => {
  const f = fixture();
  await f.controller.startScan();
  f.emit();
  expect(f.controller.getSnapshot().devices[0]?.modelId).toBe("amazfit_helio_strap");
  await f.controller.connect("local-id");
  expect(f.controller.getSnapshot().connectedModelId).toBe("amazfit_helio_strap");
  f.disconnect();
  expect(f.controller.getSnapshot().connectedModelId).toBeNull();
  await f.controller.dispose();
});

test("discovers a Xiaomi protobuf model and reaches service-verified connected", async () => {
  const f = fixture({
    deviceName: "Xiaomi Smart Band 8 ABCD",
    services: async () => [{ uuid: "0000fe95-0000-1000-8000-00805f9b34fb" }],
  });
  await f.controller.startScan();
  f.emit();
  expect(f.controller.getSnapshot().devices[0]).toMatchObject({
    name: "Xiaomi Smart Band 8 ABCD",
    modelId: "xiaomi_mi_band_8",
    family: "xiaomi",
  });
  await f.controller.connect("local-id");
  expect(f.controller.getSnapshot()).toMatchObject({
    phase: "connected",
    connectedDeviceId: "local-id",
    connectedModelId: "xiaomi_mi_band_8",
    connectedFamily: "xiaomi",
    capabilities: { stepsHistory: true },
  });
  await f.controller.dispose();
});

test("a Xiaomi model without a Xiaomi service is rejected", async () => {
  const f = fixture({
    deviceName: "Xiaomi Smart Band 8 ABCD",
    services: async () => [{ uuid: "180d" }],
  });
  await f.controller.startScan();
  f.emit();
  await f.controller.connect("local-id");
  expect(f.controller.getSnapshot()).toMatchObject({
    phase: "error",
    connectedDeviceId: null,
    connectedModelId: null,
    errorCode: "XIAOMI_SERVICE_MISSING",
  });
  await f.controller.dispose();
});

test("a Zepp OS model still requires FEE0, not the Xiaomi service", async () => {
  const f = fixture({
    deviceName: "Amazfit GTR 4",
    services: async () => [{ uuid: "0000fe95-0000-1000-8000-00805f9b34fb" }],
  });
  await f.controller.startScan();
  f.emit();
  await f.controller.connect("local-id");
  expect(f.controller.getSnapshot().errorCode).toBe("HUAMI_SERVICE_MISSING");
  await f.controller.dispose();
});

function xiaomiDetailsFixture() {
  const fileId = {
    timestamp: 1_700_000_000,
    timezone: 8,
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
  body[14] = 0;
  const bytes = new Uint8Array(body.length + 4);
  bytes.set(body);
  const checksum = crc32(body);
  bytes[body.length] = checksum & 0xff;
  bytes[body.length + 1] = (checksum >>> 8) & 0xff;
  bytes[body.length + 2] = (checksum >>> 16) & 0xff;
  bytes[body.length + 3] = (checksum >>> 24) & 0xff;
  return { fileId, bytes };
}

test("a connected Xiaomi model fetches pages through the injected history transport", async () => {
  const { fileId, bytes } = xiaomiDetailsFixture();
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
        files.push(bytes);
      }
    },
    async nextCommand() {
      const command = commands.shift();
      if (!command) throw new Error("NO_COMMAND");
      return command;
    },
    async nextActivityFile() {
      const file = files.shift();
      if (!file) throw new Error("NO_FILE");
      return file;
    },
    async close() {},
  };
  const f = fixture({
    deviceName: "Xiaomi Smart Band 8 ABCD",
    services: async () => [{ uuid: "0000fe95-0000-1000-8000-00805f9b34fb" }],
    xiaomiHistoryTransport: () => transport,
  });
  await f.controller.startScan();
  f.emit();
  await f.controller.connect("local-id");
  const pages: HelioStepsPage[] = [];

  const result = await f.controller.fetchSteps({
    authKey: new Uint8Array(16),
    since: {
      version: 1,
      nextMinuteUtc: new Date(fileId.timestamp * 1000).toISOString(),
      offsetQuarterHours: 0,
    },
    signal: new AbortController().signal,
    onPhase: () => undefined,
    async onPage(page) {
      pages.push(page);
    },
  });

  expect(result.granularity).toBe("minute");
  expect(pages).toHaveLength(1);
  expect(pages[0]!.minutes[0]!.count).toBe(42);
  expect(f.controller.getSnapshot().connectedFamily).toBe("xiaomi");
  await f.controller.dispose();
});

test("discovers a Huawei model and reaches service-verified connected", async () => {
  const f = fixture({
    deviceName: "Huawei Band 8-ABCD",
    services: async () => [{ uuid: "0000fe86-0000-1000-8000-00805f9b34fb" }],
    characteristics: async (service) =>
      service === "0000fe86-0000-1000-8000-00805f9b34fb"
        ? [
            { uuid: "0000fe01-0000-1000-8000-00805f9b34fb" },
            { uuid: "0000fe02-0000-1000-8000-00805f9b34fb" },
          ]
        : [],
  });
  await f.controller.startScan();
  f.emit();
  expect(f.controller.getSnapshot().devices[0]).toMatchObject({
    name: "Huawei Band 8-ABCD",
    modelId: "huawei_band_8",
    family: "huawei",
  });
  await f.controller.connect("local-id");
  expect(f.controller.getSnapshot()).toMatchObject({
    phase: "connected",
    connectedDeviceId: "local-id",
    connectedModelId: "huawei_band_8",
    connectedFamily: "huawei",
  });
  await expect(
    f.controller.fetchSteps({
      authKey: new Uint8Array(16),
      since: { version: 1, nextMinuteUtc: new Date(0).toISOString(), offsetQuarterHours: 0 },
      signal: new AbortController().signal,
      onPhase: () => undefined,
      async onPage() {},
    }),
  ).rejects.toThrow("HUAWEI_HISTORY_UNSUPPORTED");
  await f.controller.dispose();
});

test("discovers a Huawei model over the Honor service", async () => {
  const honorService = "c5f0ad48-cc27-48fd-9f67-8dc8e8f4a9cb";
  const f = fixture({
    deviceName: "Honor Band 9-ABCD",
    services: async () => [{ uuid: honorService }],
    characteristics: async (service) =>
      service === honorService
        ? [
            { uuid: "2a5fc8bd-3de4-43cb-9449-354bcdeccc70" },
            { uuid: "a563d757-b216-48bc-8a0f-e8dde1f916aa" },
          ]
        : [],
  });
  await f.controller.startScan();
  f.emit();
  await f.controller.connect("local-id");
  expect(f.controller.getSnapshot()).toMatchObject({
    phase: "connected",
    connectedModelId: "honor_band_9",
    connectedFamily: "huawei",
  });
  await f.controller.dispose();
});

test("a Huawei model without a Huawei service is rejected", async () => {
  const f = fixture({
    deviceName: "Huawei Band 8-ABCD",
    services: async () => [{ uuid: "180d" }],
  });
  await f.controller.startScan();
  f.emit();
  await f.controller.connect("local-id");
  expect(f.controller.getSnapshot()).toMatchObject({
    phase: "error",
    connectedDeviceId: null,
    connectedModelId: null,
    connectedFamily: null,
    errorCode: "HUAWEI_SERVICE_MISSING",
  });
  await f.controller.dispose();
});

test("discovers a Garmin model and reaches service-verified connected", async () => {
  const f = fixture({
    deviceName: "Forerunner 965",
    services: async () => [{ uuid: "6a4e2800-667b-11e3-949a-0800200c9a66" }],
    characteristics: async (service) =>
      service === "6a4e2800-667b-11e3-949a-0800200c9a66"
        ? [
            { uuid: "6a4e2810-667b-11e3-949a-0800200c9a66" },
            { uuid: "6a4e2820-667b-11e3-949a-0800200c9a66" },
          ]
        : [],
  });
  await f.controller.startScan();
  f.emit();
  expect(f.controller.getSnapshot().devices[0]).toMatchObject({
    name: "Forerunner 965",
    modelId: "garmin_forerunner_965",
    family: "garmin",
  });
  await f.controller.connect("local-id");
  expect(f.controller.getSnapshot()).toMatchObject({
    phase: "connected",
    connectedDeviceId: "local-id",
    connectedModelId: "garmin_forerunner_965",
    connectedFamily: "garmin",
  });
  await expect(
    f.controller.fetchSteps({
      authKey: new Uint8Array(16),
      since: { version: 1, nextMinuteUtc: new Date(0).toISOString(), offsetQuarterHours: 0 },
      signal: new AbortController().signal,
      onPhase: () => undefined,
      async onPage() {},
    }),
  ).rejects.toThrow("GARMIN_HISTORY_UNSUPPORTED");
  await f.controller.dispose();
});

test("discovers a Garmin model over the v1 GFDI service", async () => {
  const f = fixture({
    deviceName: "vívoactive HR",
    services: async () => [{ uuid: "6a4e2401-667b-11e3-949a-0800200c9a66" }],
    characteristics: async (service) =>
      service === "6a4e2401-667b-11e3-949a-0800200c9a66"
        ? [
            { uuid: "6a4ecd28-667b-11e3-949a-0800200c9a66" },
            { uuid: "6a4e4c80-667b-11e3-949a-0800200c9a66" },
          ]
        : [],
  });
  await f.controller.startScan();
  f.emit();
  await f.controller.connect("local-id");
  expect(f.controller.getSnapshot()).toMatchObject({
    phase: "connected",
    connectedModelId: "garmin_vivoactive_hr",
    connectedFamily: "garmin",
  });
  await f.controller.dispose();
});

test("a Garmin wearable exposes FIT history sync; a bike computer stays connection-only", async () => {
  const garminServices = async () => [{ uuid: "6a4e2800-667b-11e3-949a-0800200c9a66" }];
  const garminCharacteristics = async (service: string) =>
    service === "6a4e2800-667b-11e3-949a-0800200c9a66"
      ? [
          { uuid: "6a4e2810-667b-11e3-949a-0800200c9a66" },
          { uuid: "6a4e2820-667b-11e3-949a-0800200c9a66" },
        ]
      : [];

  const wearable = fixture({
    deviceName: "Forerunner 965",
    services: garminServices,
    characteristics: garminCharacteristics,
  });
  await wearable.controller.startScan();
  wearable.emit();
  await wearable.controller.connect("local-id");
  expect(wearable.controller.getSnapshot().capabilities).toEqual({
    stepsHistory: true,
    liveCapture: false,
    historySync: true,
  });
  await wearable.controller.dispose();

  const bike = fixture({
    deviceName: "Edge 530",
    services: garminServices,
    characteristics: garminCharacteristics,
  });
  await bike.controller.startScan();
  bike.emit();
  await bike.controller.connect("local-id");
  expect(bike.controller.getSnapshot()).toMatchObject({
    phase: "connected",
    connectedModelId: "garmin_edge_530",
    capabilities: { stepsHistory: false, liveCapture: false, historySync: false },
  });
  await bike.controller.dispose();
});

test("a Garmin model without a Garmin service is rejected", async () => {
  const f = fixture({
    deviceName: "Forerunner 965",
    services: async () => [{ uuid: "180d" }],
  });
  await f.controller.startScan();
  f.emit();
  await f.controller.connect("local-id");
  expect(f.controller.getSnapshot()).toMatchObject({
    phase: "error",
    connectedDeviceId: null,
    connectedModelId: null,
    connectedFamily: null,
    errorCode: "GARMIN_SERVICE_MISSING",
  });
  await f.controller.dispose();
});

test("a Garmin model with only the watch-app service is rejected", async () => {
  const f = fixture({
    deviceName: "Forerunner 965",
    services: async () => [{ uuid: "6a4e8022-667b-11e3-949a-0800200c9a66" }],
    characteristics: async () => [],
  });
  await f.controller.startScan();
  f.emit();
  await f.controller.connect("local-id");
  expect(f.controller.getSnapshot()).toMatchObject({
    phase: "error",
    errorCode: "GARMIN_SERVICE_MISSING",
  });
  await f.controller.dispose();
});

test("discovers a named GATT heart-rate sensor and reaches live-capture connected", async () => {
  const f = fixture({
    deviceName: "Polar H10 ABC123",
    serviceUuids: ["180d"],
    services: async () => [{ uuid: "0000180d-0000-1000-8000-00805f9b34fb" }],
    characteristics: async (service) =>
      service === "0000180d-0000-1000-8000-00805f9b34fb"
        ? [{ uuid: "00002a37-0000-1000-8000-00805f9b34fb", isNotifiable: true }]
        : [],
  });
  await f.controller.startScan();
  f.emit();
  expect(f.controller.getSnapshot().devices[0]).toMatchObject({
    name: "Polar H10 ABC123",
    modelId: "polar_h10",
    family: "ble_gatt",
    serviceUuids: ["180d"],
  });
  await f.controller.connect("local-id");
  expect(f.controller.getSnapshot()).toMatchObject({
    phase: "connected",
    connectedModelId: "polar_h10",
    connectedFamily: "ble_gatt",
    capabilities: { stepsHistory: false, liveCapture: true },
  });
  await expect(
    f.controller.fetchSteps({
      authKey: new Uint8Array(16),
      since: { version: 1, nextMinuteUtc: new Date(0).toISOString(), offsetQuarterHours: 0 },
      signal: new AbortController().signal,
      onPhase: () => undefined,
      async onPage() {},
    }),
  ).rejects.toThrow("BLE_GATT_HISTORY_UNSUPPORTED");
  await f.controller.dispose();
});

test("discovers a generic GATT sensor by advertised service UUID only", async () => {
  const f = fixture({
    deviceName: "Unnamed strap",
    serviceUuids: ["180d"],
    services: async () => [{ uuid: "0000180d-0000-1000-8000-00805f9b34fb" }],
    characteristics: async (service) =>
      service === "0000180d-0000-1000-8000-00805f9b34fb"
        ? [{ uuid: "00002a37-0000-1000-8000-00805f9b34fb", isNotifiable: true }]
        : [],
  });
  await f.controller.startScan();
  f.emit();
  expect(f.controller.getSnapshot().devices[0]).toMatchObject({
    modelId: "generic_heart_rate_sensor",
    family: "ble_gatt",
  });
  await f.controller.connect("local-id");
  expect(f.controller.getSnapshot()).toMatchObject({
    phase: "connected",
    connectedModelId: "generic_heart_rate_sensor",
    connectedFamily: "ble_gatt",
  });
  await f.controller.dispose();
});

test("a GATT model without a measurement service is rejected", async () => {
  const f = fixture({
    deviceName: "Polar H10 ABC123",
    serviceUuids: ["180d"],
    services: async () => [{ uuid: "0000fee0-0000-1000-8000-00805f9b34fb" }],
  });
  await f.controller.startScan();
  f.emit();
  await f.controller.connect("local-id");
  expect(f.controller.getSnapshot()).toMatchObject({
    phase: "error",
    errorCode: "BLE_GATT_SERVICE_MISSING",
  });
  await f.controller.dispose();
});

test("discovers a smart scale and reaches live-capture connected", async () => {
  const weightService = "0000181d-0000-1000-8000-00805f9b34fb";
  const weightMeasurement = "00002a2f-0000-1000-8000-00805f9b34fb";
  const f = fixture({
    deviceName: "MI SCALE2",
    services: async () => [{ uuid: weightService }],
    characteristics: async (service) =>
      service === weightService ? [{ uuid: weightMeasurement, isNotifiable: true }] : [],
  });
  await f.controller.startScan();
  f.emit();
  expect(f.controller.getSnapshot().devices[0]).toMatchObject({
    name: "MI SCALE2",
    modelId: "xiaomi_smart_scale_2",
    family: "ble_scale",
  });
  await f.controller.connect("local-id");
  expect(f.controller.getSnapshot()).toMatchObject({
    phase: "connected",
    connectedDeviceId: "local-id",
    connectedModelId: "xiaomi_smart_scale_2",
    connectedFamily: "ble_scale",
    capabilities: { stepsHistory: false, liveCapture: true },
  });
  await expect(
    f.controller.fetchSteps({
      authKey: new Uint8Array(16),
      since: { version: 1, nextMinuteUtc: new Date(0).toISOString(), offsetQuarterHours: 0 },
      signal: new AbortController().signal,
      onPhase: () => undefined,
      async onPage() {},
    }),
  ).rejects.toThrow("BLE_SCALE_HISTORY_UNSUPPORTED");
  await f.controller.dispose();
});

test("a smart scale without its service is rejected", async () => {
  const f = fixture({
    deviceName: "Health Scale",
    services: async () => [{ uuid: "180d" }],
  });
  await f.controller.startScan();
  f.emit();
  await f.controller.connect("local-id");
  expect(f.controller.getSnapshot()).toMatchObject({
    phase: "error",
    connectedDeviceId: null,
    connectedFamily: null,
    errorCode: "BLE_SCALE_SERVICE_MISSING",
  });
  await f.controller.dispose();
});

test("an unimplemented scale model connects without a service claim", async () => {
  const f = fixture({
    deviceName: "F8",
    services: async () => [{ uuid: "180d" }],
  });
  await f.controller.startScan();
  f.emit();
  expect(f.controller.getSnapshot().devices[0]).toMatchObject({
    modelId: "viatom_f8",
    family: "ble_scale",
  });
  await f.controller.connect("local-id");
  expect(f.controller.getSnapshot()).toMatchObject({
    phase: "connected",
    connectedModelId: "viatom_f8",
    connectedFamily: "ble_scale",
    capabilities: { stepsHistory: false, liveCapture: true },
  });
  await f.controller.dispose();
});

test("discovers a Colmi ring and reports history sync on connection", async () => {
  const f = fixture({
    deviceName: "R02_1A2B",
    services: async () => [{ uuid: COLMI_V1_SERVICE_UUID }, { uuid: COLMI_V2_SERVICE_UUID }],
    characteristics: async (service) =>
      service === COLMI_V1_SERVICE_UUID
        ? [
            { uuid: COLMI_V1_WRITE_UUID, isNotifiable: false },
            { uuid: COLMI_V1_NOTIFY_UUID, isNotifiable: true },
          ]
        : service === COLMI_V2_SERVICE_UUID
          ? [
              { uuid: COLMI_V2_COMMAND_UUID, isNotifiable: false },
              { uuid: COLMI_V2_NOTIFY_UUID, isNotifiable: true },
            ]
          : [],
  });
  await f.controller.startScan();
  f.emit();
  expect(f.controller.getSnapshot().devices[0]).toMatchObject({
    name: "R02_1A2B",
    modelId: "colmi_r02",
    family: "colmi_ring",
  });
  await f.controller.connect("local-id");
  expect(f.controller.getSnapshot()).toMatchObject({
    phase: "connected",
    connectedDeviceId: "local-id",
    connectedModelId: "colmi_r02",
    connectedFamily: "colmi_ring",
    capabilities: { stepsHistory: false, liveCapture: false, historySync: true },
  });
  await expect(
    f.controller.fetchSteps({
      authKey: new Uint8Array(16),
      since: { version: 1, nextMinuteUtc: new Date(0).toISOString(), offsetQuarterHours: 0 },
      signal: new AbortController().signal,
      onPhase: () => undefined,
      async onPage() {},
    }),
  ).rejects.toThrow("COLMI_RING_HISTORY_UNSUPPORTED");
  await f.controller.dispose();
});

test("discovers a legacy Huami watch and reports exact-minute steps", async () => {
  const f = fixture({
    deviceName: "Amazfit Bip U",
    services: async () => [{ uuid: HUAMI_SERVICE_UUID }],
    characteristics: async (service) =>
      service === HUAMI_SERVICE_UUID
        ? [
            { uuid: HUAMI_ACTIVITY_CONTROL_UUID },
            { uuid: HUAMI_ACTIVITY_DATA_UUID },
            { uuid: HUAMI_AUTH_UUID },
          ]
        : [],
  });
  await f.controller.startScan();
  f.emit();
  expect(f.controller.getSnapshot().devices[0]).toMatchObject({
    name: "Amazfit Bip U",
    modelId: "amazfit_bip_u",
    family: "huami_legacy",
  });
  await f.controller.connect("local-id");
  expect(f.controller.getSnapshot()).toMatchObject({
    phase: "connected",
    connectedDeviceId: "local-id",
    connectedModelId: "amazfit_bip_u",
    connectedFamily: "huami_legacy",
    capabilities: { stepsHistory: true, liveCapture: false, historySync: true },
  });
  await f.controller.dispose();
});

test("a legacy Huami watch without the FEE0 service is rejected", async () => {
  const f = fixture({ deviceName: "Amazfit Bip U", services: async () => [] });
  await f.controller.startScan();
  f.emit();
  await f.controller.connect("local-id");
  expect(f.controller.getSnapshot()).toMatchObject({
    phase: "error",
    connectedDeviceId: null,
    connectedFamily: null,
    errorCode: "HUAMI_LEGACY_SERVICE_MISSING",
  });
  await f.controller.dispose();
});

test("a ring without the V1 service is rejected", async () => {
  const f = fixture({
    deviceName: "R02_1A2B",
    services: async () => [{ uuid: COLMI_V2_SERVICE_UUID }],
  });
  await f.controller.startScan();
  f.emit();
  await f.controller.connect("local-id");
  expect(f.controller.getSnapshot()).toMatchObject({
    phase: "error",
    connectedDeviceId: null,
    connectedFamily: null,
    errorCode: "COLMI_RING_SERVICE_MISSING",
  });
  await f.controller.dispose();
});

test("discovers a Bangle.js watch and reports history sync on connection", async () => {
  const f = fixture({
    deviceName: "Bangle.js 2",
    services: async () => [{ uuid: BANGLE_JS_SERVICE_UUID }],
    characteristics: async (service) =>
      service === BANGLE_JS_SERVICE_UUID
        ? [
            { uuid: BANGLE_JS_TX_UUID, isNotifiable: false },
            { uuid: BANGLE_JS_RX_UUID, isNotifiable: true },
          ]
        : [],
  });
  await f.controller.startScan();
  f.emit();
  expect(f.controller.getSnapshot().devices[0]).toMatchObject({
    name: "Bangle.js 2",
    modelId: "bangle_js_2",
    family: "bangle_js",
  });
  await f.controller.connect("local-id");
  expect(f.controller.getSnapshot()).toMatchObject({
    phase: "connected",
    connectedDeviceId: "local-id",
    connectedModelId: "bangle_js_2",
    connectedFamily: "bangle_js",
    capabilities: { stepsHistory: false, liveCapture: false, historySync: true },
  });
  await expect(
    f.controller.fetchSteps({
      authKey: new Uint8Array(16),
      since: { version: 1, nextMinuteUtc: new Date(0).toISOString(), offsetQuarterHours: 0 },
      signal: new AbortController().signal,
      onPhase: () => undefined,
      async onPage() {},
    }),
  ).rejects.toThrow("BANGLE_JS_HISTORY_UNSUPPORTED");
  await f.controller.dispose();
});

test("a Bangle.js watch is matched by the Nordic UART service when it has no name", async () => {
  const f = fixture({
    deviceName: "",
    serviceUuids: [BANGLE_JS_SERVICE_UUID],
    services: async () => [{ uuid: BANGLE_JS_SERVICE_UUID }],
    characteristics: async (service) =>
      service === BANGLE_JS_SERVICE_UUID
        ? [{ uuid: BANGLE_JS_TX_UUID }, { uuid: BANGLE_JS_RX_UUID }]
        : [],
  });
  await f.controller.startScan();
  f.emit();
  expect(f.controller.getSnapshot().devices[0]).toMatchObject({
    modelId: "bangle_js_1",
    family: "bangle_js",
  });
  await f.controller.dispose();
});

test("a Bangle.js watch without the Nordic UART service is rejected", async () => {
  const f = fixture({
    deviceName: "Bangle.js 2",
    services: async () => [{ uuid: "0000180d-0000-1000-8000-00805f9b34fb" }],
  });
  await f.controller.startScan();
  f.emit();
  await f.controller.connect("local-id");
  expect(f.controller.getSnapshot()).toMatchObject({
    phase: "error",
    connectedDeviceId: null,
    connectedFamily: null,
    errorCode: "BANGLE_JS_SERVICE_MISSING",
  });
  await f.controller.dispose();
});

test("discovers a PineTime as a live heart-rate sensor", async () => {
  const f = fixture({
    deviceName: "InfiniTime",
    services: async () => [{ uuid: "180d" }],
    characteristics: async (service) =>
      service.toLowerCase().includes("180d")
        ? [{ uuid: "00002a37-0000-1000-8000-00805f9b34fb", isNotifiable: true }]
        : [],
  });
  await f.controller.startScan();
  f.emit();
  expect(f.controller.getSnapshot().devices[0]).toMatchObject({
    modelId: "pinetime_p8",
    family: "ble_gatt",
  });
  await f.controller.connect("local-id");
  expect(f.controller.getSnapshot()).toMatchObject({
    phase: "connected",
    connectedModelId: "pinetime_p8",
    connectedFamily: "ble_gatt",
    capabilities: { stepsHistory: false, liveCapture: true, historySync: false },
  });
  await f.controller.dispose();
});

test("a capture that ends cancelled without the caller aborting is reported as a lost link", async () => {
  const sessions = fakePebbleSessions();
  const f = fixture({
    deviceName: "Pebble 1A2B",
    services: PEBBLE_SERVICES,
    createPebbleSession: sessions.factory,
  });
  await f.controller.startScan();
  f.emit();
  await f.controller.connect("local-id");
  sessions.setCapture(async () => ({ status: "cancelled" }));
  await expect(
    f.controller.capturePebble({
      signal: new AbortController().signal,
      sink: async () => ({ durable: true, insertedItems: 0, throughSeq: 0 }),
    }),
  ).resolves.toEqual({ status: "failed", code: "PEBBLE_LINK_LOST" });
  await f.controller.dispose();
});
