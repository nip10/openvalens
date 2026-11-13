/**
 * Known-answer tests from docs/research/notes/Bluetooth Classic RFCOMM/
 * huawei-hichain-auth.md §6. The §6.4 vectors were computed from upstream's
 * algorithm as read (upstream has no HiChain tests), not captured from a watch.
 */
import { expect, test } from "bun:test";
import { hkdfSync } from "node:crypto";

import { hkdfSha256 } from "../crypto/huawei-auth";
import { nodeHuaweiAes, nodeHuaweiCrypto } from "../crypto/huawei-node-crypto.test-helpers";
import { decodeHuaweiTlv, encodeHuaweiTlv } from "./huawei";
import {
  buildHuaweiHiChainJson,
  buildHuaweiHiChainRequest,
  buildHuaweiPincodeRequest,
  classifyHuaweiAuthType,
  decryptHuaweiPinCode,
  huaweiHexUpper,
  huaweiHiChainDecryptAuthToken,
  huaweiHiChainEncryptChallenge,
  huaweiHiChainEncryptResult,
  huaweiHiChainPacketKey,
  huaweiHiChainPeerToken,
  huaweiHiChainPinKey,
  huaweiHiChainPsk,
  huaweiHiChainReturnCodeMac,
  huaweiHiChainSelfToken,
  huaweiHiChainSessionKey,
  huaweiUnhex,
  parseHuaweiHiChainResponse,
} from "./huawei-hichain";

const crypto = nodeHuaweiCrypto();
const aes = nodeHuaweiAes();
const seq = (start: number, length: number) =>
  Uint8Array.from({ length }, (_, index) => (start + index) & 0xff);
const hex = huaweiHexUpper;

const ANDROID_ID = "000102030405060708090A0B0C0D0E0F";
const AUTH_ID_SELF = new TextEncoder().encode(ANDROID_ID);
const AUTH_ID_PEER = new TextEncoder().encode("WATCH-AUTH-ID-0001");
const PIN = huaweiUnhex("3132333435363738");

test("HKDF-SHA256 on the provider HMAC equals Node's hkdfSync", () => {
  for (const length of [1, 32, 33, 64, 100]) {
    const ikm = seq(1, 40);
    const salt = seq(90, 16);
    const info = new TextEncoder().encode("hichain_iso_session_key");
    expect(hex(hkdfSha256(crypto, ikm, salt, info, length))).toBe(
      hex(new Uint8Array(hkdfSync("sha256", ikm, salt, info, length))),
    );
  }
});

test("PIN request and decryption (§6.2)", () => {
  expect(Array.from(buildHuaweiPincodeRequest())).toEqual([0x01, 0x00]);
  const iv = seq(0xc0, 16);
  for (const [encryptMethod, cipher] of [
    [0, "A996CC6AF9999707D362FC68953C5A3C"],
    [1, "46ED99574DF7C876921E5FC1E7BFFE448D2CD6952ED9C126"],
  ] as const) {
    const tlv = [
      { tag: 0x01, value: huaweiUnhex(cipher) },
      { tag: 0x02, value: iv },
    ];
    expect(hex(decryptHuaweiPinCode({ tlv, authVersion: 2, encryptMethod, aes }))).toBe(hex(PIN));
  }
  expect(() =>
    decryptHuaweiPinCode({
      tlv: [{ tag: 0x01, value: seq(0, 16) }],
      authVersion: 2,
      encryptMethod: 0,
      aes,
    }),
  ).toThrow("HUAWEI_HICHAIN_PIN_FAILED");
});

test("op-1 step-1 JSON and TLV are byte-exact (§6.3)", () => {
  const json = buildHuaweiHiChainJson({
    operation: 1,
    messageId: 1,
    requestId: 1_700_000_000_000n,
    androidId: ANDROID_ID,
    fields: [
      ["isoSalt", hex(seq(0x40, 16))],
      ["peerAuthId", hex(AUTH_ID_SELF)],
      ["operationCode", 1],
      ["seed", hex(seq(0x20, 32))],
      ["peerUserType", 0],
    ],
  });
  expect(json).toBe(
    '{"authForm":0,"payload":{"version":{"minVersion":"1.0.0","currentVersion":"2.0.16"},"isoSalt":"404142434445464748494A4B4C4D4E4F","peerAuthId":"3030303130323033303430353036303730383039304130423043304430453046","operationCode":1,"seed":"202122232425262728292A2B2C2D2E2F303132333435363738393A3B3C3D3E3F","peerUserType":0},"groupAndModuleVersion":"2.0.1","message":1,"requestId":"1700000000000","groupId":"7B0BC0CBCE474F6C238D9661C63400B797B166EA7849B3A370FC73A9A236E989","groupName":"health_group_name","groupOp":2,"groupType":256,"peerDeviceId":"000102030405060708090A0B0C0D0E0F","connDeviceId":"000102030405060708090A0B0C0D0E0F","appId":"com.huawei.health","ownerName":""}',
  );
  expect(json.length).toBe(671);
  const tlv = buildHuaweiHiChainRequest({ operation: 1, requestId: 1_700_000_000_000n, json });
  expect(tlv.length).toBe(687);
  expect(hex(tlv.subarray(0, 3))).toBe("01851F");
  expect(hex(tlv.subarray(tlv.length - 13))).toBe("02010103080000018BCFE56800");
});

test("op 2 sets message |0x10, drops the group block and places isDeviceLevel last", () => {
  const value = JSON.parse(
    buildHuaweiHiChainJson({
      operation: 2,
      messageId: 1,
      requestId: 1n,
      androidId: ANDROID_ID,
      fields: [["operationCode", 2]],
      isDeviceLevel: false,
    }),
  ) as Record<string, unknown>;
  expect(value.message).toBe(0x11);
  expect(value.groupId).toBeUndefined();
  expect(Object.keys(value).at(-1)).toBe("isDeviceLevel");
});

test("the bind and authenticate chain reproduces every §6.4 value", () => {
  // op 1 (bind, keyed by the PIN)
  const pinKey = huaweiHiChainPinKey(crypto, PIN);
  expect(hex(pinKey)).toBe("C0DFA082246E2A2EC22F143D46901665533DDE9EEB8170ABD6BAD6705BD96E2C");
  const psk1 = huaweiHiChainPsk(crypto, pinKey, seq(0x20, 32));
  expect(hex(psk1)).toBe("F67940D7A4837F51EE59C71F1957335D0B5FC737907A88B75EC237F1E890CBA1");
  const ids1 = {
    randSelf: seq(0x40, 16),
    randPeer: seq(0x50, 16),
    authIdSelf: AUTH_ID_SELF,
    authIdPeer: AUTH_ID_PEER,
  };
  expect(hex(huaweiHiChainPeerToken(crypto, psk1, ids1))).toBe(
    "C4887D26C6C8C0E12BAE0ADA1116DFA5966D8F4601B83FE86C3547C6C80534EF",
  );
  expect(hex(huaweiHiChainSelfToken(crypto, psk1, ids1))).toBe(
    "950B7455989DD2E86696C94D4605DEA7585517AC180176127514FB44A114EBE7",
  );
  expect(hex(huaweiHiChainReturnCodeMac(crypto, psk1))).toBe(
    "C34687AC89913FB20B8011637D304FFA19780199812440C855A48AADBA2AE87C",
  );
  const session1 = huaweiHiChainSessionKey(crypto, psk1, ids1.randSelf, ids1.randPeer);
  expect(hex(session1)).toBe("050C282F63416BAC48F03CEB813DF1DBD82A2040D199EB1070DFEAD16E476719");
  const challenge = seq(0x70, 16);
  expect(hex(huaweiHiChainEncryptChallenge(aes, session1, seq(0x60, 12), challenge))).toBe(
    "5D1E1D875BEDD819A9B807C83C10C161EA5A20C3A63B8F315E93C61B73D9A4D5",
  );
  const authToken = huaweiHiChainDecryptAuthToken(
    aes,
    session1,
    seq(0x80, 12),
    huaweiUnhex(
      "0F7F22173BBBC03619F020057CEE67E489268F6151D62E7B59E13E4E22BFF301BD2250764486BB6FF40F517A1657AE09",
    ),
    challenge,
  );
  expect(hex(authToken)).toBe(hex(seq(0x90, 32)));
  expect(hex(huaweiHiChainEncryptResult(aes, session1, seq(0xb0, 12)))).toBe(
    "DAE1227AA5E384F8A69FC22366B21418AECB58C8",
  );

  // op 2 (authenticate, keyed by the stored token)
  const psk2 = huaweiHiChainPsk(crypto, authToken, seq(0x21, 32));
  expect(hex(psk2)).toBe("17B39D65D90AC6AD5A5439E45407F2560A587AD4AFFE64198ACE979F8F830EA0");
  const ids2 = { ...ids1, randSelf: seq(0x41, 16), randPeer: seq(0x51, 16) };
  expect(hex(huaweiHiChainPeerToken(crypto, psk2, ids2))).toBe(
    "36E3A594881955B73B2A72293BE8D4400BB5020A684A9DF29F7D6ABB0859B5EB",
  );
  expect(hex(huaweiHiChainSelfToken(crypto, psk2, ids2))).toBe(
    "8BA82765EA4B026006294B69DA28E1E9B71124A5171D8095E599D6C3B2F76DDB",
  );
  expect(hex(huaweiHiChainReturnCodeMac(crypto, psk2))).toBe(
    "F11345832D23482BAE7B4FDDD276AB84F4F97C341B346AECC0DDF0BF32E99391",
  );
  const session2 = huaweiHiChainSessionKey(crypto, psk2, ids2.randSelf, ids2.randPeer);
  expect(hex(session2)).toBe("3A224DA789B0070EB60F848E30AF9335EA3DF1FF38D794E03CC8403D2CFCB0AA");
  expect(hex(huaweiHiChainEncryptResult(aes, session2, seq(0xb1, 12)))).toBe(
    "B34EC44DE586D6F39D1DA8CADD517516B1063BC8",
  );
  expect(hex(huaweiHiChainPacketKey(crypto, session2, ids2.randSelf, ids2.randPeer))).toBe(
    "4078F9B3CC3A4C1EFE5E2F35F1D3B1EF80C253C5B7F47F87D9FF93B55DFB3E7F",
  );
  // A tampered token fails as a mismatch, not a crash.
  expect(() =>
    huaweiHiChainDecryptAuthToken(aes, session1, seq(0x80, 12), seq(0, 48), challenge),
  ).toThrow("HUAWEI_HICHAIN_TOKEN_MISMATCH");
});

test("auth types classify as upstream's branches (§1.4)", () => {
  expect(classifyHuaweiAuthType(0x0186a0)).toBe("hichain");
  expect(classifyHuaweiAuthType(5)).toBe("hichain3");
  expect(classifyHuaweiAuthType(6)).toBe("hichain3");
  expect(classifyHuaweiAuthType(1)).toBe("hichain_lite");
  expect(classifyHuaweiAuthType(2)).toBe("hichain_lite");
  expect(classifyHuaweiAuthType(-1)).toBeNull();
  expect(classifyHuaweiAuthType(0)).toBeNull();
});

test("responses route by payload key; errors and unknown shapes are typed", () => {
  const json = (payload: Record<string, unknown>) =>
    decodeHuaweiTlv(
      encodeHuaweiTlv([
        { tag: 0x04, value: Uint8Array.of(0) },
        { tag: 0x01, value: new TextEncoder().encode(JSON.stringify({ message: 1, payload })) },
      ]),
    );
  expect(
    parseHuaweiHiChainResponse(
      json({ isoSalt: "5051", peerAuthId: "57", peerUserType: 0, token: "AA" }),
    ),
  ).toEqual({
    step: 1,
    randPeer: Uint8Array.of(0x50, 0x51),
    authIdPeer: Uint8Array.of(0x57),
    peerUserType: 0,
    token: Uint8Array.of(0xaa),
  });
  expect(parseHuaweiHiChainResponse(json({ returnCodeMac: "01" }))).toEqual({
    step: 2,
    returnCodeMac: Uint8Array.of(1),
  });
  expect(parseHuaweiHiChainResponse(json({ nonce: "02", encAuthToken: "03" }))).toMatchObject({
    step: 3,
  });
  expect(
    parseHuaweiHiChainResponse(
      decodeHuaweiTlv(encodeHuaweiTlv([{ tag: 0x04, value: Uint8Array.of(1) }])),
    ),
  ).toEqual({ step: 4 });
  expect(() => parseHuaweiHiChainResponse(json({ errorCode: 9 }))).toThrow(
    "HUAWEI_HICHAIN_REJECTED",
  );
  expect(() =>
    parseHuaweiHiChainResponse(json({ isoSalt: "50", peerAuthId: "57", token: "AA" })),
  ).toThrow("HUAWEI_HICHAIN_PROTOCOL");
  expect(() => parseHuaweiHiChainResponse(json({ something: 1 }))).toThrow(
    "HUAWEI_HICHAIN_PROTOCOL",
  );
  expect(() => parseHuaweiHiChainResponse([])).toThrow("HUAWEI_HICHAIN_PROTOCOL");
});
