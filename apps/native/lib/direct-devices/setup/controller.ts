import type { BleManager, Device, State, Subscription } from "react-native-ble-plx";

import type { HelioSetupController, HelioSetupSnapshot } from "./types";
import { NativeHelioLink } from "../transport/helio-link";
import { runHelioStepsHistory } from "../protocol/history";
import { matchDeviceName } from "../models/zepp-os";
import { matchXiaomiDeviceName } from "../models/xiaomi";
import { XIAOMI_BLE_SERVICE_UUIDS } from "../transport/xiaomi-link";

type Radio = {
  manager: Pick<
    BleManager,
    | "state"
    | "onStateChange"
    | "startDeviceScan"
    | "stopDeviceScan"
    | "destroy"
    | "onDeviceDisconnected"
    | "cancelTransaction"
  >;
  devices: Map<string, Device>;
};
type Runtime = {
  platform: string;
  version: number;
  requestPermissions(permissions: string[]): Promise<Record<string, string>>;
  granted: string;
};
type Deps = {
  platform?: string;
  runtime?: () => Runtime;
  loadRadio?: () => Radio;
  cryptoTest?: () => Promise<boolean>;
  scanTimeoutMs?: number;
  readyTimeoutMs?: number;
};
type NativeDeviceLease = {
  operationDone: Promise<void>;
  finishOperation(): void;
  released: Promise<void>;
  release(): void;
  held: boolean;
  cleanupOwned: boolean;
};

const initial: HelioSetupSnapshot = Object.freeze({
  phase: "idle",
  bluetooth: "unknown",
  devices: Object.freeze([]),
  connectedDeviceId: null,
  connectedModelId: null,
  errorCode: null,
  crypto: Object.freeze({ status: "not_checked", code: null }),
});
const FEE0 = "0000fee0-0000-1000-8000-00805f9b34fb";
let managerTeardownBarrier: Promise<void> = Promise.resolve();
const nativeDeviceLeases = new Map<string, NativeDeviceLease>();

async function acquireNativeDeviceLease(
  deviceId: string,
  active: () => boolean,
  cancelled: Promise<void>,
): Promise<NativeDeviceLease | null> {
  while (true) {
    const existing = nativeDeviceLeases.get(deviceId);
    if (existing) {
      const result = await Promise.race([
        existing.released.then(() => "released" as const),
        cancelled.then(() => "cancelled" as const),
      ]);
      if (result === "cancelled" || !active()) return null;
      continue;
    }
    if (!active()) return null;
    let finishOperation!: () => void;
    let finishReleased!: () => void;
    const operationDone = new Promise<void>((resolve) => {
      finishOperation = resolve;
    });
    const released = new Promise<void>((resolve) => {
      finishReleased = resolve;
    });
    const lease: NativeDeviceLease = {
      operationDone,
      finishOperation,
      released,
      held: false,
      cleanupOwned: false,
      release() {
        if (nativeDeviceLeases.get(deviceId) !== lease) return;
        nativeDeviceLeases.delete(deviceId);
        finishReleased();
      },
    };
    nativeDeviceLeases.set(deviceId, lease);
    return lease;
  }
}

export function createHelioSetupController(deps: Deps = {}): HelioSetupController {
  const listeners = new Set<() => void>();
  let snapshot = initial;
  let radio: Radio | null = null;
  let stateSubscription: Subscription | null = null;
  let disconnectSubscription: Subscription | null = null;
  let connected: Device | null = null;
  let connecting: Device | null = null;
  let connectionAttempt: object | null = null;
  let connectingLease: NativeDeviceLease | null = null;
  let connectedLease: NativeDeviceLease | null = null;
  let connectionCompletion: Promise<void> | null = null;
  let cancelLeaseWait: (() => void) | null = null;
  let generation = 0;
  let busy = false;
  let disposed = false;
  let scanRequested = false;
  let scanToken: object | null = null;
  let scanStartPending = false;
  let scanStartCompletion: Promise<void> | null = null;
  let scanControlBarrier: Promise<void> = Promise.resolve();
  let scanTimer: ReturnType<typeof setTimeout> | null = null;
  let cancelReadyWait: (() => void) | null = null;
  let historyAbort: AbortController | null = null;
  let historyCompletion: Promise<import("../protocol/types").HelioHistoryResult> | null = null;

  const publish = (patch: Partial<HelioSetupSnapshot>) => {
    snapshot = Object.freeze({ ...snapshot, ...patch });
    for (const listener of listeners) listener();
  };
  const stopRadioScan = async () => {
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = null;
    const manager = radio?.manager;
    if (manager) {
      const stopping = scanControlBarrier
        .then(() => manager.stopDeviceScan())
        .catch(() => undefined);
      scanControlBarrier = stopping;
      await stopping;
    }
  };
  const clearStateSubscription = () => {
    stateSubscription?.remove();
    stateSubscription = null;
  };
  const cancelReadiness = () => {
    cancelReadyWait?.();
    cancelReadyWait = null;
  };
  const runtime = (): Runtime => (deps.runtime ? deps.runtime() : loadRuntime());
  const ensureRadio = async (): Promise<Radio> => {
    if ((deps.platform ?? ("document" in globalThis ? "web" : "native")) === "web")
      throw new Error("UNSUPPORTED");
    await managerTeardownBarrier;
    if (disposed) throw new Error("CANCELLED");
    if (!radio) radio = deps.loadRadio ? deps.loadRadio() : loadBlePlx();
    return radio;
  };
  const operation = async (work: (generationAtStart: number) => Promise<void>) => {
    if (disposed || busy) return;
    busy = true;
    const current = ++generation;
    try {
      await work(current);
    } finally {
      if (current === generation) busy = false;
    }
  };

  const controller: HelioSetupController = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async startScan() {
      if (disposed || busy || scanStartPending || connected || scanRequested) return;
      busy = true;
      scanRequested = true;
      const token = {};
      scanToken = token;
      const current = ++generation;
      try {
        const native = deps.platform ? null : runtime();
        const platform = deps.platform ?? native!.platform;
        if (platform === "android") {
          const android = native ?? runtime();
          const required =
            android.version >= 31
              ? [
                  "android.permission.BLUETOOTH_SCAN",
                  "android.permission.BLUETOOTH_CONNECT",
                  "android.permission.ACCESS_COARSE_LOCATION",
                  "android.permission.ACCESS_FINE_LOCATION",
                ]
              : ["android.permission.ACCESS_FINE_LOCATION"];
          const results = await android.requestPermissions(required);
          if (current !== generation || disposed) return;
          if (required.some((permission) => results[permission] !== android.granted))
            throw new Error("PERMISSION_DENIED");
        }
        if (current !== generation || disposed) return;
        const r = await ensureRadio();
        if (current !== generation || disposed) return;
        const state = await waitUntilPoweredOn(
          r,
          () => current === generation && !disposed,
          deps.readyTimeoutMs ?? 10000,
          (cancel) => {
            cancelReadyWait = cancel;
          },
        );
        if (current !== generation || disposed) return;
        if (state !== "PoweredOn") {
          publish({
            bluetooth: bluetoothState(state),
            phase: "error",
            errorCode: bluetoothErrorCode(state),
          });
          busy = false;
          scanRequested = false;
          scanToken = null;
          return;
        }
        publish({
          bluetooth: "powered_on",
          phase: "scanning",
          devices: Object.freeze([]),
          errorCode: null,
        });
        stateSubscription = r.manager.onStateChange((next) => {
          if (disposed || current !== generation) return;
          publish({ bluetooth: bluetoothState(next) });
        }, false);
        await scanControlBarrier;
        if (current !== generation || disposed || !scanRequested) return;
        scanStartPending = true;
        const nativeStart = r.manager.startDeviceScan(
          null,
          { allowDuplicates: false },
          (error, device) => {
            if (disposed || current !== generation) return;
            if (error) {
              void stopRadioScan();
              clearStateSubscription();
              busy = false;
              scanRequested = false;
              scanToken = null;
              publish({ phase: "error", errorCode: "SCAN_FAILED" });
              return;
            }
            if (!device || !device.name) return;
            const zeppModel = matchDeviceName(device.name);
            const xiaomiModel = zeppModel ? null : matchXiaomiDeviceName(device.name);
            const model = zeppModel ?? xiaomiModel;
            if (!model) return;
            const family = zeppModel ? "zepp_os" : "xiaomi";
            r.devices.set(device.id, device);
            const found = new Map(snapshot.devices.map((item) => [item.id, item]));
            found.set(
              device.id,
              Object.freeze({
                id: device.id,
                name: device.name,
                rssi: device.rssi ?? null,
                modelId: model.id,
                family,
              }),
            );
            publish({ devices: Object.freeze([...found.values()]) });
          },
        );
        scanStartCompletion = nativeStart;
        try {
          await nativeStart;
        } finally {
          if (scanStartCompletion === nativeStart) scanStartCompletion = null;
        }
        if (current !== generation || disposed || !scanRequested) {
          await stopRadioScan();
          scanStartPending = false;
          return;
        }
        scanStartPending = false;
        scanTimer = setTimeout(() => {
          if (current === generation)
            void stopRadioScan().then(() => {
              if (current !== generation || disposed) return;
              clearStateSubscription();
              publish({ phase: "idle" });
              busy = false;
              scanRequested = false;
              scanToken = null;
            });
        }, deps.scanTimeoutMs ?? 12000);
      } catch (error) {
        if (scanToken === token) {
          scanStartPending = false;
          scanStartCompletion = null;
          scanToken = null;
        }
        if (current === generation && !disposed) {
          await stopRadioScan();
          if (current !== generation || disposed) return;
          clearStateSubscription();
          publish({
            phase: "error",
            bluetooth:
              errorCode(error) === "UNSUPPORTED"
                ? "unsupported"
                : errorCode(error) === "PERMISSION_DENIED"
                  ? "unauthorized"
                  : snapshot.bluetooth,
            errorCode: safeCode(error),
          });
          busy = false;
          scanRequested = false;
          scanToken = null;
        }
      }
    },
    async stopScan() {
      if (!scanRequested) return;
      scanRequested = false;
      scanToken = null;
      ++generation;
      busy = false;
      cancelReadiness();
      const current = generation;
      clearStateSubscription();
      await stopRadioScan();
      if (!disposed && current === generation && !scanRequested && snapshot.phase === "scanning")
        publish({ phase: "idle" });
    },
    async connect(deviceId) {
      if (snapshot.phase === "scanning") {
        const beforeStop = generation;
        await controller.stopScan();
        if (disposed || generation !== beforeStop + 1) return;
      }
      if (disposed || busy || connected) return;
      const work = operation(async (current) => {
        let ownedDevice: Device | null = null;
        let lease: NativeDeviceLease | null = null;
        const attempt = {};
        try {
          const r = await ensureRadio();
          if (current !== generation || disposed) return;
          const selected = r.devices.get(deviceId);
          const knownDevice = snapshot.devices.find((device) => device.id === deviceId);
          if (!selected || !knownDevice) throw new Error("DEVICE_NOT_DISCOVERED");
          const model =
            matchDeviceName(knownDevice.name) ?? matchXiaomiDeviceName(knownDevice.name);
          if (!model) throw new Error("DEVICE_NOT_DISCOVERED");
          const family =
            knownDevice.family ?? (matchDeviceName(knownDevice.name) ? "zepp_os" : "xiaomi");
          await stopRadioScan();
          if (current !== generation || disposed) return;
          let cancelWait!: () => void;
          const cancelled = new Promise<void>((resolve) => {
            cancelWait = resolve;
          });
          cancelLeaseWait = cancelWait;
          lease = await acquireNativeDeviceLease(
            deviceId,
            () => current === generation && !disposed,
            cancelled,
          );
          if (cancelLeaseWait === cancelWait) cancelLeaseWait = null;
          if (!lease) return;
          if (current !== generation || disposed) return;
          publish({ phase: "connecting", errorCode: null });
          connectionAttempt = attempt;
          connectingLease = lease;
          connecting = selected;
          ownedDevice = selected;
          let device = await selected.connect();
          ownedDevice = device;
          if (connectionAttempt === attempt) connecting = device;
          if (current !== generation || disposed) {
            await device.cancelConnection();
            return;
          }
          device = await device.discoverAllServicesAndCharacteristics();
          ownedDevice = device;
          const discovered = device;
          if (current !== generation || disposed) {
            await discovered.cancelConnection();
            return;
          }
          if (connectionAttempt === attempt) connecting = discovered;
          const services = await discovered.services();
          if (current !== generation || disposed) {
            await discovered.cancelConnection();
            return;
          }
          const hasRequiredService =
            family === "xiaomi"
              ? services.some((service) => XIAOMI_BLE_SERVICE_UUIDS.has(service.uuid.toLowerCase()))
              : services.some((service) => service.uuid.toLowerCase() === FEE0);
          if (!hasRequiredService)
            throw new Error(
              family === "xiaomi" ? "XIAOMI_SERVICE_MISSING" : "HUAMI_SERVICE_MISSING",
            );
          disconnectSubscription = r.manager.onDeviceDisconnected(discovered.id, () => {
            if (disposed || connected !== discovered || current !== generation) return;
            connected = null;
            connectedLease = null;
            disconnectSubscription?.remove();
            disconnectSubscription = null;
            if (lease) {
              lease.cleanupOwned = true;
              void lease.operationDone.then(() => lease?.release());
            }
            publish({
              phase: "idle",
              connectedDeviceId: null,
              connectedModelId: null,
              errorCode: "DEVICE_DISCONNECTED",
            });
          });
          connected = discovered;
          lease.held = true;
          connectedLease = lease;
          ownedDevice = null;
          connecting = null;
          connectingLease = null;
          connectionAttempt = null;
          publish({
            phase: "connected",
            connectedDeviceId: deviceId,
            connectedModelId: model.id,
            bluetooth: "powered_on",
          });
        } catch (error) {
          if (connectionAttempt === attempt) {
            connecting = null;
            connectingLease = null;
            connectionAttempt = null;
          }
          if (ownedDevice) await ownedDevice.cancelConnection().catch(() => undefined);
          if (current === generation && !disposed)
            publish({
              phase: "error",
              connectedDeviceId: null,
              connectedModelId: null,
              errorCode: safeCode(error),
            });
        } finally {
          lease?.finishOperation();
          if (lease && !lease.held && !lease.cleanupOwned) lease.release();
        }
      });
      connectionCompletion = work;
      try {
        await work;
      } finally {
        if (connectionCompletion === work) connectionCompletion = null;
      }
    },
    async disconnect() {
      historyAbort?.abort();
      const pendingHistory = historyCompletion;
      ++generation;
      busy = false;
      scanRequested = false;
      cancelReadiness();
      cancelLeaseWait?.();
      cancelLeaseWait = null;
      const stopPromise = stopRadioScan();
      clearStateSubscription();
      disconnectSubscription?.remove();
      disconnectSubscription = null;
      const current = generation;
      const handles = new Set(
        [connecting, connected].filter((device): device is Device => device !== null),
      );
      const leases = new Set(
        [connectingLease, connectedLease].filter(
          (lease): lease is NativeDeviceLease => lease !== null,
        ),
      );
      const pendingConnection = connectionCompletion;
      for (const lease of leases) lease.cleanupOwned = true;
      connecting = null;
      connected = null;
      connectionAttempt = null;
      connectingLease = null;
      connectedLease = null;
      const cancellations = [...handles].map(cancelDevice);
      await Promise.all([
        stopPromise,
        ...cancellations,
        pendingConnection?.catch(() => undefined),
        pendingHistory?.catch(() => undefined),
      ]);
      for (const lease of leases) lease.release();
      if (!disposed && current === generation)
        publish({ phase: "idle", connectedDeviceId: null, connectedModelId: null });
    },
    async runCryptoSelfTest() {
      if (disposed) return;
      const current = generation;
      publish({ crypto: Object.freeze({ status: "running", code: null }) });
      try {
        const testCrypto =
          deps.cryptoTest ??
          (async () => {
            const { runB163CryptoSelfTest } =
              require("../crypto/self-test") as typeof import("../crypto/self-test");
            return runB163CryptoSelfTest();
          });
        const passed = await testCrypto();
        if (current === generation && !disposed)
          publish({
            crypto: Object.freeze({
              status: passed ? "passed" : "failed",
              code: passed ? null : "CRYPTO_VECTOR_MISMATCH",
            }),
          });
      } catch {
        if (current === generation && !disposed)
          publish({ crypto: Object.freeze({ status: "unavailable", code: "CRYPTO_UNAVAILABLE" }) });
      }
    },
    async fetchSteps(options) {
      if (disposed) throw new Error("CANCELLED");
      if (!connected) throw new Error("NOT_CONNECTED");
      if (historyCompletion) throw new Error("HISTORY_BUSY");
      const device = connected;
      const abortController = new AbortController();
      historyAbort = abortController;
      const forwardAbort = () => abortController.abort();
      options.signal.addEventListener("abort", forwardAbort, { once: true });
      const linked = { ...options, signal: abortController.signal };
      const workLink = new NativeHelioLink(device, radio?.manager);
      const work = runHelioStepsHistory(workLink, linked).finally(() => workLink.close());
      historyCompletion = work;
      try {
        return await work;
      } finally {
        options.signal.removeEventListener("abort", forwardAbort);
        if (historyCompletion === work) historyCompletion = null;
        if (historyAbort === abortController) historyAbort = null;
      }
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      ++generation;
      busy = false;
      scanRequested = false;
      scanToken = null;
      cancelReadiness();
      historyAbort?.abort();
      const pendingHistory = historyCompletion;
      cancelLeaseWait?.();
      cancelLeaseWait = null;
      clearStateSubscription();
      disconnectSubscription?.remove();
      disconnectSubscription = null;
      const handles = new Set(
        [connecting, connected].filter((device): device is Device => device !== null),
      );
      const leases = new Set(
        [connectingLease, connectedLease].filter(
          (lease): lease is NativeDeviceLease => lease !== null,
        ),
      );
      const pendingConnection = connectionCompletion;
      for (const lease of leases) lease.cleanupOwned = true;
      connecting = null;
      connected = null;
      connectionAttempt = null;
      connectingLease = null;
      connectedLease = null;
      const cancellations = [...handles].map(cancelDevice);
      const pendingStop = stopRadioScan();
      const ownedRadio = radio;
      radio = null;
      listeners.clear();
      if (ownedRadio) {
        const pendingStart = scanStartCompletion;
        const teardown = managerTeardownBarrier.then(async () => {
          await pendingStart?.catch(() => undefined);
          await pendingStop;
          await pendingConnection?.catch(() => undefined);
          await pendingHistory?.catch(() => undefined);
          await Promise.all(cancellations);
          await ownedRadio.manager.destroy();
          for (const lease of leases) lease.release();
        });
        managerTeardownBarrier = teardown.catch(() => undefined);
        await managerTeardownBarrier;
      } else {
        await pendingConnection?.catch(() => undefined);
        await pendingHistory?.catch(() => undefined);
        await Promise.all(cancellations);
        for (const lease of leases) lease.release();
      }
    },
  };
  return controller;
}

function loadBlePlx(): Radio {
  // Native BLE module is deliberately required only after an explicit scan/connect action.
  const { BleManager } = require("react-native-ble-plx") as typeof import("react-native-ble-plx");
  return { manager: new BleManager(), devices: new Map() };
}
function cancelDevice(device: Device): Promise<void> {
  try {
    return device
      .cancelConnection()
      .then(() => undefined)
      .catch(() => undefined);
  } catch {
    return Promise.resolve();
  }
}
function loadRuntime(): Runtime {
  const { Platform, PermissionsAndroid } = require("react-native") as typeof import("react-native");
  return {
    platform: Platform.OS,
    version: Number(Platform.Version),
    granted: PermissionsAndroid.RESULTS.GRANTED,
    requestPermissions: (permissions) =>
      PermissionsAndroid.requestMultiple(permissions as never) as Promise<Record<string, string>>,
  };
}
async function waitUntilPoweredOn(
  radio: Radio,
  active: () => boolean,
  timeoutMs: number,
  registerCancel: (cancel: (() => void) | null) => void,
): Promise<State> {
  const current = await radio.manager.state();
  if (!active()) throw new Error("CANCELLED");
  if (current === "PoweredOn" || ["PoweredOff", "Unauthorized", "Unsupported"].includes(current))
    return current;
  return new Promise<State>((resolve, reject) => {
    let settled = false;
    let subscription: Subscription | null = null;
    let timer: ReturnType<typeof setTimeout>;
    const finish = (state?: State, error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      subscription?.remove();
      registerCancel(null);
      if (error) reject(error);
      else if (state) resolve(state);
      else reject(new Error("BLUETOOTH_STATE_TIMEOUT"));
    };
    registerCancel(() => finish(undefined, new Error("CANCELLED")));
    timer = setTimeout(() => finish(undefined, new Error("BLUETOOTH_STATE_TIMEOUT")), timeoutMs);
    subscription = radio.manager.onStateChange((state) => {
      if (!active()) {
        finish(undefined, new Error("CANCELLED"));
        return;
      }
      if (["PoweredOn", "PoweredOff", "Unauthorized", "Unsupported"].includes(state)) finish(state);
    }, true);
    if (settled) subscription.remove();
  });
}
function bluetoothState(state: State): HelioSetupSnapshot["bluetooth"] {
  return (
    (
      {
        PoweredOn: "powered_on",
        PoweredOff: "powered_off",
        Unauthorized: "unauthorized",
        Unsupported: "unsupported",
      } as const
    )[state as "PoweredOn"] ?? "unknown"
  );
}
function bluetoothErrorCode(state: State): string {
  if (state === "Unauthorized") return "BLUETOOTH_UNAUTHORIZED";
  if (state === "Unsupported") return "BLUETOOTH_UNSUPPORTED";
  return "BLUETOOTH_POWERED_OFF";
}
function errorCode(error: unknown): string {
  return error instanceof Error ? error.message : "";
}
function safeCode(error: unknown): string {
  const code = errorCode(error);
  return SAFE_CODES.has(code) ? code : "CONNECTION_FAILED";
}
const SAFE_CODES = new Set([
  "UNSUPPORTED",
  "PERMISSION_DENIED",
  "CANCELLED",
  "DEVICE_NOT_DISCOVERED",
  "HUAMI_SERVICE_MISSING",
  "XIAOMI_SERVICE_MISSING",
  "BLUETOOTH_STATE_TIMEOUT",
  "SCAN_FAILED",
  "CONNECTION_FAILED",
]);
