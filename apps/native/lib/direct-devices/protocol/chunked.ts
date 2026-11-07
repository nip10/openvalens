/* Adapted from Gadgetbridge Huami2021ChunkedEncoder.java, Copyright (C) 2022-2024 José Rebelo.
 * Source: Codeberg 8976702fc3d00e6008c91fe994668cb4027f7bc2; AGPL-3.0-or-later.
 * This port adds strict bounds and validates inbound transport CRCs.
 */
import type { CryptoProbeProvider } from "../crypto/self-test";

export type PacketCrypto = Pick<CryptoProbeProvider, "createCipheriv">;
export const DEFAULT_MAX_MESSAGE_BYTES = 1024 * 1024;

export function crc32(bytes: Uint8Array, length = bytes.length): number {
  if (!Number.isSafeInteger(length) || length < 0 || length > bytes.length) throw new Error("INVALID_CRC_RANGE");
  let crc = 0xffffffff;
  for (let i = 0; i < length; i += 1) {
    crc ^= bytes[i]!;
    for (let b = 0; b < 8; b += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u32le(out: Uint8Array, offset: number, value: number): void {
  out[offset] = value & 0xff; out[offset + 1] = (value >>> 8) & 0xff;
  out[offset + 2] = (value >>> 16) & 0xff; out[offset + 3] = (value >>> 24) & 0xff;
}
function crypt(data: Uint8Array, key: Uint8Array, provider: PacketCrypto): Uint8Array {
  if (key.length !== 16 || data.length === 0 || data.length % 16) throw new Error("INVALID_AES_BLOCKS");
  const cipher = provider.createCipheriv("aes-128-ecb", key, null);
  cipher.setAutoPadding(false);
  return concat(cipher.update(data), cipher.final());
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0; for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

export function encodeChunkedMessage(args: {
  payload: Uint8Array; endpoint: number; mtu: number; handle: number; encrypted: boolean;
  extendedFlags?: boolean; sequence?: number; sessionKey?: Uint8Array; crypto?: PacketCrypto; maxBytes?: number;
}): Uint8Array[] {
  const { payload, endpoint, mtu, handle, encrypted, sequence = 0, sessionKey, crypto } = args;
  const extended = args.extendedFlags ?? true;
  const maxBytes = args.maxBytes ?? DEFAULT_MAX_MESSAGE_BYTES;
  if (payload.length > maxBytes || payload.length > 0xffffffff) throw new Error("MESSAGE_TOO_LARGE");
  if (!Number.isInteger(endpoint) || endpoint < 0 || endpoint > 0xffff || !Number.isInteger(mtu) || mtu < 23 ||
      !Number.isInteger(handle) || handle < 0 || handle > 255 || !Number.isInteger(sequence) || sequence < 0 || sequence > 0xffffffff)
    throw new Error("INVALID_FRAME_PARAMETERS");
  const header = extended ? 11 : 10;
  const capacity = Math.min(512, Math.max(23, mtu)) - 3 - header;
  if (capacity < 1) throw new Error("INVALID_MTU");
  let wire = payload;
  if (encrypted) {
    if (!sessionKey || sessionKey.length !== 16 || !crypto) throw new Error("CRYPTO_UNAVAILABLE");
    const key = Uint8Array.from(sessionKey, (byte) => byte ^ handle);
    const paddedLength = Math.ceil((payload.length + 8) / 16) * 16;
    const plain = new Uint8Array(paddedLength);
    plain.set(payload); u32le(plain, payload.length, sequence);
    u32le(plain, payload.length + 4, crc32(plain, payload.length + 4));
    wire = crypt(plain, key, crypto);
    key.fill(0); plain.fill(0);
  }
  const packets: Uint8Array[] = [];
  let offset = 0, count = 0;
  while (offset < wire.length) {
    if (count > 255) throw new Error("TOO_MANY_CHUNKS");
    const head = count === 0 ? header : (extended ? 5 : 4);
    const chunkCapacity = Math.min(512, Math.max(23, mtu)) - 3 - head;
    const take = Math.min(wire.length - offset, chunkCapacity);
    const packet = new Uint8Array(head + take);
    const first = count === 0, last = offset + take === wire.length;
    packet[0] = 3;
    packet[1] = (encrypted ? 8 : 0) | (first ? 1 : 0) | (last ? 6 : 0);
    if (extended) { packet[2] = 0; packet[3] = handle; packet[4] = count; }
    else { packet[2] = handle; packet[3] = count; }
    if (first) {
      const p = extended ? 5 : 4;
      u32le(packet, p, payload.length); packet[p + 4] = endpoint & 0xff; packet[p + 5] = endpoint >>> 8;
    }
    packet.set(wire.subarray(offset, offset + take), head);
    packets.push(packet); offset += take; count += 1;
  }
  return packets;
}

export type InboundChunk = Readonly<{ handle: number; count: number; encrypted: boolean; first: boolean; last: boolean; endpoint: number; originalLength?: number; payload?: Uint8Array }>;
export class ChunkReassembler {
  private active: { handle: number; encrypted: boolean; endpoint: number; expectedLength: number; nextCount: number; chunks: Uint8Array[]; size: number } | null = null;
  constructor(private readonly maxMessageBytes = DEFAULT_MAX_MESSAGE_BYTES, private readonly maxChunks = 256) {}
  reset(): void { this.active?.chunks.forEach((chunk) => chunk.fill(0)); this.active = null; }
  accept(packet: Uint8Array): InboundChunk | null {
    if (packet.length < 5 || packet.length > 512 || packet[0] !== 3) throw new Error("MALFORMED_CHUNK");
    const flags = packet[1]!, first = !!(flags & 1), last = !!(flags & 2), needsAck = !!(flags & 4), encrypted = !!(flags & 8);
    if ((flags & 0xf0) !== 0 || (last ? !needsAck : needsAck)) throw new Error("UNSUPPORTED_CHUNK_FLAGS");
    const extended = packet.length >= 5 && packet[2] === 0;
    const head = extended ? (first ? 11 : 5) : (first ? 10 : 4);
    if (packet.length < head) throw new Error("TRUNCATED_CHUNK");
    const handle = packet[extended ? 3 : 2]!, count = packet[extended ? 4 : 3]!;
    const endpoint = first ? packet[extended ? 9 : 8]! | (packet[extended ? 10 : 9]! << 8) : this.active?.endpoint ?? -1;
    const expectedLength = first ? (packet[extended ? 5 : 4]! | (packet[extended ? 6 : 5]! << 8) | (packet[extended ? 7 : 6]! << 16) | (packet[extended ? 8 : 7]! << 24)) >>> 0 : this.active?.expectedLength ?? 0;
    if (first) {
      if (this.active) throw new Error("INTERLEAVED_MESSAGE");
      if (expectedLength > this.maxMessageBytes) throw new Error("MESSAGE_TOO_LARGE");
      if (count !== 0) throw new Error("INVALID_FIRST_COUNT");
      this.active = { handle, encrypted, endpoint, expectedLength, nextCount: 0, chunks: [], size: 0 };
    }
    const active = this.active;
    if (!active || active.handle !== handle || active.encrypted !== encrypted || active.nextCount !== count || count >= this.maxChunks)
      throw new Error("CHUNK_SEQUENCE");
    const body = packet.slice(head);
    active.chunks.push(body); active.size += body.length; active.nextCount += 1;
    if (active.size > this.maxMessageBytes + 32) { this.reset(); throw new Error("MESSAGE_TOO_LARGE"); }
    if (!last) return { handle, count, encrypted, first, last, endpoint };
    const joined = concat(...active.chunks);
    if ((!encrypted && joined.length !== active.expectedLength) || (encrypted && (joined.length === 0 || joined.length % 16 !== 0))) {
      this.reset(); throw new Error("MESSAGE_LENGTH_MISMATCH");
    }
    const result = { handle, count, encrypted, first: true, last: true, endpoint: active.endpoint, originalLength: active.expectedLength, payload: joined };
    this.active = null;
    return result;
  }
}
