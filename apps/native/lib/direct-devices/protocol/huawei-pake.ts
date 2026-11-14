/**
 * Honor PAKE/STS (Honor Watch 5, 5 Pro, 6), pure parts: the PAKE-form
 * SecurityNegotiation (0x01/0x33), the Honor "MBB" framing of 0x01/0x28, and
 * the EC-SPEKE / Ed25519 crypto. Ported from Gadgetbridge 8976702fc3d0
 * (`GetHiChainPakeRequest`, `HiChainPakeUtils`, `DeviceConfig.HiChain`,
 * `DeviceConfig.SecurityNegotiation`); see
 * docs/research/notes/Bluetooth Classic RFCOMM/honor-pake-sts.md. No I/O and no
 * randomness here: the driver injects both.
 *
 * AGPL-3.0-or-later (same as upstream Gadgetbridge).
 */

import { ed25519, x25519 } from "@noble/curves/ed25519.js";

import { concatHuaweiBytes, hkdfSha256, type HuaweiCryptoProvider } from "../crypto/huawei-auth";
import {
  encodeHuaweiTlv,
  huaweiTlvByte,
  huaweiTlvBytes,
  type HuaweiAesProvider,
  type HuaweiTlv,
} from "./huawei";
import { huaweiEqualBytes, huaweiHexUpper, huaweiUnhex } from "./huawei-hichain";

/** `GetHiChainPakeRequest` message ids (OpenHarmony device_auth); replies are `id | 0x8000`. */
export const HUAWEI_PAKE_MESSAGE = Object.freeze({
  pakeStart: 1,
  clientConfirm: 2,
  exchange: 3,
  stsStart: 17,
  stsAck: 18,
  stsStartReply: 32785,
  stsAckReply: 32786,
});

/** First-message `version`; classic HiChain sends 2.0.16, PAKE 2.0.15. */
const PAKE_VERSION = { minVersion: "1.0.0", currentVersion: "2.0.15" } as const;
/** `serviceType` of the PAKE start and the STS start. */
export const HUAWEI_PAKE_SERVICE_TYPE = "WEAR_MBB";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const utf8 = (value: string) => encoder.encode(value);
const latin1 = (value: string) => Uint8Array.from(value, (character) => character.charCodeAt(0));

const BASE_INFO = utf8("hichain_speke_base_info");
const SESSION_KEY_INFO = utf8("hichain_speke_sessionkey_info");
const TMP_AUTH_KEY_INFO = utf8("hichain_tmp_auth_enc_key");
export const HUAWEI_PAKE_EXCHANGE_REQUEST_AAD = utf8("hichain_exchange_request");
export const HUAWEI_PAKE_EXCHANGE_RESPONSE_AAD = utf8("hichain_exchange_response");

/** RFC 7748 base point u = 9. */
export const HUAWEI_PAKE_BASE_POINT = (() => {
  const point = new Uint8Array(32);
  point[0] = 9;
  return point;
})();

// ---------------------------------------------------------------------------
// SecurityNegotiation, PAKE form (`DeviceConfig.SecurityNegotiation.Request`, MBB)
// ---------------------------------------------------------------------------

/** Tags 1 authMode, 2 pairType (1 FIRST_PAIR, 2 RECONNECT), 3 our authId. */
export function buildHuaweiPakeSecurityNegotiationRequest(args: {
  authMode: number;
  pairType: 1 | 2;
  authId: Uint8Array;
}): Uint8Array {
  return encodeHuaweiTlv([
    { tag: 0x01, value: Uint8Array.of(args.authMode) },
    { tag: 0x02, value: Uint8Array.of(args.pairType) },
    { tag: 0x03, value: args.authId },
  ]);
}

// ---------------------------------------------------------------------------
// 0x01/0x28 MBB framing
// ---------------------------------------------------------------------------

/** dataType 1: our X25519 public key. */
export function buildHuaweiPakeDhRequest(publicKey: Uint8Array): Uint8Array {
  return encodeHuaweiTlv([
    { tag: 0x01, value: Uint8Array.of(0x01) },
    { tag: 0x02, value: publicKey },
  ]);
}

export type HuaweiPakeField = readonly [string, string | number | boolean];

/**
 * dataType 2: `{[authForm:0,] message, payload}` in upstream's key order. The
 * first message of a flow appends `version` then `operationCode` to the payload.
 */
export function buildHuaweiPakeJson(args: {
  messageId: number;
  fields: readonly HuaweiPakeField[];
  first?: { operationCode: 1 | 2 };
  authForm?: boolean;
}): string {
  const payload: Record<string, unknown> = {};
  for (const [key, value] of args.fields) payload[key] = value;
  if (args.first) {
    payload.version = { ...PAKE_VERSION };
    payload.operationCode = args.first.operationCode;
  }
  const value: Record<string, unknown> = {};
  if (args.authForm) value.authForm = 0;
  value.message = args.messageId;
  value.payload = payload;
  return JSON.stringify(value);
}

export function buildHuaweiPakeJsonRequest(json: string): Uint8Array {
  return encodeHuaweiTlv([
    { tag: 0x01, value: Uint8Array.of(0x02) },
    { tag: 0x02, value: utf8(json) },
  ]);
}

export type HuaweiPakeResponse =
  | Readonly<{ kind: "dh"; publicKey: Uint8Array }>
  | Readonly<{ kind: "identity" }>
  | Readonly<{ kind: "pake_response"; challenge: Uint8Array; salt: Uint8Array; epk: Uint8Array }>
  | Readonly<{ kind: "pake_confirm"; kcfData: Uint8Array }>
  | Readonly<{ kind: "exchange"; exAuthInfo: Uint8Array }>
  | Readonly<{
      kind: "sts_start";
      challenge: Uint8Array;
      salt: Uint8Array;
      epk: Uint8Array;
      nonce: Uint8Array;
    }>
  | Readonly<{ kind: "sts_ack"; kcfData: Uint8Array }>;

/**
 * `DeviceConfig.HiChain.Response` for the MBB framing: tag 1 is the data type
 * (1 DH, 2 JSON, 3 device identity), tag 2 the payload. STS replies are routed
 * by message number, bind replies by their keys. A non-zero
 * `payload.errorCode` is the watch refusing (`HUAWEI_PAKE_REJECTED`);
 * anything unrecognised is `HUAWEI_PAKE_PROTOCOL` (upstream would restart).
 */
export function parseHuaweiPakeResponse(tlv: HuaweiTlv): HuaweiPakeResponse {
  if (huaweiTlvBytes(tlv, 0x04) !== null) throw new Error("HUAWEI_PAKE_PROTOCOL");
  const dataType = huaweiTlvByte(tlv, 0x01);
  const data = huaweiTlvBytes(tlv, 0x02);
  if (dataType === 0x03) return { kind: "identity" };
  if (dataType === 0x01) {
    if (!data) throw new Error("HUAWEI_PAKE_PROTOCOL");
    return { kind: "dh", publicKey: data };
  }
  if (dataType !== 0x02 || !data) throw new Error("HUAWEI_PAKE_PROTOCOL");
  let envelope: Record<string, unknown>;
  try {
    envelope = JSON.parse(decoder.decode(data)) as Record<string, unknown>;
  } catch {
    throw new Error("HUAWEI_PAKE_PROTOCOL");
  }
  const payload = envelope.payload as Record<string, unknown> | undefined;
  if (!payload || typeof payload !== "object") throw new Error("HUAWEI_PAKE_PROTOCOL");
  const errorCode = payload.errorCode;
  if (typeof errorCode === "number" && errorCode !== 0) throw new Error("HUAWEI_PAKE_REJECTED");
  const hex = (key: string) => {
    const value = payload[key];
    if (typeof value !== "string") throw new Error("HUAWEI_PAKE_PROTOCOL");
    try {
      return huaweiUnhex(value);
    } catch {
      throw new Error("HUAWEI_PAKE_PROTOCOL");
    }
  };
  const message = envelope.message;
  if (message === HUAWEI_PAKE_MESSAGE.stsStartReply)
    return {
      kind: "sts_start",
      challenge: hex("challenge"),
      epk: hex("epk"),
      salt: hex("salt"),
      nonce: hex("nonce"),
    };
  if (message === HUAWEI_PAKE_MESSAGE.stsAckReply)
    return { kind: "sts_ack", kcfData: hex("kcfData") };
  if ("challenge" in payload && "salt" in payload && "epk" in payload)
    return {
      kind: "pake_response",
      challenge: hex("challenge"),
      salt: hex("salt"),
      epk: hex("epk"),
    };
  if ("kcfData" in payload) return { kind: "pake_confirm", kcfData: hex("kcfData") };
  if ("exAuthInfo" in payload) return { kind: "exchange", exAuthInfo: hex("exAuthInfo") };
  throw new Error("HUAWEI_PAKE_PROTOCOL");
}

// ---------------------------------------------------------------------------
// Curve25519 (`HiChainPakeUtils`)
// ---------------------------------------------------------------------------

const P = 2n ** 255n - 19n;
const A = 486662n;

const mod = (value: bigint) => {
  const result = value % P;
  return result >= 0n ? result : result + P;
};

function powMod(base: bigint, exponent: bigint): bigint {
  let result = 1n;
  let b = mod(base);
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % P;
    b = (b * b) % P;
    e >>= 1n;
  }
  return result;
}

const invert = (value: bigint) => {
  if (mod(value) === 0n) throw new Error("HUAWEI_PAKE_PROTOCOL");
  return powMod(value, P - 2n);
};

function littleEndianToBig(bytes: Uint8Array): bigint {
  let value = 0n;
  for (let index = bytes.length - 1; index >= 0; index -= 1)
    value = (value << 8n) | BigInt(bytes[index]!);
  return value;
}

/** Minimal big-endian bytes (`BN_bn2bin`; zero is one 00 byte, as upstream's `toUnsignedBytes`). */
function bigToMinimalBigEndian(value: bigint): Uint8Array {
  if (value === 0n) return Uint8Array.of(0);
  const out: number[] = [];
  for (let rest = value; rest > 0n; rest >>= 8n) out.unshift(Number(rest & 0xffn));
  return Uint8Array.from(out);
}

function bigToLittleEndian32(value: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let rest = value;
  for (let index = 0; index < 32; index += 1) {
    out[index] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  return out;
}

/** RFC 7748 X25519, little-endian in and out. Rejects an all-zero result. */
export function huaweiPakeX25519(scalar: Uint8Array, u: Uint8Array): Uint8Array {
  if (scalar.length !== 32 || u.length !== 32) throw new Error("HUAWEI_PAKE_PROTOCOL");
  try {
    return x25519.scalarMult(scalar, u);
  } catch {
    throw new Error("HUAWEI_PAKE_PROTOCOL");
  }
}

/**
 * `HiChainPakeUtils.hashToCurve25519`: Elligator2 (non-square 2) to a
 * Curve25519 u-coordinate, replicating the OpenHarmony reference byte for
 * byte, including its left-aligned (not left-padded) placement of `x` before
 * the little-endian reversal.
 */
export function huaweiPakeHashToCurve(secret: Uint8Array): Uint8Array {
  const h = new Uint8Array(32);
  h.set(secret.subarray(0, 32));
  h[31]! &= 0x3f;
  const r = littleEndianToBig(h);
  const denominator = mod(1n + 2n * mod(r * r));
  const b = mod(mod(-A) * invert(denominator));
  const b2 = mod(b * b);
  const a = mod(b2 * b + A * b2 + b);
  const legendre = powMod(a, (P - 1n) >> 1n);
  const x = a === 0n || legendre === 1n ? b : mod(-b - A);
  const bigEndian = bigToMinimalBigEndian(x);
  const buffer = new Uint8Array(32);
  buffer.set(bigEndian.subarray(0, 32), 0);
  return buffer.reverse();
}

/** First-pair PIN: uppercase hex of the first 6 bytes of the X25519 secret. */
export function huaweiPakeBindPin(shared: Uint8Array): string {
  return huaweiHexUpper(shared.subarray(0, 6));
}

/** `derivePasswordKey`: HKDF over the PIN string's ISO-8859-1 bytes. */
export function huaweiPakePasswordKey(
  crypto: HuaweiCryptoProvider,
  pin: string,
  salt: Uint8Array,
): Uint8Array {
  return hkdfSha256(crypto, latin1(pin), salt, BASE_INFO, 32);
}

/** EC-SPEKE keys: `HKDF(K, salt, "hichain_speke_sessionkey_info", 48)` → 16-byte session key, 32-byte kcf key. */
export function huaweiPakeSessionKeys(
  crypto: HuaweiCryptoProvider,
  sharedSecret: Uint8Array,
  salt: Uint8Array,
): { sessionKey: Uint8Array; kcfKey: Uint8Array } {
  const keys = hkdfSha256(crypto, sharedSecret, salt, SESSION_KEY_INFO, 48);
  return { sessionKey: keys.slice(0, 16), kcfKey: keys.slice(16, 48) };
}

/** `generateProof`: `HMAC(kcfKey, first ‖ second)`. */
export function huaweiPakeProof(
  crypto: HuaweiCryptoProvider,
  kcfKey: Uint8Array,
  first: Uint8Array,
  second: Uint8Array,
): Uint8Array {
  return crypto.hmacSha256(kcfKey, concatHuaweiBytes(first, second));
}

export type HuaweiPakeSpeke = Readonly<{
  selfChallenge: Uint8Array;
  selfEpk: Uint8Array;
  sessionKey: Uint8Array;
  kcfKey: Uint8Array;
  /** Ours: `HMAC(kcf, selfChallenge ‖ peerChallenge)`. */
  proof: Uint8Array;
  /** The watch's expected confirm: `HMAC(kcf, peerChallenge ‖ selfChallenge)`. */
  peerProof: Uint8Array;
}>;

/**
 * The SPEKE client side shared by the bind and the STS reconnect: the password
 * key and base from the PIN and salt, our ephemeral, the shared secret, keys
 * and both proofs (`GetHiChainPakeRequest` steps 1-2, `processStsStartResponse`).
 */
export function huaweiPakeSpeke(args: {
  crypto: HuaweiCryptoProvider;
  pin: string;
  salt: Uint8Array;
  peerChallenge: Uint8Array;
  peerEpk: Uint8Array;
  selfChallenge: Uint8Array;
  selfPrivate: Uint8Array;
}): HuaweiPakeSpeke {
  const { crypto } = args;
  const base = huaweiPakeHashToCurve(huaweiPakePasswordKey(crypto, args.pin, args.salt));
  const selfEpk = huaweiPakeX25519(args.selfPrivate, base);
  const shared = huaweiPakeX25519(args.selfPrivate, args.peerEpk);
  const { sessionKey, kcfKey } = huaweiPakeSessionKeys(crypto, shared, args.salt);
  return {
    selfChallenge: args.selfChallenge,
    selfEpk,
    sessionKey,
    kcfKey,
    proof: huaweiPakeProof(crypto, kcfKey, args.selfChallenge, args.peerChallenge),
    peerProof: huaweiPakeProof(crypto, kcfKey, args.peerChallenge, args.selfChallenge),
  };
}

export function huaweiPakeProofMatches(expected: Uint8Array, received: Uint8Array): boolean {
  return huaweiEqualBytes(expected, received);
}

// ---------------------------------------------------------------------------
// Ed25519 identity and the STS PSK
// ---------------------------------------------------------------------------

export function huaweiPakeIdentityPublicKey(seed: Uint8Array): Uint8Array {
  return ed25519.getPublicKey(seed);
}

/** Ed25519 (RFC 8032, pure) over `SHA-256(message)`: the watch pre-hashes. */
export function huaweiPakeSign(
  crypto: HuaweiCryptoProvider,
  seed: Uint8Array,
  message: Uint8Array,
): Uint8Array {
  return ed25519.sign(crypto.sha256(message), seed);
}

export function huaweiPakeVerify(
  crypto: HuaweiCryptoProvider,
  message: Uint8Array,
  signature: Uint8Array,
  publicKey: Uint8Array,
): boolean {
  if (signature.length !== 64 || publicKey.length !== 32) return false;
  try {
    return ed25519.verify(signature, crypto.sha256(message), publicKey, { zip215: false });
  } catch {
    return false;
  }
}

/** `ed25519PrivateToX25519`: `clamp(SHA-512(seed)[0..32))`. */
export function huaweiPakeIdentityToX25519Secret(seed: Uint8Array): Uint8Array {
  return ed25519.utils.toMontgomerySecret(seed);
}

/**
 * `ed25519PublicToX25519`: `u = (1 + y) / (1 − y) mod p` with the sign bit
 * dropped, as upstream (no point validation; a bad key fails the bind's
 * signature check first).
 */
export function huaweiPakeIdentityToX25519Public(publicKey: Uint8Array): Uint8Array {
  if (publicKey.length !== 32) throw new Error("HUAWEI_PAKE_PROTOCOL");
  const bytes = Uint8Array.from(publicKey);
  bytes[31]! &= 0x7f;
  const y = littleEndianToBig(bytes);
  return bigToLittleEndian32(mod(mod(1n + y) * invert(mod(1n - y))));
}

/** `computeStsPsk`: static X25519 between our identity and the watch's. */
export function huaweiPakeStsPsk(seed: Uint8Array, peerPublicKey: Uint8Array): Uint8Array {
  return huaweiPakeX25519(
    huaweiPakeIdentityToX25519Secret(seed),
    huaweiPakeIdentityToX25519Public(peerPublicKey),
  );
}

/** `deriveStsPin`: lowercase hex of `HKDF(psk, nonce, "hichain_tmp_auth_enc_key", 32)`. */
export function huaweiPakeStsPin(
  crypto: HuaweiCryptoProvider,
  psk: Uint8Array,
  nonce: Uint8Array,
): string {
  return huaweiHexUpper(hkdfSha256(crypto, psk, nonce, TMP_AUTH_KEY_INFO, 32)).toLowerCase();
}

// ---------------------------------------------------------------------------
// Key exchange (bind message 3)
// ---------------------------------------------------------------------------

/** `{"authId":hex(authId),"authPk":hex(publicKey)}` as UTF-8. */
export function huaweiPakeIdentityInfo(authId: Uint8Array, publicKey: Uint8Array): Uint8Array {
  return utf8(
    JSON.stringify({ authId: huaweiHexUpper(authId), authPk: huaweiHexUpper(publicKey) }),
  );
}

/** `encryptAesGcm`: `iv12 ‖ AES-128-GCM(sessionKey, iv12, aad, plaintext)`. */
export function huaweiPakeSeal(
  aes: HuaweiAesProvider,
  key: Uint8Array,
  iv: Uint8Array,
  aad: Uint8Array,
  plaintext: Uint8Array,
): Uint8Array {
  if (iv.length !== 12) throw new Error("HUAWEI_PAKE_PROTOCOL");
  return concatHuaweiBytes(iv, aes.encryptGcm(key, plaintext, iv, aad));
}

export function huaweiPakeOpen(
  aes: HuaweiAesProvider,
  key: Uint8Array,
  aad: Uint8Array,
  sealed: Uint8Array,
): Uint8Array {
  if (sealed.length <= 12 + 16) throw new Error("HUAWEI_PAKE_FAILED");
  try {
    return aes.decryptGcm(key, sealed.subarray(12), sealed.subarray(0, 12), aad);
  } catch {
    throw new Error("HUAWEI_PAKE_FAILED");
  }
}

/** The watch's exchange reply: `info ‖ sig64`, `info` = `{"authId","authPk"}`. */
export function parseHuaweiPakePeerIdentity(plaintext: Uint8Array): {
  info: Uint8Array;
  signature: Uint8Array;
  authId: Uint8Array;
  authPk: Uint8Array;
} {
  if (plaintext.length <= 64) throw new Error("HUAWEI_PAKE_FAILED");
  const info = plaintext.slice(0, plaintext.length - 64);
  const signature = plaintext.slice(plaintext.length - 64);
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(decoder.decode(info)) as Record<string, unknown>;
  } catch {
    throw new Error("HUAWEI_PAKE_PROTOCOL");
  }
  if (typeof parsed.authId !== "string" || typeof parsed.authPk !== "string")
    throw new Error("HUAWEI_PAKE_PROTOCOL");
  try {
    return {
      info,
      signature,
      authId: huaweiUnhex(parsed.authId),
      authPk: huaweiUnhex(parsed.authPk),
    };
  } catch {
    throw new Error("HUAWEI_PAKE_PROTOCOL");
  }
}
