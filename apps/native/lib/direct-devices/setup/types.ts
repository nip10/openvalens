import type { ZeppOsModelId } from "../models/zepp-os";
import type { HelioHistoryOptions, HelioHistoryResult } from "../protocol/types";

export type HelioDiscoveredDevice = Readonly<{
  id: string;
  name: string;
  rssi: number | null;
  /** Matched Zepp OS model id; absent only for legacy snapshots. */
  modelId?: ZeppOsModelId;
}>;

export type HelioSetupSnapshot = Readonly<{
  phase: "idle" | "scanning" | "connecting" | "connected" | "error";
  bluetooth: "unknown" | "powered_on" | "powered_off" | "unauthorized" | "unsupported";
  devices: readonly HelioDiscoveredDevice[];
  connectedDeviceId: string | null;
  /** Matched Zepp OS model id of the connected device; absent only for legacy snapshots. */
  connectedModelId?: ZeppOsModelId | null;
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
