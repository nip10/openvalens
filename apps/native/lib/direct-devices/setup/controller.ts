import type { BleManager, Device, State, Subscription } from "react-native-ble-plx";

import type {
  DirectDeviceFamily,
  DirectDeviceHistorySample,
  DirectDeviceLiveSample,
  HelioSetupController,
  HelioSetupSnapshot,
} from "./types";
import { NativeHelioLink } from "../transport/helio-link";
import { runHelioStepsHistory } from "../protocol/history";
import { matchDeviceName } from "../models/zepp-os";
import { matchXiaomiDeviceName } from "../models/xiaomi";
import { matchHuaweiDeviceName } from "../models/huawei";
import { matchGarminDeviceName } from "../models/garmin";
import { matchBleGattDevice, normalizeServiceUuid } from "../models/ble-gatt";
import { matchBangleJsDevice } from "../models/bangle-js";
import { matchBleScaleDevice } from "../models/ble-scale";
import { COLMI_V1_SERVICE_UUID, matchColmiRingDevice } from "../models/colmi-ring";
import { matchGloryFitDevice } from "../models/gloryfit";
import { selectXiaomiProfile, XIAOMI_BLE_SERVICE_UUIDS } from "../transport/xiaomi-link";
import type { XiaomiBleProfile } from "../transport/xiaomi-link";
import { HUAWEI_BLE_SERVICE_UUIDS, selectHuaweiProfile } from "../transport/huawei-link";
import type { HuaweiBleProfile } from "../transport/huawei-link";
import { GARMIN_BLE_SERVICE_UUIDS, selectGarminProfile } from "../transport/garmin-link";
import type { GarminBleProfile } from "../transport/garmin-link";
import {
  BLE_GATT_SERVICE_UUIDS,
  BleGattSession,
  selectBleGattProfiles,
} from "../transport/ble-gatt-sensors";
import type { BleGattProfile } from "../transport/ble-gatt-sensors";
import { createBleScaleSession, selectBleScaleProfile } from "../transport/ble-scale";
import type { BleScaleProfile, BleScaleSession } from "../transport/ble-scale";
import { createColmiRingSession, selectColmiRingProfile } from "../transport/colmi-ring";
import type { ColmiRingProfile, ColmiRingSession } from "../transport/colmi-ring";
import {
  GLORYFIT_SERVICE_UUIDS,
  createGloryFitSession,
  selectGloryFitProfile,
} from "../transport/gloryfit";
import type { GloryFitProfile, GloryFitSession } from "../transport/gloryfit";
import {
  BANGLE_JS_SERVICE_UUIDS,
  createBangleJsSession,
  selectBangleJsProfile,
} from "../transport/bangle-js";
import type { BangleJsProfile, BangleJsSession } from "../transport/bangle-js";
import { MOYOUNG_SERVICE_UUID, matchMoyoungDevice } from "../models/moyoung";
import { createMoyoungSession, selectMoyoungProfile } from "../transport/moyoung";
import type { MoyoungProfile, MoyoungSession } from "../transport/moyoung";
import { FITPRO_SERVICE_UUID, matchFitProDevice } from "../models/fitpro";
import { createFitProSession, selectFitProProfile } from "../transport/fitpro";
import type { FitProProfile, FitProSession } from "../transport/fitpro";
import { createHuamiLegacySession, selectHuamiLegacyProfile } from "../transport/huami-legacy";
import { createGarminSession, type GarminSession } from "../transport/garmin";
import type { HuamiLegacyProfile, HuamiLegacySession } from "../transport/huami-legacy";
import { HUAMI_SERVICE_UUID, matchHuamiLegacyDevice } from "../models/huami-legacy";
import { createHuaweiSession } from "../transport/huawei";
import type { HuaweiSession } from "../transport/huawei";
import { createNativeXiaomiHistoryTransport } from "../transport/xiaomi-session";
import { runXiaomiStepsHistory } from "../protocol/xiaomi-history";
import type { XiaomiHistoryTransport } from "../protocol/xiaomi-history";
import type { HelioHistoryOptions } from "../protocol/types";
import { BANGLE_JS_MTU_REQUEST } from "../protocol/bangle-js";

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
  /** Test seam for the Xiaomi history runner; production uses the BLE transport. */
  xiaomiHistoryTransport?: (
    device: Device,
    profile: XiaomiBleProfile,
    options: HelioHistoryOptions,
  ) => XiaomiHistoryTransport;
  /**
   * Receives live GATT/scale samples while a connection-based device is
   * connected. The sync controller supplies this to persist captures; without
   * it the session is not started (there is nothing to deliver samples to).
   */
  onLiveSample?: (sample: DirectDeviceLiveSample) => void;
  /**
   * Receives history-sync records (rings fetch stored history on connection).
   * Without it the ring session is not started.
   */
  onHistorySample?: (sample: DirectDeviceHistorySample) => void;
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
  connectedFamily: null,
  capabilities: Object.freeze({ stepsHistory: false, liveCapture: false, historySync: false }),
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
  let connectedFamily: DirectDeviceFamily | null = null;
  let connectedProfile: XiaomiBleProfile | null = null;
  let connectedHuaweiProfile: HuaweiBleProfile | null = null;
  let connectedGarminProfile: GarminBleProfile | null = null;
  let connectedGarminSession: GarminSession | null = null;
  let connectedBleGattSession: BleGattSession | null = null;
  let connectedBleScaleSession: BleScaleSession | null = null;
  let connectedColmiRingSession: ColmiRingSession | null = null;
  let connectedGloryFitSession: GloryFitSession | null = null;
  let connectedBangleJsSession: BangleJsSession | null = null;
  let connectedMoyoungSession: MoyoungSession | null = null;
  let connectedFitProSession: FitProSession | null = null;
  let connectedHuamiLegacySession: HuamiLegacySession | null = null;
  let connectedHuaweiSession: HuaweiSession | null = null;
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
            if (!device) return;
            const name = device.name ?? device.localName ?? null;
            const serviceUuids = device.serviceUUIDs ?? [];
            const zeppModel = name ? matchDeviceName(name) : null;
            const xiaomiModel = zeppModel || !name ? null : matchXiaomiDeviceName(name);
            const huaweiModel =
              zeppModel || xiaomiModel || !name ? null : matchHuaweiDeviceName(name);
            const garminModel =
              zeppModel || xiaomiModel || huaweiModel || !name ? null : matchGarminDeviceName(name);
            // Generic GATT models are matched first, by advertised service UUID,
            // and only when no named model matched (upstream GenericCoordinator).
            // Smart scales are name-only and come after that fallback.
            const bleGattModel =
              zeppModel || xiaomiModel || huaweiModel || garminModel
                ? null
                : matchBleGattDevice(name, serviceUuids);
            // Bangle.js advertises the Nordic UART service; the name is tried
            // first and the service UUID is only a fallback (upstream matches
            // the name, but a nameless watch is still reachable).
            const bangleJsModel =
              zeppModel || xiaomiModel || huaweiModel || garminModel || bleGattModel
                ? null
                : matchBangleJsDevice(name, serviceUuids);
            // Moyoung / Da Fit watches are name-only and sit directly after
            // Bangle.js in the chain.
            const moyoungModel =
              zeppModel ||
              xiaomiModel ||
              huaweiModel ||
              garminModel ||
              bleGattModel ||
              bangleJsModel
                ? null
                : matchMoyoungDevice(name);
            // FitPro bands are name-only and sit directly after Moyoung.
            const fitProModel =
              zeppModel ||
              xiaomiModel ||
              huaweiModel ||
              garminModel ||
              bleGattModel ||
              bangleJsModel ||
              moyoungModel
                ? null
                : matchFitProDevice(name);
            // Legacy Huami watches are name-only and sit directly after
            // Bangle.js in the chain.
            const huamiLegacyModel =
              zeppModel ||
              xiaomiModel ||
              huaweiModel ||
              garminModel ||
              bleGattModel ||
              bangleJsModel ||
              moyoungModel ||
              fitProModel
                ? null
                : matchHuamiLegacyDevice(name);
            const gloryFitModel =
              zeppModel ||
              xiaomiModel ||
              huaweiModel ||
              garminModel ||
              bleGattModel ||
              bangleJsModel ||
              moyoungModel ||
              fitProModel ||
              huamiLegacyModel
                ? null
                : matchGloryFitDevice(name);
            const bleScaleModel =
              zeppModel ||
              xiaomiModel ||
              huaweiModel ||
              garminModel ||
              bleGattModel ||
              bangleJsModel ||
              moyoungModel ||
              fitProModel ||
              huamiLegacyModel ||
              gloryFitModel
                ? null
                : matchBleScaleDevice(name);
            // Smart rings are name-only and come after the scale family.
            const colmiRingModel =
              zeppModel ||
              xiaomiModel ||
              huaweiModel ||
              garminModel ||
              bleGattModel ||
              bangleJsModel ||
              moyoungModel ||
              fitProModel ||
              huamiLegacyModel ||
              gloryFitModel ||
              bleScaleModel
                ? null
                : matchColmiRingDevice(name);
            const model =
              zeppModel ??
              xiaomiModel ??
              huaweiModel ??
              garminModel ??
              bleGattModel ??
              bangleJsModel ??
              moyoungModel ??
              fitProModel ??
              huamiLegacyModel ??
              gloryFitModel ??
              bleScaleModel ??
              colmiRingModel;
            if (!model) return;
            const family = zeppModel
              ? "zepp_os"
              : xiaomiModel
                ? "xiaomi"
                : huaweiModel
                  ? "huawei"
                  : garminModel
                    ? "garmin"
                    : bleGattModel
                      ? "ble_gatt"
                      : bangleJsModel
                        ? "bangle_js"
                        : moyoungModel
                          ? "moyoung"
                          : fitProModel
                            ? "fitpro"
                            : huamiLegacyModel
                              ? "huami_legacy"
                              : gloryFitModel
                                ? "gloryfit"
                                : bleScaleModel
                                  ? "ble_scale"
                                  : "colmi_ring";
            r.devices.set(device.id, device);
            const found = new Map(snapshot.devices.map((item) => [item.id, item]));
            found.set(
              device.id,
              Object.freeze({
                id: device.id,
                name: name ?? "Unnamed BLE device",
                rssi: device.rssi ?? null,
                modelId: model.id,
                family,
                serviceUuids,
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
            matchDeviceName(knownDevice.name) ??
            matchXiaomiDeviceName(knownDevice.name) ??
            matchHuaweiDeviceName(knownDevice.name) ??
            matchGarminDeviceName(knownDevice.name) ??
            matchBleGattDevice(knownDevice.name, knownDevice.serviceUuids) ??
            matchBangleJsDevice(knownDevice.name, knownDevice.serviceUuids) ??
            matchMoyoungDevice(knownDevice.name) ??
            matchFitProDevice(knownDevice.name) ??
            matchHuamiLegacyDevice(knownDevice.name) ??
            matchGloryFitDevice(knownDevice.name) ??
            matchBleScaleDevice(knownDevice.name) ??
            matchColmiRingDevice(knownDevice.name);
          if (!model) throw new Error("DEVICE_NOT_DISCOVERED");
          const family =
            knownDevice.family ??
            (matchDeviceName(knownDevice.name)
              ? "zepp_os"
              : matchXiaomiDeviceName(knownDevice.name)
                ? "xiaomi"
                : matchHuaweiDeviceName(knownDevice.name)
                  ? "huawei"
                  : matchGarminDeviceName(knownDevice.name)
                    ? "garmin"
                    : matchBleGattDevice(knownDevice.name, knownDevice.serviceUuids)
                      ? "ble_gatt"
                      : matchBangleJsDevice(knownDevice.name, knownDevice.serviceUuids)
                        ? "bangle_js"
                        : matchMoyoungDevice(knownDevice.name)
                          ? "moyoung"
                          : matchFitProDevice(knownDevice.name)
                            ? "fitpro"
                            : matchHuamiLegacyDevice(knownDevice.name)
                              ? "huami_legacy"
                              : matchGloryFitDevice(knownDevice.name)
                                ? "gloryfit"
                                : matchBleScaleDevice(knownDevice.name)
                                  ? "ble_scale"
                                  : "colmi_ring");
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
          if (family === "xiaomi" || family === "huawei" || family === "garmin") {
            // Best effort; iOS ignores this and Android negotiates the largest MTU.
            // GarminSupport requests 515; the other families use 512.
            await discovered.requestMTU(family === "garmin" ? 515 : 512).catch(() => undefined);
          } else if (family === "bangle_js") {
            // Upstream requests 131 at init; writes stay chunked at 20 bytes
            // because the negotiated MTU is not exposed by react-native-ble-plx.
            await discovered.requestMTU(BANGLE_JS_MTU_REQUEST).catch(() => undefined);
          }
          if (connectionAttempt === attempt) connecting = discovered;
          const services = await discovered.services();
          if (current !== generation || disposed) {
            await discovered.cancelConnection();
            return;
          }
          const bleScaleModel =
            family === "ble_scale" ? matchBleScaleDevice(knownDevice.name) : null;
          const bangleJsModel =
            family === "bangle_js"
              ? matchBangleJsDevice(knownDevice.name, knownDevice.serviceUuids)
              : null;
          const moyoungModel = family === "moyoung" ? matchMoyoungDevice(knownDevice.name) : null;
          const fitProModel = family === "fitpro" ? matchFitProDevice(knownDevice.name) : null;
          const gloryFitModel =
            family === "gloryfit" ? matchGloryFitDevice(knownDevice.name) : null;
          const huamiLegacyModel =
            family === "huami_legacy" ? matchHuamiLegacyDevice(knownDevice.name) : null;
          const huaweiModel = family === "huawei" ? matchHuaweiDeviceName(knownDevice.name) : null;
          const garminModel = family === "garmin" ? matchGarminDeviceName(knownDevice.name) : null;
          const colmiRingModel =
            family === "colmi_ring" ? matchColmiRingDevice(knownDevice.name) : null;
          const hasRequiredService =
            family === "xiaomi"
              ? services.some((service) => XIAOMI_BLE_SERVICE_UUIDS.has(service.uuid.toLowerCase()))
              : family === "huawei"
                ? services.some((service) =>
                    HUAWEI_BLE_SERVICE_UUIDS.has(service.uuid.toLowerCase()),
                  )
                : family === "garmin"
                  ? services.some((service) =>
                      GARMIN_BLE_SERVICE_UUIDS.has(service.uuid.toLowerCase()),
                    )
                  : family === "ble_gatt"
                    ? services.some((service) =>
                        BLE_GATT_SERVICE_UUIDS.has(normalizeServiceUuid(service.uuid)),
                      )
                    : family === "bangle_js"
                      ? services.some((service) =>
                          BANGLE_JS_SERVICE_UUIDS.has(normalizeServiceUuid(service.uuid)),
                        )
                      : family === "moyoung"
                        ? services.some(
                            (service) =>
                              normalizeServiceUuid(service.uuid) === MOYOUNG_SERVICE_UUID,
                          )
                        : family === "fitpro"
                          ? services.some(
                              (service) =>
                                normalizeServiceUuid(service.uuid) === FITPRO_SERVICE_UUID,
                            )
                          : family === "gloryfit"
                            ? [...GLORYFIT_SERVICE_UUIDS].every((uuid) =>
                                services.some(
                                  (service) => normalizeServiceUuid(service.uuid) === uuid,
                                ),
                              )
                            : family === "ble_scale"
                              ? !bleScaleModel?.serviceUuids.length ||
                                services.some((service) =>
                                  bleScaleModel.serviceUuids.includes(
                                    normalizeServiceUuid(service.uuid),
                                  ),
                                )
                              : family === "colmi_ring"
                                ? services.some(
                                    (service) =>
                                      normalizeServiceUuid(service.uuid) === COLMI_V1_SERVICE_UUID,
                                  )
                                : family === "huami_legacy"
                                  ? services.some(
                                      (service) =>
                                        normalizeServiceUuid(service.uuid) === HUAMI_SERVICE_UUID,
                                    )
                                  : services.some((service) => service.uuid.toLowerCase() === FEE0);
          if (!hasRequiredService)
            throw new Error(
              family === "xiaomi"
                ? "XIAOMI_SERVICE_MISSING"
                : family === "huawei"
                  ? "HUAWEI_SERVICE_MISSING"
                  : family === "garmin"
                    ? "GARMIN_SERVICE_MISSING"
                    : family === "ble_gatt"
                      ? "BLE_GATT_SERVICE_MISSING"
                      : family === "bangle_js"
                        ? "BANGLE_JS_SERVICE_MISSING"
                        : family === "moyoung"
                          ? "MOYOUNG_SERVICE_MISSING"
                          : family === "fitpro"
                            ? "FITPRO_SERVICE_MISSING"
                            : family === "gloryfit"
                              ? "GLORYFIT_SERVICE_MISSING"
                              : family === "ble_scale"
                                ? "BLE_SCALE_SERVICE_MISSING"
                                : family === "colmi_ring"
                                  ? "COLMI_RING_SERVICE_MISSING"
                                  : family === "huami_legacy"
                                    ? "HUAMI_LEGACY_SERVICE_MISSING"
                                    : "HUAMI_SERVICE_MISSING",
            );
          let profile: XiaomiBleProfile | null = null;
          let huaweiProfile: HuaweiBleProfile | null = null;
          let garminProfile: GarminBleProfile | null = null;
          let bleGattProfiles: readonly BleGattProfile[] | null = null;
          let bleScaleProfile: BleScaleProfile | null = null;
          let bangleJsProfile: BangleJsProfile | null = null;
          let moyoungProfile: MoyoungProfile | null = null;
          let fitProProfile: FitProProfile | null = null;
          let gloryFitProfile: GloryFitProfile | null = null;
          let huamiLegacyProfile: HuamiLegacyProfile | null = null;
          let colmiRingProfile: ColmiRingProfile | null = null;
          if (family === "xiaomi") {
            profile = await selectXiaomiProfile(
              discovered,
              services.map((service) => service.uuid),
            );
            if (!profile) throw new Error("XIAOMI_SERVICE_MISSING");
          } else if (family === "huawei") {
            huaweiProfile = await selectHuaweiProfile(
              discovered,
              services.map((service) => service.uuid),
              huaweiModel?.newHonorProtocol ? "honor" : undefined,
            );
            if (!huaweiProfile) throw new Error("HUAWEI_SERVICE_MISSING");
          } else if (family === "garmin") {
            garminProfile = await selectGarminProfile(
              discovered,
              services.map((service) => service.uuid),
            );
            if (!garminProfile) throw new Error("GARMIN_SERVICE_MISSING");
          } else if (family === "ble_gatt") {
            bleGattProfiles = await selectBleGattProfiles(
              discovered,
              services.map((service) => service.uuid),
            );
            if (!bleGattProfiles.length) throw new Error("BLE_GATT_SERVICE_MISSING");
          } else if (family === "ble_scale" && bleScaleModel?.serviceUuids.length) {
            bleScaleProfile = await selectBleScaleProfile(
              discovered,
              services.map((service) => service.uuid),
              bleScaleModel.id,
            );
            if (!bleScaleProfile) throw new Error("BLE_SCALE_SERVICE_MISSING");
          } else if (family === "bangle_js" && bangleJsModel) {
            bangleJsProfile = await selectBangleJsProfile(
              discovered,
              services.map((service) => service.uuid),
              bangleJsModel.id,
            );
            if (!bangleJsProfile) throw new Error("BANGLE_JS_SERVICE_MISSING");
          } else if (family === "moyoung" && moyoungModel) {
            moyoungProfile = await selectMoyoungProfile(
              discovered,
              services.map((service) => service.uuid),
              moyoungModel,
            );
            if (!moyoungProfile) throw new Error("MOYOUNG_SERVICE_MISSING");
          } else if (family === "fitpro" && fitProModel) {
            fitProProfile = await selectFitProProfile(
              discovered,
              services.map((service) => service.uuid),
              fitProModel,
            );
            if (!fitProProfile) throw new Error("FITPRO_SERVICE_MISSING");
          } else if (family === "gloryfit" && gloryFitModel) {
            gloryFitProfile = await selectGloryFitProfile(
              discovered,
              services.map((service) => service.uuid),
              gloryFitModel.id,
            );
            if (!gloryFitProfile) throw new Error("GLORYFIT_SERVICE_MISSING");
          } else if (family === "huami_legacy" && huamiLegacyModel) {
            huamiLegacyProfile = await selectHuamiLegacyProfile(
              discovered,
              services.map((service) => service.uuid),
              huamiLegacyModel.id,
            );
            if (!huamiLegacyProfile) throw new Error("HUAMI_LEGACY_SERVICE_MISSING");
          } else if (family === "colmi_ring" && colmiRingModel) {
            colmiRingProfile = await selectColmiRingProfile(
              discovered,
              services.map((service) => service.uuid),
              colmiRingModel.id,
            );
            if (!colmiRingProfile) throw new Error("COLMI_RING_SERVICE_MISSING");
          }
          disconnectSubscription = r.manager.onDeviceDisconnected(discovered.id, () => {
            if (disposed || connected !== discovered || current !== generation) return;
            connected = null;
            connectedFamily = null;
            connectedProfile = null;
            connectedHuaweiProfile = null;
            connectedGarminProfile = null;
            void connectedGarminSession?.close();
            connectedGarminSession = null;
            void connectedBleGattSession?.close();
            connectedBleGattSession = null;
            void connectedBleScaleSession?.close();
            connectedBleScaleSession = null;
            void connectedColmiRingSession?.close();
            connectedColmiRingSession = null;
            void connectedBangleJsSession?.close();
            connectedBangleJsSession = null;
            void connectedMoyoungSession?.close();
            connectedMoyoungSession = null;
            void connectedFitProSession?.close();
            connectedFitProSession = null;
            void connectedGloryFitSession?.close();
            connectedGloryFitSession = null;
            void connectedHuamiLegacySession?.close();
            connectedHuamiLegacySession = null;
            void connectedHuaweiSession?.close();
            connectedHuaweiSession = null;
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
              connectedFamily: null,
              capabilities: Object.freeze({
                stepsHistory: false,
                liveCapture: false,
                historySync: false,
              }),
              errorCode: "DEVICE_DISCONNECTED",
            });
          });
          connected = discovered;
          connectedFamily = family;
          connectedProfile = profile;
          connectedHuaweiProfile = huaweiProfile;
          connectedGarminProfile = garminProfile;
          lease.held = true;
          connectedLease = lease;
          ownedDevice = null;
          connecting = null;
          connectingLease = null;
          connectionAttempt = null;
          if (bleGattProfiles && deps.onLiveSample) {
            void connectedBleGattSession?.close();
            connectedBleGattSession = new BleGattSession(
              discovered,
              bleGattProfiles,
              deps.onLiveSample,
            );
            connectedBleGattSession.start();
          }
          if (bleScaleProfile && deps.onLiveSample) {
            void connectedBleScaleSession?.close();
            connectedBleScaleSession = createBleScaleSession(
              discovered,
              bleScaleProfile,
              deps.onLiveSample,
            );
            connectedBleScaleSession.start();
          }
          if (colmiRingProfile && deps.onHistorySample) {
            void connectedColmiRingSession?.close();
            connectedColmiRingSession = createColmiRingSession({
              device: discovered,
              profile: colmiRingProfile,
              onRecord: deps.onHistorySample,
            });
            connectedColmiRingSession.start();
          }
          if (bangleJsProfile && deps.onHistorySample) {
            void connectedBangleJsSession?.close();
            connectedBangleJsSession = createBangleJsSession({
              device: discovered,
              deviceId,
              profile: bangleJsProfile,
              onRecord: deps.onHistorySample,
              // Realtime (rt:1) samples are heart-rate points, so they ride the
              // same history sink and become normal heart_rate records.
              onLiveHeartRate: deps.onHistorySample,
            });
            connectedBangleJsSession.start();
          }
          if (moyoungProfile && deps.onHistorySample) {
            void connectedMoyoungSession?.close();
            connectedMoyoungSession = createMoyoungSession({
              device: discovered,
              profile: moyoungProfile,
              onRecord: deps.onHistorySample,
            });
            connectedMoyoungSession.start();
          }
          if (fitProProfile && deps.onHistorySample) {
            void connectedFitProSession?.close();
            connectedFitProSession = createFitProSession({
              device: discovered,
              profile: fitProProfile,
              onRecord: deps.onHistorySample,
            });
            connectedFitProSession.start();
          }
          if (gloryFitProfile && deps.onHistorySample) {
            void connectedGloryFitSession?.close();
            connectedGloryFitSession = createGloryFitSession({
              device: discovered,
              profile: gloryFitProfile,
              onRecord: deps.onHistorySample,
            });
            connectedGloryFitSession.start();
          }
          if (huamiLegacyProfile && huamiLegacyModel && deps.onHistorySample) {
            void connectedHuamiLegacySession?.close();
            // The user-entered key arrives with the sync action, so the
            // session is created here and started by `fetchSteps`.
            connectedHuamiLegacySession = createHuamiLegacySession({
              device: discovered,
              deviceId,
              profile: huamiLegacyProfile,
              sampleSizeRule: huamiLegacyModel.sampleSize,
              authFlags: huamiLegacyModel.authFlags,
              cryptFlags: huamiLegacyModel.cryptFlags,
              onRecord: deps.onHistorySample,
              onLiveHeartRate: deps.onHistorySample,
            });
          }
          if (garminProfile && garminModel?.sync && deps.onHistorySample) {
            void connectedGarminSession?.close();
            // Garmin needs no key, so the FIT file sync starts on connection
            // and `fetchSteps` only awaits it inside the sync action.
            connectedGarminSession = createGarminSession({
              device: discovered,
              deviceId,
              profile: garminProfile,
              modelId: garminModel.id,
              onRecord: deps.onHistorySample,
            });
            connectedGarminSession.start();
          }
          if (huaweiProfile && huaweiModel?.sync && deps.onHistorySample) {
            void connectedHuaweiSession?.close();
            // Huawei auth is automatic (MAC-derived key), but the transfer is
            // started by `fetchSteps` so it runs inside the sync action's
            // authority and cancellation window.
            connectedHuaweiSession = createHuaweiSession({
              device: discovered,
              deviceId,
              profile: huaweiProfile,
              macAddress: discovered.id,
              onRecord: deps.onHistorySample,
            });
          }
          publish({
            phase: "connected",
            connectedDeviceId: deviceId,
            connectedModelId: model.id,
            connectedFamily: family,
            capabilities: Object.freeze({
              stepsHistory:
                family === "zepp_os" ||
                family === "xiaomi" ||
                family === "fitpro" ||
                family === "huami_legacy" ||
                (family === "huawei" && huaweiModel?.sync === true) ||
                (family === "garmin" && garminModel?.sync === true),
              liveCapture: family === "ble_gatt" || family === "ble_scale",
              historySync:
                family === "colmi_ring" ||
                family === "bangle_js" ||
                family === "moyoung" ||
                family === "fitpro" ||
                family === "gloryfit" ||
                family === "huami_legacy" ||
                (family === "huawei" && huaweiModel?.sync === true) ||
                (family === "garmin" && garminModel?.sync === true),
            }),
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
              connectedFamily: null,
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
      connectedFamily = null;
      connectedProfile = null;
      connectedHuaweiProfile = null;
      connectedGarminProfile = null;
      void connectedGarminSession?.close();
      connectedGarminSession = null;
      void connectedBleGattSession?.close();
      connectedBleGattSession = null;
      void connectedBleScaleSession?.close();
      connectedBleScaleSession = null;
      void connectedColmiRingSession?.close();
      connectedColmiRingSession = null;
      void connectedBangleJsSession?.close();
      connectedBangleJsSession = null;
      void connectedMoyoungSession?.close();
      connectedMoyoungSession = null;
      void connectedFitProSession?.close();
      connectedFitProSession = null;
      void connectedGloryFitSession?.close();
      connectedGloryFitSession = null;
      void connectedHuamiLegacySession?.close();
      connectedHuamiLegacySession = null;
      void connectedHuaweiSession?.close();
      connectedHuaweiSession = null;
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
        publish({
          phase: "idle",
          connectedDeviceId: null,
          connectedModelId: null,
          connectedFamily: null,
          capabilities: Object.freeze({
            stepsHistory: false,
            liveCapture: false,
            historySync: false,
          }),
        });
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
      // Huawei history is a later milestone; the connection foundation stops at
      // connected + service-verified. The selected profile is retained for that
      // milestone.
      if (connectedFamily === "huawei") {
        if (!connectedHuaweiProfile) throw new Error("HUAWEI_SERVICE_MISSING");
        if (!connectedHuaweiSession) throw new Error("HUAWEI_HISTORY_UNSUPPORTED");
      }
      // Garmin FIT files sync on connection; the sync action awaits the
      // session so its records are committed inside the authority window.
      if (connectedFamily === "garmin") {
        if (!connectedGarminProfile) throw new Error("GARMIN_SERVICE_MISSING");
        if (!connectedGarminSession) throw new Error("GARMIN_HISTORY_UNSUPPORTED");
      }
      // Generic GATT sensors expose live notifications only; there is no
      // history/backfill characteristic, so this family never runs fetchSteps.
      if (connectedFamily === "ble_gatt") throw new Error("BLE_GATT_HISTORY_UNSUPPORTED");
      // Smart scales capture live/stored frames on the connection; there is no
      // cursor-based history page to fetch.
      if (connectedFamily === "ble_scale") throw new Error("BLE_SCALE_HISTORY_UNSUPPORTED");
      // Rings sync stored history on connection through their own session; there
      // is no cursor-based history page to fetch.
      if (connectedFamily === "colmi_ring") throw new Error("COLMI_RING_HISTORY_UNSUPPORTED");
      // Bangle.js also syncs on connection through its own session.
      if (connectedFamily === "bangle_js") throw new Error("BANGLE_JS_HISTORY_UNSUPPORTED");
      // Moyoung watches sync stored heart rate and sleep on connection; steps
      // are daily totals only, so there is no cursor-based page to fetch.
      if (connectedFamily === "moyoung") throw new Error("MOYOUNG_HISTORY_UNSUPPORTED");
      // FitPro bands push their stored history on connection through their own
      // ack-driven fetch chain; there is no cursor-based page to fetch.
      if (connectedFamily === "fitpro") throw new Error("FITPRO_HISTORY_UNSUPPORTED");
      // GloryFit watches also sync on connection through their own session.
      if (connectedFamily === "gloryfit") throw new Error("GLORYFIT_HISTORY_UNSUPPORTED");
      const device = connected;
      const abortController = new AbortController();
      historyAbort = abortController;
      const forwardAbort = () => abortController.abort();
      options.signal.addEventListener("abort", forwardAbort, { once: true });
      const linked = { ...options, signal: abortController.signal };
      const work =
        connectedFamily === "garmin"
          ? (async () => {
              const session = connectedGarminSession;
              if (!session) throw new Error("GARMIN_HISTORY_UNSUPPORTED");
              const onAbort = () => void session.close();
              linked.signal.addEventListener("abort", onAbort, { once: true });
              try {
                await session.whenDone();
              } finally {
                linked.signal.removeEventListener("abort", onAbort);
              }
              return {
                pages: 0,
                minutes: 0,
                complete: !linked.signal.aborted,
                granularity: "minute" as const,
              };
            })()
          : connectedFamily === "huawei"
            ? (async () => {
                const session = connectedHuaweiSession;
                if (!session) throw new Error("HUAWEI_HISTORY_UNSUPPORTED");
                const onAbort = () => void session.close();
                linked.signal.addEventListener("abort", onAbort, { once: true });
                try {
                  session.start();
                  await session.whenDone();
                } finally {
                  linked.signal.removeEventListener("abort", onAbort);
                }
                return {
                  pages: 0,
                  minutes: 0,
                  complete: !linked.signal.aborted,
                  granularity: "minute" as const,
                };
              })()
            : connectedFamily === "huami_legacy"
              ? (async () => {
                  const session = connectedHuamiLegacySession;
                  if (!session) throw new Error("HUAMI_LEGACY_SERVICE_MISSING");
                  if (linked.authKey.length !== 16) throw new Error("INVALID_AUTH_KEY");
                  const onAbort = () => void session.close();
                  linked.signal.addEventListener("abort", onAbort, { once: true });
                  try {
                    session.start(linked.authKey);
                    await session.whenDone();
                  } finally {
                    linked.signal.removeEventListener("abort", onAbort);
                  }
                  return {
                    pages: 0,
                    minutes: 0,
                    complete: !linked.signal.aborted,
                    granularity: "minute" as const,
                  };
                })()
              : connectedFamily === "xiaomi"
                ? (() => {
                    if (!connectedProfile) throw new Error("XIAOMI_HISTORY_UNSUPPORTED");
                    const transport = deps.xiaomiHistoryTransport
                      ? deps.xiaomiHistoryTransport(device, connectedProfile, linked)
                      : createNativeXiaomiHistoryTransport(
                          device,
                          connectedProfile,
                          {
                            authKey: linked.authKey,
                            phoneApiLevel: runtime().version,
                            phoneName: "OpenValens",
                            region: "US",
                          },
                          radio?.manager,
                        );
                    return runXiaomiStepsHistory(transport, linked);
                  })()
                : (() => {
                    const workLink = new NativeHelioLink(device, radio?.manager);
                    return runHelioStepsHistory(workLink, linked).finally(() => workLink.close());
                  })();
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
      connectedFamily = null;
      connectedProfile = null;
      connectedHuaweiProfile = null;
      connectedGarminProfile = null;
      void connectedGarminSession?.close();
      connectedGarminSession = null;
      void connectedBleGattSession?.close();
      connectedBleGattSession = null;
      void connectedBleScaleSession?.close();
      connectedBleScaleSession = null;
      void connectedColmiRingSession?.close();
      connectedColmiRingSession = null;
      void connectedBangleJsSession?.close();
      connectedBangleJsSession = null;
      void connectedMoyoungSession?.close();
      connectedMoyoungSession = null;
      void connectedFitProSession?.close();
      connectedFitProSession = null;
      void connectedGloryFitSession?.close();
      connectedGloryFitSession = null;
      void connectedHuamiLegacySession?.close();
      connectedHuamiLegacySession = null;
      void connectedHuaweiSession?.close();
      connectedHuaweiSession = null;
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
  "HUAWEI_SERVICE_MISSING",
  "GARMIN_SERVICE_MISSING",
  "BLE_GATT_SERVICE_MISSING",
  "BLE_SCALE_SERVICE_MISSING",
  "COLMI_RING_SERVICE_MISSING",
  "BANGLE_JS_SERVICE_MISSING",
  "MOYOUNG_SERVICE_MISSING",
  "FITPRO_SERVICE_MISSING",
  "GLORYFIT_SERVICE_MISSING",
  "HUAMI_LEGACY_SERVICE_MISSING",
  "BLUETOOTH_STATE_TIMEOUT",
  "SCAN_FAILED",
  "CONNECTION_FAILED",
]);
