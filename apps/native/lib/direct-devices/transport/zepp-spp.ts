/**
 * Zepp OS over Bluetooth Classic SPP, Android only (issue #419; decided
 * 2026-11-13). Upstream defaults nine coordinators to `ZeppOsBtbrSupport`,
 * which opens an RFCOMM client socket to the Zepp serial service, asks for the
 * GATT-characteristic → SPP-channel map, starts a session and then runs the
 * unchanged Zepp OS protocol with each characteristic write/notify carried as
 * channel data. This module is that wrapper as a `HelioLink`, so the existing
 * Zepp OS session (auth, history fetch, sleep and its fallback) runs over it
 * unchanged.
 *
 * Ported from Gadgetbridge 8976702fc3d00e6008c91fe994668cb4027f7bc2,
 * `service/devices/huami/zeppos/ZeppOsBtbrSupport.java` (ZBR) and
 * `ZeppOsBtbrTransactionBuilder.java`. Not ported: the 25-minute keep-alive
 * ping (ZBR:128-135, :394-414), which only matters for a link held open; ours
 * is opened for one sync and closed after.
 *
 * Nothing here is hardware-validated.
 *
 * AGPL-3.0-or-later (same as upstream Gadgetbridge).
 */

import type { BtClassicAdapter, RfcommLink } from "../../../modules/bt-classic";
import { ACTIVITY_CONTROL, ACTIVITY_DATA, CHUNK_READ, CHUNK_WRITE } from "../protocol/codec";
import type { HelioLink } from "../protocol/types";
import {
  encodeZeppSppChannelAck,
  encodeZeppSppChannelData,
  encodeZeppSppFrame,
  encodeZeppSppPong,
  encodeZeppSppSessionStart,
  parseZeppSppChannelData,
  parseZeppSppChannels,
  parseZeppSppSessionAck,
  ZEPP_SPP_CMD,
  ZEPP_SPP_SERVICE_UUID,
  ZeppSppDeframer,
  type ZeppSppChannelMap,
  type ZeppSppFrame,
} from "../protocol/zepp-spp";

export const ZEPP_SPP_CONNECT_TIMEOUT_MS = 15_000;
/** CHANNELS_GET → CHANNELS_RET → SESSION_START → SESSION_START_ACK. */
export const ZEPP_SPP_HANDSHAKE_TIMEOUT_MS = 10_000;

/** The chunked encoder never builds packets past a 512-byte MTU (protocol/chunked.ts). */
const CHUNK_MTU_CAP = 512;
/** `ZeppOsSupport.setMtu` keeps its default of 23 for anything lower. */
const MIN_MTU = 23;

type Characteristic = Parameters<HelioLink["subscribe"]>[0] | Parameters<HelioLink["write"]>[0];

const CHARACTERISTIC_UUID: Readonly<Record<Characteristic, string>> = {
  chunk_write: CHUNK_WRITE,
  chunk_read: CHUNK_READ,
  activity_data: ACTIVITY_DATA,
  activity_control: ACTIVITY_CONTROL,
};

/** The chunked channel cannot work without both of its characteristics. */
const REQUIRED_CHARACTERISTICS = [CHUNK_WRITE, CHUNK_READ];

type Subscriber = { onBytes(bytes: Uint8Array): void; onFailure(): void };

export type OpenZeppSppOptions = Readonly<{
  btClassic: BtClassicAdapter;
  /** The watch's address; upstream connects BOTH-mode watches on their one address. */
  address: string;
  signal: AbortSignal;
  connectTimeoutMs?: number;
  handshakeTimeoutMs?: number;
  /** Session nonce source; upstream draws a non-negative random int (ZBR:260). */
  nonce?: () => number;
}>;

/**
 * Opens the RFCOMM socket and completes the SPP handshake. Rejects with a
 * `BT_CLASSIC_*` or `ZEPP_SPP_*` code, or `CANCELLED`; the socket is closed on
 * every failure.
 */
export async function openZeppSppLink(options: OpenZeppSppOptions): Promise<ZeppSppLink> {
  const { signal } = options;
  if (signal.aborted) throw new Error("CANCELLED");
  if (!options.btClassic.isSupported()) throw new Error("BT_CLASSIC_UNSUPPORTED");
  const socket = await openSocket(options);
  const link = new ZeppSppLink(socket);
  try {
    await link.handshake(
      signal,
      options.handshakeTimeoutMs ?? ZEPP_SPP_HANDSHAKE_TIMEOUT_MS,
      options.nonce ?? (() => Math.floor(Math.random() * 0x7fffffff)),
    );
    return link;
  } catch (error) {
    await link.close().catch(() => undefined);
    throw error;
  }
}

/** `openRfcomm` takes no signal: an abort settles at once and closes the late socket. */
function openSocket(options: OpenZeppSppOptions): Promise<RfcommLink> {
  const { signal } = options;
  return new Promise<RfcommLink>((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      reject(new Error("CANCELLED"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    options.btClassic
      .openRfcomm({
        address: options.address,
        uuid: ZEPP_SPP_SERVICE_UUID,
        // ZeppOsBtbrSupport goes through BtBRQueue's createRfcommSocketToServiceRecord.
        secure: true,
        timeoutMs: options.connectTimeoutMs ?? ZEPP_SPP_CONNECT_TIMEOUT_MS,
      })
      .then(
        (socket) => {
          signal.removeEventListener("abort", onAbort);
          if (settled) {
            void socket.close().catch(() => undefined);
            return;
          }
          settled = true;
          resolve(socket);
        },
        (error: unknown) => {
          signal.removeEventListener("abort", onAbort);
          if (settled) return;
          settled = true;
          reject(error);
        },
      );
  });
}

/**
 * One SPP session as a `HelioLink`. Characteristic writes become CHANNEL_DATA
 * frames without an ack request (ZeppOsBtbrTransactionBuilder.write passes
 * `false`); inbound CHANNEL_DATA is routed by channel to the subscribers of
 * its characteristic and acked when the watch asks.
 */
export class ZeppSppLink implements HelioLink {
  private readonly deframer = new ZeppSppDeframer();
  private readonly subscribers = new Map<string, Set<Subscriber>>();
  private readonly unsubscribeSocket: () => void;
  private channels: ZeppSppChannelMap | null = null;
  private session = -1;
  private mtu = MIN_MTU;
  private nonce = -1;
  private seqTx = 0;
  private open = false;
  private failed = false;
  private closed = false;
  private handshakeSettle: ((error?: Error) => void) | null = null;
  private nonceSource: () => number = () => 0;

  constructor(private readonly socket: RfcommLink) {
    this.unsubscribeSocket = socket.subscribe(
      (bytes) => this.onSocketBytes(bytes),
      (reason) => {
        if (reason !== "local") this.fail(new Error("ZEPP_SPP_CLOSED"));
      },
    );
  }

  /** The negotiated session MTU, less the 3-byte ATT header the encoder assumes. */
  get maxWriteBytes(): number {
    return Math.min(CHUNK_MTU_CAP, this.mtu) - 3;
  }

  /** @internal Runs CHANNELS_GET through SESSION_START_ACK (ZBR:129-135, :239-293). */
  handshake(signal: AbortSignal, timeoutMs: number, nonce: () => number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => settle(new Error("ZEPP_SPP_HANDSHAKE_TIMEOUT")), timeoutMs);
      const onAbort = () => settle(new Error("CANCELLED"));
      const settle = (error?: Error) => {
        if (this.handshakeSettle !== settle) return;
        this.handshakeSettle = null;
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        if (error) reject(error);
        else resolve();
      };
      this.handshakeSettle = settle;
      this.nonceSource = nonce;
      if (signal.aborted) return onAbort();
      signal.addEventListener("abort", onAbort, { once: true });
      if (this.failed) return settle(new Error("ZEPP_SPP_CLOSED"));
      this.send(ZEPP_SPP_CMD.CHANNELS_GET, new Uint8Array(0)).catch((error: unknown) =>
        settle(asError(error, "ZEPP_SPP_WRITE_FAILED")),
      );
    });
  }

  subscribe(
    characteristic: "chunk_read" | "activity_data" | "activity_control",
    onBytes: (bytes: Uint8Array) => void,
    onFailure: () => void,
  ): () => void {
    const uuid = CHARACTERISTIC_UUID[characteristic];
    const subscriber: Subscriber = { onBytes, onFailure };
    const set = this.subscribers.get(uuid) ?? new Set<Subscriber>();
    set.add(subscriber);
    this.subscribers.set(uuid, set);
    // ZeppOsBtbrTransactionBuilder.notify is a no-op: every channel is live.
    if (this.failed || this.closed) queueMicrotask(onFailure);
    return () => {
      set.delete(subscriber);
    };
  }

  async write(
    characteristic: "chunk_write" | "chunk_read" | "activity_control",
    bytes: Uint8Array,
    signal: AbortSignal,
  ): Promise<void> {
    if (signal.aborted) throw new Error("CANCELLED");
    if (!this.open || this.failed || this.closed) throw new Error("ZEPP_SPP_CLOSED");
    const channel = this.channels?.byCharacteristic.get(CHARACTERISTIC_UUID[characteristic]);
    // Upstream logs and drops a write to an unmapped characteristic (ZBR:222-226).
    if (channel === undefined) throw new Error("ZEPP_SPP_UNKNOWN_CHANNEL");
    await this.send(
      ZEPP_SPP_CMD.CHANNEL_DATA,
      encodeZeppSppChannelData(this.session, channel, bytes, false),
    );
    if (signal.aborted) throw new Error("CANCELLED");
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.open = false;
    this.handshakeSettle?.(new Error("CANCELLED"));
    this.unsubscribeSocket();
    this.subscribers.clear();
    this.deframer.reset();
    await this.socket.close();
  }

  /** Sequence numbers are taken in call order, which is also the socket's write order. */
  private send(cmd: number, payload: Uint8Array): Promise<void> {
    const seq = this.seqTx;
    this.seqTx = (this.seqTx + 1) & 0xff;
    return this.socket.write(encodeZeppSppFrame(cmd, seq, payload));
  }

  private onSocketBytes(bytes: Uint8Array): void {
    if (this.closed || this.failed) return;
    let frames: ZeppSppFrame[];
    try {
      frames = this.deframer.push(bytes);
    } catch (error) {
      this.fail(asError(error, "ZEPP_SPP_BUFFER_OVERFLOW"));
      return;
    }
    for (const frame of frames) {
      if (this.closed || this.failed) return;
      this.handleFrame(frame);
    }
  }

  private handleFrame({ cmd, seq, payload }: ZeppSppFrame): void {
    switch (cmd) {
      case ZEPP_SPP_CMD.CHANNELS_RET: {
        if (!this.handshakeSettle || this.channels) return;
        let channels: ZeppSppChannelMap;
        try {
          channels = parseZeppSppChannels(payload);
        } catch (error) {
          this.handshakeSettle(asError(error, "ZEPP_SPP_CHANNELS_MALFORMED"));
          return;
        }
        if (REQUIRED_CHARACTERISTICS.some((uuid) => !channels.byCharacteristic.has(uuid))) {
          this.handshakeSettle(new Error("ZEPP_SPP_CHANNELS_MISSING"));
          return;
        }
        this.channels = channels;
        this.nonce = this.nonceSource() >>> 0;
        const settle = this.handshakeSettle;
        this.send(ZEPP_SPP_CMD.SESSION_START, encodeZeppSppSessionStart(this.nonce)).catch(
          (error: unknown) => settle(asError(error, "ZEPP_SPP_WRITE_FAILED")),
        );
        return;
      }
      case ZEPP_SPP_CMD.SESSION_START_ACK: {
        if (!this.handshakeSettle || !this.channels || this.open) return;
        const ack = parseZeppSppSessionAck(payload);
        // Upstream ignores a wrong nonce or a status other than 1 (ZBR:268-276);
        // the handshake then runs into its timeout.
        if (!ack || ack.nonce !== this.nonce || ack.status !== 1) return;
        this.session = ack.session;
        if (ack.mtu >= MIN_MTU) this.mtu = ack.mtu;
        this.open = true;
        this.handshakeSettle();
        return;
      }
      case ZEPP_SPP_CMD.SESSION_END: {
        // The watch drops the socket about 2 s after ending our session (ZBR:295-312).
        if (this.open && payload.length >= 1 && payload[0] === this.session)
          this.fail(new Error("ZEPP_SPP_SESSION_ENDED"));
        return;
      }
      case ZEPP_SPP_CMD.CHANNEL_DATA: {
        if (!this.open) return;
        const data = parseZeppSppChannelData(payload);
        if (!data || data.session !== this.session) return;
        const uuid = this.channels?.byChannel.get(data.channel);
        if (uuid !== undefined) {
          for (const subscriber of Array.from(this.subscribers.get(uuid) ?? [])) {
            try {
              subscriber.onBytes(data.value);
            } catch {
              subscriber.onFailure();
            }
          }
        }
        // Upstream acks after dispatching, and returns before the ack for an
        // unmapped channel (ZBR:330-341).
        if (uuid !== undefined && data.mustAck)
          void this.send(
            ZEPP_SPP_CMD.CHANNEL_ACK,
            encodeZeppSppChannelAck(this.session, seq),
          ).catch(() => this.fail(new Error("ZEPP_SPP_WRITE_FAILED")));
        return;
      }
      case ZEPP_SPP_CMD.PING: {
        if (!this.open || payload.length < 4 || payload[0] !== this.session) return;
        void this.send(ZEPP_SPP_CMD.PONG, encodeZeppSppPong(this.session)).catch(() =>
          this.fail(new Error("ZEPP_SPP_WRITE_FAILED")),
        );
        return;
      }
      default:
        // SESSION_END_ACK, CHANNEL_ACK and PONG are only logged upstream.
        return;
    }
  }

  private fail(error: Error): void {
    if (this.failed || this.closed) return;
    this.failed = true;
    this.open = false;
    this.handshakeSettle?.(error);
    for (const set of this.subscribers.values())
      for (const subscriber of Array.from(set)) subscriber.onFailure();
  }
}

function asError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback);
}
