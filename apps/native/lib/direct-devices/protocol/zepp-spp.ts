/**
 * Zepp OS over Bluetooth Classic SPP: the frame codec and the session-control
 * payloads (issue #419). Pure; the socket side is transport/zepp-spp.ts.
 *
 * Ported from Gadgetbridge 8976702fc3d00e6008c91fe994668cb4027f7bc2,
 * `service/devices/huami/zeppos/ZeppOsBtbrSupport.java` (ZBR below), with
 * `util/CheckSums.getCRC16`, `service/btle/BLETypeConversions.fromUint16/32`
 * and `util/StringUtils.untilNullTerminator(ByteBuffer)`. See
 * docs/research/notes/Bluetooth Classic RFCOMM/bluetooth-classic-rfcomm.md §7.
 *
 * A frame is `55 cmd seq len16LE payload crc16LE aa` (ZBR:196-216). The CRC
 * covers cmd, seq, the little-endian length and the payload (ZBR:386-392).
 * Every multi-byte field is little-endian (ZBR:93, :197, :236).
 *
 * AGPL-3.0-or-later (same as upstream Gadgetbridge).
 */

/** SDP UUID of the Zepp OS serial service (HuamiService.UUID_BT_SERIAL_SERVICE). */
export const ZEPP_SPP_SERVICE_UUID = "00000022-0000-3512-2118-0009af100700";

export const ZEPP_SPP_PREAMBLE = 0x55;
export const ZEPP_SPP_TRAILER = 0xaa;

/** ZBR:76-85. */
export const ZEPP_SPP_CMD = Object.freeze({
  CHANNELS_GET: 0x01,
  CHANNELS_RET: 0x02,
  SESSION_START: 0x03,
  SESSION_START_ACK: 0x04,
  SESSION_END: 0x05,
  SESSION_END_ACK: 0x06,
  CHANNEL_DATA: 0x07,
  CHANNEL_ACK: 0x08,
  PING: 0x09,
  PONG: 0x0a,
});

/** Receive buffer: twice the largest MTU upstream has seen (ZBR:67-71). */
export const ZEPP_SPP_BUFFER_BYTES = 2 * 32768;

/** Preamble, cmd, seq, length, crc, trailer (ZBR:144). */
const MIN_FRAME_BYTES = 8;

/**
 * `CheckSums.getCRC16(seq, crc)`: CRC-16/CCITT-FALSE (poly 0x1021), byte-wise
 * form transcribed from upstream; `crc` defaults to upstream's 0xFFFF seed.
 */
export function zeppSppCrc16(bytes: Uint8Array, crc = 0xffff): number {
  for (const byte of bytes) {
    crc = ((crc >>> 8) | (crc << 8)) & 0xffff;
    crc ^= byte & 0xff;
    crc ^= (crc & 0xff) >> 4;
    crc ^= (crc << 12) & 0xffff;
    crc ^= ((crc & 0xff) << 5) & 0xffff;
  }
  return crc & 0xffff;
}

/** ZBR:386-392: CRC over cmd, seq, the payload length (u16 LE) and the payload. */
export function zeppSppFrameCrc(cmd: number, seq: number, payload: Uint8Array): number {
  let crc = zeppSppCrc16(Uint8Array.of(cmd & 0xff));
  crc = zeppSppCrc16(Uint8Array.of(seq & 0xff), crc);
  crc = zeppSppCrc16(Uint8Array.of(payload.length & 0xff, (payload.length >> 8) & 0xff), crc);
  return zeppSppCrc16(payload, crc);
}

/** ZBR:196-216. */
export function encodeZeppSppFrame(cmd: number, seq: number, payload: Uint8Array): Uint8Array {
  if (payload.length > 0xffff) throw new Error("ZEPP_SPP_FRAME_TOO_LARGE");
  const out = new Uint8Array(payload.length + MIN_FRAME_BYTES);
  const crc = zeppSppFrameCrc(cmd, seq, payload);
  out[0] = ZEPP_SPP_PREAMBLE;
  out[1] = cmd & 0xff;
  out[2] = seq & 0xff;
  out[3] = payload.length & 0xff;
  out[4] = (payload.length >> 8) & 0xff;
  out.set(payload, 5);
  out[5 + payload.length] = crc & 0xff;
  out[6 + payload.length] = (crc >> 8) & 0xff;
  out[7 + payload.length] = ZEPP_SPP_TRAILER;
  return out;
}

export type ZeppSppFrame = Readonly<{ cmd: number; seq: number; payload: Uint8Array }>;

/**
 * Stream reassembly with upstream's resync rules (ZBR:138-194):
 * - a byte that is not the preamble is skipped alone;
 * - a frame whose trailer is wrong is skipped up to (not including) that
 *   byte, which is then tried as a preamble;
 * - a frame with a bad CRC is dropped whole.
 *
 * Deviations: upstream reads the length as a signed short, which throws on
 * lengths of 0x8000 and above; this reads it unsigned, and treats a length
 * that cannot fit the 64 KiB buffer as a false preamble (skip one byte), so a
 * stray 0x55 cannot stall the stream. Bytes pending beyond the buffer throw
 * `ZEPP_SPP_BUFFER_OVERFLOW`, where upstream's `ByteBuffer.put` would throw.
 */
export class ZeppSppDeframer {
  private pending = new Uint8Array(0);

  push(chunk: Uint8Array): ZeppSppFrame[] {
    if (this.pending.length + chunk.length > ZEPP_SPP_BUFFER_BYTES) {
      this.pending = new Uint8Array(0);
      throw new Error("ZEPP_SPP_BUFFER_OVERFLOW");
    }
    const buffer = new Uint8Array(this.pending.length + chunk.length);
    buffer.set(this.pending);
    buffer.set(chunk, this.pending.length);
    const frames: ZeppSppFrame[] = [];
    let at = 0;
    while (at < buffer.length) {
      if (buffer.length - at < MIN_FRAME_BYTES) break;
      if (buffer[at] !== ZEPP_SPP_PREAMBLE) {
        at += 1;
        continue;
      }
      const cmd = buffer[at + 1]!;
      const seq = buffer[at + 2]!;
      const length = buffer[at + 3]! | (buffer[at + 4]! << 8);
      // A header that can never fit the buffer is not a frame start: resync.
      if (length + MIN_FRAME_BYTES > ZEPP_SPP_BUFFER_BYTES) {
        at += 1;
        continue;
      }
      // Payload, CRC and trailer must all be present.
      if (buffer.length - (at + 5) < length + 3) break;
      const payload = buffer.slice(at + 5, at + 5 + length);
      const expectedCrc = buffer[at + 5 + length]! | (buffer[at + 6 + length]! << 8);
      const trailerAt = at + 7 + length;
      if (buffer[trailerAt] !== ZEPP_SPP_TRAILER) {
        at = trailerAt;
        continue;
      }
      at = trailerAt + 1;
      if (zeppSppFrameCrc(cmd, seq, payload) !== expectedCrc) continue;
      frames.push({ cmd, seq, payload });
    }
    this.pending = buffer.slice(at);
    return frames;
  }

  reset(): void {
    this.pending = new Uint8Array(0);
  }
}

const u16le = (bytes: Uint8Array, offset: number) => bytes[offset]! | (bytes[offset + 1]! << 8);
const s16le = (bytes: Uint8Array, offset: number) => (u16le(bytes, offset) << 16) >> 16;

/** GATT characteristic UUID (lowercase) ↔ SPP channel number. */
export type ZeppSppChannelMap = Readonly<{
  version: number;
  byCharacteristic: ReadonlyMap<string, number>;
  byChannel: ReadonlyMap<number, string>;
}>;

/**
 * CMD_CHANNELS_RET (ZBR:239-265): version u8, count s16, then `count` times a
 * NUL-terminated UUID string and a u16 channel. Versions above 1 are refused,
 * as upstream does. A missing terminator or a short buffer is malformed
 * (upstream would throw on `UUID.fromString(null)` or a buffer underflow).
 */
export function parseZeppSppChannels(payload: Uint8Array): ZeppSppChannelMap {
  if (payload.length < 3) throw new Error("ZEPP_SPP_CHANNELS_MALFORMED");
  const version = payload[0]!;
  if (version > 1) throw new Error("ZEPP_SPP_UNSUPPORTED_VERSION");
  // `getShort()` is signed; a negative count runs the loop zero times.
  const count = s16le(payload, 1);
  const byCharacteristic = new Map<string, number>();
  const byChannel = new Map<number, string>();
  let at = 3;
  for (let index = 0; index < count; index += 1) {
    const end = payload.indexOf(0, at);
    if (end < 0) throw new Error("ZEPP_SPP_CHANNELS_MALFORMED");
    const uuid = String.fromCharCode(...payload.subarray(at, end)).toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uuid))
      throw new Error("ZEPP_SPP_CHANNELS_MALFORMED");
    if (end + 3 > payload.length) throw new Error("ZEPP_SPP_CHANNELS_MALFORMED");
    const channel = u16le(payload, end + 1);
    byCharacteristic.set(uuid, channel);
    byChannel.set(channel, uuid);
    at = end + 3;
  }
  return { version, byCharacteristic, byChannel };
}

/** CMD_SESSION_START payload: the nonce as u32 LE (ZBR:260-262). */
export function encodeZeppSppSessionStart(nonce: number): Uint8Array {
  return Uint8Array.of(nonce & 0xff, (nonce >>> 8) & 0xff, (nonce >>> 16) & 0xff, nonce >>> 24);
}

export type ZeppSppSessionAck = Readonly<{
  nonce: number;
  status: number;
  session: number;
  mtu: number;
}>;

/** CMD_SESSION_START_ACK (ZBR:266-293): nonce u32, status u8, session u8, mtu u16. */
export function parseZeppSppSessionAck(payload: Uint8Array): ZeppSppSessionAck | null {
  if (payload.length < 8) return null;
  return {
    nonce: (payload[0]! | (payload[1]! << 8) | (payload[2]! << 16) | (payload[3]! << 24)) >>> 0,
    status: payload[4]!,
    session: payload[5]!,
    mtu: u16le(payload, 6),
  };
}

/** CMD_CHANNEL_DATA payload (ZBR:218-233): session, channel u16, ack flag, value. */
export function encodeZeppSppChannelData(
  session: number,
  channel: number,
  value: Uint8Array,
  requestAck = false,
): Uint8Array {
  const out = new Uint8Array(value.length + 4);
  out[0] = session & 0xff;
  out[1] = channel & 0xff;
  out[2] = (channel >> 8) & 0xff;
  out[3] = requestAck ? 1 : 0;
  out.set(value, 4);
  return out;
}

export type ZeppSppChannelData = Readonly<{
  session: number;
  channel: number;
  mustAck: boolean;
  value: Uint8Array;
}>;

/** ZBR:320-343. */
export function parseZeppSppChannelData(payload: Uint8Array): ZeppSppChannelData | null {
  if (payload.length < 4) return null;
  return {
    session: payload[0]!,
    channel: u16le(payload, 1),
    mustAck: payload[3] !== 0,
    value: payload.slice(4),
  };
}

/** The phone's CMD_CHANNEL_ACK reply: session, the frame's seq, ok, 0 (ZBR:336-341). */
export function encodeZeppSppChannelAck(session: number, seq: number): Uint8Array {
  return Uint8Array.of(session & 0xff, seq & 0xff, 0x01, 0x00);
}

/** The phone's CMD_PONG reply to a ping: session, 1, 0, 0 (ZBR:352-371). */
export function encodeZeppSppPong(session: number): Uint8Array {
  return Uint8Array.of(session & 0xff, 0x01, 0x00, 0x00);
}
