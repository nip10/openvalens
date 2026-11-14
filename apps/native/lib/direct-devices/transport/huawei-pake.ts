/**
 * Honor PAKE/STS drivers (Honor Watch 5, 5 Pro, 6): the PSK-SPEKE bind
 * (operation code 1) and the STS reconnect (operation code 2) over 0x01/0x28,
 * ported from Gadgetbridge 8976702fc3d0 `GetHiChainPakeRequest`. The session
 * supplies the transport (`request`) and randomness; the crypto is in
 * `protocol/huawei-pake.ts`. See
 * docs/research/notes/Bluetooth Classic RFCOMM/honor-pake-sts.md.
 *
 * AGPL-3.0-or-later (same as upstream Gadgetbridge).
 */

import type { HuaweiCryptoProvider } from "../crypto/huawei-auth";
import { concatHuaweiBytes } from "../crypto/huawei-auth";
import type { HuaweiAesProvider, HuaweiTlv } from "../protocol/huawei";
import { huaweiHexUpper } from "../protocol/huawei-hichain";
import {
  HUAWEI_PAKE_BASE_POINT,
  HUAWEI_PAKE_EXCHANGE_REQUEST_AAD,
  HUAWEI_PAKE_EXCHANGE_RESPONSE_AAD,
  HUAWEI_PAKE_MESSAGE,
  HUAWEI_PAKE_SERVICE_TYPE,
  buildHuaweiPakeDhRequest,
  buildHuaweiPakeJson,
  buildHuaweiPakeJsonRequest,
  huaweiPakeBindPin,
  huaweiPakeIdentityInfo,
  huaweiPakeIdentityPublicKey,
  huaweiPakeOpen,
  huaweiPakeProofMatches,
  huaweiPakeSeal,
  huaweiPakeSign,
  huaweiPakeSpeke,
  huaweiPakeStsPin,
  huaweiPakeStsPsk,
  huaweiPakeVerify,
  huaweiPakeX25519,
  parseHuaweiPakePeerIdentity,
  parseHuaweiPakeResponse,
  type HuaweiPakeResponse,
} from "../protocol/huawei-pake";

/** The watch's identity, learned at bind and needed for every STS reconnect. */
export type HuaweiPakePeer = Readonly<{ authId: Uint8Array; authPk: Uint8Array }>;

export type HuaweiPakeIo = Readonly<{
  /**
   * Sends one 0x01/0x28 TLV and resolves with the reply. `accept` returning
   * false skips a reply and keeps waiting.
   */
  request(tlv: Uint8Array, accept: (reply: HuaweiTlv) => boolean): Promise<HuaweiTlv>;
}>;

export type HuaweiPakeContext = Readonly<{
  io: HuaweiPakeIo;
  crypto: HuaweiCryptoProvider;
  aes: HuaweiAesProvider;
  randomBytes: (size: number) => Uint8Array;
  /** `UTF-8(androidId)`: our authId. */
  authId: Uint8Array;
  /** Our long-term Ed25519 seed (32 bytes). */
  seed: Uint8Array;
}>;

/** A device-identity frame (dataType 3) is not a reply to our step: skip it. */
const notIdentity = (reply: HuaweiTlv) => {
  try {
    return parseHuaweiPakeResponse(reply).kind !== "identity";
  } catch {
    return true;
  }
};

async function exchange(context: HuaweiPakeContext, tlv: Uint8Array): Promise<HuaweiPakeResponse> {
  return parseHuaweiPakeResponse(await context.io.request(tlv, notIdentity));
}

function expect<K extends HuaweiPakeResponse["kind"]>(
  reply: HuaweiPakeResponse,
  kind: K,
): Extract<HuaweiPakeResponse, { kind: K }> {
  if (reply.kind !== kind) throw new Error("HUAWEI_PAKE_PROTOCOL");
  return reply as Extract<HuaweiPakeResponse, { kind: K }>;
}

const json = (
  messageId: number,
  fields: ReadonlyArray<readonly [string, string | number | boolean]>,
  options: { first?: { operationCode: 1 | 2 }; authForm?: boolean } = {},
) => buildHuaweiPakeJsonRequest(buildHuaweiPakeJson({ messageId, fields, ...options }));

/**
 * The PSK-SPEKE bind: an anonymous X25519 exchange gives a 12-character PIN
 * (the user types nothing), SPEKE proves both sides hold it, then each side
 * sends its Ed25519 identity, signed and sealed under the session key.
 * Returns the watch's identity for the store.
 */
export async function runHuaweiPakeBind(context: HuaweiPakeContext): Promise<HuaweiPakePeer> {
  const { crypto, aes } = context;
  // Step 0: X25519 → PIN.
  const dhPrivate = context.randomBytes(32);
  const dh = expect(
    await exchange(
      context,
      buildHuaweiPakeDhRequest(huaweiPakeX25519(dhPrivate, HUAWEI_PAKE_BASE_POINT)),
    ),
    "dh",
  );
  const pin = huaweiPakeBindPin(huaweiPakeX25519(dhPrivate, dh.publicKey));

  // Step 1: PAKE start → challenge, salt, epk.
  const start = expect(
    await exchange(
      context,
      json(
        HUAWEI_PAKE_MESSAGE.pakeStart,
        [
          ["support256mod", true],
          ["serviceType", HUAWEI_PAKE_SERVICE_TYPE],
        ],
        { first: { operationCode: 1 } },
      ),
    ),
    "pake_response",
  );
  const speke = huaweiPakeSpeke({
    crypto,
    pin,
    salt: start.salt,
    peerChallenge: start.challenge,
    peerEpk: start.epk,
    selfChallenge: context.randomBytes(16),
    selfPrivate: context.randomBytes(32),
  });

  // Step 2: client confirm → the watch's proof.
  const confirm = expect(
    await exchange(
      context,
      json(HUAWEI_PAKE_MESSAGE.clientConfirm, [
        ["challenge", huaweiHexUpper(speke.selfChallenge)],
        ["epk", huaweiHexUpper(speke.selfEpk)],
        ["kcfData", huaweiHexUpper(speke.proof)],
      ]),
    ),
    "pake_confirm",
  );
  if (!huaweiPakeProofMatches(speke.peerProof, confirm.kcfData))
    throw new Error("HUAWEI_PAKE_FAILED");

  // Step 3: identities, signed over SHA-256(challenges ‖ info), sealed under the session key.
  const info = huaweiPakeIdentityInfo(context.authId, huaweiPakeIdentityPublicKey(context.seed));
  const signature = huaweiPakeSign(
    crypto,
    context.seed,
    concatHuaweiBytes(speke.selfChallenge, start.challenge, info),
  );
  const sealed = huaweiPakeSeal(
    aes,
    speke.sessionKey,
    context.randomBytes(12),
    HUAWEI_PAKE_EXCHANGE_REQUEST_AAD,
    concatHuaweiBytes(info, signature),
  );
  const reply = expect(
    await exchange(
      context,
      json(HUAWEI_PAKE_MESSAGE.exchange, [["exAuthInfo", huaweiHexUpper(sealed)]]),
    ),
    "exchange",
  );
  const peer = parseHuaweiPakePeerIdentity(
    huaweiPakeOpen(aes, speke.sessionKey, HUAWEI_PAKE_EXCHANGE_RESPONSE_AAD, reply.exAuthInfo),
  );
  const signed = concatHuaweiBytes(start.challenge, speke.selfChallenge, peer.info);
  if (!huaweiPakeVerify(crypto, signed, peer.signature, peer.authPk))
    throw new Error("HUAWEI_PAKE_FAILED");
  return { authId: peer.authId, authPk: peer.authPk };
}

/**
 * The STS reconnect: the SPEKE PIN comes from the static X25519 between both
 * Ed25519 identities and the watch's nonce, so a watch that still trusts us
 * proves it without a new bind. Any refusal or proof mismatch is
 * `HUAWEI_PAKE_REBIND_REQUIRED`.
 */
export async function runHuaweiPakeReconnect(
  context: HuaweiPakeContext,
  peer: HuaweiPakePeer,
): Promise<void> {
  const { crypto } = context;
  const rebind = (error: unknown): never => {
    const code = error instanceof Error ? error.message : "";
    if (code === "HUAWEI_PAKE_REJECTED" || code === "HUAWEI_PAKE_FAILED")
      throw new Error("HUAWEI_PAKE_REBIND_REQUIRED", { cause: error });
    throw error;
  };
  // Message 17: its challenge and epk are never used again (upstream: "cosmetic").
  const start = await exchange(
    context,
    json(
      HUAWEI_PAKE_MESSAGE.stsStart,
      [
        ["challenge", huaweiHexUpper(context.randomBytes(16))],
        ["epk", huaweiHexUpper(huaweiPakeX25519(context.randomBytes(32), HUAWEI_PAKE_BASE_POINT))],
        ["serviceType", HUAWEI_PAKE_SERVICE_TYPE],
        ["peerAuthId", huaweiHexUpper(context.authId)],
        ["keyLength", 32],
        ["keyInfoSize", 0],
      ],
      { first: { operationCode: 2 }, authForm: true },
    ),
  ).catch(rebind);
  const sts = expect(start, "sts_start");
  const pin = huaweiPakeStsPin(crypto, huaweiPakeStsPsk(context.seed, peer.authPk), sts.nonce);
  const speke = huaweiPakeSpeke({
    crypto,
    pin,
    salt: sts.salt,
    peerChallenge: sts.challenge,
    peerEpk: sts.epk,
    selfChallenge: context.randomBytes(16),
    selfPrivate: context.randomBytes(32),
  });
  const ack = expect(
    await exchange(
      context,
      json(
        HUAWEI_PAKE_MESSAGE.stsAck,
        [
          ["challenge", huaweiHexUpper(speke.selfChallenge)],
          ["epk", huaweiHexUpper(speke.selfEpk)],
          ["kcfData", huaweiHexUpper(speke.proof)],
        ],
        { authForm: true },
      ),
    ).catch(rebind),
    "sts_ack",
  );
  if (!huaweiPakeProofMatches(speke.peerProof, ack.kcfData))
    throw new Error("HUAWEI_PAKE_REBIND_REQUIRED");
}
