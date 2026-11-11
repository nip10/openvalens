import type { BleGattModelId } from "../models/ble-gatt";
import type { BangleJsModelId } from "../models/bangle-js";
import type { BleScaleModelId } from "../models/ble-scale";
import type { ColmiRingModelId } from "../models/colmi-ring";
import type { FitProModelId } from "../models/fitpro";
import type { GloryFitModelId } from "../models/gloryfit";
import type { GarminModelId } from "../models/garmin";
import type { HuaweiModelId } from "../models/huawei";
import type { HuamiLegacyModelId } from "../models/huami-legacy";
import type { MoyoungModelId } from "../models/moyoung";
import type { XiaomiModelId } from "../models/xiaomi";
import type { ZeppOsModelId } from "../models/zepp-os";
import type { BleGattSample } from "../protocol/ble-gatt";
import type { BangleJsRecord } from "../protocol/bangle-js";
import type { WeightMeasurementSample } from "../protocol/ble-scale";
import type { ColmiRingRecord } from "../protocol/colmi-ring";
import type { FitProRecord } from "../protocol/fitpro";
import type { GarminRecord } from "../protocol/garmin";
import type { GloryFitRecord } from "../protocol/gloryfit";
import type { HuaweiRecord } from "../protocol/huawei";
import type { HuamiLegacyRecord } from "../protocol/huami-legacy";
import type { MoyoungRecord } from "../protocol/moyoung";
import type { HelioHistoryOptions, HelioHistoryResult } from "../protocol/types";

/** A model id from any direct-device registry. */
export type DirectDeviceModelId =
  | ZeppOsModelId
  | XiaomiModelId
  | HuaweiModelId
  | GarminModelId
  | BleGattModelId
  | BangleJsModelId
  | BleScaleModelId
  | ColmiRingModelId
  | GloryFitModelId
  | HuamiLegacyModelId
  | MoyoungModelId
  | FitProModelId;

/** The protocol family a discovered model belongs to. */
export type DirectDeviceFamily =
  | "zepp_os"
  | "xiaomi"
  | "huawei"
  | "garmin"
  | "ble_gatt"
  | "bangle_js"
  | "ble_scale"
  | "colmi_ring"
  | "gloryfit"
  | "huami_legacy"
  | "moyoung"
  | "fitpro";

/** A live sample from either connection-based capture family. */
export type DirectDeviceLiveSample = BleGattSample | WeightMeasurementSample;

/** A record emitted by a history-sync family (rings, Bangle.js and GloryFit sync on connection). */
export type DirectDeviceHistorySample =
  | ColmiRingRecord
  | BangleJsRecord
  | GloryFitRecord
  | GarminRecord
  | HuamiLegacyRecord
  | HuaweiRecord
  | MoyoungRecord
  | FitProRecord;

export type HelioDiscoveredDevice = Readonly<{
  id: string;
  name: string;
  rssi: number | null;
  /** Matched model id; absent only for legacy snapshots. */
  modelId?: DirectDeviceModelId;
  /** Matched protocol family; absent only for legacy snapshots. */
  family?: DirectDeviceFamily;
  /** Advertised service UUIDs, retained so UUID-only models can be re-matched. */
  serviceUuids?: readonly string[];
}>;

export type HelioSetupSnapshot = Readonly<{
  phase: "idle" | "scanning" | "connecting" | "connected" | "error";
  bluetooth: "unknown" | "powered_on" | "powered_off" | "unauthorized" | "unsupported";
  devices: readonly HelioDiscoveredDevice[];
  connectedDeviceId: string | null;
  /** Matched model id of the connected device; absent only for legacy snapshots. */
  connectedModelId?: DirectDeviceModelId | null;
  /** Protocol family of the connected device; absent only for legacy snapshots. */
  connectedFamily?: DirectDeviceFamily | null;
  capabilities: Readonly<{
    stepsHistory: boolean;
    liveCapture: boolean;
    /** True for families that sync stored history on connection (rings). */
    historySync: boolean;
  }>;
  errorCode: string | null;
  crypto: Readonly<{
    status: "not_checked" | "running" | "passed" | "unavailable" | "failed";
    code: string | null;
  }>;
}>;

export interface HelioSetupController {
  getSnapshot(): HelioSetupSnapshot;
  subscribe(listener: () => void): () => void;
  startScan(): Promise<void>;
  stopScan(): Promise<void>;
  connect(deviceId: string): Promise<void>;
  disconnect(): Promise<void>;
  runCryptoSelfTest(): Promise<void>;
  fetchSteps(options: HelioHistoryOptions): Promise<HelioHistoryResult>;
  dispose(): Promise<void>;
}
