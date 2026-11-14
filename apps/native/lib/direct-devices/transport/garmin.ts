/**
 * Connection session for Garmin health wearables (GFDI over BLE, Multi-Link).
 *
 * Ported from Gadgetbridge at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2:
 * - `service/devices/garmin/GarminSupport.java` (initialization, file sync)
 * - `service/devices/garmin/communicator/v2/CommunicatorV2.java` (ML handles)
 * - `service/devices/garmin/messages/FileTransferHandler.java` (queue)
 * - `service/devices/garmin/fit/FitAsyncProcessor.java` (parse after download)
 *
 * Flow: connect → ML handshake (close all handles, register GFDI) → supported
 * file types + SYNC_READY → directory download → per-file download → FIT
 * parse → records; downloaded files are archived on the watch unless
 * `keepOnDevice` is set. Files already downloaded (tracked by the sync-state
 * store) are archived and skipped.
 *
 * Transport scope
 * ---------------
 * The session speaks the Multi-Link (ML) transport, which is what current
 * watches expose (`6a4e2800-…`). Devices that only advertise the v0/v1 GFDI
 * services are refused with `GARMIN_ML_REQUIRED` rather than half-supported.
 *
 * MLR (Multi-Link Reliable, `MlrCommunicator.java`) is negotiated per service
 * registration: models whose registry entry says `mlr: "preferred"` register
 * GFDI with `reliable = 2`, and whenever the watch grants a reliable handle
 * (asked or not, as upstream) GFDI runs through a `GarminMlrChannel` instead
 * of the plain `[handle][COBS]` path. A failed or unanswered reliable
 * registration is retried once as plain ML (a local safety net; upstream has
 * none). An unsolicited `CLOSE_HANDLE_RESP` for GFDI closes the channel and
 * registers again (`CommunicatorV2:456-464`). MLR retransmits without a
 * retry limit, so the per-request watchdogs below stay the outer bound. No
 * model is hardware-validated, over ML or MLR.
 *
 * Auth: none. Pairing is a GFDI system event (`PAIR_COMPLETE`); there is no
 * key exchange or account on the BLE link.
 *
 * Licence: AGPL-3.0-or-later (same as upstream).
 */

import type { Device } from "react-native-ble-plx";

import { getGarminMlrMode, type GarminMlrMode, type GarminModelId } from "../models/garmin";
import {
  GarminMlrChannel,
  garminMlrRouteHandle,
  isGarminMlrRoutableHandle,
} from "../protocol/garmin-mlr";
import {
  GARMIN_DOWNLOAD_STATUS,
  GarminCobsDecoder,
  GARMIN_FILE_FLAG,
  GARMIN_FIT_DATA_TYPE,
  GARMIN_ML_REQUEST,
  GARMIN_ML_SERVICE_GFDI,
  GARMIN_MESSAGE,
  GARMIN_REQUEST_TYPE,
  GARMIN_STATUS,
  GARMIN_SYSTEM_EVENT,
  buildGarminAuthNegotiationStatus,
  buildGarminConfiguration,
  buildGarminDeviceInformationReply,
  buildGarminDownloadRequest,
  buildGarminMlCloseAll,
  buildGarminMlRegisterService,
  buildGarminSetFileFlags,
  buildGarminStatusPayload,
  buildGarminSupportedFileTypesRequest,
  buildGarminSystemEvent,
  buildGarminTransferDataStatus,
  decodeGarminGfdiFrame,
  encodeGarminCobs,
  encodeGarminGfdiFrame,
  garminCrc16,
  garminFitRecords,
  isGarminDirectorySentinel,
  isGarminDirectoryType,
  isGarminActivityFile,
  isGarminHealthFile,
  parseGarminClassicAddress,
  parseGarminDeviceInformation,
  parseGarminDirectory,
  parseGarminFileTransferData,
  parseGarminMlMessage,
  parseGarminStatus,
  type GarminDirectoryEntry,
  type GarminGfdiFrame,
  type GarminMlMessage,
  type GarminRecord,
  type GarminStatusMessage,
} from "../protocol/garmin";
import { NativeGarminLink, type GarminBleProfile } from "./garmin-link";

/** Local watchdog for each request; upstream has no explicit timeout. */
export const GARMIN_WATCHDOG_MS = 30_000;
/** Delay before the first write, so the GATT link is ready after connect. */
export const GARMIN_INIT_DELAY_MS = 1_000;
/**
 * How long to wait after registration for the watch's `CONFIGURATION`, which
 * upstream waits for before requesting file types and SYNC_READY. A watch that
 * never sends it gets today's sequence after this delay.
 */
export const GARMIN_CONFIGURATION_WAIT_MS = 5_000;
/**
 * A file transfer fails after this long without a chunk; the overall cap
 * bounds one file (a long GPS workout at a few KB/s takes minutes).
 */
export const GARMIN_TRANSFER_MAX_MS = 10 * 60_000;
/** Larger files are skipped (left on the watch, not archived). */
export const GARMIN_MAX_FILE_BYTES = 8 * 1024 * 1024;
/** Safety bound on files per sync, so a broken directory cannot loop. */
export const GARMIN_MAX_FILES_PER_SYNC = 256;

export type GarminFailure =
  | "init"
  | "sync"
  | "file_transfer"
  | "fit"
  | "steps"
  | "heart_rate"
  | "sleep_session";

/** Last-sync bookkeeping so already-downloaded files are not fetched twice. */
export type GarminSyncStateStore = Readonly<{
  hasDownloaded(deviceId: string, key: string): boolean;
  markDownloaded(deviceId: string, key: string): void;
}>;

/** Creates an isolated in-memory store (used by tests and by default). */
export function createMemoryGarminSyncStateStore(): GarminSyncStateStore {
  const downloaded = new Map<string, Set<string>>();
  return {
    hasDownloaded: (deviceId, key) => downloaded.get(deviceId)?.has(key) ?? false,
    markDownloaded: (deviceId, key) => {
      const set = downloaded.get(deviceId) ?? new Set<string>();
      set.add(key);
      downloaded.set(deviceId, set);
    },
  };
}

/** Process-wide fallback store. */
export const defaultGarminSyncStateStore: GarminSyncStateStore = createMemoryGarminSyncStateStore();

export type GarminTimers = Readonly<{
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}>;

const defaultTimers: GarminTimers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** The transport surface the session drives; injectable for tests. */
export interface GarminSessionLink {
  readonly protocol: GarminBleProfile["protocol"];
  readonly maxWriteBytes: number;
  /** Raw BLE notifications, handle byte intact (ML). */
  subscribeRaw(onNotification: (bytes: Uint8Array) => void, onFailure: () => void): () => void;
  write(frame: GarminGfdiFrame, signal: AbortSignal): Promise<void>;
  writeRaw(bytes: Uint8Array, signal: AbortSignal): Promise<void>;
  /** Exactly one GATT write, no chunking (MLR packets). */
  writePacket(bytes: Uint8Array, signal: AbortSignal): Promise<void>;
  setHandle(handle: number): void;
  close(): Promise<void>;
}

type MonitorDevice = Pick<Device, "monitorCharacteristicForService">;
type WriteDevice = Pick<Device, "writeCharacteristicWithResponseForService"> & {
  mtu?: number;
};
type TransactionManager = { cancelTransaction(id: string): void };

export type GarminSessionOptions = Readonly<{
  device: MonitorDevice & WriteDevice;
  profile: GarminBleProfile;
  /** Stable device id used as the sync-state key. */
  deviceId: string;
  modelId: GarminModelId;
  /** Overrides the registry's MLR preference for `modelId`. */
  mlr?: GarminMlrMode;
  onRecord: (record: GarminRecord) => void;
  onFailure?: (failure: GarminFailure) => void;
  timers?: GarminTimers;
  watchdogMs?: number;
  initDelayMs?: number;
  configurationWaitMs?: number;
  /** Leave downloaded files on the watch instead of archiving them. */
  keepOnDevice?: boolean;
  syncState?: GarminSyncStateStore;
  /** Test seam; production builds a `NativeGarminLink`. */
  link?: GarminSessionLink;
  maxFiles?: number;
  manager?: TransactionManager;
  /**
   * Edge-class devices (issue #421): called when the BLE directory lists no
   * FIT file and the device reported a Classic address, as upstream's
   * `onDirectoryWithoutFitFiles` (GarminSupport:1067-1087). It runs the file
   * sync over RFCOMM (transport/garmin-rfcomm.ts) and resolves false when that
   * sync was cut short.
   */
  onDirectoryWithoutFitFiles?: (classicAddress: string, signal: AbortSignal) => Promise<boolean>;
}>;

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  promise.catch(() => undefined);
  return { promise, resolve, reject };
}

type TransferState = {
  expected: number;
  buffer: Uint8Array;
  received: number;
  crc: number;
  done: Deferred<Uint8Array>;
  /** Restarts the inactivity timer; set by `receiveTransfer`. */
  touch: () => void;
};

type MlWaiter = {
  requestType: number;
  done: Deferred<GarminMlMessage>;
};

/** The registered GFDI handle, and its MLR channel when the grant was reliable. */
type GfdiBinding = Readonly<{ handle: number; mlr: GarminMlrChannel | null }>;

const EMPTY = new Uint8Array(0);

/**
 * One device connection. `start()` subscribes and runs the sync chain;
 * `whenDone()` resolves when it ends; `close()` tears everything down.
 */
export class GarminSession {
  private readonly timers: GarminTimers;
  private readonly watchdogMs: number;
  private readonly initDelayMs: number;
  private readonly configurationWaitMs: number;
  /** Resolved by the watch's `CONFIGURATION` (or by close). */
  private readonly configured = deferred<void>();
  private readonly keepOnDevice: boolean;
  private readonly syncState: GarminSyncStateStore;
  private readonly maxFiles: number;
  private readonly link: GarminSessionLink;
  private readonly abort = new AbortController();
  private readonly decoder = new GarminCobsDecoder();
  /** Ask for MLR when registering GFDI (`GarminSupport.mlrEnabled`). */
  private readonly mlrPreferred: boolean;
  /** Set once a reliable registration failed; later ones ask for plain ML. */
  private mlrFallback = false;
  private gfdi: GfdiBinding | null = null;
  /** Resolved with the binding on every GFDI registration. */
  private bound = deferred<GfdiBinding>();
  /** `CommunicatorV2.closingAll`: a CLOSE_ALL_REQ is outstanding. */
  private closingAll = false;
  /** An unsolicited re-registration is in flight. */
  private reregistering = false;
  /** A failure that ends the session, e.g. GFDI could not be re-registered. */
  private fatal: Error | null = null;
  private readonly done: Promise<void>;
  private resolveDone!: () => void;
  private rejectDone!: (error: unknown) => void;
  private unsubscribe: (() => void) | null = null;
  private statusWaiter: {
    originalMessageType: number;
    done: Deferred<GarminStatusMessage>;
  } | null = null;
  private mlWaiter: MlWaiter | null = null;
  private transfer: TransferState | null = null;
  private stage: GarminFailure = "init";
  private settled = false;
  private started = false;
  private closed = false;
  /** A transfer stalled and the remaining files were left for the next sync. */
  private stalled = false;
  /** From DEVICE_INFORMATION (GarminSupport:505-510); used only by the RFCOMM hook. */
  private classicAddress: string | null = null;

  constructor(private readonly options: GarminSessionOptions) {
    this.timers = options.timers ?? defaultTimers;
    this.watchdogMs = options.watchdogMs ?? GARMIN_WATCHDOG_MS;
    this.initDelayMs = options.initDelayMs ?? GARMIN_INIT_DELAY_MS;
    this.configurationWaitMs = options.configurationWaitMs ?? GARMIN_CONFIGURATION_WAIT_MS;
    this.keepOnDevice = options.keepOnDevice ?? false;
    this.syncState = options.syncState ?? defaultGarminSyncStateStore;
    this.maxFiles = options.maxFiles ?? GARMIN_MAX_FILES_PER_SYNC;
    this.mlrPreferred = (options.mlr ?? getGarminMlrMode(options.modelId)) === "preferred";
    this.link =
      options.link ?? new NativeGarminLink(options.device, options.profile, options.manager);
    this.done = new Promise<void>((resolve, reject) => {
      this.resolveDone = resolve;
      this.rejectDone = reject;
    });
    this.done.catch(() => undefined);
  }

  /** Starts the chain. Safe to call once; later calls are ignored. */
  start(): void {
    if (this.started || this.closed) return;
    this.started = true;
    try {
      this.unsubscribe = this.link.subscribeRaw(
        (bytes) => this.handleNotification(bytes),
        () => this.options.onFailure?.(this.stage),
      );
    } catch {
      this.options.onFailure?.(this.stage);
    }
    void this.run();
  }

  /** Resolves when the chain finishes; rejects on a fatal transfer error. */
  whenDone(): Promise<void> {
    return this.done;
  }

  /** False when a stalled transfer cut the sync short (files remain on the watch). */
  get complete(): boolean {
    return !this.stalled;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.abort.abort();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.unbindGfdi();
    this.failPending(new Error("GARMIN_CLOSED"));
    await this.link.close().catch(() => undefined);
    this.settleResolve();
  }

  // -------------------------------------------------------------------------
  // Chain
  // -------------------------------------------------------------------------

  private async run(): Promise<void> {
    try {
      if (this.initDelayMs > 0) {
        await new Promise<void>((resolve) => this.timers.setTimeout(resolve, this.initDelayMs));
      }
      if (this.closed) return this.settleResolve();
      this.stage = "init";
      await this.initialize();
      if (this.closed) return this.settleResolve();
      this.stage = "file_transfer";
      await this.syncFiles();
      if (this.closed) return this.settleResolve();
      // A stalled sync is not complete: the watch keeps its remaining files.
      if (!this.stalled) await this.sendSystemEvent(GARMIN_SYSTEM_EVENT.SYNC_COMPLETE);
      this.settleResolve();
    } catch (error) {
      this.options.onFailure?.(this.stage);
      this.settleReject(error);
    }
  }

  private async initialize(): Promise<void> {
    if (this.link.protocol !== "v2") throw new Error("GARMIN_ML_REQUIRED");
    await this.registerMlHandle();
    // `GarminSupport.completeInitialization` runs on the capabilities event,
    // i.e. after DEVICE_INFORMATION and CONFIGURATION have been answered.
    await this.waitForConfiguration();
    if (this.closed) return;
    await this.writeFrame({
      messageType: GARMIN_MESSAGE.SUPPORTED_FILE_TYPES_REQUEST,
      payload: buildGarminSupportedFileTypesRequest(),
    });
    await this.sendSystemEvent(GARMIN_SYSTEM_EVENT.SYNC_READY);
  }

  /**
   * `CommunicatorV2.initializeDevice` + `processHandleManagement`: close every
   * handle, then register the GFDI service and keep its handle.
   */
  private async registerMlHandle(): Promise<void> {
    const closeAll = this.waitForMl(GARMIN_ML_REQUEST.CLOSE_ALL_RESP);
    this.closingAll = true;
    try {
      await this.link.writeRaw(buildGarminMlCloseAll(), this.abort.signal);
      await this.withWatchdog(closeAll.promise, "GARMIN_ML_CLOSE_TIMEOUT");
    } finally {
      this.closingAll = false;
      this.clearMlWaiter(closeAll);
    }
    await this.registerGfdi();
  }

  /**
   * Registers GFDI, reliable when MLR is preferred. A reliable request that is
   * refused, unanswered or granted on a handle MLR cannot route falls back to
   * plain ML once per session (INFERRED safety net; upstream has none).
   */
  private async registerGfdi(): Promise<void> {
    const reliable = this.mlrPreferred && !this.mlrFallback;
    try {
      await this.requestGfdiRegistration(reliable);
    } catch (error) {
      if (!reliable || this.closed) throw error;
      this.mlrFallback = true;
      await this.requestGfdiRegistration(false);
    }
  }

  private async requestGfdiRegistration(reliable: boolean): Promise<void> {
    const register = this.waitForMl(GARMIN_ML_REQUEST.REGISTER_ML_RESP);
    let response: GarminMlMessage;
    try {
      await this.link.writeRaw(
        buildGarminMlRegisterService(GARMIN_ML_SERVICE_GFDI, reliable),
        this.abort.signal,
      );
      response = await this.withWatchdog(register.promise, "GARMIN_ML_REGISTER_TIMEOUT");
    } finally {
      this.clearMlWaiter(register);
    }
    // `CommunicatorV2:364-367`: a non-zero status is a failed registration.
    if (response.handle === null || response.status !== 0) {
      throw new Error("GARMIN_ML_REGISTER_FAILED");
    }
    // `handleMlManagement` bound the grant synchronously, so GFDI messages
    // the watch sends right behind it are not lost; it refuses only an MLR
    // grant that no packet could reach. (The binding may already be gone
    // again: an unsolicited close re-registers on its own.)
    if ((response.reliable ?? 0) !== 0 && !isGarminMlrRoutableHandle(response.handle)) {
      throw new Error("GARMIN_MLR_HANDLE");
    }
  }

  /**
   * `CommunicatorV2:417-430`: any non-zero reliability byte is MLR, whether
   * or not it was asked for; zero is plain ML.
   */
  private bindGfdi(handle: number, reliable: number): void {
    if (reliable !== 0 && !isGarminMlrRoutableHandle(handle)) {
      // Upstream would key a communicator that no packet can reach
      // (`CommunicatorV2:201`); fail so the registration falls back to ML.
      throw new Error("GARMIN_MLR_HANDLE");
    }
    this.unbindGfdi();
    // Upstream creates a fresh `GfdiCallback` (and COBS decoder) per grant.
    this.decoder.reset();
    const mlr =
      reliable === 0
        ? null
        : new GarminMlrChannel({
            handle,
            maxPacketSize: this.link.maxWriteBytes,
            timers: this.timers,
            sendPacket: (packet) => {
              void this.link.writePacket(packet, this.abort.signal).catch(() => undefined);
            },
            onData: (data) => this.acceptGfdiBytes(data),
          });
    const binding: GfdiBinding = { handle, mlr };
    this.gfdi = binding;
    this.link.setHandle(handle);
    this.bound.resolve(binding);
  }

  private unbindGfdi(): void {
    const current = this.gfdi;
    if (!current) return;
    current.mlr?.close();
    this.gfdi = null;
    this.bound = deferred<GfdiBinding>();
  }

  /**
   * `CommunicatorV2:456-464`: the watch closed GFDI outside a close-all, so
   * register it again with the same MLR choice. Requests in flight keep
   * their watchdogs; if registration fails for good, the session ends.
   */
  private onGfdiClosed(): void {
    this.unbindGfdi();
    if (this.reregistering || this.closed || this.fatal) return;
    this.reregistering = true;
    this.registerGfdi().then(
      () => {
        this.reregistering = false;
      },
      (error: unknown) => {
        this.reregistering = false;
        if (this.closed) return;
        this.failSession(error instanceof Error ? error : new Error("GARMIN_ML_REGISTER_FAILED"));
      },
    );
  }

  private failSession(error: Error): void {
    if (this.fatal) return;
    this.fatal = error;
    this.unbindGfdi();
    this.bound.reject(error);
    this.failPending(error);
  }

  private async syncFiles(): Promise<void> {
    const directory = await this.downloadFile(0);
    const entries = parseGarminDirectory(directory);
    const rfcomm = this.options.onDirectoryWithoutFitFiles;
    // FileTransferHandler: no FIT entry moves the sync to RFCOMM.
    if (
      rfcomm &&
      this.classicAddress &&
      !entries.some((entry) => entry.dataType === GARMIN_FIT_DATA_TYPE)
    ) {
      if (!(await rfcomm(this.classicAddress, this.abort.signal))) this.stalled = true;
      return;
    }
    // Monitoring, sleep and HRV files first: ACTIVITY files can be large and
    // slow, and must not crowd them out of the file budget or a failing sync.
    const queue = entries
      .filter(
        (entry) =>
          !isGarminDirectorySentinel(entry) &&
          isGarminHealthFile(entry) &&
          entry.fileSize <= GARMIN_MAX_FILE_BYTES,
      )
      .sort(
        (left, right) => Number(isGarminActivityFile(left)) - Number(isGarminActivityFile(right)),
      );
    let processed = 0;
    for (const entry of queue) {
      if (this.closed) return;
      if (processed >= this.maxFiles) break;
      processed += 1;
      const key = this.fileKey(entry);
      if (this.syncState.hasDownloaded(this.options.deviceId, key)) {
        // Upstream archives files it already has and does not download again.
        await this.archive(entry);
        continue;
      }
      let bytes: Uint8Array;
      try {
        bytes = await this.downloadFile(entry.fileIndex);
      } catch (error) {
        // One failed file must not abort the whole sync, but after a stalled
        // transfer the watch may still be sending: stop asking for more.
        this.options.onFailure?.("file_transfer");
        if (this.closed) return;
        if (error instanceof Error && error.message === "GARMIN_TRANSFER_TIMEOUT") {
          this.stalled = true;
          return;
        }
        continue;
      }
      try {
        for (const record of garminFitRecords(bytes)) this.options.onRecord(record);
        this.syncState.markDownloaded(this.options.deviceId, key);
      } catch {
        // A parse failure is reported but does not stop the remaining files.
        this.options.onFailure?.("fit");
      }
      await this.archive(entry);
    }
  }

  private async archive(entry: GarminDirectoryEntry): Promise<void> {
    if (this.keepOnDevice || isGarminDirectoryType(entry)) return;
    await this.writeFrame({
      messageType: GARMIN_MESSAGE.SET_FILE_FLAG,
      payload: buildGarminSetFileFlags(entry.fileIndex, GARMIN_FILE_FLAG.ARCHIVE),
    }).catch(() => this.options.onFailure?.("file_transfer"));
  }

  /**
   * Requests one file (index 0 is the root directory) and collects its data
   * chunks. The download status carries the authoritative size.
   */
  private async downloadFile(fileIndex: number): Promise<Uint8Array> {
    const status = await this.requestStatus(GARMIN_MESSAGE.DOWNLOAD_REQUEST, () =>
      this.writeFrame({
        messageType: GARMIN_MESSAGE.DOWNLOAD_REQUEST,
        payload: buildGarminDownloadRequest({
          fileIndex,
          requestType: GARMIN_REQUEST_TYPE.NEW,
        }),
      }),
    );
    if (
      status.status !== GARMIN_STATUS.ACK ||
      status.downloadStatus !== GARMIN_DOWNLOAD_STATUS.OK ||
      status.maxFileSize === null
    ) {
      throw new Error("GARMIN_DOWNLOAD_REJECTED");
    }
    if (status.maxFileSize > GARMIN_MAX_FILE_BYTES) throw new Error("GARMIN_FILE_TOO_LARGE");
    return this.receiveTransfer(status.maxFileSize);
  }

  private async requestStatus(
    originalMessageType: number,
    send: () => Promise<void>,
  ): Promise<GarminStatusMessage> {
    const wait = deferred<GarminStatusMessage>();
    this.statusWaiter = { originalMessageType, done: wait };
    try {
      await send();
      return await this.withWatchdog(wait.promise, "GARMIN_STATUS_TIMEOUT");
    } finally {
      if (this.statusWaiter?.done === wait) this.statusWaiter = null;
    }
  }

  /**
   * Collects one file. The watchdog restarts on every chunk, so a large file
   * that keeps arriving is not cut off; `GARMIN_TRANSFER_MAX_MS` caps it.
   */
  private async receiveTransfer(expected: number): Promise<Uint8Array> {
    if (expected === 0) return new Uint8Array(0);
    const done = deferred<Uint8Array>();
    let idle: unknown = null;
    const fail = () => done.reject(new Error("GARMIN_TRANSFER_TIMEOUT"));
    const transfer: TransferState = {
      expected,
      buffer: new Uint8Array(expected),
      received: 0,
      crc: 0,
      done,
      touch: () => {
        if (idle !== null) this.timers.clearTimeout(idle);
        idle = this.timers.setTimeout(fail, this.watchdogMs);
      },
    };
    const cap = this.timers.setTimeout(fail, GARMIN_TRANSFER_MAX_MS);
    transfer.touch();
    this.transfer = transfer;
    try {
      return await done.promise;
    } finally {
      if (idle !== null) this.timers.clearTimeout(idle);
      this.timers.clearTimeout(cap);
      if (this.transfer === transfer) this.transfer = null;
    }
  }

  // -------------------------------------------------------------------------
  // Notifications
  // -------------------------------------------------------------------------

  /**
   * `CommunicatorV2.onCharacteristicChanged` (`CommunicatorV2:193-243`): a
   * packet with bit 7 set goes to the MLR channel when one is registered for
   * `((b0 & 0x70) >> 4) | 0x80`; everything else is read as `[handle][data]`,
   * so ML handles with the msb set still work (#5476). Handle 0 carries ML
   * handle management; the GFDI handle carries COBS data.
   */
  private handleNotification(bytes: Uint8Array): void {
    if (this.closed || bytes.length === 0) return;
    if (this.link.protocol !== "v2") return;
    const first = bytes[0]!;
    const gfdi = this.gfdi;
    if ((first & 0x80) !== 0 && gfdi?.mlr && garminMlrRouteHandle(first) === gfdi.handle) {
      gfdi.mlr.receive(bytes);
      return;
    }
    if (first === 0) {
      const message = parseGarminMlMessage(bytes);
      if (message) this.handleMlManagement(message);
      return;
    }
    // Plain ML data is accepted only on a plain ML GFDI registration; an MLR
    // registration's data always carries the MLR header.
    if (!gfdi || gfdi.mlr || first !== gfdi.handle) return;
    this.acceptGfdiBytes(bytes.subarray(1));
  }

  /** `CommunicatorV2.processHandleManagement`, for the GFDI service. */
  private handleMlManagement(message: GarminMlMessage): void {
    switch (message.requestType) {
      case GARMIN_ML_REQUEST.CLOSE_ALL_RESP:
        this.resolveMlWaiter(message);
        return;
      case GARMIN_ML_REQUEST.REGISTER_ML_RESP:
        if (message.service !== GARMIN_ML_SERVICE_GFDI) return;
        // Bind before anything else is read: the watch starts GFDI (e.g.
        // DEVICE_INFORMATION) right after the grant. An unrequested grant
        // (e.g. the late answer to a registration that timed out) replaces
        // the current one, as upstream overwrites its handle maps
        // (`CommunicatorV2:372-430`).
        if (message.status === 0 && message.handle !== null) {
          try {
            this.bindGfdi(message.handle, message.reliable ?? 0);
          } catch {
            // An unroutable MLR grant: keep the current registration; a
            // waiting registration sees the mismatch and falls back.
          }
        }
        this.resolveMlWaiter(message);
        return;
      case GARMIN_ML_REQUEST.CLOSE_HANDLE_RESP:
        // Upstream matches the service only; matching the handle as well keeps
        // a late close of a superseded registration from closing the current.
        if (
          message.service === GARMIN_ML_SERVICE_GFDI &&
          !this.closingAll &&
          this.gfdi !== null &&
          message.handle === this.gfdi.handle
        ) {
          this.onGfdiClosed();
        }
        return;
      default:
        return;
    }
  }

  /**
   * Feeds GFDI bytes (an ML payload or in-order MLR data) to the COBS decoder
   * and handles every complete message. MLR fragments do not line up with
   * GFDI messages, so one packet can end one frame and start or hold another.
   */
  private acceptGfdiBytes(bytes: Uint8Array): void {
    let decoded = this.decoder.accept(bytes);
    while (decoded) {
      this.handleGfdiMessage(decoded);
      if (this.closed) return;
      decoded = this.decoder.accept(EMPTY);
    }
  }

  private handleGfdiMessage(bytes: Uint8Array): void {
    if (this.closed) return;
    let frame: GarminGfdiFrame;
    try {
      frame = decodeGarminGfdiFrame(bytes);
    } catch {
      this.options.onFailure?.(this.stage);
      return;
    }
    if (frame.messageType === GARMIN_MESSAGE.RESPONSE) {
      let status: GarminStatusMessage;
      try {
        status = parseGarminStatus(frame.payload);
      } catch {
        this.options.onFailure?.(this.stage);
        return;
      }
      const waiter = this.statusWaiter;
      if (waiter && waiter.originalMessageType === status.originalMessageType) {
        this.statusWaiter = null;
        waiter.done.resolve(status);
      }
      return;
    }
    if (frame.messageType === GARMIN_MESSAGE.FILE_TRANSFER_DATA) {
      this.handleTransferChunk(frame.payload);
      return;
    }
    this.answerWatch(frame);
  }

  private handleTransferChunk(payload: Uint8Array): void {
    const transfer = this.transfer;
    if (!transfer) return;
    let chunk: ReturnType<typeof parseGarminFileTransferData>;
    try {
      chunk = parseGarminFileTransferData(payload);
    } catch {
      transfer.done.reject(new Error("GARMIN_TRANSFER_TRUNCATED"));
      return;
    }
    if (chunk.dataOffset !== transfer.received) {
      transfer.done.reject(new Error("GARMIN_TRANSFER_OFFSET"));
      return;
    }
    const crc = garminCrc16(chunk.data, transfer.crc);
    if (crc !== chunk.crc) {
      transfer.done.reject(new Error("GARMIN_TRANSFER_CRC"));
      return;
    }
    transfer.crc = crc;
    const take = Math.min(chunk.data.length, transfer.expected - transfer.received);
    transfer.buffer.set(chunk.data.subarray(0, take), transfer.received);
    transfer.received += chunk.data.length;
    const offset = transfer.received;
    transfer.touch();
    // Acknowledge every chunk, otherwise the watch stops sending.
    void this.writeFrame({
      messageType: GARMIN_MESSAGE.RESPONSE,
      payload: buildGarminTransferDataStatus(offset),
    }).catch(() => undefined);
    if (offset >= transfer.expected) {
      this.transfer = null;
      transfer.done.resolve(transfer.buffer);
    }
  }

  // -------------------------------------------------------------------------
  // Writes and waits
  // -------------------------------------------------------------------------

  /**
   * `CommunicatorV2.sendMessage`: COBS-encode the frame, then hand it to the
   * MLR channel when GFDI is reliable, else to the ML chunker. While GFDI is
   * being registered again, writes wait for the new handle (bounded by the
   * watchdog). An MLR write resolves once queued; the channel delivers it.
   */
  private async writeFrame(frame: GarminGfdiFrame): Promise<void> {
    const binding = await this.gfdiBinding();
    if (binding.mlr) {
      if (this.abort.signal.aborted) throw new Error("CANCELLED");
      binding.mlr.send(encodeGarminCobs(encodeGarminGfdiFrame(frame)));
      return;
    }
    await this.link.write(frame, this.abort.signal);
  }

  private gfdiBinding(): Promise<GfdiBinding> {
    if (this.fatal) return Promise.reject(this.fatal);
    if (this.closed) return Promise.reject(new Error("GARMIN_CLOSED"));
    if (this.gfdi) return Promise.resolve(this.gfdi);
    return this.withWatchdog(this.bound.promise, "GARMIN_ML_REGISTER_TIMEOUT");
  }

  private sendSystemEvent(eventType: number): Promise<void> {
    return this.writeFrame({
      messageType: GARMIN_MESSAGE.SYSTEM_EVENT,
      payload: buildGarminSystemEvent(eventType),
    });
  }

  private waitForConfiguration(): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = this.timers.setTimeout(resolve, this.configurationWaitMs);
      void this.configured.promise.then(() => {
        this.timers.clearTimeout(timer);
        resolve();
      });
    });
  }

  /**
   * Writes in order, as upstream sends status, reply, followup. Never rejects:
   * a lost reply surfaces as the watch's own timeout, not as a session error.
   */
  private reply(frames: readonly GarminGfdiFrame[]): Promise<void> {
    let chain = Promise.resolve();
    for (const frame of frames) chain = chain.then(() => this.writeFrame(frame));
    return chain.catch(() => undefined);
  }

  private status(originalMessageType: number, status: number): GarminGfdiFrame {
    return {
      messageType: GARMIN_MESSAGE.RESPONSE,
      payload: buildGarminStatusPayload(originalMessageType, status),
    };
  }

  /**
   * `GarminSupport.onMessage` for the incoming messages this family answers;
   * anything else gets no reply, as upstream sends none for unparsed types.
   */
  private answerWatch(frame: GarminGfdiFrame): void {
    const type = frame.messageType;
    switch (type) {
      case GARMIN_MESSAGE.DEVICE_INFORMATION: {
        let info: ReturnType<typeof parseGarminDeviceInformation>;
        try {
          info = parseGarminDeviceInformation(frame.payload);
        } catch {
          return;
        }
        this.classicAddress = parseGarminClassicAddress(frame.payload) ?? this.classicAddress;
        void this.reply([
          this.status(type, GARMIN_STATUS.ACK),
          {
            messageType: GARMIN_MESSAGE.RESPONSE,
            payload: buildGarminDeviceInformationReply(info.protocolVersion),
          },
        ]);
        return;
      }
      case GARMIN_MESSAGE.CONFIGURATION:
        // Upstream initializes only after both are sent (`onMessage`, then the
        // capabilities event).
        void this.reply([
          this.status(type, GARMIN_STATUS.ACK),
          { messageType: GARMIN_MESSAGE.CONFIGURATION, payload: buildGarminConfiguration() },
        ]).then(() => this.configured.resolve());
        return;
      case GARMIN_MESSAGE.AUTH_NEGOTIATION: {
        let payload: Uint8Array;
        try {
          payload = buildGarminAuthNegotiationStatus(frame.payload);
        } catch {
          return;
        }
        void this.reply([{ messageType: GARMIN_MESSAGE.RESPONSE, payload }]);
        return;
      }
      case GARMIN_MESSAGE.CURRENT_TIME_REQUEST:
        // Upstream's reply when time sync is off: this family never sets the clock.
        void this.reply([this.status(type, GARMIN_STATUS.UNSUPPORTED)]);
        return;
      // Parsed upstream with the default ACK status; we take no action. We
      // advertise upstream's capabilities, so a watch may send the feature
      // requests too, and gets the same ACK upstream sends.
      case GARMIN_MESSAGE.BATTERY_STATUS:
      case GARMIN_MESSAGE.SYNCHRONIZATION:
      case GARMIN_MESSAGE.FILE_AVAILABLE:
      case GARMIN_MESSAGE.CREATE_FILE:
      case GARMIN_MESSAGE.WEATHER_REQUEST:
      case GARMIN_MESSAGE.FIND_MY_PHONE_REQUEST:
      case GARMIN_MESSAGE.FIND_MY_PHONE_CANCEL:
      case GARMIN_MESSAGE.MUSIC_CONTROL:
        void this.reply([this.status(type, GARMIN_STATUS.ACK)]);
        return;
      // FIT_DEFINITION/FIT_DATA, NOTIFICATION_CONTROL/SUBSCRIPTION, PROTOBUF_*
      // and MUSIC_CONTROL_CAPABILITIES have their own status formats upstream
      // and imply follow-up work we do not do; they stay unanswered rather
      // than get a status that claims otherwise. Unparsed types: nothing, as
      // upstream (`UnhandledMessage`).
      default:
        return;
    }
  }

  private waitForMl(requestType: number): Deferred<GarminMlMessage> {
    const wait = deferred<GarminMlMessage>();
    this.mlWaiter = { requestType, done: wait };
    return wait;
  }

  private resolveMlWaiter(message: GarminMlMessage): boolean {
    const waiter = this.mlWaiter;
    if (!waiter || waiter.requestType !== message.requestType) return false;
    this.mlWaiter = null;
    waiter.done.resolve(message);
    return true;
  }

  private clearMlWaiter(wait: Deferred<GarminMlMessage>): void {
    if (this.mlWaiter?.done === wait) this.mlWaiter = null;
  }

  private withWatchdog<T>(promise: Promise<T>, code: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = this.timers.setTimeout(() => reject(new Error(code)), this.watchdogMs);
      promise.then(
        (value) => {
          this.timers.clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          this.timers.clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  private fileKey(entry: GarminDirectoryEntry): string {
    return `${entry.fileIndex}:${entry.fileNumber}:${entry.fileSize}:${entry.timestamp ?? 0}`;
  }

  private failPending(error: Error): void {
    this.configured.resolve();
    // No-op when GFDI is bound; otherwise wakes writes waiting for a handle.
    this.bound.reject(error);
    const status = this.statusWaiter;
    if (status) {
      this.statusWaiter = null;
      status.done.reject(error);
    }
    const ml = this.mlWaiter;
    if (ml) {
      this.mlWaiter = null;
      ml.done.reject(error);
    }
    const transfer = this.transfer;
    if (transfer) {
      this.transfer = null;
      transfer.done.reject(error);
    }
  }

  private settleResolve(): void {
    if (this.settled) return;
    this.settled = true;
    this.resolveDone();
  }

  private settleReject(error: unknown): void {
    if (this.settled) return;
    this.settled = true;
    this.rejectDone(error);
  }
}

/** Creates a Garmin session for a selected ML profile. */
export function createGarminSession(options: GarminSessionOptions): GarminSession {
  return new GarminSession(options);
}
