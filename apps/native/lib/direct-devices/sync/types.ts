import type {
  DirectDeviceBindingSummary,
  DirectDevicePublication,
} from "@openvalens/api/contracts/direct-device";
import type { DirectDeviceFamily, HelioDiscoveredDevice, HelioSetupSnapshot } from "../setup/types";

export type HelioSyncContext = Readonly<{
  serverUrl: string;
  userId: string;
  organizationId: string;
  sessionId: string;
}>;

export type DirectDeviceConfirmationTarget = Readonly<{
  connectedDeviceId: string;
  family: DirectDeviceFamily;
  modelId: string;
  connectionGeneration: number;
}>;

export type HelioSyncSnapshot = Readonly<{
  phase:
    | "idle"
    | "loading_bindings"
    | "scanning"
    | "connecting"
    | "connected"
    | "authenticating"
    | "discovering_services"
    | "fetching"
    | "capturing"
    | "uploading"
    | "processing"
    | "cancelled"
    | "error";
  bindings: readonly DirectDeviceBindingSummary[];
  selectedBindingId: string | null;
  nearbyDevices: readonly HelioDiscoveredDevice[];
  connectedDeviceId: string | null;
  /** Matched Zepp OS registry id of the connected device, or null. */
  connectedModelId: string | null;
  connectedFamily: DirectDeviceFamily | null;
  connectionGeneration: number;
  capabilities: Readonly<{ stepsHistory: boolean; liveCapture: boolean; historySync: boolean }>;
  bluetooth: HelioSetupSnapshot["bluetooth"];
  errorCode: string | null;
  capturedMinutes: number;
  pendingEnvelopes: number;
  /** Locally quarantined legacy envelopes blocked with IDENTITY_REQUIRED. */
  blockedIdentityEnvelopes: number;
  acceptedEnvelopes: number;
  queuedEnvelopes: number;
  publication: DirectDevicePublication | null;
  isBusy: boolean;
  canSync: boolean;
}>;

export interface HelioSyncController {
  getSnapshot(): HelioSyncSnapshot;
  subscribe(listener: () => void): () => void;
  refreshBindings(): Promise<void>;
  createBinding(): Promise<void>;
  confirmBindingIdentity(deviceId: string, expected: DirectDeviceConfirmationTarget): Promise<void>;
  selectBinding(deviceId: string): void;
  startScan(): Promise<void>;
  stopScan(): Promise<void>;
  connect(nativeId: string): Promise<void>;
  syncSteps(authKeyHex: string): Promise<void>;
  retryUpload(): Promise<void>;
  cancel(): Promise<void>;
  dispose(): Promise<void>;
}
