/**
 * Fossil Hybrid HR / Gen 6 Hybrid / Skagen Jorn Gen 6: pure codecs for the
 * authenticated activity-file download.
 *
 * Ported from Gadgetbridge at 8976702fc3d00e6008c91fe994668cb4027f7bc2; the
 * byte-level evidence, with file:line citations and marked inferences, is in
 * docs/research/notes/Fossil Hybrid HR protocol/fossil-hybrid-hr-protocol.md
 * (cited below as "spec §n").
 *
 * Nothing here touches Bluetooth or storage. Crypto is injected so the codecs
 * run under Bun with Node's crypto and on device with react-native-quick-crypto.
 *
 * AGPL-3.0-or-later (same as upstream Gadgetbridge).
 */

export const FOSSIL_SERVICE_UUID = "3dda0001-957f-7d4a-34a6-74696673696d";
/** "Basic" request channel: device pairing checks (spec §1.3). */
export const FOSSIL_BASIC_UUID = "3dda0002-957f-7d4a-34a6-74696673696d";
/** File-transfer control: lookup, get, delete (spec §1.3). */
export const FOSSIL_FILE_CONTROL_UUID = "3dda0003-957f-7d4a-34a6-74696673696d";
/** File data: download packets arrive as notifications (spec §1.3). */
export const FOSSIL_FILE_DATA_UUID = "3dda0004-957f-7d4a-34a6-74696673696d";
/** Authentication channel (spec §3.2). */
export const FOSSIL_AUTH_UUID = "3dda0005-957f-7d4a-34a6-74696673696d";
/** Device Information: Firmware Revision and Model Number (spec §1.2). */
export const FOSSIL_DEVICE_INFO_SERVICE_UUID = "0000180a-0000-1000-8000-00805f9b34fb";
export const FOSSIL_FIRMWARE_REVISION_UUID = "00002a26-0000-1000-8000-00805f9b34fb";
export const FOSSIL_MODEL_NUMBER_UUID = "00002a24-0000-1000-8000-00805f9b34fb";

/** Static activity-file handle: major 0x01, minor 0x00 (spec §4.1). */
export const FOSSIL_ACTIVITY_MAJOR = 0x01;
/** The only activity-file version upstream parses (spec §5.1). */
export const FOSSIL_ACTIVITY_FILE_VERSION = 22;

export type FossilCrypto = Readonly<{
  randomBytes(size: number): Uint8Array;
  /** AES-128-ECB, one 16-byte block, no padding. */
  aesEcbEncrypt(key: Uint8Array, block: Uint8Array): Uint8Array;
  aesEcbDecrypt(key: Uint8Array, block: Uint8Array): Uint8Array;
  /** AES-128-CTR with a 128-bit big-endian counter (standard OpenSSL semantics). */
  aesCtr(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Uint8Array;
}>;

// ---------------------------------------------------------------------------
// Key

/**
 * Parses the user's 16-byte key the way upstream does (spec §3.1): spaces and
 * every "0x" are removed, then exactly 32 hex characters are required. Unlike
 * upstream, an all-zero key is refused instead of silently used.
 */
export function parseFossilAuthKey(input: string): Uint8Array | null {
  const hex = input.replace(/\s+/g, "").replace(/0x/gi, "");
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) return null;
  const key = Uint8Array.from({ length: 16 }, (_, index) =>
    Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16),
  );
  return key.some((byte) => byte !== 0) ? key : null;
}

// ---------------------------------------------------------------------------
// Authentication: VerifyPrivateKeyRequest (spec §3.2)

/** Step 1 on 3dda0005: `02 01 01` + 8 phone-random bytes. */
export function encodeFossilVerifyStart(phoneRandom: Uint8Array): Uint8Array {
  if (phoneRandom.length !== 8) throw new Error("FOSSIL_PHONE_RANDOM_LENGTH");
  return Uint8Array.from([0x02, 0x01, 0x01, ...phoneRandom]);
}

/**
 * Step 2 → step 3: decrypts the watch challenge (bytes 4..19) with the user
 * key, swaps its halves, re-encrypts, and returns the reply plus the watch
 * random used later for file IVs. Single-block CBC with a zero IV is ECB.
 */
export function answerFossilChallenge(
  crypto: FossilCrypto,
  key: Uint8Array,
  notification: Uint8Array,
): { watchRandom: Uint8Array; reply: Uint8Array } {
  if (notification.length < 20 || notification[1] !== 0x01)
    throw new Error("FOSSIL_AUTH_CHALLENGE_INVALID");
  const plain = crypto.aesEcbDecrypt(key, notification.slice(4, 20));
  if (plain.length !== 16) throw new Error("FOSSIL_AUTH_CHALLENGE_INVALID");
  const watchRandom = plain.slice(0, 8);
  const swapped = Uint8Array.from([...plain.slice(8, 16), ...plain.slice(0, 8)]);
  const encrypted = crypto.aesEcbEncrypt(key, swapped);
  return { watchRandom, reply: Uint8Array.from([0x02, 0x02, 0x01, ...encrypted]) };
}

/** Step 4: `value[1] == 0x02`; `value[2]` is the result code (0 = success). */
export function parseFossilVerifyResult(notification: Uint8Array): boolean | null {
  if (notification.length < 3 || notification[1] !== 0x02) return null;
  return notification[2] === 0x00;
}

// ---------------------------------------------------------------------------
// File transfer framing (spec §4)

/** Low nibble of byte 0 of a 3dda0003 notification names its response type. */
export function fossilResponseType(notification: Uint8Array): number {
  return (notification[0] ?? 0) & 0x0f;
}

/** Lookup of the activity file's current dynamic handle: `02 FF 01`. */
export function encodeFossilActivityLookup(): Uint8Array {
  return Uint8Array.of(0x02, 0xff, FOSSIL_ACTIVITY_MAJOR);
}

export type FossilHandle = Readonly<{ minor: number; major: number }>;

/** Encrypted get of a whole file: `01 minor major 00000000 FFFFFFFF`. */
export function encodeFossilFileGet(handle: FossilHandle): Uint8Array {
  return Uint8Array.of(
    0x01,
    handle.minor,
    handle.major,
    0x00,
    0x00,
    0x00,
    0x00,
    0xff,
    0xff,
    0xff,
    0xff,
  );
}

/** Delete of exactly the fetched dynamic handle: `0B minor major`. */
export function encodeFossilFileDelete(handle: FossilHandle): Uint8Array {
  return Uint8Array.of(0x0b, handle.minor, handle.major);
}

/** Delete reply: exactly `8B minor major status`, status 0 (spec §4.6). */
export function parseFossilDeleteResult(
  notification: Uint8Array,
  handle: FossilHandle,
): boolean | null {
  if (notification.length !== 4 || notification[0] !== 0x8b) return null;
  return (
    notification[1] === handle.minor && notification[2] === handle.major && notification[3] === 0
  );
}

const u32le = (bytes: Uint8Array, offset: number) =>
  ((bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16)) +
    bytes[offset + 3]! * 0x1000000) >>>
  0;

/** Lookup type-2 reply: status at 3, payload size at 4..7 (0 = no data). */
export function parseFossilLookupStart(
  notification: Uint8Array,
): { status: number; size: number } | null {
  if (fossilResponseType(notification) !== 2 || notification.length < 8) return null;
  return { status: notification[3]!, size: u32le(notification, 4) };
}

/** Get type-1 reply: handle echo at 1..2, status at 3, file size at 4..7. */
export function parseFossilGetStart(
  notification: Uint8Array,
  handle: FossilHandle,
): { status: number; fileSize: number } | null {
  if (fossilResponseType(notification) !== 1 || notification.length < 8) return null;
  if (notification[1] !== handle.minor || notification[2] !== handle.major)
    throw new Error("FOSSIL_FILE_HANDLE_MISMATCH");
  return { status: notification[3]!, fileSize: u32le(notification, 4) };
}

/** Type-8 reply: transfer complete, CRC32 of the payload at 8..11. */
export function parseFossilTransferCrc(notification: Uint8Array): number | null {
  if (fossilResponseType(notification) !== 8 || notification.length < 12) return null;
  return u32le(notification, 8);
}

/** The dynamic handle is the first two bytes of the lookup payload (LE). */
export function fossilHandleFromLookupPayload(payload: Uint8Array): FossilHandle {
  if (payload.length < 2) throw new Error("FOSSIL_LOOKUP_PAYLOAD_INVALID");
  return { minor: payload[0]!, major: payload[1]! };
}

// ---------------------------------------------------------------------------
// CRC32 (IEEE / zlib, java.util.zip.CRC32): the transport integrity check.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------
// Encrypted download (spec §4.4)

/**
 * Base CTR IV: zeros, phoneRandom[0..5] at 2..7 with byte 7 incremented, and
 * watchRandom[0..6] at 9..15.
 */
export function fossilFileIv(phoneRandom: Uint8Array, watchRandom: Uint8Array): Uint8Array {
  if (phoneRandom.length < 6 || watchRandom.length < 7) throw new Error("FOSSIL_IV_RANDOMS");
  const iv = new Uint8Array(16);
  iv.set(phoneRandom.slice(0, 6), 2);
  iv.set(watchRandom.slice(0, 7), 9);
  iv[7] = (iv[7]! + 1) & 0xff;
  return iv;
}

/** Adds `amount` to bytes 12..15 as a big-endian u32, wrapping, no carry into 11. */
export function fossilIncrementIv(iv: Uint8Array, amount: number): Uint8Array {
  const next = iv.slice();
  const view = new DataView(next.buffer);
  view.setUint32(12, (view.getUint32(12, false) + amount) >>> 0, false);
  return next;
}

/**
 * Reassembles an encrypted file download. Each notification is decrypted on
 * its own at IV(n) = baseIv + summand·n, where `summand` is the number of
 * 16-byte blocks the watch's CTR stream spends per packet. Upstream guesses it
 * from 0x1e..0x2f (which only fits MTU ≈ 512); here it is derived from the
 * first packet's length first, then the upstream range, then 1..64, and the
 * choice is confirmed by the second packet's sequence marker (low 7 bits = 1).
 * The transfer CRC32 is the final arbiter.
 */
export class FossilEncryptedDownload {
  private readonly chunks: Uint8Array[] = [];
  private received = 0;
  private packets = 0;
  private summand: number | null = null;
  private firstPacketLength = 0;
  private finished = false;

  constructor(
    private readonly crypto: FossilCrypto,
    private readonly key: Uint8Array,
    private readonly baseIv: Uint8Array,
    readonly fileSize: number,
  ) {
    if (!Number.isSafeInteger(fileSize) || fileSize <= 0 || fileSize > 8 * 1024 * 1024)
      throw new Error("FOSSIL_FILE_SIZE_INVALID");
  }

  get complete(): boolean {
    return this.finished;
  }

  /** Feeds one 3dda0004 notification. Returns true once the final packet is in. */
  push(packet: Uint8Array): boolean {
    if (this.finished) throw new Error("FOSSIL_FILE_PACKET_AFTER_FINAL");
    if (packet.length < 2) throw new Error("FOSSIL_FILE_PACKET_INVALID");
    const index = this.packets;
    let plain: Uint8Array;
    if (index === 0) {
      plain = this.crypto.aesCtr(this.key, this.baseIv, packet);
      this.firstPacketLength = packet.length;
    } else {
      if (this.summand === null) this.summand = this.findSummand(packet);
      plain = this.crypto.aesCtr(
        this.key,
        fossilIncrementIv(this.baseIv, this.summand * index),
        packet,
      );
    }
    const payload = plain.slice(1);
    if (this.received + payload.length > this.fileSize) throw new Error("FOSSIL_FILE_OVERFLOW");
    this.chunks.push(payload);
    this.received += payload.length;
    this.packets += 1;
    if ((plain[0]! & 0x80) === 0x80) this.finished = true;
    return this.finished;
  }

  private findSummand(packet: Uint8Array): number {
    const derived = Math.ceil(this.firstPacketLength / 16);
    const upstream = Array.from({ length: 0x2f - 0x1e + 1 }, (_, offset) => 0x1e + offset);
    const wide = Array.from({ length: 64 }, (_, offset) => offset + 1);
    for (const candidate of [derived, ...upstream, ...wide]) {
      const marker = this.crypto.aesCtr(
        this.key,
        fossilIncrementIv(this.baseIv, candidate),
        packet.slice(0, 1),
      )[0]!;
      if ((marker & 0x7f) === 0x01) return candidate;
    }
    throw new Error("FOSSIL_FILE_COUNTER_UNKNOWN");
  }

  /** The reassembled plaintext, verified against the type-8 CRC32. */
  result(expectedCrc: number): Uint8Array {
    if (!this.finished) throw new Error("FOSSIL_FILE_INCOMPLETE");
    const data = new Uint8Array(this.received);
    let offset = 0;
    for (const chunk of this.chunks) {
      data.set(chunk, offset);
      offset += chunk.length;
    }
    if (data.length !== this.fileSize) throw new Error("FOSSIL_FILE_SIZE_MISMATCH");
    if (crc32(data) !== expectedCrc >>> 0) throw new Error("FOSSIL_FILE_CRC_MISMATCH");
    return data;
  }
}

/** Unencrypted lookup payload: marker byte + data, final when bit 0x80 is set. */
export class FossilPlainDownload {
  private readonly chunks: Uint8Array[] = [];
  private finished = false;

  get complete(): boolean {
    return this.finished;
  }

  push(packet: Uint8Array): boolean {
    if (this.finished) throw new Error("FOSSIL_FILE_PACKET_AFTER_FINAL");
    if (packet.length < 1) throw new Error("FOSSIL_FILE_PACKET_INVALID");
    this.chunks.push(packet.slice(1));
    if ((packet[0]! & 0x80) === 0x80) this.finished = true;
    return this.finished;
  }

  result(expectedCrc: number): Uint8Array {
    if (!this.finished) throw new Error("FOSSIL_FILE_INCOMPLETE");
    const size = this.chunks.reduce((total, chunk) => total + chunk.length, 0);
    const data = new Uint8Array(size);
    let offset = 0;
    for (const chunk of this.chunks) {
      data.set(chunk, offset);
      offset += chunk.length;
    }
    if (crc32(data) !== expectedCrc >>> 0) throw new Error("FOSSIL_LOOKUP_CRC_MISMATCH");
    return data;
  }
}

// ---------------------------------------------------------------------------
// Activity file (spec §5): a faithful port of ActivityFileParser.java.

export type FossilWearState = "not_wearing" | "wearing" | "unknown";

export type FossilActivitySample = Readonly<{
  /** Unix seconds, as the watch reports it (no minute alignment upstream). */
  timestamp: number;
  steps: number;
  /** 0 when the file carries no reading (always 0 in the step-only variant). */
  heartRate: number;
  heartRateQuality: number;
  calories: number;
  active: boolean;
  wear: FossilWearState;
}>;

export type FossilActivityFile = Readonly<{
  variant: "hr" | "steps_only";
  samples: readonly FossilActivitySample[];
}>;

const HR_STREAM_STARTERS = new Set([0xce, 0xc2, 0xe2, 0xe0, 0xdd, 0xd6, 0xcb, 0xcc, 0xcf]);
const VALID_FLAGS = new Set([0xce, 0xdd, 0xcb, 0xcc, 0xcf, 0xd6, 0xe2]);

/** Little-endian cursor that throws past the end, like java.nio.ByteBuffer. */
class Cursor {
  position: number;
  constructor(
    private readonly bytes: Uint8Array,
    start: number,
  ) {
    this.position = start;
  }
  get capacity(): number {
    return this.bytes.length;
  }
  get(): number {
    if (this.position >= this.bytes.length) throw new Error("FOSSIL_ACTIVITY_TRUNCATED");
    return this.bytes[this.position++]!;
  }
  peek(index: number): number {
    if (index < 0 || index >= this.bytes.length) throw new Error("FOSSIL_ACTIVITY_TRUNCATED");
    return this.bytes[index]!;
  }
  skip(count: number): void {
    if (this.position + count > this.bytes.length) throw new Error("FOSSIL_ACTIVITY_TRUNCATED");
    this.position += count;
  }
  int32(): number {
    const b0 = this.get();
    const b1 = this.get();
    const b2 = this.get();
    const b3 = this.get();
    return b0 | (b1 << 8) | (b2 << 16) | (b3 << 24) | 0;
  }
}

type MutableSample = {
  steps: number;
  heartRate: number;
  calories: number;
  active: boolean;
};

function variabilitySteps(lower: number): number {
  // parseVariabilityBytes: only the step count is kept (variability is unknown).
  return (lower & 0x01) === 0x01 ? lower & 0x0e : lower & 0xfe;
}

function int32At(bytes: Uint8Array, offset: number): number {
  if (offset + 4 > bytes.length) throw new Error("FOSSIL_ACTIVITY_TRUNCATED");
  return (
    bytes[offset]! |
    (bytes[offset + 1]! << 8) |
    (bytes[offset + 2]! << 16) |
    (bytes[offset + 3]! << 24) |
    0
  );
}

/**
 * Parses a decrypted activity file. Throws on a version other than 22 or on a
 * read past the end; upstream treats both as "do not delete".
 */
export function parseFossilActivityFile(file: Uint8Array): FossilActivityFile {
  if (file.length < 53) throw new Error("FOSSIL_ACTIVITY_TRUNCATED");
  const version = file[2]! | (file[3]! << 8);
  if (version !== FOSSIL_ACTIVITY_FILE_VERSION) throw new Error("FOSSIL_ACTIVITY_VERSION");
  return HR_STREAM_STARTERS.has(file[52]!)
    ? { variant: "hr", samples: parseHrVariant(file) }
    : { variant: "steps_only", samples: parseStepsOnlyVariant(file) };
}

function parseStepsOnlyVariant(file: Uint8Array): FossilActivitySample[] {
  let timestamp = int32At(file, 34);
  const samples: FossilActivitySample[] = [];
  for (let position = 44; position <= file.length - 4; position += 4) {
    if (file[position + 2] !== 0xff) break; // not a known no-HR record
    const flags = file[position + 3]!;
    samples.push({
      timestamp,
      steps: variabilitySteps(file[position]!),
      heartRate: 0,
      heartRateQuality: 0,
      calories: flags & 0x3f,
      active: (flags & 0x40) === 0x40,
      wear: "wearing",
    });
    timestamp += 60;
  }
  return samples;
}

function parseHrVariant(file: Uint8Array): FossilActivitySample[] {
  const buffer = new Cursor(file, 52);
  const samples: FossilActivitySample[] = [];
  let timestamp = int32At(file, 8);
  let wear: FossilWearState = "unknown";
  let quality = 0;
  let current: MutableSample = { steps: 0, heartRate: 0, calories: 0, active: false };
  const finish = () => {
    samples.push({
      timestamp,
      steps: current.steps,
      heartRate: current.heartRate,
      heartRateQuality: quality,
      calories: current.calories,
      active: current.active,
      wear,
    });
    timestamp += 60;
    current = { steps: 0, heartRate: 0, calories: 0, active: false };
  };
  const readFourByteSample = () => {
    current.steps = variabilitySteps(buffer.get());
    buffer.get(); // higher variability byte
    current.heartRate = buffer.get();
    const calories = buffer.get();
    current.active = (calories & 0x40) === 0x40;
    current.calories = calories & 0x3f;
    finish();
  };

  while (buffer.position < buffer.capacity - 4) {
    const next = buffer.get();
    switch (next) {
      case 0xce: {
        const wearByte = buffer.get();
        const wearBits = (wearByte & 0x18) >> 3;
        wear = wearBits === 0 ? "not_wearing" : wearBits === 1 ? "wearing" : "unknown";
        quality = (wearByte & 0xe0) >> 5;
        const f1 = buffer.get();
        const f2 = buffer.get();
        if (f1 === 0xe2 && f2 === 0x04) {
          const resync = buffer.int32();
          buffer.skip(2); // duration
          buffer.skip(2); // minutes offset
          timestamp = resync;
        } else if (f1 === 0xd3) {
          // Workout-related; upstream only skips (spec §5.4).
          const info0 = buffer.get();
          buffer.get();
          const v1 = buffer.get();
          const v2 = buffer.peek(buffer.position);
          if (v1 === 0xdf) {
            buffer.get();
            if (info0 === 0x08) buffer.skip(11);
            else if (!VALID_FLAGS.has(buffer.peek(buffer.position + 4))) buffer.skip(3);
          } else if (v1 === 0xe2 && v2 === 0x04) {
            buffer.skip(13);
            if (!VALID_FLAGS.has(buffer.peek(buffer.position))) buffer.skip(3);
          } else if (!VALID_FLAGS.has(buffer.peek(buffer.position + 4))) {
            buffer.get();
          }
        } else if (f1 === 0xcf || f1 === 0xdf) {
          continue;
        } else if (f1 === 0xd6) {
          buffer.get(); // SpO2 (not mapped: no SpO2 record type in the contract)
          buffer.skip(3);
        } else if (f1 === 0xfe && f2 === 0xfe) {
          if (buffer.peek(buffer.position) === 0xfe) buffer.get();
        } else if (VALID_FLAGS.has(buffer.peek(buffer.position + 2))) {
          // 6-byte minute record: f1/f2 are the variability bytes.
          current.steps = variabilitySteps(f1);
          current.heartRate = buffer.get();
          const calories = buffer.get();
          current.active = (calories & 0x40) === 0x40;
          current.calories = calories & 0x3f;
          finish();
          continue;
        }
        if (buffer.position > buffer.capacity - 4) continue;
        readFourByteSample();
        break;
      }
      case 0xc2:
        buffer.skip(3);
        break;
      case 0xe2:
        buffer.skip(9);
        if (!VALID_FLAGS.has(buffer.peek(buffer.position))) buffer.skip(6);
        break;
      case 0xe0:
        // Workout summary: 14 TLV attributes. Not mapped (spec §5.7).
        for (let attribute = 0; attribute < 14; attribute += 1) {
          const id = buffer.get();
          const size = buffer.get();
          // Upstream reads attribute 2 with getInt() and attribute 9 with
          // get(0): a shorter attribute throws there, so the file is kept.
          if ((id === 2 && size < 4) || (id === 9 && size < 1))
            throw new Error("FOSSIL_ACTIVITY_TRUNCATED");
          buffer.skip(size);
        }
        break;
      case 0xdd:
        buffer.skip(20);
        break;
      case 0xd6:
        buffer.get();
        buffer.get(); // SpO2 (not mapped)
        break;
      case 0xcb:
      case 0xcc:
      case 0xcf:
        buffer.get();
        break;
      default:
        break;
    }
  }
  return samples;
}

// ---------------------------------------------------------------------------
// Native crypto

/** react-native-quick-crypto provider; loaded lazily (no native import at load time). */
export async function loadFossilCrypto(): Promise<FossilCrypto> {
  const native = (await import("react-native-quick-crypto")) as unknown as {
    randomBytes(size: number): Uint8Array;
    createCipheriv(
      algorithm: string,
      key: Uint8Array,
      iv: Uint8Array | null,
    ): {
      setAutoPadding(on: boolean): void;
      update(data: Uint8Array): Uint8Array;
      final(): Uint8Array;
    };
    createDecipheriv(
      algorithm: string,
      key: Uint8Array,
      iv: Uint8Array | null,
    ): {
      setAutoPadding(on: boolean): void;
      update(data: Uint8Array): Uint8Array;
      final(): Uint8Array;
    };
  };
  return nodeStyleFossilCrypto(native);
}

/** Builds the provider from any Node-compatible crypto (Node in tests, quick-crypto on device). */
export function nodeStyleFossilCrypto(native: {
  randomBytes(size: number): Uint8Array;
  createCipheriv(
    algorithm: string,
    key: Uint8Array,
    iv: Uint8Array | null,
  ): {
    setAutoPadding(on: boolean): void;
    update(data: Uint8Array): Uint8Array;
    final(): Uint8Array;
  };
  createDecipheriv(
    algorithm: string,
    key: Uint8Array,
    iv: Uint8Array | null,
  ): {
    setAutoPadding(on: boolean): void;
    update(data: Uint8Array): Uint8Array;
    final(): Uint8Array;
  };
}): FossilCrypto {
  const run = (
    cipher: {
      setAutoPadding(on: boolean): void;
      update(data: Uint8Array): Uint8Array;
      final(): Uint8Array;
    },
    data: Uint8Array,
  ) => {
    cipher.setAutoPadding(false);
    const head = new Uint8Array(cipher.update(data));
    const tail = new Uint8Array(cipher.final());
    const out = new Uint8Array(head.length + tail.length);
    out.set(head);
    out.set(tail, head.length);
    return out;
  };
  return {
    randomBytes: (size) => new Uint8Array(native.randomBytes(size)),
    aesEcbEncrypt: (key, block) => run(native.createCipheriv("aes-128-ecb", key, null), block),
    aesEcbDecrypt: (key, block) => run(native.createDecipheriv("aes-128-ecb", key, null), block),
    aesCtr: (key, iv, data) => run(native.createCipheriv("aes-128-ctr", key, iv), data),
  };
}
