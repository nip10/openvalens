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
import { matchHuaweiDeviceName, type HuaweiModel } from "../models/huawei";
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
import { CASIO_WATCH_FEATURES_SERVICE_UUID, matchCasioDevice } from "../models/casio";
import { createCasioSession, selectCasioProfile } from "../transport/casio";
import type { CasioProfile, CasioSession } from "../transport/casio";
import { FITPRO_SERVICE_UUID, matchFitProDevice } from "../models/fitpro";
import { createFitProSession, selectFitProProfile } from "../transport/fitpro";
import type { FitProProfile, FitProSession } from "../transport/fitpro";
import { PEBBLE_SERVICE_UUID, isPebbleCandidateName, matchPebbleDevice } from "../models/pebble";
import { FOSSIL_SERVICE_UUID, isFossilCandidate } from "../models/fossil-hr";
import { loadFossilCrypto, type FossilCrypto } from "../protocol/fossil-hr";
import { createFossilHrSession, type FossilPeer, type FossilSession } from "../transport/fossil-hr";
import { createDurablePebbleSession, type PebbleBondAdapter } from "../transport/pebble";
import type { DurablePebbleSession, PebblePeer, PebbleSessionOutcome } from "../pebble-types";
import { createHuamiLegacySession, selectHuamiLegacyProfile } from "../transport/huami-legacy";
import { createGarminSession, type GarminSession } from "../transport/garmin";
import type { HuamiLegacyProfile, HuamiLegacySession } from "../transport/huami-legacy";
import { HUAMI_SERVICE_UUID, matchHuamiLegacyDevice } from "../models/huami-legacy";
import { createHuaweiSession } from "../transport/huawei";
import type { HuaweiSession } from "../transport/huawei";
import { runHuaweiBrSync } from "../transport/huawei-rfcomm";
import { createSecureHuaweiHiChainStore } from "../transport/huawei-hichain-store";
import type { HuaweiHiChainStore } from "../transport/huawei";
import type { BtClassicAdapter } from "../../../modules/bt-classic";
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
  /** Test seam for the durable Pebble transport. */
  createPebbleSession?: typeof createDurablePebbleSession;
  /** Android bond adapter; production loads the local `pebble-bond` module lazily. */
  pebbleBondAdapter?: () => PebbleBondAdapter;
  /** Android Bluetooth Classic adapter; production loads `bt-classic` lazily. */
  btClassicAdapter?: () => BtClassicAdapter;
  /** Durable HiChain id/token store; production uses the OS keystore. */
  huaweiHiChainStore?: () => HuaweiHiChainStore;
  /** Pairing/handshake/identity budget for the Pebble prepare step. */
  pebblePrepareTimeoutMs?: number;
  /** Test seam for the Fossil Hybrid HR session. */
  createFossilSession?: typeof createFossilHrSession;
  /** Fossil AES provider; production loads react-native-quick-crypto lazily. */
  fossilCrypto?: () => Promise<FossilCrypto>;
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
  pairingPrompt: null,
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
  let connectedCasioProfile: CasioProfile | null = null;
  let connectedGarminSession: GarminSession | null = null;
  let connectedBleGattSession: BleGattSession | null = null;
  let connectedBleScaleSession: BleScaleSession | null = null;
  let connectedColmiRingSession: ColmiRingSession | null = null;
  let connectedGloryFitSession: GloryFitSession | null = null;
  let connectedBangleJsSession: BangleJsSession | null = null;
  let connectedMoyoungSession: MoyoungSession | null = null;
  let connectedFitProSession: FitProSession | null = null;
  /** Prepared (paired, handshaken, firmware-identified) durable Pebble session. */
  let connectedPebbleSession: DurablePebbleSession | null = null;
  let connectedPebblePeer: PebblePeer | null = null;
  /** Aborts an in-flight Pebble prepare when the attempt is superseded. */
  let pebblePrepareAbort: AbortController | null = null;
  /** Set while a capture runs: its terminal disconnect is expected, not an error. */
  let pebbleCaptureEnding = false;
  /** Prepared (identity-resolved, not yet authenticated) Fossil session. */
  let connectedFossilSession: FossilSession | null = null;
  let connectedFossilPeer: FossilPeer | null = null;
  let fossilPrepareAbort: AbortController | null = null;
  let connectedHuamiLegacySession: HuamiLegacySession | null = null;
  let connectedHuaweiSession: HuaweiSession | null = null;
  /** A Bluetooth Classic Huawei/Honor watch: history runs over RFCOMM in `fetchSteps`. */
  let connectedHuaweiBr: { model: HuaweiModel; bleAddress: string; deviceId: string } | null = null;
  let hichainStore: HuaweiHiChainStore | null = null;
  const huaweiHiChainStore = (): HuaweiHiChainStore =>
    (hichainStore ??= (deps.huaweiHiChainStore ?? createSecureHuaweiHiChainStore)());
  /** Android with the `bt-classic` module present; false on iOS and older builds. */
  const btClassicSupported = (): boolean => {
    try {
      return (deps.btClassicAdapter ?? loadBtClassicAdapter)().isSupported();
    } catch {
      return false;
    }
  };
  let connectedCasioSession: CasioSession | null = null;
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
            // Casio watches are name-only and sit last: the GB-6900B family
            // shares no name shape with the other families.
            const casioModel =
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
              bleScaleModel ||
              colmiRingModel
                ? null
                : matchCasioDevice(name);
            // Pebble watches share one upstream name pattern (`Pebble.*`) and
            // sit last. The three prospective BLE models advertise as
            // `Pebble XXXX`; other shapes include Classic-mode and dual-mode
            // generations. All remain discoverable but gated from connection.
            const pebbleModel =
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
              bleScaleModel ||
              colmiRingModel ||
              casioModel
                ? null
                : matchPebbleDevice(name);
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
              colmiRingModel ??
              casioModel ??
              pebbleModel;
            // Generic `Pebble XXXX` names carry no trustworthy model: list them
            // as Pebble candidates without a model id rather than guess one.
            const pebbleCandidate = !model && isPebbleCandidateName(name);
            // Fossil hybrids are found by service UUID only (upstream never
            // matches names); the model is resolved after connecting.
            const fossilCandidate = !model && !pebbleCandidate && isFossilCandidate(serviceUuids);
            if (!model && !pebbleCandidate && !fossilCandidate) return;
            const family = fossilCandidate
              ? "fossil_hr"
              : zeppModel
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
                                    : colmiRingModel
                                      ? "colmi_ring"
                                      : casioModel
                                        ? "casio"
                                        : "pebble";
            r.devices.set(device.id, device);
            const found = new Map(snapshot.devices.map((item) => [item.id, item]));
            found.set(
              device.id,
              Object.freeze({
                id: device.id,
                name: name ?? "Unnamed BLE device",
                rssi: device.rssi ?? null,
                ...(model ? { modelId: model.id } : {}),
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
          // Every Pebble-shaped name or Pebble-family entry takes the durable
          // Pebble path: the model is never guessed from the advertised name,
          // only taken from the firmware identity during prepare.
          const pebbleCandidate =
            knownDevice.family === "pebble" || isPebbleCandidateName(knownDevice.name);
          const fossilCandidate =
            !pebbleCandidate &&
            (knownDevice.family === "fossil_hr" || isFossilCandidate(knownDevice.serviceUuids));
          const model =
            pebbleCandidate || fossilCandidate
              ? null
              : (matchDeviceName(knownDevice.name) ??
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
                matchColmiRingDevice(knownDevice.name) ??
                matchCasioDevice(knownDevice.name));
          if (!model && !pebbleCandidate && !fossilCandidate)
            throw new Error("DEVICE_NOT_DISCOVERED");
          const family: DirectDeviceFamily = pebbleCandidate
            ? "pebble"
            : fossilCandidate
              ? "fossil_hr"
              : (knownDevice.family ??
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
                                      : matchColmiRingDevice(knownDevice.name)
                                        ? "colmi_ring"
                                        : matchCasioDevice(knownDevice.name)
                                          ? "casio"
                                          : "pebble"));
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
          let discovered = device;
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
          const casioModel = family === "casio" ? matchCasioDevice(knownDevice.name) : null;
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
                                : family === "casio"
                                  ? services.some(
                                      (service) =>
                                        normalizeServiceUuid(service.uuid) ===
                                        CASIO_WATCH_FEATURES_SERVICE_UUID,
                                    )
                                  : family === "pebble"
                                    ? services.some(
                                        (service) =>
                                          normalizeServiceUuid(service.uuid) ===
                                          PEBBLE_SERVICE_UUID,
                                      )
                                    : family === "fossil_hr"
                                      ? services.some(
                                          (service) =>
                                            normalizeServiceUuid(service.uuid) ===
                                            FOSSIL_SERVICE_UUID,
                                        )
                                      : family === "huami_legacy"
                                        ? services.some(
                                            (service) =>
                                              normalizeServiceUuid(service.uuid) ===
                                              HUAMI_SERVICE_UUID,
                                          )
                                        : services.some(
                                            (service) => service.uuid.toLowerCase() === FEE0,
                                          );
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
                                  : family === "casio"
                                    ? "CASIO_SERVICE_MISSING"
                                    : family === "pebble"
                                      ? "PEBBLE_SERVICE_MISSING"
                                      : family === "fossil_hr"
                                        ? "FOSSIL_SERVICE_MISSING"
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
          let casioProfile: CasioProfile | null = null;
          let pebblePeer: PebblePeer | null = null;
          let pebbleSession: DurablePebbleSession | null = null;
          let fossilPeer: FossilPeer | null = null;
          let fossilSession: FossilSession | null = null;
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
          } else if (family === "casio" && casioModel) {
            casioProfile = await selectCasioProfile(
              discovered,
              services.map((service) => service.uuid),
              casioModel,
            );
            if (!casioProfile && casioModel.reconnectOnMissingCharacteristics) {
              // BasicCasio2C2DSupport workaround (upstream issue 3216): the
              // first connect can miss 26eb002c/26eb002d, so reconnect once.
              await discovered.cancelConnection().catch(() => undefined);
              if (current !== generation || disposed) return;
              discovered = await selected.connect();
              ownedDevice = discovered;
              if (connectionAttempt === attempt) connecting = discovered;
              discovered = await discovered.discoverAllServicesAndCharacteristics();
              ownedDevice = discovered;
              if (current !== generation || disposed) {
                await discovered.cancelConnection();
                return;
              }
              casioProfile = await selectCasioProfile(
                discovered,
                (await discovered.services()).map((service) => service.uuid),
                casioModel,
              );
            }
            if (!casioProfile) throw new Error("CASIO_SERVICE_MISSING");
          } else if (family === "pebble") {
            // Pairing, PPoGATT readiness and firmware identity only; history is
            // requested later, by the sync action, with a durable sink.
            const prepareAbort = new AbortController();
            pebblePrepareAbort = prepareAbort;
            pebbleSession = (deps.createPebbleSession ?? createDurablePebbleSession)({
              device: discovered,
              // The scanned peripheral id: Android MAC address, iOS UUID.
              nativeId: deviceId,
              advertisedName: knownDevice.name,
              bondAdapter: (deps.pebbleBondAdapter ?? loadPebbleBondAdapter)(),
              ...(deps.pebblePrepareTimeoutMs !== undefined
                ? { prepareTimeoutMs: deps.pebblePrepareTimeoutMs }
                : {}),
            });
            try {
              pebblePeer = await pebbleSession.prepare(prepareAbort.signal);
            } catch (error) {
              await pebbleSession.close().catch(() => undefined);
              throw error;
            } finally {
              if (pebblePrepareAbort === prepareAbort) pebblePrepareAbort = null;
            }
            if (current !== generation || disposed) {
              await pebbleSession.close().catch(() => undefined);
              return;
            }
          } else if (family === "fossil_hr") {
            // Identity only (Device Information reads); the key is used later,
            // inside the sync action.
            const prepareAbort = new AbortController();
            fossilPrepareAbort = prepareAbort;
            fossilSession = (deps.createFossilSession ?? createFossilHrSession)({
              device: discovered,
              nativeId: deviceId,
              advertisedName: knownDevice.name,
              crypto: deps.fossilCrypto ?? loadFossilCrypto,
            });
            try {
              fossilPeer = await fossilSession.prepare(prepareAbort.signal);
            } catch (error) {
              await fossilSession.close().catch(() => undefined);
              throw error;
            } finally {
              if (fossilPrepareAbort === prepareAbort) fossilPrepareAbort = null;
            }
            if (current !== generation || disposed) {
              await fossilSession.close().catch(() => undefined);
              return;
            }
          }
          disconnectSubscription = r.manager.onDeviceDisconnected(discovered.id, () => {
            if (disposed || connected !== discovered || current !== generation) return;
            connected = null;
            connectedFamily = null;
            connectedProfile = null;
            connectedHuaweiProfile = null;
            connectedGarminProfile = null;
            connectedCasioProfile = null;
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
            connectedHuaweiBr = null;
            void connectedCasioSession?.close();
            connectedCasioSession = null;
            void connectedPebbleSession?.close();
            connectedPebbleSession = null;
            connectedPebblePeer = null;
            void connectedFossilSession?.close();
            connectedFossilSession = null;
            connectedFossilPeer = null;
            // A finished Pebble capture ends the link itself; that is not an error.
            const expectedDisconnect = pebbleCaptureEnding;
            pebbleCaptureEnding = false;
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
              errorCode: expectedDisconnect ? null : "DEVICE_DISCONNECTED",
            });
          });
          connected = discovered;
          connectedFamily = family;
          connectedProfile = profile;
          connectedHuaweiProfile = huaweiProfile;
          connectedGarminProfile = garminProfile;
          connectedCasioProfile = casioProfile;
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
          if (casioProfile && deps.onHistorySample) {
            void connectedCasioSession?.close();
            // The steps fetch starts on connection; `fetchSteps` only awaits it
            // so its records commit inside the sync action's authority window.
            connectedCasioSession = createCasioSession({
              device: discovered,
              profile: casioProfile,
              onRecord: deps.onHistorySample,
            });
            connectedCasioSession.start();
          }
          if (pebbleSession && pebblePeer) {
            void connectedPebbleSession?.close();
            connectedPebbleSession = pebbleSession;
            connectedPebblePeer = pebblePeer;
          }
          if (fossilSession && fossilPeer) {
            void connectedFossilSession?.close();
            connectedFossilSession = fossilSession;
            connectedFossilPeer = fossilPeer;
          }
          const huaweiBrSync =
            huaweiProfile !== null &&
            huaweiModel?.transport === "br" &&
            deps.onHistorySample !== undefined &&
            btClassicSupported();
          if (huaweiBrSync && huaweiModel) {
            void connectedHuaweiSession?.close();
            connectedHuaweiSession = null;
            connectedHuaweiBr = { model: huaweiModel, bleAddress: discovered.id, deviceId };
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
              hichainStore: huaweiHiChainStore(),
              onAuthPrompt: (prompt) => publish({ pairingPrompt: prompt }),
            });
          }
          publish({
            phase: "connected",
            connectedDeviceId: deviceId,
            connectedModelId: pebblePeer
              ? pebblePeer.identity.modelId
              : fossilPeer
                ? fossilPeer.model.id
                : model!.id,
            connectedFamily: family,
            capabilities: Object.freeze({
              stepsHistory:
                family === "zepp_os" ||
                family === "xiaomi" ||
                family === "fitpro" ||
                family === "huami_legacy" ||
                (family === "casio" && casioProfile?.source !== null) ||
                (family === "pebble" && pebblePeer !== null) ||
                (family === "fossil_hr" && fossilPeer !== null) ||
                (family === "huawei" && (huaweiModel?.sync === true || huaweiBrSync)) ||
                (family === "garmin" && garminModel?.sync === true),
              liveCapture: family === "ble_gatt" || family === "ble_scale",
              historySync:
                family === "colmi_ring" ||
                family === "bangle_js" ||
                family === "moyoung" ||
                family === "fitpro" ||
                family === "gloryfit" ||
                family === "huami_legacy" ||
                (family === "casio" && casioProfile?.source !== null) ||
                (family === "pebble" && pebblePeer !== null) ||
                (family === "huawei" && (huaweiModel?.sync === true || huaweiBrSync)) ||
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
      connectedCasioProfile = null;
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
      connectedHuaweiBr = null;
      void connectedCasioSession?.close();
      connectedCasioSession = null;
      pebblePrepareAbort?.abort();
      pebblePrepareAbort = null;
      pebbleCaptureEnding = false;
      void connectedPebbleSession?.close();
      connectedPebbleSession = null;
      connectedPebblePeer = null;
      fossilPrepareAbort?.abort();
      fossilPrepareAbort = null;
      void connectedFossilSession?.close();
      connectedFossilSession = null;
      connectedFossilPeer = null;
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
    getFossilPeer() {
      return connected && connectedFamily === "fossil_hr" ? connectedFossilPeer : null;
    },
    async fossilDownload(options) {
      const session = connectedFossilSession;
      if (!connected || connectedFamily !== "fossil_hr" || !session)
        throw new Error("FOSSIL_NOT_CONNECTED");
      return session.downloadActivity(options);
    },
    async fossilDelete(options) {
      const session = connectedFossilSession;
      if (!connected || connectedFamily !== "fossil_hr" || !session)
        throw new Error("FOSSIL_NOT_CONNECTED");
      return session.deleteFile(options);
    },
    getPebblePeer() {
      return connected && connectedFamily === "pebble" ? connectedPebblePeer : null;
    },
    async capturePebble(options) {
      const session = connectedPebbleSession;
      if (!connected || connectedFamily !== "pebble" || !session || !connectedPebblePeer)
        return Object.freeze({ status: "failed", code: "PEBBLE_NOT_CONNECTED" } as const);
      // The transport ends the link at every terminal outcome; mark that
      // disconnect as expected so it is not reported as a dropped connection.
      pebbleCaptureEnding = true;
      let outcome: PebbleSessionOutcome;
      try {
        outcome = await session.capture(options);
      } catch {
        outcome = Object.freeze({ status: "failed", code: "PEBBLE_CAPTURE_FAILED" } as const);
      }
      // "cancelled" the caller did not ask for is a dropped link (the
      // disconnect handler closes the session), not a user cancel.
      if (outcome.status === "cancelled" && !options.signal.aborted)
        outcome = Object.freeze({ status: "failed", code: "PEBBLE_LINK_LOST" } as const);
      // Settle setup state (lease, handles, snapshot) before the caller
      // publishes its result, so a late link event cannot overwrite it.
      if (connectedPebbleSession === session) await controller.disconnect();
      return outcome;
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
        if (!connectedHuaweiSession && !connectedHuaweiBr)
          throw new Error("HUAWEI_HISTORY_UNSUPPORTED");
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
      // Protect against stale/manually constructed connected state too.
      // Pebble history goes through `capturePebble` with a durable sink.
      if (connectedFamily === "pebble") throw new Error("PEBBLE_USE_DURABLE_CAPTURE");
      // Fossil history goes through fossilDownload, durable storage, then fossilDelete.
      if (connectedFamily === "fossil_hr") throw new Error("FOSSIL_USE_FILE_SYNC");
      // Casio client-role models fetch their hourly step buckets on connection;
      // the sync action only awaits that fetch.
      if (connectedFamily === "casio") {
        if (!connectedCasioProfile) throw new Error("CASIO_SERVICE_MISSING");
        if (!connectedCasioSession) throw new Error("CASIO_STEPS_UNSUPPORTED");
      }
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
                complete: !linked.signal.aborted && session.complete,
                granularity: "minute" as const,
              };
            })()
          : connectedFamily === "casio"
            ? (async () => {
                const session = connectedCasioSession;
                if (!session) throw new Error("CASIO_STEPS_UNSUPPORTED");
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
                  const br = connectedHuaweiBr;
                  if (br) {
                    await runHuaweiBrSync({
                      model: br.model,
                      bleAddress: br.bleAddress,
                      deviceId: br.deviceId,
                      btClassic: (deps.btClassicAdapter ?? loadBtClassicAdapter)(),
                      bond: (deps.pebbleBondAdapter ?? loadPebbleBondAdapter)(),
                      onRecord: deps.onHistorySample!,
                      signal: linked.signal,
                      hichainStore: huaweiHiChainStore(),
                      onAuthPrompt: (prompt) => publish({ pairingPrompt: prompt }),
                    });
                    return {
                      pages: 0,
                      minutes: 0,
                      complete: !linked.signal.aborted,
                      granularity: "minute" as const,
                    };
                  }
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
        if (snapshot.pairingPrompt) publish({ pairingPrompt: null });
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
      connectedCasioProfile = null;
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
      connectedHuaweiBr = null;
      void connectedCasioSession?.close();
      connectedCasioSession = null;
      pebblePrepareAbort?.abort();
      pebblePrepareAbort = null;
      pebbleCaptureEnding = false;
      void connectedPebbleSession?.close();
      connectedPebbleSession = null;
      connectedPebblePeer = null;
      fossilPrepareAbort?.abort();
      fossilPrepareAbort = null;
      void connectedFossilSession?.close();
      connectedFossilSession = null;
      connectedFossilPeer = null;
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
function loadBtClassicAdapter(): BtClassicAdapter {
  // Lazy: the local Expo module is only required for a Bluetooth Classic watch.
  return (require("../../../modules/bt-classic") as typeof import("../../../modules/bt-classic"))
    .btClassicAdapter;
}
function loadPebbleBondAdapter(): PebbleBondAdapter {
  // Lazy: the local Expo module is only required on a real Pebble connect.
  return (require("../../../modules/pebble-bond") as typeof import("../../../modules/pebble-bond"))
    .pebbleBondAdapter;
}
function safeCode(error: unknown): string {
  const code = errorCode(error);
  return SAFE_CODES.has(code) ? code : "CONNECTION_FAILED";
}
const SAFE_CODES = new Set([
  "PEBBLE_CAPTURE_UNAVAILABLE",
  "PEBBLE_SERVICE_MISSING",
  "PEBBLE_PPOGATT_MISSING",
  "PEBBLE_NOT_CONNECTED",
  "PEBBLE_CONNECTIVITY_STALE",
  "PEBBLE_CONNECTIVITY_INCONSISTENT",
  "PEBBLE_PAIRING_UNSUPPORTED",
  "PEBBLE_PAIRING_INCOMPLETE",
  "PEBBLE_PAIRING_TIMEOUT",
  "PEBBLE_PAIRING_FAILED",
  "PEBBLE_PAIRING_BUSY",
  "PEBBLE_PAIRING_CANCELLED",
  "PEBBLE_PAIRING_INVALID_DEVICE",
  "PEBBLE_PAIRING_PERMISSION",
  "PEBBLE_PAIRING_UNAVAILABLE",
  "PEBBLE_PAIRING_INVALID_STATE",
  "PEBBLE_PREPARE_TIMEOUT",
  "PEBBLE_MONITOR_FAILED",
  "PEBBLE_WRITE_FAILED",
  "PEBBLE_IDENTITY_UNSUPPORTED",
  "PEBBLE_IDENTITY_CONFLICT",
  "PEBBLE_LINK_LOST",
  "FOSSIL_SERVICE_MISSING",
  "FOSSIL_DEVICE_INFO_UNAVAILABLE",
  "FOSSIL_MODEL_UNSUPPORTED",
  "FOSSIL_MONITOR_FAILED",
  "FOSSIL_WRITE_FAILED",
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
  "CASIO_SERVICE_MISSING",
  "CASIO_STEPS_UNSUPPORTED",
  "BANGLE_JS_SERVICE_MISSING",
  "MOYOUNG_SERVICE_MISSING",
  "FITPRO_SERVICE_MISSING",
  "GLORYFIT_SERVICE_MISSING",
  "HUAMI_LEGACY_SERVICE_MISSING",
  "BLUETOOTH_STATE_TIMEOUT",
  "SCAN_FAILED",
  "CONNECTION_FAILED",
]);
