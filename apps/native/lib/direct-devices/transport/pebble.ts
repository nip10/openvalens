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
 * The watch gives no explicit "sync finished" marker, so the session finishes
 * when the last health session closes and the line stays quiet for
 * `PEBBLE_SYNC_QUIET_MS`, or when no session opens within
 * `PEBBLE_SYNC_START_MS` (nothing to sync). A 30 s watchdog guards a silent
 * watch and reports a failure instead of hanging.
 *
 * Licence: AGPL-3.0-or-later (same as upstream).
 */

import type { Characteristic, Device, Subscription } from "react-native-ble-plx";

import { PEBBLE_SERVICE_UUID, type PebbleModel, type PebbleModelId } from "../models/pebble";
import { normalizeServiceUuid } from "../models/ble-gatt";
import {
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
    this.monitor();
    void this.run();
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
        // Upstream answers a TIMEOUT with a NACK.
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
