import type { GarminModelId } from "../models/garmin";
import type { HuaweiModelId } from "../models/huawei";
import type { XiaomiModelId } from "../models/xiaomi";
import type { ZeppOsModelId } from "../models/zepp-os";
import type { HelioHistoryOptions, HelioHistoryResult } from "../protocol/types";

/** A model id from any direct-device registry. */
export type DirectDeviceModelId = ZeppOsModelId | XiaomiModelId | HuaweiModelId | GarminModelId;

/** The protocol family a discovered model belongs to. */
export type DirectDeviceFamily = "zepp_os" | "xiaomi" | "huawei" | "garmin";

export type HelioDiscoveredDevice = Readonly<{
  id: string;
  name: string;
  rssi: number | null;
  /** Matched model id; absent only for legacy snapshots. */
  modelId?: DirectDeviceModelId;
  /** Matched protocol family; absent only for legacy snapshots. */
  family?: DirectDeviceFamily;
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
  capabilities: Readonly<{ stepsHistory: boolean }>;
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
