/**
 * Garmin MLR (Multi-Link Reliable): the 2-byte header codec and the
 * go-back-N reliability layer that runs per ML service registration (pure, no
 * BLE).
 *
 * Ported one to one from Gadgetbridge at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2:
 * `service/devices/garmin/communicator/v2/MlrCommunicator.java` (`Mlr` below,
 * line numbers at that commit). Byte-level notes and the test vectors are in
 * `docs/research/notes/Garmin MLR transport/garmin-mlr-transport.md` §4.
 *
 * Header, per GATT write or notification (`Mlr:318-331`):
 *
 *     byte0  1 H H H R R R R   MLR flag, handle & 7, reqNum >> 2
 *     byte1  R R S S S S S S   reqNum & 3, seqNum
 *     byte2… data fragment (absent for an ACK-only packet)
 *
 * `reqNum` is a cumulative ACK (the sender's next expected sequence number);
 * both counters wrap modulo 64. The send window starts and is capped at 32,
 * the retransmission timeout starts at 1 s and doubles up to 20 s, and every
 * timeout halves the window and resends everything unacknowledged with the
 * request number each fragment was first sent with.
 *
 * Deviations from `Mlr`:
 * - a request number that would acknowledge more than is outstanding is
 *   ignored. Upstream applies every changed request number, so a stale one
 *   (a peer retransmits with the request number it first sent, as we do)
 *   would expire null slots, move `lastRcvAck` past `nextSendSeq` and stop
 *   sending for good (`Mlr:207-248`, INFERRED from the arithmetic). With 6-bit
 *   numbers a stale value at least `64 - outstanding` behind still reads as a
 *   valid ACK; that residual ambiguity is inherent to the protocol and is
 *   shared with upstream;
 * - the outgoing fragment queue is capped (`GARMIN_MLR_MAX_QUEUED_FRAGMENTS`)
 *   and `send()` after `close()` throws; upstream queues without bound and
 *   ignores a send after close;
 * - packets that arrive after `close()` are ignored; upstream removes the
 *   communicator from its handle map instead (`CommunicatorV2:446-451`);
 * - `maxPacketSize` is fixed for the life of the channel (the docs'
 *   requirement); upstream also updates it on an MTU change (`Mlr:84-88`);
 * - protocol state and the retransmission timer are updated before each
 *   write (upstream writes first), and a retransmission round restarts the
 *   timer only while something is outstanding, so a `sendPacket` that calls
 *   straight back into `receive` cannot leave a stale timer behind;
 * - an `onAcked` or `onData` listener that throws is ignored.
 *
 * Nothing here is hardware-validated: upstream has no recorded MLR traces, so
 * the tests are built from the upstream source and the vectors in the note.
 *
 * Licence: AGPL-3.0-or-later (same as upstream Gadgetbridge).
 */

import {
  GARMIN_MLR_FLAG_MASK,
  GARMIN_MLR_HANDLE_MASK,
  GARMIN_MLR_HANDLE_SHIFT,
  GARMIN_MLR_REQ_NUM_MASK,
  GARMIN_MLR_SEQ_NUM_MASK,
} from "./garmin";

/** `Mlr.MAX_SEQ_NUM`; sequence and request numbers live in 0..63. */
export const GARMIN_MLR_MAX_SEQ_NUM = 0x3f;
const SEQ_SPACE = GARMIN_MLR_MAX_SEQ_NUM + 1;
/** `Mlr.INITIAL_MAX_UNACKED_SEND`: initial and maximum send window. */
export const GARMIN_MLR_INITIAL_WINDOW = 0x20;
/** `Mlr.INITIAL_RETRANSMISSION_TIMEOUT`, ms. */
export const GARMIN_MLR_INITIAL_RTO_MS = 1_000;
/** `Mlr.MAX_RETRANSMISSION_TIMEOUT`, ms. */
export const GARMIN_MLR_MAX_RTO_MS = 20_000;
/** `Mlr.ACK_TIMEOUT`, ms: the delayed-ACK timer. */
export const GARMIN_MLR_ACK_TIMEOUT_MS = 20;
/** `Mlr.ACK_TRIGGER_THRESHOLD`: ACK at once after this many in-order packets. */
export const GARMIN_MLR_ACK_TRIGGER_THRESHOLD = 5;
/**
 * Local bound on queued, not yet sent fragments (not upstream). At the
 * smallest packet size (MTU 23: 18 data bytes) this is ~73 KB of GFDI.
 */
export const GARMIN_MLR_MAX_QUEUED_FRAGMENTS = 4_096;
/** The MLR header length; an ACK-only packet is exactly this long. */
export const GARMIN_MLR_HEADER_BYTES = 2;

export type GarminMlrHeader = Readonly<{
  /** Bit 7 of byte 0. */
  mlr: boolean;
  /** The 3-bit handle field (the registered handle is `0x80 | handle`). */
  handle: number;
  reqNum: number;
  seqNum: number;
}>;

function assertSeq(value: number, code: string): void {
  if (!Number.isInteger(value) || value < 0 || value > GARMIN_MLR_MAX_SEQ_NUM) {
    throw new Error(code);
  }
}

/** `Mlr.createPacket`: header plus data, for the registered `handle`. */
export function encodeGarminMlrPacket(
  handle: number,
  reqNum: number,
  seqNum: number,
  data: Uint8Array = new Uint8Array(0),
): Uint8Array {
  if (!Number.isInteger(handle) || handle < 0 || handle > 0xff) throw new Error("GARMIN_HANDLE");
  assertSeq(reqNum, "GARMIN_MLR_REQ_NUM");
  assertSeq(seqNum, "GARMIN_MLR_SEQ_NUM");
  const packet = new Uint8Array(GARMIN_MLR_HEADER_BYTES + data.length);
  packet[0] =
    GARMIN_MLR_FLAG_MASK |
    ((handle & 0x07) << GARMIN_MLR_HANDLE_SHIFT) |
    ((reqNum >> 2) & GARMIN_MLR_REQ_NUM_MASK);
  packet[1] = ((reqNum & 0x03) << 6) | (seqNum & GARMIN_MLR_SEQ_NUM_MASK);
  packet.set(data, GARMIN_MLR_HEADER_BYTES);
  return packet;
}

/** `Mlr.onPacketReceived` header decode (`Mlr:133-143`). */
export function decodeGarminMlrHeader(byte0: number, byte1: number): GarminMlrHeader {
  return {
    mlr: (byte0 & GARMIN_MLR_FLAG_MASK) !== 0,
    handle: (byte0 & GARMIN_MLR_HANDLE_MASK) >> GARMIN_MLR_HANDLE_SHIFT,
    reqNum: ((byte0 & GARMIN_MLR_REQ_NUM_MASK) << 2) | ((byte1 >> 6) & 0x03),
    seqNum: byte1 & GARMIN_MLR_SEQ_NUM_MASK,
  };
}

/**
 * The registered handle an MLR packet belongs to, as `CommunicatorV2` keys
 * its MLR communicators: `((byte0 & 0x70) >> 4) | 0x80` (`CommunicatorV2:201`).
 */
export function garminMlrRouteHandle(byte0: number): number {
  return ((byte0 & GARMIN_MLR_HANDLE_MASK) >> GARMIN_MLR_HANDLE_SHIFT) | GARMIN_MLR_FLAG_MASK;
}

/**
 * True when a granted handle can carry MLR traffic: upstream's routing only
 * ever reaches `0x80 | n`, n in 0..7 (`CommunicatorV2:201`). A reliable grant
 * outside that range would never receive a packet.
 */
export function isGarminMlrRoutableHandle(handle: number): boolean {
  return Number.isInteger(handle) && (handle & 0xf8) === GARMIN_MLR_FLAG_MASK;
}

export type GarminMlrTimers = Readonly<{
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}>;

export type GarminMlrChannelOptions = Readonly<{
  /** The handle the watch granted (`0x80 | n`). */
  handle: number;
  /** `calcMaxWriteChunk(mtu)`: bytes per GATT write, header included. */
  maxPacketSize: number;
  /** `MessageSender.sendPacket`: exactly one GATT write; fire and forget. */
  sendPacket: (packet: Uint8Array) => void;
  /** `MessageReceiver.onDataReceived`: in-order data, header stripped. */
  onData: (data: Uint8Array) => void;
  /** `AckListener.onAcked`: acknowledged data bytes, and whether all is acked. */
  onAcked?: (ackedBytes: number, allAcked: boolean) => void;
  timers: GarminMlrTimers;
}>;

type Fragment = Readonly<{ data: Uint8Array; reqNum: number }>;

const mod = (value: number): number => (value + SEQ_SPACE) % SEQ_SPACE;

/**
 * One MLR registration (`MlrCommunicator`). State starts at zero for every
 * successful registration (`Mlr:42-53`). JavaScript runs single-threaded,
 * which stands in for upstream's `lock`.
 */
export class GarminMlrChannel {
  readonly handle: number;
  readonly maxPacketSize: number;
  private lastSendAck = 0;
  private nextSendSeq = 0;
  private nextRcvSeq = 0;
  private lastRcvAck = 0;
  private maxNumUnackedSend = GARMIN_MLR_INITIAL_WINDOW;
  private retransmissionTimeout = GARMIN_MLR_INITIAL_RTO_MS;
  private readonly fragmentQueue: Uint8Array[] = [];
  private queueHead = 0;
  private readonly sentFragments: (Fragment | null)[] = Array.from(
    { length: SEQ_SPACE },
    () => null,
  );
  private ackTimer: unknown = null;
  private retransmissionTimer: unknown = null;
  private isClosed = false;

  constructor(private readonly options: GarminMlrChannelOptions) {
    if (!Number.isInteger(options.handle) || options.handle < 0 || options.handle > 0xff) {
      throw new Error("GARMIN_HANDLE");
    }
    if (
      !Number.isInteger(options.maxPacketSize) ||
      options.maxPacketSize <= GARMIN_MLR_HEADER_BYTES
    ) {
      throw new Error("GARMIN_WRITE_SIZE");
    }
    this.handle = options.handle;
    this.maxPacketSize = options.maxPacketSize;
  }

  get closed(): boolean {
    return this.isClosed;
  }

  /** Current send window (`maxNumUnackedSend`). */
  get window(): number {
    return this.maxNumUnackedSend;
  }

  /** Current retransmission timeout in ms. */
  get rto(): number {
    return this.retransmissionTimeout;
  }

  /** Sent but not yet acknowledged packets. */
  get unacked(): number {
    return mod(this.nextSendSeq - this.lastRcvAck);
  }

  /** Fragments waiting for the window to open. */
  get queued(): number {
    return this.fragmentQueue.length - this.queueHead;
  }

  /**
   * `Mlr.sendMessage` (`Mlr:96-124`): fragment into `maxPacketSize - 2` byte
   * pieces, queue them and send what the window allows.
   */
  send(message: Uint8Array): void {
    if (this.isClosed) throw new Error("GARMIN_MLR_CLOSED");
    if (message.length === 0) return;
    const chunk = this.maxPacketSize - GARMIN_MLR_HEADER_BYTES;
    const count = Math.ceil(message.length / chunk);
    if (this.queued + count > GARMIN_MLR_MAX_QUEUED_FRAGMENTS) {
      throw new Error("GARMIN_MLR_QUEUE_FULL");
    }
    for (let offset = 0; offset < message.length; offset += chunk) {
      this.fragmentQueue.push(message.slice(offset, offset + chunk));
    }
    this.runProtocol();
  }

  /** `Mlr.onPacketReceived` (`Mlr:126-176`). */
  receive(packet: Uint8Array): void {
    if (this.isClosed) return;
    if (packet.length < GARMIN_MLR_HEADER_BYTES) return;
    const header = decodeGarminMlrHeader(packet[0]!, packet[1]!);
    if (!header.mlr) return;
    if (header.handle !== (this.handle & 0x07)) return;

    const data = this.processPacket(header.reqNum, header.seqNum, packet);
    if (data) {
      try {
        this.options.onData(data);
      } catch {
        // `Mlr:163-167`: a receiver failure is logged and does not break MLR.
      }
    }
    // The receiver may have closed the channel (e.g. on a fatal message).
    if (this.isClosed) return;
    if (data) this.scheduleAckIfNeeded();
    this.runProtocol();
  }

  /** `Mlr.close` (`Mlr:378-388`): stop timers, drop queued fragments. */
  close(): void {
    this.isClosed = true;
    this.clearAckTimer();
    this.clearRetransmissionTimer();
    this.fragmentQueue.length = 0;
    this.queueHead = 0;
  }

  // -------------------------------------------------------------------------
  // Receive side
  // -------------------------------------------------------------------------

  /** `Mlr.processPacketLocked` (`Mlr:182-204`). */
  private processPacket(reqNum: number, seqNum: number, packet: Uint8Array): Uint8Array | null {
    if (reqNum !== this.lastRcvAck) this.processAck(reqNum);
    if (packet.length <= GARMIN_MLR_HEADER_BYTES) return null;
    if (seqNum !== this.nextRcvSeq) {
      // Out of order: no reorder buffer; re-send the expected ACK at once so
      // the peer goes back to `nextRcvSeq` (`Mlr:194-199`).
      this.sendAckPacket();
      return null;
    }
    this.nextRcvSeq = mod(this.nextRcvSeq + 1);
    return packet.slice(GARMIN_MLR_HEADER_BYTES);
  }

  /** `Mlr.processAckLocked` (`Mlr:207-248`). */
  private processAck(reqNum: number): void {
    const numAcked = mod(reqNum - this.lastRcvAck);
    const numUnacked = mod(this.nextSendSeq - this.lastRcvAck);
    // Deviation (see the module comment): an ACK beyond what is outstanding
    // is not a valid cumulative ACK, so it must not move the window.
    if (numAcked > numUnacked) return;

    this.clearRetransmissionTimer();
    let ackedBytes = 0;
    for (let index = this.lastRcvAck; index !== reqNum; index = mod(index + 1)) {
      ackedBytes += this.sentFragments[index]?.data.length ?? 0;
      this.sentFragments[index] = null;
    }
    this.lastRcvAck = reqNum;

    // Recover from a retransmission backoff.
    this.retransmissionTimeout = GARMIN_MLR_INITIAL_RTO_MS;
    this.maxNumUnackedSend = Math.min(this.maxNumUnackedSend + numAcked, GARMIN_MLR_INITIAL_WINDOW);

    if (this.options.onAcked && ackedBytes > 0) {
      try {
        this.options.onAcked(ackedBytes, this.queued === 0 && this.lastRcvAck === this.nextSendSeq);
      } catch {
        // A listener failure must not break the protocol state.
      }
    }
    if (this.lastRcvAck !== this.nextSendSeq) this.startRetransmissionTimer();
  }

  /** `Mlr.scheduleAckIfNeededLocked` (`Mlr:250-261`). */
  private scheduleAckIfNeeded(): void {
    this.clearAckTimer();
    const numRcvdUnacked = mod(this.nextRcvSeq - this.lastSendAck);
    if (numRcvdUnacked >= GARMIN_MLR_ACK_TRIGGER_THRESHOLD) {
      this.sendAckPacket();
    } else {
      this.ackTimer = this.options.timers.setTimeout(() => {
        this.ackTimer = null;
        this.sendAckPacket();
      }, GARMIN_MLR_ACK_TIMEOUT_MS);
    }
  }

  /** `Mlr.sendAckPacketLocked` (`Mlr:270-283`): ACK-only, seqNum 0. */
  private sendAckPacket(): void {
    if (this.isClosed) return;
    this.clearAckTimer();
    this.write(encodeGarminMlrPacket(this.handle, this.nextRcvSeq, 0));
    this.lastSendAck = this.nextRcvSeq;
  }

  // -------------------------------------------------------------------------
  // Send side
  // -------------------------------------------------------------------------

  /** `Mlr.runProtocolLocked` (`Mlr:285-316`). */
  private runProtocol(): void {
    if (this.isClosed) return;
    while (this.queueHead < this.fragmentQueue.length) {
      const numSentUnacked = mod(this.nextSendSeq - this.lastRcvAck);
      if (numSentUnacked >= this.maxNumUnackedSend) break;
      const data = this.fragmentQueue[this.queueHead]!;
      this.queueHead += 1;
      // The piggybacked ACK is stored so a retransmission repeats it
      // (upstream fix f4556e81cc). It does not update `lastSendAck`.
      const reqNum = this.nextRcvSeq;
      const seqNum = this.nextSendSeq;
      // State and timer are updated before the write (upstream writes first),
      // so a `sendPacket` that calls back into `receive` sees them settled.
      this.sentFragments[seqNum] = { data, reqNum };
      this.nextSendSeq = mod(seqNum + 1);
      if (numSentUnacked === 0) this.startRetransmissionTimer();
      this.write(encodeGarminMlrPacket(this.handle, reqNum, seqNum, data));
      if (this.isClosed) return;
    }
    this.compactQueue();
  }

  /** `Mlr.onRetransmissionTimeout` (`Mlr:341-376`): go-back-N. */
  private onRetransmissionTimeout(): void {
    this.retransmissionTimer = null;
    if (this.isClosed) return;
    this.retransmissionTimeout = Math.min(this.retransmissionTimeout * 2, GARMIN_MLR_MAX_RTO_MS);
    this.maxNumUnackedSend = Math.max(1, Math.floor(this.maxNumUnackedSend / 2));
    for (let index = this.lastRcvAck; index !== this.nextSendSeq; index = mod(index + 1)) {
      const fragment = this.sentFragments[index];
      if (!fragment) continue;
      this.write(encodeGarminMlrPacket(this.handle, fragment.reqNum, index, fragment.data));
      if (this.isClosed) return;
    }
    // Always true unless a write called back into `receive` and acked it all.
    if (this.lastRcvAck !== this.nextSendSeq) this.startRetransmissionTimer();
  }

  private startRetransmissionTimer(): void {
    this.clearRetransmissionTimer();
    this.retransmissionTimer = this.options.timers.setTimeout(
      () => this.onRetransmissionTimeout(),
      this.retransmissionTimeout,
    );
  }

  private clearRetransmissionTimer(): void {
    if (this.retransmissionTimer === null) return;
    this.options.timers.clearTimeout(this.retransmissionTimer);
    this.retransmissionTimer = null;
  }

  private clearAckTimer(): void {
    if (this.ackTimer === null) return;
    this.options.timers.clearTimeout(this.ackTimer);
    this.ackTimer = null;
  }

  private write(packet: Uint8Array): void {
    try {
      this.options.sendPacket(packet);
    } catch {
      // Upstream queues the write and never sees its outcome; a lost packet
      // is recovered by the peer's ACKs or our retransmission timer.
    }
  }

  private compactQueue(): void {
    if (this.queueHead === 0) return;
    if (this.queueHead >= this.fragmentQueue.length) {
      this.fragmentQueue.length = 0;
      this.queueHead = 0;
    } else if (this.queueHead > 64) {
      this.fragmentQueue.splice(0, this.queueHead);
      this.queueHead = 0;
    }
  }
}
