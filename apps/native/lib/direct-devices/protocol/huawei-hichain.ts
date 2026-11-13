/**
 * Huawei full HiChain authentication (HiChain and HiChain3), pure parts: the
 * PIN fetch (0x01/0x2C), the ISO exchange codec (0x01/0x28) and its crypto.
 * Ported from Gadgetbridge 8976702fc3d0 (`GetHiChainRequest`, `GetPincodeRequest`,
 * `DeviceConfig.HiChain`, `HuaweiCrypto`, `CryptoUtils`); see
 * docs/research/notes/Bluetooth Classic RFCOMM/huawei-hichain-auth.md. No I/O
 * and no randomness here: the session injects both.
 *
 * AGPL-3.0-or-later (same as upstream Gadgetbridge).
 */

import {
  concatHuaweiBytes,
  hkdfSha256,
  huaweiDigestSecret,
  type HuaweiCryptoProvider,
} from "../crypto/huawei-auth";
import {
  encodeHuaweiTlv,
  huaweiTlvByte,
  huaweiTlvBytes,
  type HuaweiAesProvider,
  type HuaweiTlv,
} from "./huawei";

export const HUAWEI_HICHAIN_COMMAND = 0x28;
export const HUAWEI_PINCODE_COMMAND = 0x2c;
/** `HuaweiConstants.GROUP_ID`. */
export const HUAWEI_HICHAIN_GROUP_ID =
  "7B0BC0CBCE474F6C238D9661C63400B797B166EA7849B3A370FC73A9A236E989";
/** Op-1 step 1 waits for the user to confirm on the watch (`firstAuthenticateTimeout`). */
export const HUAWEI_HICHAIN_CONFIRM_TIMEOUT_MS = 30_000;
/** Op-2 step 1 (`authenticateTimeout`). */
export const HUAWEI_HICHAIN_AUTH_TIMEOUT_MS = 5_000;

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const utf8 = (value: string) => encoder.encode(value);

export function huaweiHexUpper(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

export function huaweiUnhex(value: string): Uint8Array {
  if (!/^(?:[0-9a-fA-F]{2})*$/.test(value)) throw new Error("HUAWEI_HICHAIN_PROTOCOL");
  const out = new Uint8Array(value.length / 2);
  for (let index = 0; index < out.length; index += 1)
    out[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  return out;
}

/** Constant-time equality for MACs and tokens. */
export function huaweiEqualBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left[index]! ^ right[index]!;
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Auth-type decision (`HuaweiSupportProvider.finalizeSecurityNegotiationHiChain`)
// ---------------------------------------------------------------------------

/** 0x0186A0 is HiChain; 5 and 6 are "HiChain3" (same exchange); 1 and 2 HiChainLite. */
export function classifyHuaweiAuthType(
  authType: number,
): "hichain" | "hichain3" | "hichain_lite" | null {
  if (authType === 0x0186a0) return "hichain";
  if ((authType ^ 1) === 4 || (authType ^ 2) === 4) return "hichain3";
  if (authType === 1 || authType === 2) return "hichain_lite";
  return null;
}

// ---------------------------------------------------------------------------
// PIN (0x01/0x2C)
// ---------------------------------------------------------------------------

/** `GetPincodeRequest`: one empty tag 0x01. */
export function buildHuaweiPincodeRequest(): Uint8Array {
  return encodeHuaweiTlv([{ tag: 0x01, value: new Uint8Array(0) }]);
}

/**
 * `HuaweiCrypto.decryptPinCode`: the PIN (tag 0x01) under the digest secret
 * for `authVersion`, AES-128-GCM when `encryptMethod == 1` (IV as sent, no
 * AAD), else AES-128-CBC/PKCS7; the IV is tag 0x02.
 */
export function decryptHuaweiPinCode(args: {
  tlv: HuaweiTlv;
  authVersion: number;
  encryptMethod: number;
  aes: HuaweiAesProvider;
}): Uint8Array {
  const cipherText = huaweiTlvBytes(args.tlv, 0x01);
  const iv = huaweiTlvBytes(args.tlv, 0x02);
  if (!cipherText || !iv) throw new Error("HUAWEI_HICHAIN_PIN_FAILED");
  const key = huaweiDigestSecret(args.authVersion);
  try {
    return args.encryptMethod === 0x01
      ? args.aes.decryptGcm(key, cipherText, iv)
      : args.aes.decryptCbc(key, cipherText, iv);
  } catch {
    throw new Error("HUAWEI_HICHAIN_PIN_FAILED");
  }
}

// ---------------------------------------------------------------------------
// ISO exchange codec (0x01/0x28)
// ---------------------------------------------------------------------------

export type HuaweiHiChainOperation = 1 | 2;

/**
 * Request JSON in upstream's exact key order (`DeviceConfig.HiChain.Request
 * .createJson`, Android `org.json`: insertion order, no whitespace). `fields`
 * go into `payload` after `version`; op 1 adds the group block; op-2 steps 1
 * and 2 end with `isDeviceLevel`.
 */
export function buildHuaweiHiChainJson(args: {
  operation: HuaweiHiChainOperation;
  /** 1, 2, 3 or 4; op 2's final step is sent with `message` 3 (|0x10). */
  messageId: number;
  requestId: bigint;
  androidId: string;
  fields: ReadonlyArray<readonly [string, string | number]>;
  isDeviceLevel?: boolean;
}): string {
  const payload: Record<string, unknown> = {
    version: { minVersion: "1.0.0", currentVersion: "2.0.16" },
  };
  for (const [key, value] of args.fields) payload[key] = value;
  const value: Record<string, unknown> = {
    authForm: 0,
    payload,
    groupAndModuleVersion: "2.0.1",
    message: args.messageId | (args.operation === 2 ? 0x10 : 0),
  };
  if (args.operation === 1) {
    value.requestId = args.requestId.toString();
    value.groupId = HUAWEI_HICHAIN_GROUP_ID;
    value.groupName = "health_group_name";
    value.groupOp = 2;
    value.groupType = 256;
    value.peerDeviceId = args.androidId;
    value.connDeviceId = args.androidId;
    value.appId = "com.huawei.health";
    value.ownerName = "";
  }
  if (args.isDeviceLevel !== undefined) value.isDeviceLevel = args.isDeviceLevel;
  return JSON.stringify(value);
}

/** Request TLV: 0x01 JSON, 0x02 operation, 0x03 requestId as u64 big-endian. */
export function buildHuaweiHiChainRequest(args: {
  operation: HuaweiHiChainOperation;
  requestId: bigint;
  json: string;
}): Uint8Array {
  const requestId = new Uint8Array(8);
  new DataView(requestId.buffer).setBigUint64(0, args.requestId);
  return encodeHuaweiTlv([
    { tag: 0x01, value: utf8(args.json) },
    { tag: 0x02, value: Uint8Array.of(args.operation) },
    { tag: 0x03, value: requestId },
  ]);
}

export type HuaweiHiChainResponse =
  | Readonly<{
      step: 1;
      randPeer: Uint8Array;
      authIdPeer: Uint8Array;
      peerUserType: number;
      token: Uint8Array;
    }>
  | Readonly<{ step: 2; returnCodeMac: Uint8Array }>
  | Readonly<{ step: 3; nonce: Uint8Array; encAuthToken: Uint8Array }>
  | Readonly<{ step: 4 }>;

/**
 * `DeviceConfig.HiChain.Response`: tag 0x04 is the type (0 = JSON in tag
 * 0x01, anything else = the final step). The JSON's payload is routed by key
 * (`isoSalt`, `returnCodeMac`, `encAuthToken`). A non-zero `errorCode` is the
 * watch refusing; anything unrecognised is a protocol error (upstream would
 * loop back to step 1).
 */
export function parseHuaweiHiChainResponse(tlv: HuaweiTlv): HuaweiHiChainResponse {
  const type = huaweiTlvByte(tlv, 0x04);
  if (type === null) throw new Error("HUAWEI_HICHAIN_PROTOCOL");
  if (type !== 0) return { step: 4 };
  const raw = huaweiTlvBytes(tlv, 0x01);
  if (!raw) throw new Error("HUAWEI_HICHAIN_PROTOCOL");
  let envelope: { payload?: Record<string, unknown> } & Record<string, unknown>;
  try {
    envelope = JSON.parse(decoder.decode(raw)) as typeof envelope;
  } catch {
    throw new Error("HUAWEI_HICHAIN_PROTOCOL");
  }
  const payload = envelope.payload;
  if (!payload || typeof payload !== "object") throw new Error("HUAWEI_HICHAIN_PROTOCOL");
  const errorCode = payload.errorCode ?? envelope.errorCode;
  if (typeof errorCode === "number" && errorCode !== 0) throw new Error("HUAWEI_HICHAIN_REJECTED");
  const text = (key: string) => {
    const value = payload[key];
    if (typeof value !== "string") throw new Error("HUAWEI_HICHAIN_PROTOCOL");
    return huaweiUnhex(value);
  };
  if ("isoSalt" in payload) {
    if (typeof payload.peerUserType !== "number") throw new Error("HUAWEI_HICHAIN_PROTOCOL");
    return {
      step: 1,
      randPeer: text("isoSalt"),
      authIdPeer: text("peerAuthId"),
      peerUserType: payload.peerUserType,
      token: text("token"),
    };
  }
  if ("returnCodeMac" in payload) return { step: 2, returnCodeMac: text("returnCodeMac") };
  if ("encAuthToken" in payload)
    return { step: 3, nonce: text("nonce"), encAuthToken: text("encAuthToken") };
  throw new Error("HUAWEI_HICHAIN_PROTOCOL");
}

// ---------------------------------------------------------------------------
// Crypto (`GetHiChainRequest`, spec §3.4)
// ---------------------------------------------------------------------------

const ZERO4 = new Uint8Array(4);

/** `SHA256(UTF-8(uppercase hex of the PIN))`: the op-1 PSK key. */
export function huaweiHiChainPinKey(crypto: HuaweiCryptoProvider, pin: Uint8Array): Uint8Array {
  return crypto.sha256(utf8(huaweiHexUpper(pin)));
}

export function huaweiHiChainPsk(
  crypto: HuaweiCryptoProvider,
  key: Uint8Array,
  seed: Uint8Array,
): Uint8Array {
  return crypto.hmacSha256(key, seed);
}

/** The watch's step-1 token: `HMAC(psk, randPeer ‖ randSelf ‖ authIdSelf ‖ authIdPeer)`. */
export function huaweiHiChainPeerToken(
  crypto: HuaweiCryptoProvider,
  psk: Uint8Array,
  ids: HuaweiHiChainIds,
): Uint8Array {
  return crypto.hmacSha256(
    psk,
    concatHuaweiBytes(ids.randPeer, ids.randSelf, ids.authIdSelf, ids.authIdPeer),
  );
}

/** Our step-2 token, the mirror order: `HMAC(psk, randSelf ‖ randPeer ‖ authIdPeer ‖ authIdSelf)`. */
export function huaweiHiChainSelfToken(
  crypto: HuaweiCryptoProvider,
  psk: Uint8Array,
  ids: HuaweiHiChainIds,
): Uint8Array {
  return crypto.hmacSha256(
    psk,
    concatHuaweiBytes(ids.randSelf, ids.randPeer, ids.authIdPeer, ids.authIdSelf),
  );
}

/** The watch's step-2 `returnCodeMac`: `HMAC(psk, 00000000)`. */
export function huaweiHiChainReturnCodeMac(
  crypto: HuaweiCryptoProvider,
  psk: Uint8Array,
): Uint8Array {
  return crypto.hmacSha256(psk, ZERO4);
}

export type HuaweiHiChainIds = Readonly<{
  randSelf: Uint8Array;
  randPeer: Uint8Array;
  authIdSelf: Uint8Array;
  authIdPeer: Uint8Array;
}>;

export function huaweiHiChainSessionKey(
  crypto: HuaweiCryptoProvider,
  psk: Uint8Array,
  randSelf: Uint8Array,
  randPeer: Uint8Array,
): Uint8Array {
  return hkdfSha256(
    crypto,
    psk,
    concatHuaweiBytes(randSelf, randPeer),
    utf8("hichain_iso_session_key"),
    32,
  );
}

/** Op-1 step 3: the 16-byte challenge under AES-256-GCM, AAD "hichain_iso_exchange". */
export function huaweiHiChainEncryptChallenge(
  aes: HuaweiAesProvider,
  sessionKey: Uint8Array,
  nonce: Uint8Array,
  challenge: Uint8Array,
): Uint8Array {
  return aes.encryptGcm(sessionKey, challenge, nonce, utf8("hichain_iso_exchange"));
}

/** The watch's step-3 `encAuthToken`, AAD = our challenge. */
export function huaweiHiChainDecryptAuthToken(
  aes: HuaweiAesProvider,
  sessionKey: Uint8Array,
  nonce: Uint8Array,
  encAuthToken: Uint8Array,
  challenge: Uint8Array,
): Uint8Array {
  try {
    return aes.decryptGcm(sessionKey, encAuthToken, nonce, challenge);
  } catch {
    throw new Error("HUAWEI_HICHAIN_TOKEN_MISMATCH");
  }
}

/** Step 4: `00000000` under AES-256-GCM, AAD "hichain_iso_result". */
export function huaweiHiChainEncryptResult(
  aes: HuaweiAesProvider,
  sessionKey: Uint8Array,
  nonce: Uint8Array,
): Uint8Array {
  return aes.encryptGcm(sessionKey, ZERO4, nonce, utf8("hichain_iso_result"));
}

/** After op 2: the 32-byte packet key, `HKDF(sessionKey, randSelf ‖ randPeer, "hichain_return_key")`. */
export function huaweiHiChainPacketKey(
  crypto: HuaweiCryptoProvider,
  sessionKey: Uint8Array,
  randSelf: Uint8Array,
  randPeer: Uint8Array,
): Uint8Array {
  return hkdfSha256(
    crypto,
    sessionKey,
    concatHuaweiBytes(randSelf, randPeer),
    utf8("hichain_return_key"),
    32,
  );
}
