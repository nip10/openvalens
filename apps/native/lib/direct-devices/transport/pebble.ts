/**
 * Connection session for Pebble 2 / Time 2 / 2 Duo watches.
 *
 * Ported from Gadgetbridge at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2
 * (`service/devices/pebble/PebbleLESupport.java`, `PebbleGATTClient.java`,
 * `PebbleProtocol.java`, `DatalogSessionHealth*.java`).
 *
 * Transport choice
 * ----------------
 * Upstream normally makes the phone a GATT *server* (`PebbleGATTServer`,
 * services `10000000-…` and `BADBADBA-…`) and the watch writes PPoGATT packets
 * into it. A central-only BLE stack cannot host a GATT server, so this session
 * uses upstream's `clientOnly` path instead: the phone is a GATT client of the
 * watch's PPoGATT service `30000003-…`, notifying on `30000004-…` and writing
 * `30000006-…`. Upstream marks that path experimental and "only possible for
 * Pebble 2"; the three BLE models use the same PPoGATT shim.
 *
 * Flow
 * ----
 * 1. Enable notifications on the PPoGATT read characteristic.
 * 2. Negotiate the MTU (request 339, clamped by `pebble_mtu_limit`, default
 *    512, range 20-512) and derive the chunk size.
 * 3. Request the firmware version (upstream writes it immediately on connect).
 * 4. Enable health tracking and HRM with BlobDB preference writes, then send
 *    the health-sync request (endpoint 911).
 * 5. Answer every PPoGATT packet: data is ACKed and fed to the frame
 *    reassembler, command 2 gets the magic `03 19 19`, ACKs are ignored.
 * 6. Handle DATALOG sessions: OPENSESSION/SENDDATA/CLOSE/TIMEOUT/ACK/NACK.
 *    Steps (tag 81), sleep bounds (tag 83) and overlays (tag 84) produce
 *    records; tag 85 is a stub upstream and produces nothing.
 *
 * Completion
 * ----------
 * The watch gives no explicit "sync finished" marker. `DurablePebbleTransport`
 * reports `idle` once every health session has closed and no health traffic
 * follows for `PEBBLE_SYNC_QUIET_MS` (any later open or data cancels that
 * window). It fails with `PEBBLE_CAPTURE_TIMEOUT` when no health session opens
 * within `PEBBLE_SYNC_WATCHDOG_MS`, and with `PEBBLE_CAPTURE_STALLED` when an
 * open session goes silent for that long. `idle` is not proof of complete
 * history. The legacy `PebbleSession` facade above it never starts.
 *
 * Licence: AGPL-3.0-or-later (same as upstream).
 */

import type { Characteristic, Device, Subscription } from "react-native-ble-plx";

import {
  PEBBLE_SERVICE_UUID,
  isPebbleCandidateName,
  type PebbleModel,
  type PebbleModelId,
} from "../models/pebble";
import { normalizeServiceUuid } from "../models/ble-gatt";
import {
  PEBBLE_CONNECTIVITY_UUID,
  PEBBLE_PAIRING_TRIGGER_UUID,
  PEBBLE_MTU_UUID,
  PEBBLE_ENDPOINT_DATALOG,
  PEBBLE_MTU_LIMIT_DEFAULT,
  PEBBLE_MTU_LIMIT_MAX,
  PEBBLE_MTU_LIMIT_MIN,
  PEBBLE_ENDPOINT_FIRMWARE_VERSION,
  PEBBLE_HEALTH_LOG_TAG_OVERLAY,
  PEBBLE_HEALTH_LOG_TAG_SLEEP,
  PEBBLE_HEALTH_LOG_TAG_STEPS,
  PEBBLE_MTU_REQUEST,
  PEBBLE_PPOGATT_READ_UUID,
  PEBBLE_PPOGATT_SERVICE_UUID,
  PEBBLE_PPOGATT_WRITE_UUID,
  PEBBLE_UUID_ZERO,
  assembleSleepSessions,
  chunkPpogatt,
  createPebbleReassembler,
  decodeDatalogPayload,
  decodePpogattHeader,
  encodeActivateHealth,
  encodeActivateHrm,
  encodeDatalogAck,
  encodeDatalogFrame,
  encodeDatalogNack,
  encodeFirmwareVersionReq,
  encodeHealthSync,
  encodePpogattAck,
  parseOverlaySessionData,
  parseSleepSessionData,
  parseStepsSessionData,
  parseFirmwareVersion,
  ppogattMagicResponse,
  stepsSamplesToRecords,
  type PebbleDatalogFrame,
  type PebbleFailure,
  type PebbleFrame,
  type PebbleHealthProfile,
  type PebbleRecord,
  type PebbleSleepBounds,
  type PebbleSleepOverlay,
} from "../protocol/pebble";
import type {
  DurablePebbleSession,
  PebblePacket,
  PebblePacketSink,
  PebblePeer,
  PebbleSessionOutcome,
} from "../pebble-types";

/** Services a registered Pebble BLE model exposes. */
export const PEBBLE_SERVICE_UUIDS: ReadonlySet<string> = new Set([
  PEBBLE_SERVICE_UUID,
  PEBBLE_PPOGATT_SERVICE_UUID,
]);

/** Local safety net for a silent watch; upstream has no timeout. */
export const PEBBLE_SYNC_WATCHDOG_MS = 30_000;
/** Quiet window after the last session closes before the sync is considered done. */
export const PEBBLE_SYNC_QUIET_MS = 2_000;
/** Window after the health-sync request in which a session must open. */
export const PEBBLE_SYNC_START_MS = 5_000;

export type PebbleProfile = Readonly<{
  modelId: PebbleModelId;
  serviceUuid: string;
  ppogattServiceUuid: string;
  /** Watch → phone notify characteristic (`30000004-…`). */
  readUuid: string;
  /** Phone → watch write characteristic (`30000006-…`). */
  writeUuid: string;
  /** Clamped `pebble_mtu_limit`. */
  mtuLimit: number;
}>;

type ProfileDevice = Pick<Device, "characteristicsForService">;

async function characteristicUuidsFor(
  device: ProfileDevice,
  serviceUuid: string,
): Promise<readonly string[]> {
  const characteristics = await device.characteristicsForService(serviceUuid);
  return characteristics.map((characteristic) => normalizeServiceUuid(characteristic.uuid));
}

/** Clamps the `pebble_mtu_limit` preference like `PebbleLESupport` does. */
export function clampPebbleMtuLimit(limit: number | undefined): number {
  const value = limit ?? PEBBLE_MTU_LIMIT_DEFAULT;
  return Math.min(PEBBLE_MTU_LIMIT_MAX, Math.max(PEBBLE_MTU_LIMIT_MIN, Math.trunc(value)));
}

/**
 * Picks the Pebble PPoGATT profile from the connected device's services. The
 * `0000fed9` pairing service and the `30000003` PPoGATT service with both its
 * read (`30000004`) and write (`30000006`) characteristics are required.
 * Returns null for a Bluetooth Classic model or when anything is missing.
 */
export async function selectPebbleProfile(
  device: ProfileDevice,
  serviceUuids: readonly string[],
  model: Pick<PebbleModel, "id" | "bleOnly">,
  options?: { mtuLimit?: number },
): Promise<PebbleProfile | null> {
  if (!model.bleOnly) return null;
  const services = new Set(serviceUuids.map(normalizeServiceUuid));
  if (!services.has(PEBBLE_SERVICE_UUID)) return null;
  if (!services.has(PEBBLE_PPOGATT_SERVICE_UUID)) return null;
  const characteristics = await characteristicUuidsFor(device, PEBBLE_PPOGATT_SERVICE_UUID);
  if (!characteristics.includes(PEBBLE_PPOGATT_READ_UUID)) return null;
  if (!characteristics.includes(PEBBLE_PPOGATT_WRITE_UUID)) return null;
  return {
    modelId: model.id,
    serviceUuid: PEBBLE_SERVICE_UUID,
    ppogattServiceUuid: PEBBLE_PPOGATT_SERVICE_UUID,
    readUuid: PEBBLE_PPOGATT_READ_UUID,
    writeUuid: PEBBLE_PPOGATT_WRITE_UUID,
    mtuLimit: clampPebbleMtuLimit(options?.mtuLimit),
  };
}

/** Selects GATT characteristics before firmware identity is known. */
export async function selectPebbleCandidateProfile(
  device: ProfileDevice,
  serviceUuids: readonly string[],
  options?: { mtuLimit?: number },
): Promise<Omit<PebbleProfile, "modelId"> | null> {
  const services = new Set(serviceUuids.map(normalizeServiceUuid));
  if (!services.has(PEBBLE_SERVICE_UUID) || !services.has(PEBBLE_PPOGATT_SERVICE_UUID)) return null;
  const characteristics = await characteristicUuidsFor(device, PEBBLE_PPOGATT_SERVICE_UUID);
  if (!characteristics.includes(PEBBLE_PPOGATT_READ_UUID)) return null;
  if (!characteristics.includes(PEBBLE_PPOGATT_WRITE_UUID)) return null;
  return {
    serviceUuid: PEBBLE_SERVICE_UUID,
    ppogattServiceUuid: PEBBLE_PPOGATT_SERVICE_UUID,
    readUuid: PEBBLE_PPOGATT_READ_UUID,
    writeUuid: PEBBLE_PPOGATT_WRITE_UUID,
    mtuLimit: clampPebbleMtuLimit(options?.mtuLimit),
  };
}

export type PebbleTimers = Readonly<{
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}>;

const defaultTimers: PebbleTimers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

type MonitorDevice = Pick<Device, "monitorCharacteristicForService">;
type WriteDevice = Pick<Device, "writeCharacteristicWithResponseForService">;
type MtuDevice = Readonly<{
  requestMTU?(mtu: number): Promise<unknown>;
  mtu?: number;
}>;

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function encodeBase64(bytes: Uint8Array): string {
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]!;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    output += BASE64_ALPHABET[first >> 2];
    output += BASE64_ALPHABET[((first & 0x03) << 4) | ((second ?? 0) >> 4)];
    output +=
      second === undefined ? "=" : BASE64_ALPHABET[((second & 0x0f) << 2) | ((third ?? 0) >> 6)];
    output += third === undefined ? "=" : BASE64_ALPHABET[third & 0x3f];
  }
  return output;
}

function decodeBase64(value: string): Uint8Array {
  const clean = value.replace(/=+$/, "");
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const character of clean) {
    const index = BASE64_ALPHABET.indexOf(character);
    if (index < 0) continue;
    buffer = (buffer << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

export type PebbleSessionOptions = Readonly<{
  device: MonitorDevice & Partial<WriteDevice> & MtuDevice;
  profile: PebbleProfile;
  onRecord: (record: PebbleRecord) => void;
  onFailure?: (failure: PebbleFailure) => void;
  timers?: PebbleTimers;
  /** Per-phase silence watchdog, re-armed by every inbound packet. */
  watchdogMs?: number;
  /** Quiet window after the last session closes. */
  quietMs?: number;
  /** Window after the health-sync request in which a session must open. */
  startTimeoutMs?: number;
  /** `pebble_sync_health` preference (default true). */
  syncHealth?: boolean;
  /**
   * Profile written by the `activityPreferences` health-enable BlobDB write.
   * Omitted by default: inventing a height/weight/age would overwrite the
   * user's real profile on the watch, so the write is only sent when the app
   * has a real profile to send.
   */
  healthProfile?: PebbleHealthProfile;
}>;

type Session = {
  id: number;
  logTag: number;
  itemSize: number;
  uuid: string;
};

type Watchdog = { handle: unknown; kind: "init" | "sync" };

/**
 * One watch connection. `start()` subscribes, negotiates the MTU and launches
 * the health sync; `whenDone()` settles when the sync finishes or fails and
 * `close()` tears everything down.
 */
export class PebbleSession {
  private readonly subscriptions = new Set<Subscription>();
  private readonly reassembler = createPebbleReassembler();
  private readonly timers: PebbleTimers;
  private readonly watchdogMs: number;
  private readonly quietMs: number;
  private readonly startTimeoutMs: number;
  private readonly syncHealth: boolean;
  private readonly healthProfile: PebbleHealthProfile | undefined;
  private readonly sessions = new Map<number, Session>();
  private effectiveMtu: number;
  /** 5-bit serial shared by every outbound data frame, like upstream. */
  private writeSerial = 0;
  private watchdog: Watchdog | null = null;
  private quietTimer: unknown = null;
  private startTimer: unknown = null;
  private phase: "init" | "sync" | "done" = "init";
  private healthSessionsOpened = 0;
  private healthSessionsClosed = 0;
  private closed = false;
  private settled = false;
  private resolveDone!: () => void;
  private readonly done: Promise<void>;

  constructor(private readonly options: PebbleSessionOptions) {
    this.timers = options.timers ?? defaultTimers;
    this.watchdogMs = options.watchdogMs ?? PEBBLE_SYNC_WATCHDOG_MS;
    this.quietMs = options.quietMs ?? PEBBLE_SYNC_QUIET_MS;
    this.startTimeoutMs = options.startTimeoutMs ?? PEBBLE_SYNC_START_MS;
    this.syncHealth = options.syncHealth ?? true;
    this.healthProfile = options.healthProfile;
    this.effectiveMtu = options.profile.mtuLimit;
    this.done = new Promise<void>((resolve) => {
      this.resolveDone = resolve;
    });
  }

  /** Resolves when the sync finishes, fails or the session is closed. */
  whenDone(): Promise<void> {
    return this.done;
  }

  start(): void {
    if (this.closed) return;
    // Legacy callback sessions cannot prove durable persistence before a
    // DATALOG ACK. Keep the export as an explicit unavailable facade until all
    // callers use createDurablePebbleSession.
    throw new Error("PEBBLE_CAPTURE_UNAVAILABLE");
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.clearWatchdog();
    this.clearQuietTimer();
    this.clearStartTimer();
    this.settle();
    for (const subscription of this.subscriptions) subscription.remove();
    this.subscriptions.clear();
    this.sessions.clear();
  }

  // -------------------------------------------------------------------------
  // Chain
  // -------------------------------------------------------------------------

  private async run(): Promise<void> {
    this.armWatchdog("init");
    await this.negotiateMtu();
    if (this.closed) return;

    await this.write(encodeFirmwareVersionReq()).catch(() => {
      this.options.onFailure?.("init");
    });
    if (this.closed) return;

    if (this.syncHealth) {
      // Upstream sends these from `fake://health` and `fake://hrm`. The
      // activityPreferences blob carries the user's height/weight/age/gender,
      // so it is only written when the app supplies a real profile.
      if (this.healthProfile) {
        await this.write(encodeActivateHealth(this.healthProfile)).catch(() => {
          this.options.onFailure?.("init");
        });
      }
      await this.write(encodeActivateHrm(true)).catch(() => {
        this.options.onFailure?.("init");
      });
      if (this.closed) return;
    }

    this.phase = "sync";
    this.armWatchdog("sync");
    await this.write(encodeHealthSync()).catch(() => {
      this.options.onFailure?.("sync");
    });
    if (this.closed) return;
    this.armStartTimer();
  }

  private async negotiateMtu(): Promise<void> {
    const request = this.options.device.requestMTU;
    if (!request) return;
    try {
      await request.call(this.options.device, PEBBLE_MTU_REQUEST);
    } catch {
      // iOS ignores MTU requests; the chunk size falls back to the limit.
    }
    const negotiated = this.options.device.mtu;
    if (typeof negotiated === "number" && Number.isFinite(negotiated) && negotiated > 0)
      this.effectiveMtu = Math.min(negotiated, this.options.profile.mtuLimit);
  }

  // -------------------------------------------------------------------------
  // Timers
  // -------------------------------------------------------------------------

  private armWatchdog(kind: "init" | "sync"): void {
    this.clearWatchdog();
    const handle = this.timers.setTimeout(() => {
      if (this.closed) return;
      this.watchdog = null;
      this.options.onFailure?.(kind);
      this.finish();
    }, this.watchdogMs);
    this.watchdog = { handle, kind };
  }

  private touchWatchdog(): void {
    if (this.phase === "done") return;
    this.armWatchdog(this.phase === "init" ? "init" : "sync");
  }

  private clearWatchdog(): void {
    if (!this.watchdog) return;
    this.timers.clearTimeout(this.watchdog.handle);
    this.watchdog = null;
  }

  private armQuietTimer(): void {
    this.clearQuietTimer();
    this.quietTimer = this.timers.setTimeout(() => {
      this.quietTimer = null;
      if (this.closed) return;
      if (this.sessions.size === 0) this.finish();
    }, this.quietMs);
  }

  private clearQuietTimer(): void {
    if (this.quietTimer === null) return;
    this.timers.clearTimeout(this.quietTimer);
    this.quietTimer = null;
  }

  private armStartTimer(): void {
    this.clearStartTimer();
    this.startTimer = this.timers.setTimeout(() => {
      this.startTimer = null;
      if (this.closed || this.phase !== "sync") return;
      // Nothing queued on the watch: an empty sync is a success, not a failure.
      if (this.healthSessionsOpened === 0) this.finish();
    }, this.startTimeoutMs);
  }

  private clearStartTimer(): void {
    if (this.startTimer === null) return;
    this.timers.clearTimeout(this.startTimer);
    this.startTimer = null;
  }

  private finish(): void {
    if (this.phase === "done") return;
    this.phase = "done";
    this.clearWatchdog();
    this.clearQuietTimer();
    this.clearStartTimer();
    this.emitSleepSessions();
    this.settle();
  }

  private settle(): void {
    if (this.settled) return;
    this.settled = true;
    this.resolveDone();
  }

  // -------------------------------------------------------------------------
  // Notifications
  // -------------------------------------------------------------------------

  private handlePpogatt(bytes: Uint8Array): void {
    if (this.closed || bytes.length === 0) return;
    const { command, serial } = decodePpogattHeader(bytes[0]!);
    if (command === 0x02) {
      // The watch asks a question we do not understand; answer the magic.
      void this.writeRaw(ppogattMagicResponse(bytes.length > 1)).catch(() => undefined);
      return;
    }
    if (command === 0x01) return; // ACK for one of our writes.
    if (command !== 0x00) return;

    this.touchWatchdog();
    if (this.phase === "init") this.phase = "sync";
    void this.writeRaw(encodePpogattAck(serial)).catch(() => undefined);
    for (const frame of this.reassembler.push(bytes.slice(1))) this.handleFrame(frame);
  }

  private handleFrame(frame: PebbleFrame): void {
    if (frame.endpoint === PEBBLE_ENDPOINT_DATALOG) {
      const datalog = decodeDatalogPayload(frame.payload);
      if (datalog) this.handleDatalog(datalog);
      return;
    }
    if (frame.endpoint === PEBBLE_ENDPOINT_FIRMWARE_VERSION) {
      // The reply is informational; the hardware revision is already known
      // from the registry match.
      return;
    }
  }

  private handleDatalog(frame: PebbleDatalogFrame): void {
    switch (frame.command) {
      case "open_session":
        this.sessions.set(frame.id, {
          id: frame.id,
          logTag: frame.logTag,
          itemSize: frame.itemSize,
          uuid: frame.uuid,
        });
        if (frame.uuid === PEBBLE_UUID_ZERO && this.isHealthTag(frame.logTag)) {
          this.healthSessionsOpened += 1;
          this.clearStartTimer();
        }
        this.reply(frame.id, "ack");
        return;
      case "send_data": {
        const session = this.sessions.get(frame.id);
        if (!session) {
          this.reply(frame.id, "nack");
          return;
        }
        const parsed = this.handleSessionData(session, frame.data);
        this.reply(frame.id, parsed ? "ack" : "nack");
        return;
      }
      case "close": {
        const session = this.sessions.get(frame.id);
        this.sessions.delete(frame.id);
        if (session) this.noteHealthSessionClosed(session);
        this.reply(frame.id, session ? "ack" : "nack");
        return;
      }
      case "timeout": {
        const session = this.sessions.get(frame.id);
        this.sessions.delete(frame.id);
        if (session) this.noteHealthSessionClosed(session);
        // Legacy facade (never started). Upstream ignores TIMEOUT; see DurablePebbleTransport.
        this.reply(frame.id, "nack");
        return;
      }
      case "ack":
      case "nack":
      case "report_sessions":
      case "unknown":
        return;
    }
  }

  private isHealthTag(tag: number): boolean {
    return (
      tag === PEBBLE_HEALTH_LOG_TAG_STEPS ||
      tag === PEBBLE_HEALTH_LOG_TAG_SLEEP ||
      tag === PEBBLE_HEALTH_LOG_TAG_OVERLAY ||
      tag === 85
    );
  }

  private noteHealthSessionClosed(session: Session): void {
    if (session.uuid !== PEBBLE_UUID_ZERO || !this.isHealthTag(session.logTag)) return;
    this.healthSessionsClosed += 1;
    if (this.healthSessionsClosed >= this.healthSessionsOpened) this.armQuietTimer();
  }

  /** Parses one SENDDATA payload and emits its records. Returns false to NACK. */
  private handleSessionData(session: Session, data: Uint8Array): boolean {
    if (session.uuid !== PEBBLE_UUID_ZERO) return false;
    switch (session.logTag) {
      case PEBBLE_HEALTH_LOG_TAG_STEPS: {
        const packets = parseStepsSessionData(data, session.itemSize);
        if (!packets) {
          this.options.onFailure?.("steps");
          return false;
        }
        for (const packet of packets) {
          const { steps, heartRate } = stepsSamplesToRecords(packet.samples);
          for (const record of steps) this.options.onRecord(record);
          for (const record of heartRate) this.options.onRecord(record);
        }
        return true;
      }
      case PEBBLE_HEALTH_LOG_TAG_SLEEP: {
        const bounds = parseSleepSessionData(data, session.itemSize);
        if (!bounds) {
          this.options.onFailure?.("sleep_session");
          return false;
        }
        this.sleepBounds.push(...bounds);
        return true;
      }
      case PEBBLE_HEALTH_LOG_TAG_OVERLAY: {
        const overlays = parseOverlaySessionData(data, session.itemSize);
        if (!overlays) {
          this.options.onFailure?.("sleep_session");
          return false;
        }
        this.sleepOverlays.push(...overlays);
        return true;
      }
      default:
        // Tag 85 (standalone HR) is a stub upstream: ACK, emit nothing.
        return true;
    }
  }

  // -------------------------------------------------------------------------
  // Sleep assembly
  // -------------------------------------------------------------------------

  private readonly sleepBounds: PebbleSleepBounds[] = [];
  private readonly sleepOverlays: PebbleSleepOverlay[] = [];

  /**
   * Tag 83 and tag 84 arrive as separate sessions, in either order, so the
   * combined sessions are emitted once when the sync finishes. Emitting them
   * earlier would produce a second record with the same external id when the
   * overlays arrived.
   */
  private emitSleepSessions(): void {
    for (const session of assembleSleepSessions(this.sleepBounds, this.sleepOverlays))
      this.options.onRecord(session);
  }

  // -------------------------------------------------------------------------
  // Writes and subscription
  // -------------------------------------------------------------------------

  private reply(id: number, kind: "ack" | "nack"): void {
    const payload = kind === "ack" ? encodeDatalogAck(id) : encodeDatalogNack(id);
    void this.write(encodeDatalogFrame(payload)).catch(() => {
      this.options.onFailure?.("init");
    });
  }

  /** Writes a complete Pebble frame, chunked into PPoGATT packets. */
  private async write(frame: Uint8Array): Promise<void> {
    const packets = chunkPpogatt(frame, this.effectiveMtu, this.writeSerial);
    this.writeSerial = (this.writeSerial + packets.length) & 0x1f;
    for (const packet of packets) await this.writeRaw(packet);
  }

  private async writeRaw(packet: Uint8Array): Promise<void> {
    const write = this.options.device.writeCharacteristicWithResponseForService;
    if (!write) throw new Error("PEBBLE_WRITE_UNAVAILABLE");
    const { ppogattServiceUuid, writeUuid } = this.options.profile;
    await write.call(this.options.device, ppogattServiceUuid, writeUuid, encodeBase64(packet));
  }

  private monitor(): void {
    if (this.closed) return;
    try {
      const subscription = this.options.device.monitorCharacteristicForService(
        this.options.profile.ppogattServiceUuid,
        this.options.profile.readUuid,
        (error, value: Characteristic | null) => {
          if (this.closed) return;
          if (error || !value?.value) {
            this.options.onFailure?.("init");
            return;
          }
          try {
            this.handlePpogatt(decodeBase64(value.value));
          } catch {
            this.options.onFailure?.("init");
          }
        },
      );
      this.subscriptions.add(subscription);
    } catch {
      this.options.onFailure?.("init");
    }
  }
}

/** Creates a watch session for a selected profile. */
export function createPebbleSession(options: PebbleSessionOptions): PebbleSession {
  return new PebbleSession(options);
}

/** Bond APIs are platform adapters; transport never assumes a pairing succeeded. */
export type PebbleBondAdapter = Readonly<{
  getState(nativeId: string): Promise<"none" | "bonding" | "bonded" | "unsupported">;
  ensureBonded(args: { nativeId: string; requestId: string; timeoutMs: number }): Promise<void>;
  cancelWait(requestId: string): Promise<void>;
}>;

export type DurablePebbleOptions = Readonly<{
  device: Device;
  nativeId: string;
  advertisedName?: string | null;
  advertisedHardwareId?: number | null;
  bondAdapter?: PebbleBondAdapter;
  timers?: PebbleTimers;
  pairingTimeoutMs?: number;
  prepareTimeoutMs?: number;
}>;

type DurableProfile = Omit<PebbleProfile, "modelId">;
type DurableOpen = Extract<PebbleDatalogFrame, { command: "open_session" }>;

function pebbleIdentity(hardwareId: number): PebblePeer["identity"] | null {
  if ([12, 14, 248, 250].includes(hardwareId))
    return { family: "pebble", modelId: "pebble_classic_2" };
  if (hardwareId === 15) return { family: "pebble", modelId: "pebble_2_duo" };
  if ([13, 16, 17, 18, 243, 244, 247, 249].includes(hardwareId))
    return { family: "pebble", modelId: "pebble_time_2" };
  return null;
}

/** Health sessions: UUID zero, tags 81/83/84, a usable item size. */
function isHealthOpen(frame: DurableOpen): boolean {
  return (
    frame.uuid === PEBBLE_UUID_ZERO && [81, 83, 84].includes(frame.logTag) && frame.itemSize > 0
  );
}

function characteristicBytes(value: Characteristic | null): Uint8Array {
  return value?.value ? decodeBase64(value.value) : new Uint8Array();
}

/** Prepare performs pairing/identity only; capture is the only history request. */
export class DurablePebbleTransport implements DurablePebbleSession {
  private readonly subscriptions = new Set<Subscription>();
  private readonly reassembler = createPebbleReassembler();
  /** Open health sessions (UUID zero, tags 81/83/84). */
  private readonly sessions = new Map<number, DurableOpen>();
  /** Sessions we ACK-open (as upstream does) but never accept data for. */
  private readonly foreignSessions = new Set<number>();
  /** Opens that arrive between prepare() and capture(); replayed at capture start. */
  private readonly preCaptureOpens: DurableOpen[] = [];
  private readonly timers: PebbleTimers;
  private profile: DurableProfile | null = null;
  private peer: PebblePeer | null = null;
  private serial = 0;
  private writeQueue: Promise<void> = Promise.resolve();
  private inboundQueue: Promise<void> = Promise.resolve();
  private inboundPending = 0;
  private outboundPending = 0;
  private writeFailure: unknown = null;
  private captureSignal: AbortSignal | null = null;
  private active = false;
  private terminal = false;
  private closed = false;
  private handshakeResolve: (() => void) | null = null;
  private handshakePromise: Promise<void>;
  /** Rejects once the session turns terminal, so prepare waits fail fast. */
  private readonly terminated: Promise<never>;
  private rejectTerminated: (error: Error) => void = () => undefined;
  private firmwareResolve: ((hardwareId: number) => void) | null = null;
  private terminalResolve: ((outcome: PebbleSessionOutcome) => void) | null = null;
  private receivedPackets = 0;
  private durableItems = 0;
  private device: Device;

  constructor(private readonly options: DurablePebbleOptions) {
    this.timers = options.timers ?? defaultTimers;
    this.device = options.device;
    this.handshakePromise = new Promise((resolve) => {
      this.handshakeResolve = resolve;
    });
    this.terminated = new Promise<never>((_, reject) => {
      this.rejectTerminated = reject;
    });
    // Observed only through withTimeout races; never an unhandled rejection.
    this.terminated.catch(() => undefined);
  }

  async prepare(signal: AbortSignal): Promise<PebblePeer> {
    if (this.closed) throw new Error("PEBBLE_CLOSED");
    if (signal.aborted) throw new Error("CANCELLED");
    const adapter = this.options.bondAdapter;
    let pairingRequest: string | null = null;
    // Cancellation covers the whole prepare, including the (long) bond wait.
    const abort = () => {
      if (pairingRequest) void adapter?.cancelWait(pairingRequest).catch(() => undefined);
      void this.close();
    };
    signal.addEventListener("abort", abort, { once: true });
    const checkpoint = () => {
      if (signal.aborted || this.closed) throw new Error("CANCELLED");
    };
    try {
      const device = this.device;
      const services = await device.services();
      checkpoint();
      const profile = await selectPebbleCandidateProfile(
        device,
        services.map((service) => service.uuid),
      );
      if (!profile) throw new Error("PEBBLE_PPOGATT_MISSING");
      this.profile = profile;
      const connectivity = await device.readCharacteristicForService(
        PEBBLE_SERVICE_UUID,
        PEBBLE_CONNECTIVITY_UUID,
      );
      checkpoint();
      let flags = characteristicBytes(connectivity)[0] ?? 0;
      if ((flags & 0x20) !== 0) throw new Error("PEBBLE_CONNECTIVITY_STALE");
      if ((flags & 0x01) === 0) throw new Error("PEBBLE_NOT_CONNECTED");
      const paired = (flags & 0x02) !== 0;
      const encrypted = (flags & 0x04) !== 0;
      if (encrypted && !paired) throw new Error("PEBBLE_CONNECTIVITY_INCONSISTENT");
      if (!paired) {
        if (!adapter) throw new Error("PEBBLE_PAIRING_UNSUPPORTED");
        const requestId = `${this.options.nativeId}:${Date.now()}`;
        // Check support first: the trigger can raise a system pairing prompt,
        // which must not appear for a connection that is about to be refused.
        const state = await adapter.getState(this.options.nativeId);
        if (state === "unsupported") throw new Error("PEBBLE_PAIRING_UNSUPPORTED");
        checkpoint();
        await device.writeCharacteristicWithResponseForService(
          PEBBLE_SERVICE_UUID,
          PEBBLE_PAIRING_TRIGGER_UUID,
          encodeBase64(Uint8Array.of(0x11)),
        );
        checkpoint();
        pairingRequest = requestId;
        try {
          await adapter.ensureBonded({
            nativeId: this.options.nativeId,
            requestId,
            timeoutMs: this.options.pairingTimeoutMs ?? 30_000,
          });
        } finally {
          pairingRequest = null;
          await adapter.cancelWait(requestId).catch(() => undefined);
        }
        checkpoint();
        flags =
          characteristicBytes(
            await device.readCharacteristicForService(
              PEBBLE_SERVICE_UUID,
              PEBBLE_CONNECTIVITY_UUID,
            ),
          )[0] ?? 0;
        checkpoint();
        if ((flags & 0x20) !== 0 || (flags & 0x06) !== 0x06)
          throw new Error("PEBBLE_PAIRING_INCOMPLETE");
      } else if (!encrypted) {
        throw new Error("PEBBLE_CONNECTIVITY_INCONSISTENT");
      }

      await this.startMonitor();
      checkpoint();
      await this.withTimeout(this.handshakePromise, this.options.prepareTimeoutMs ?? 10_000);
      // Listen before asking: the reply can arrive before the write settles.
      const firmware = new Promise<number>((resolve) => {
        this.firmwareResolve = resolve;
      });
      await this.writeFrame(encodeFirmwareVersionReq());
      const hardwareId = await this.withTimeout(firmware, this.options.prepareTimeoutMs ?? 10_000);
      this.firmwareResolve = null;
      if (
        this.options.advertisedHardwareId !== undefined &&
        this.options.advertisedHardwareId !== null &&
        this.options.advertisedHardwareId !== hardwareId
      )
        throw new Error("PEBBLE_IDENTITY_CONFLICT");
      const identity = pebbleIdentity(hardwareId);
      if (!identity) throw new Error("PEBBLE_IDENTITY_UNSUPPORTED");
      if (this.options.advertisedName && !isPebbleCandidateName(this.options.advertisedName))
        throw new Error("PEBBLE_IDENTITY_CONFLICT");
      this.peer = { nativeId: this.options.nativeId, hardwareId, identity };
      return this.peer;
    } catch (error) {
      await this.close();
      throw signal.aborted ? new Error("CANCELLED") : error;
    } finally {
      signal.removeEventListener("abort", abort);
    }
  }

  async capture(args: {
    signal: AbortSignal;
    sink: PebblePacketSink;
  }): Promise<PebbleSessionOutcome> {
    if (this.terminal) return { status: "failed", code: "PEBBLE_SESSION_TERMINAL" };
    if (!this.peer || !this.profile || this.closed)
      return { status: "failed", code: "PEBBLE_NOT_PREPARED" };
    if (this.active) return { status: "failed", code: "PEBBLE_CAPTURE_BUSY" };
    if (args.signal.aborted) return { status: "cancelled" };
    this.active = true;
    this.captureSink = args.sink;
    this.captureSignal = args.signal;
    this.openedAnySession = false;
    const done = new Promise<PebbleSessionOutcome>((resolve) => {
      this.terminalResolve = resolve;
    });
    const abort = () => this.finish({ status: "cancelled" });
    args.signal.addEventListener("abort", abort, { once: true });
    try {
      for (const open of this.preCaptureOpens.splice(0)) this.enqueueInbound(open);
      await this.writeFrame(encodeHealthSync());
      // A cancel or failure during the write must not leave a timer armed.
      if (!this.terminal && !this.openedAnySession)
        this.captureTimer = this.timers.setTimeout(() => {
          if (!this.openedAnySession)
            this.finish({ status: "failed", code: "PEBBLE_CAPTURE_TIMEOUT" });
        }, PEBBLE_SYNC_WATCHDOG_MS);
      const outcome = await done;
      return outcome;
    } catch (error) {
      this.finish({
        status: "failed",
        code: error instanceof Error ? error.message : "PEBBLE_CAPTURE_FAILED",
      });
      return done;
    } finally {
      args.signal.removeEventListener("abort", abort);
      this.active = false;
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.finish({ status: "cancelled" });
    for (const subscription of this.subscriptions) subscription.remove();
    this.subscriptions.clear();
    await this.device.cancelConnection().catch(() => undefined);
  }

  private async startMonitor(): Promise<void> {
    const profile = this.profile!;
    const device = this.device;
    // Initialize the upstream MTU characteristic, then consume ble-plx's returned device.
    await device.writeCharacteristicWithResponseForService(
      PEBBLE_SERVICE_UUID,
      PEBBLE_MTU_UUID,
      encodeBase64(Uint8Array.of(PEBBLE_MTU_REQUEST & 0xff, (PEBBLE_MTU_REQUEST >>> 8) & 0xff)),
    );
    let current = device;
    let mtuNegotiated = false;
    try {
      current = await device.requestMTU(PEBBLE_MTU_REQUEST);
      mtuNegotiated = true;
    } catch {
      // Platforms that cannot negotiate use the conservative BLE default.
    }
    this.device = current;
    const mtu =
      mtuNegotiated && Number.isFinite(current.mtu) && current.mtu >= 23 ? current.mtu : 23;
    this.profile = { ...profile, mtuLimit: Math.min(mtu, profile.mtuLimit) };
    try {
      const subscription = device.monitorCharacteristicForService(
        profile.ppogattServiceUuid,
        profile.readUuid,
        (error, value) => {
          if (error) {
            this.finish({ status: "failed", code: "PEBBLE_MONITOR_FAILED" });
            return;
          }
          if (!value?.value) return;
          this.handleNotification(characteristicBytes(value));
        },
      );
      this.subscriptions.add(subscription);
    } catch (error) {
      throw new Error("PEBBLE_MONITOR_FAILED", { cause: error });
    }
  }

  private handleNotification(bytes: Uint8Array): void {
    // Late notifications after a terminal outcome are dropped, not ACKed.
    if (this.closed || this.terminal || bytes.length === 0) return;
    const { command, serial } = decodePpogattHeader(bytes[0]!);
    if (command === 2) {
      void this.queueRaw(ppogattMagicResponse(bytes.length > 1))
        .then(() => {
          this.handshakeResolve?.();
          this.handshakeResolve = null;
        })
        .catch(() => this.finish({ status: "failed", code: "PEBBLE_WRITE_FAILED" }));
      return;
    }
    if (command !== 0) return;
    void this.queueRaw(encodePpogattAck(serial)).catch(() =>
      this.finish({ status: "failed", code: "PEBBLE_WRITE_FAILED" }),
    );
    for (const frame of this.reassembler.push(bytes.slice(1))) {
      if (frame.endpoint === PEBBLE_ENDPOINT_FIRMWARE_VERSION) {
        const firmware = parseFirmwareVersion(frame.payload);
        if (firmware) this.firmwareResolve?.(firmware.hardwareId);
      } else if (frame.endpoint === PEBBLE_ENDPOINT_DATALOG) {
        const datalog = decodeDatalogPayload(frame.payload);
        if (datalog) this.enqueueInbound(datalog);
      }
    }
  }

  private enqueueInbound(frame: PebbleDatalogFrame): void {
    if (this.terminal || this.closed) return;
    if (!this.active) {
      // The watch may push its data log as soon as the link is ready. Keep the
      // opens (bounded) so the sessions are known once capture starts; any
      // early data is left unanswered and the watch re-sends it.
      // Only health opens are kept (foreign ones cannot crowd them out), and
      // from as soon as the link is monitored, including the firmware wait.
      if (
        this.profile &&
        frame.command === "open_session" &&
        isHealthOpen(frame) &&
        this.preCaptureOpens.length < 16
      ) {
        const existing = this.preCaptureOpens.findIndex((open) => open.id === frame.id);
        if (existing >= 0) this.preCaptureOpens.splice(existing, 1);
        this.preCaptureOpens.push(frame);
      }
      return;
    }
    if (this.inboundPending >= 64) {
      this.finish({ status: "failed", code: "PEBBLE_INBOUND_QUEUE_FULL" });
      return;
    }
    this.inboundPending += 1;
    this.inboundQueue = this.inboundQueue
      .then(() => this.processDatalog(frame))
      .catch(() => this.finish({ status: "failed", code: "PEBBLE_PERSISTENCE_FAILED" }))
      .finally(() => {
        this.inboundPending -= 1;
      });
  }

  /**
   * Mirrors upstream `PebbleProtocol.decodeDatalog` replies: every OPEN is
   * ACKed; DATA for an unknown or unparseable session is NACKed (and capture
   * continues); CLOSE is answered with a NACK; TIMEOUT gets no reply. Only
   * health sessions (UUID zero, tags 81/83/84) are accepted; others are
   * ACK-opened but their data is NACKed so the watch keeps it.
   */
  private async processDatalog(frame: PebbleDatalogFrame): Promise<void> {
    if (!this.active || this.terminal || this.closed) return;
    switch (frame.command) {
      case "open_session": {
        if (isHealthOpen(frame)) {
          this.sessions.set(frame.id, frame);
          this.foreignSessions.delete(frame.id);
          this.noteHealthActivity();
          this.openedAnySession = true;
          if (this.captureTimer !== null) this.timers.clearTimeout(this.captureTimer);
          this.captureTimer = null;
        } else {
          this.sessions.delete(frame.id);
          this.foreignSessions.add(frame.id);
        }
        await this.datalogReply(frame.id, true);
        return;
      }
      case "send_data": {
        const session = this.sessions.get(frame.id);
        if (!session) {
          // Foreign or unknown (e.g. opened on an earlier connection): the
          // watch keeps NACKed data and re-opens or re-sends it. Unknown ones
          // may be health data left on the watch, so they count as rejected.
          if (!this.foreignSessions.has(frame.id)) this.rejectedPackets += 1;
          await this.datalogReply(frame.id, false);
          return;
        }
        const payloadValid =
          frame.data.length > 0 &&
          frame.data.length % session.itemSize === 0 &&
          frame.data.length / session.itemSize <= 10_000 &&
          ((session.logTag === PEBBLE_HEALTH_LOG_TAG_STEPS &&
            parseStepsSessionData(frame.data, session.itemSize) !== null) ||
            (session.logTag === PEBBLE_HEALTH_LOG_TAG_SLEEP &&
              parseSleepSessionData(frame.data, session.itemSize) !== null) ||
            (session.logTag === PEBBLE_HEALTH_LOG_TAG_OVERLAY &&
              parseOverlaySessionData(frame.data, session.itemSize) !== null));
        if (!payloadValid) {
          // Not counted as activity: a watch re-sending a bad packet must not
          // keep the stall watchdog from ending capture.
          this.rejectedPackets += 1;
          await this.datalogReply(frame.id, false);
          return;
        }
        this.noteHealthActivity();
        const packet: PebblePacket = {
          uuid: session.uuid,
          sessionTimestamp: session.timestamp,
          logTag: session.logTag as 81 | 83 | 84,
          itemType: session.itemType,
          itemSize: session.itemSize,
          data: frame.data.slice(),
        };
        let receipt;
        try {
          receipt = await this.captureSink!(packet);
        } catch (error) {
          // Storage failure: no reply at all (safe whatever the watch does
          // with a NACK), then disconnect. The packet stays on the watch.
          this.finish({
            status: "failed",
            code:
              error instanceof Error && error.message === "PEBBLE_INBOX_FULL"
                ? "PEBBLE_INBOX_FULL"
                : "PEBBLE_PERSISTENCE_FAILED",
          });
          return;
        }
        if (!receipt.durable) {
          this.finish({ status: "failed", code: "PEBBLE_DURABILITY_UNCONFIRMED" });
          return;
        }
        if (this.terminal || this.closed || this.captureSignal?.aborted) return;
        this.receivedPackets += 1;
        this.durableItems += receipt.insertedItems;
        await this.datalogReply(frame.id, true);
        return;
      }
      case "close": {
        const wasHealth = this.sessions.delete(frame.id);
        this.foreignSessions.delete(frame.id);
        if (wasHealth) this.noteHealthActivity();
        await this.datalogReply(frame.id, false);
        if (wasHealth && this.sessions.size === 0) this.startQuietWindow();
        return;
      }
      case "timeout":
        return; // Upstream logs and ignores TIMEOUT without replying.
      default:
        return;
    }
  }

  private captureSink: PebblePacketSink | null = null;
  private quietTimer: unknown = null;
  private captureTimer: unknown = null;
  private stallTimer: unknown = null;
  private openedAnySession = false;
  private rejectedPackets = 0;

  /** Health traffic: cancel a pending quiet window and re-arm the stall watchdog. */
  private noteHealthActivity(): void {
    if (this.quietTimer !== null) this.timers.clearTimeout(this.quietTimer);
    this.quietTimer = null;
    if (this.stallTimer !== null) this.timers.clearTimeout(this.stallTimer);
    this.stallTimer = this.timers.setTimeout(() => {
      this.stallTimer = null;
      if (this.active && !this.terminal)
        this.finish({
          status: "failed",
          code: "PEBBLE_CAPTURE_STALLED",
          // Durable data was still received; rejected packets stay on the watch.
          receivedPackets: this.receivedPackets,
          durableItems: this.durableItems,
          rejectedPackets: this.rejectedPackets,
        });
    }, PEBBLE_SYNC_WATCHDOG_MS);
  }

  private startQuietWindow(): void {
    if (this.quietTimer !== null) this.timers.clearTimeout(this.quietTimer);
    this.quietTimer = this.timers.setTimeout(() => {
      this.quietTimer = null;
      if (this.active && !this.terminal && this.sessions.size === 0)
        this.finish({
          status: "idle",
          receivedPackets: this.receivedPackets,
          durableItems: this.durableItems,
          rejectedPackets: this.rejectedPackets,
        });
    }, PEBBLE_SYNC_QUIET_MS);
  }

  private async datalogReply(id: number, accepted: boolean): Promise<void> {
    if (this.terminal || this.closed) return;
    await this.writeFrame(
      encodeDatalogFrame(accepted ? encodeDatalogAck(id) : encodeDatalogNack(id)),
      true,
    );
  }

  private writeFrame(frame: Uint8Array, captureOnly = false): Promise<void> {
    return this.enqueueWrite(async () => {
      if (this.closed) throw new Error("PEBBLE_CLOSED");
      if (captureOnly && (!this.active || this.terminal || this.captureSignal?.aborted)) return;
      const packets = chunkPpogatt(frame, this.profile?.mtuLimit ?? 23, this.serial);
      this.serial = (this.serial + packets.length) & 0x1f;
      for (const packet of packets) await this.writeRawDirect(packet);
    });
  }

  private queueRaw(packet: Uint8Array): Promise<void> {
    return this.enqueueWrite(() => this.writeRawDirect(packet));
  }

  private enqueueWrite(work: () => Promise<void>): Promise<void> {
    if (this.outboundPending >= 64) {
      this.finish({ status: "failed", code: "PEBBLE_OUTBOUND_QUEUE_FULL" });
      return Promise.reject(new Error("PEBBLE_OUTBOUND_QUEUE_FULL"));
    }
    this.outboundPending += 1;
    const job = this.writeQueue.then(async () => {
      if (this.writeFailure) throw this.writeFailure;
      await work();
    });
    this.writeQueue = job
      .catch((error) => {
        this.writeFailure = error;
        this.finish({ status: "failed", code: "PEBBLE_WRITE_FAILED" });
      })
      .finally(() => {
        this.outboundPending -= 1;
      });
    return job;
  }

  private async writeRawDirect(packet: Uint8Array): Promise<void> {
    const profile = this.profile;
    if (!profile) throw new Error("PEBBLE_NOT_PREPARED");
    await this.device.writeCharacteristicWithResponseForService(
      profile.ppogattServiceUuid,
      profile.writeUuid,
      encodeBase64(packet),
    );
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = this.timers.setTimeout(() => reject(new Error("PEBBLE_PREPARE_TIMEOUT")), ms);
      Promise.race([promise, this.terminated])
        .then(resolve, reject)
        .finally(() => this.timers.clearTimeout(timer));
    });
  }

  private finish(outcome: PebbleSessionOutcome): void {
    if (this.terminal) return;
    this.terminal = true;
    this.rejectTerminated(
      new Error(
        outcome.status === "failed"
          ? outcome.code
          : outcome.status === "cancelled"
            ? "CANCELLED"
            : "PEBBLE_SESSION_TERMINAL",
      ),
    );
    if (this.quietTimer !== null) this.timers.clearTimeout(this.quietTimer);
    if (this.captureTimer !== null) this.timers.clearTimeout(this.captureTimer);
    if (this.stallTimer !== null) this.timers.clearTimeout(this.stallTimer);
    this.quietTimer = null;
    this.captureTimer = null;
    this.stallTimer = null;
    this.sessions.clear();
    this.foreignSessions.clear();
    this.preCaptureOpens.length = 0;
    this.terminalResolve?.(outcome);
    this.terminalResolve = null;
    for (const subscription of this.subscriptions) subscription.remove();
    this.subscriptions.clear();
    void this.options.device.cancelConnection().catch(() => undefined);
  }
}

export function createDurablePebbleSession(options: DurablePebbleOptions): DurablePebbleSession {
  return new DurablePebbleTransport(options);
}
