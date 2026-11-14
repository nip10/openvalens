/**
 * Honor PAKE/STS primitives and codec. The first block replays upstream's own
 * `TestHiChainPakeUtils` vectors (Gadgetbridge 8976702fc3d0); the rest are
 * known answers from an independent Node script (OpenSSL X25519/Ed25519,
 * `huawei-pake.kat.json`), so a misreading shared by code and test cannot pass.
 *
 * AGPL-3.0-or-later (same as upstream Gadgetbridge).
 */

import { expect, test } from "bun:test";

import { nodeHuaweiAes, nodeHuaweiCrypto } from "../crypto/huawei-node-crypto.test-helpers";
import { decodeHuaweiTlv, encodeHuaweiTlv } from "./huawei";
import { huaweiHexUpper, huaweiUnhex } from "./huawei-hichain";
import {
  huaweiPakeBasePoint,
  HUAWEI_PAKE_EXCHANGE_REQUEST_AAD,
  buildHuaweiPakeDhRequest,
  buildHuaweiPakeJson,
  buildHuaweiPakeSecurityNegotiationRequest,
  huaweiPakeBindPin,
  huaweiPakeHashToCurve,
  huaweiPakeIdentityPublicKey,
  huaweiPakeIdentityToX25519Public,
  huaweiPakeIdentityToX25519Secret,
  huaweiPakeOpen,
  huaweiPakePasswordKey,
  huaweiPakeSeal,
  huaweiPakeSpeke,
  huaweiPakeStsPin,
  huaweiPakeStsPsk,
  huaweiPakeVerify,
  huaweiPakeX25519,
  parseHuaweiPakePeerIdentity,
  parseHuaweiPakeResponse,
} from "./huawei-pake";
import KAT from "./huawei-pake.kat.json";
import { HONOR_PAKE_INPUTS } from "./huawei-pake.test-helpers";

const crypto = nodeHuaweiCrypto();
const lower = (bytes: Uint8Array) => huaweiHexUpper(bytes).toLowerCase();
const seq = (start: number, length: number) =>
  Uint8Array.from({ length }, (_, index) => (start + index) & 0xff);

// ---------------------------------------------------------------------------
// Upstream TestHiChainPakeUtils
// ---------------------------------------------------------------------------

test("Elligator2 matches upstream's OpenHarmony-validated vectors byte for byte", () => {
  const vectors = [
    [
      "0000000000000000000000000000000000000000000000000000000000000001",
      "8488ac5e043ea853cd14e1a0d9b13abf534298f96509d669b0ea87cbf09bb673",
    ],
    [
      "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20",
      "4e4c39ac31d3b3b16617427847178670e6afce5430eaa6aa41166cd7b1552525",
    ],
    // 33 bytes: only the first 32 count.
    [
      "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef00",
      "281f4575bc3210b5e6031561b1dfdacfadd91220fad52dab911c99e7e8e92d56",
    ],
    [
      "fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff0",
      "39cefaa8000c28b1501cee3f00eb5b997e897979a0c854ff5924f32de8103a7e",
    ],
    [
      "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
      "d3e239d7180ca04349edbd3751eca41fd3c2856bc64319cd5d9649764651a87d",
    ],
  ] as const;
  for (const [input, output] of vectors)
    expect(lower(huaweiPakeHashToCurve(huaweiUnhex(input)))).toBe(output);
});

test("Elligator2 keeps upstream's left-aligned placement when x < 2^248", () => {
  // None of upstream's vectors reaches this case. Found and computed by an
  // independent BigInt script; the ordinary little-endian encoding would be
  // 0c4bcd…539500 (x's top byte is zero).
  expect(
    lower(
      huaweiPakeHashToCurve(
        huaweiUnhex("2810ef4ae2add576ad9f835237431d1211f993d6dcba48b0c017779ab2cc67c2"),
      ),
    ),
  ).toBe("000c4bcd28b3e726dbdeb11a0c1bcadf4430a2c4540def36f3dace0e57b89539");
});

test("X25519 matches RFC 7748 §5.2 vector 1", () => {
  expect(
    lower(
      huaweiPakeX25519(
        huaweiUnhex("a546e36bf0527c9d3b16154b82465edd62144c0ac1fc5a18506a2244ba449ac4"),
        huaweiUnhex("e6db6867583030db3594c1a424b15f7c726624ec26b3353b10a903a6d0ab1c4c"),
      ),
    ),
  ).toBe("c3da55379de9c6908e94ea4df28d084f32eccf03491c71f754b4075577a28552");
});

test("the bind PIN is the uppercase hex of the first 6 shared bytes", () => {
  expect(
    huaweiPakeBindPin(
      huaweiUnhex("abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"),
    ),
  ).toBe("ABCDEF012345");
});

test("Ed25519 matches upstream's vector (signs the message as given, verifies, rejects a tamper)", () => {
  const { ed25519 } =
    require("@noble/curves/ed25519.js") as typeof import("@noble/curves/ed25519.js");
  const seed = seq(0, 32);
  const message = huaweiUnhex("deadbeef".repeat(8));
  expect(lower(huaweiPakeIdentityPublicKey(seed))).toBe(
    "03a107bff3ce10be1d70dd18e74bc09967e4d6309ba50d5f1ddc8664125531b8",
  );
  const signature = ed25519.sign(message, seed);
  expect(lower(signature)).toBe(
    "3771fe931eacab89e3f74565a75c44ee25722c0c0f5359b01c48f35d419c6940" +
      "f4966019fad4f4db18ca85e6724062735722465dea3450d758a916c8f1c2130f",
  );
  // Our verify pre-hashes with SHA-256, as the watch does; check both shapes.
  const prehashed = ed25519.sign(crypto.sha256(message), seed);
  expect(huaweiPakeVerify(crypto, message, prehashed, huaweiPakeIdentityPublicKey(seed))).toBe(
    true,
  );
  prehashed[0]! ^= 1;
  expect(huaweiPakeVerify(crypto, message, prehashed, huaweiPakeIdentityPublicKey(seed))).toBe(
    false,
  );
});

test("the Ed25519-to-X25519 maps agree and both sides derive one STS PSK", () => {
  const seedA = seq(0, 32);
  const seedB = huaweiUnhex("a1b2c3d4e5f60718293a4b5c6d7e8f900f1e2d3c4b5a69788796a5b4c3d2e1f0");
  for (const seed of [seedA, seedB])
    expect(
      lower(huaweiPakeX25519(huaweiPakeIdentityToX25519Secret(seed), huaweiPakeBasePoint())),
    ).toBe(lower(huaweiPakeIdentityToX25519Public(huaweiPakeIdentityPublicKey(seed))));
  const pskA = huaweiPakeStsPsk(seedA, huaweiPakeIdentityPublicKey(seedB));
  const pskB = huaweiPakeStsPsk(seedB, huaweiPakeIdentityPublicKey(seedA));
  expect(lower(pskA)).toBe(lower(pskB));
  expect(pskA.some((byte) => byte !== 0)).toBe(true);
  // And the independent script's value.
  expect(huaweiHexUpper(pskA)).toBe(KAT.stsPsk);
});

// ---------------------------------------------------------------------------
// Known answers (independent Node script)
// ---------------------------------------------------------------------------

const BIND_INPUTS = HONOR_PAKE_INPUTS;

test("the bind's DH, PIN, SPEKE keys and proofs match the independent script", () => {
  const input = BIND_INPUTS;
  const phoneDhPub = huaweiPakeX25519(input.phoneDh, huaweiPakeBasePoint());
  const watchDhPub = huaweiPakeX25519(input.watchDh, huaweiPakeBasePoint());
  expect(huaweiHexUpper(phoneDhPub)).toBe(KAT.phoneDhPub);
  expect(huaweiHexUpper(watchDhPub)).toBe(KAT.watchDhPub);
  const pin = huaweiPakeBindPin(huaweiPakeX25519(input.phoneDh, watchDhPub));
  expect(pin).toBe(KAT.pin);
  expect(huaweiHexUpper(huaweiPakePasswordKey(crypto, pin, input.salt))).toBe(KAT.passwordKey);
  const speke = huaweiPakeSpeke({
    crypto,
    pin,
    salt: input.salt,
    peerChallenge: input.watchChallenge,
    peerEpk: huaweiUnhex(KAT.watchEpk),
    selfChallenge: input.phoneChallenge,
    selfPrivate: input.phonePrivate,
  });
  expect(
    huaweiHexUpper(huaweiPakeHashToCurve(huaweiPakePasswordKey(crypto, pin, input.salt))),
  ).toBe(KAT.base);
  expect(huaweiHexUpper(speke.selfEpk)).toBe(KAT.selfEpk);
  expect(huaweiHexUpper(speke.sessionKey)).toBe(KAT.sessionKey);
  expect(huaweiHexUpper(speke.kcfKey)).toBe(KAT.kcfKey);
  expect(huaweiHexUpper(speke.proof)).toBe(KAT.proof);
  expect(huaweiHexUpper(speke.peerProof)).toBe(KAT.peerProof);
});

test("the sealed exchange round-trips and the watch's identity verifies", () => {
  const input = BIND_INPUTS;
  const aes = nodeHuaweiAes();
  const sessionKey = huaweiUnhex(KAT.sessionKey);
  // Our sealed reply opens to info ‖ signature under the request AAD.
  const ours = huaweiPakeOpen(
    aes,
    sessionKey,
    HUAWEI_PAKE_EXCHANGE_REQUEST_AAD,
    huaweiUnhex(KAT.exAuthInfo),
  );
  expect(
    huaweiHexUpper(
      huaweiPakeSeal(aes, sessionKey, input.phoneIv, HUAWEI_PAKE_EXCHANGE_REQUEST_AAD, ours),
    ),
  ).toBe(KAT.exAuthInfo);
  const watch = parseHuaweiPakePeerIdentity(
    huaweiPakeOpen(
      aes,
      sessionKey,
      new TextEncoder().encode("hichain_exchange_response"),
      huaweiUnhex(KAT.watchExAuthInfo),
    ),
  );
  expect(new TextDecoder().decode(watch.authId)).toBe("HONOR-WATCH-0001");
  expect(huaweiHexUpper(watch.authPk)).toBe(KAT.watchEdPub);
  const signed = new Uint8Array([...input.watchChallenge, ...input.phoneChallenge, ...watch.info]);
  expect(huaweiPakeVerify(crypto, signed, watch.signature, watch.authPk)).toBe(true);
  // The wrong AAD fails the tag.
  expect(() =>
    huaweiPakeOpen(
      aes,
      sessionKey,
      HUAWEI_PAKE_EXCHANGE_REQUEST_AAD,
      huaweiUnhex(KAT.watchExAuthInfo),
    ),
  ).toThrow("HUAWEI_PAKE_FAILED");
});

test("the STS PIN is lowercase hex of the HKDF, and its SPEKE matches the script", () => {
  const input = BIND_INPUTS;
  const psk = huaweiUnhex(KAT.stsPsk);
  const pin = huaweiPakeStsPin(crypto, psk, input.stsNonce);
  expect(pin).toBe(KAT.stsPin);
  expect(pin).toMatch(/^[0-9a-f]{64}$/);
  const speke = huaweiPakeSpeke({
    crypto,
    pin,
    salt: input.stsSalt,
    peerChallenge: input.stsWatchChallenge,
    peerEpk: huaweiUnhex(KAT.stsWatchEpk),
    selfChallenge: input.stsPhoneChallenge,
    selfPrivate: input.stsPhonePrivate,
  });
  expect(huaweiHexUpper(speke.selfEpk)).toBe(KAT.stsSelfEpk);
  expect(huaweiHexUpper(speke.proof)).toBe(KAT.stsProof);
  expect(huaweiHexUpper(speke.peerProof)).toBe(KAT.stsPeerProof);
});

// ---------------------------------------------------------------------------
// Codec
// ---------------------------------------------------------------------------

test("the PAKE-form SecurityNegotiation is authMode, pairType, authId (no UUID or flags)", () => {
  expect(
    huaweiHexUpper(
      buildHuaweiPakeSecurityNegotiationRequest({
        authMode: 2,
        pairType: 1,
        authId: BIND_INPUTS.authId,
      }),
    ),
  ).toBe("010102" + "020101" + "0320" + huaweiHexUpper(BIND_INPUTS.authId));
});

test("the JSON messages keep upstream's key order and version", () => {
  expect(
    buildHuaweiPakeJson({
      messageId: 1,
      fields: [
        ["support256mod", true],
        ["serviceType", "WEAR_MBB"],
      ],
      first: { operationCode: 1 },
    }),
  ).toBe(
    '{"message":1,"payload":{"support256mod":true,"serviceType":"WEAR_MBB","version":{"minVersion":"1.0.0","currentVersion":"2.0.15"},"operationCode":1}}',
  );
  expect(
    buildHuaweiPakeJson({
      messageId: 17,
      fields: [
        ["challenge", "AA"],
        ["epk", "BB"],
        ["serviceType", "WEAR_MBB"],
        ["peerAuthId", "CC"],
        ["keyLength", 32],
        ["keyInfoSize", 0],
      ],
      first: { operationCode: 2 },
      authForm: true,
    }),
  ).toBe(
    '{"authForm":0,"message":17,"payload":{"challenge":"AA","epk":"BB","serviceType":"WEAR_MBB","peerAuthId":"CC","keyLength":32,"keyInfoSize":0,"version":{"minVersion":"1.0.0","currentVersion":"2.0.15"},"operationCode":2}}',
  );
  expect(buildHuaweiPakeJson({ messageId: 18, fields: [["kcfData", "DD"]], authForm: true })).toBe(
    '{"authForm":0,"message":18,"payload":{"kcfData":"DD"}}',
  );
  expect(huaweiHexUpper(buildHuaweiPakeDhRequest(new Uint8Array(32).fill(7)))).toBe(
    "010101" + "0220" + "07".repeat(32),
  );
});

test("replies route by data type, STS message number, then payload keys", () => {
  const json = (value: unknown) =>
    decodeHuaweiTlv(
      encodeHuaweiTlv([
        { tag: 0x01, value: Uint8Array.of(0x02) },
        { tag: 0x02, value: new TextEncoder().encode(JSON.stringify(value)) },
      ]),
    );
  expect(
    parseHuaweiPakeResponse([
      { tag: 0x01, value: Uint8Array.of(0x01) },
      { tag: 0x02, value: Uint8Array.of(9) },
    ]),
  ).toMatchObject({ kind: "dh" });
  expect(
    parseHuaweiPakeResponse([
      { tag: 0x01, value: Uint8Array.of(0x03) },
      { tag: 0x02, value: new TextEncoder().encode("serial;mac;name") },
    ]).kind,
  ).toBe("identity");
  // 32785 carries challenge/salt/epk too: the message number wins.
  expect(
    parseHuaweiPakeResponse(
      json({ message: 32785, payload: { challenge: "01", salt: "02", epk: "03", nonce: "04" } }),
    ).kind,
  ).toBe("sts_start");
  expect(
    parseHuaweiPakeResponse(
      json({ message: 32769, payload: { challenge: "01", salt: "02", epk: "aa" } }),
    ),
  ).toMatchObject({ kind: "pake_response", epk: Uint8Array.of(0xaa) });
  expect(parseHuaweiPakeResponse(json({ message: 32770, payload: { kcfData: "01" } })).kind).toBe(
    "pake_confirm",
  );
  expect(parseHuaweiPakeResponse(json({ message: 32786, payload: { kcfData: "01" } })).kind).toBe(
    "sts_ack",
  );
  expect(
    parseHuaweiPakeResponse(json({ message: 32771, payload: { exAuthInfo: "01" } })).kind,
  ).toBe("exchange");
  expect(() =>
    parseHuaweiPakeResponse(json({ message: 32770, payload: { errorCode: 7 } })),
  ).toThrow("HUAWEI_PAKE_REJECTED");
  expect(() => parseHuaweiPakeResponse(json({ message: 1, payload: {} }))).toThrow(
    "HUAWEI_PAKE_PROTOCOL",
  );
  // org.json coerces numeric strings (`getInt`, `optInt`); a JSON `null` body is malformed.
  expect(() =>
    parseHuaweiPakeResponse(json({ message: 32770, payload: { errorCode: "7" } })),
  ).toThrow("HUAWEI_PAKE_REJECTED");
  expect(parseHuaweiPakeResponse(json({ message: "32786", payload: { kcfData: "01" } })).kind).toBe(
    "sts_ack",
  );
  expect(() => parseHuaweiPakeResponse(json(null))).toThrow("HUAWEI_PAKE_PROTOCOL");
  // Classic HiChain framing (tag 0x04) is not PAKE.
  expect(() => parseHuaweiPakeResponse([{ tag: 0x04, value: Uint8Array.of(0) }])).toThrow(
    "HUAWEI_PAKE_PROTOCOL",
  );
});
