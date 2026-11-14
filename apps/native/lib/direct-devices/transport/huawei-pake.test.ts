/**
 * Honor PAKE/STS drivers against a scripted watch whose replies, and the bytes
 * it expects from us, come from the independent known-answer script
 * (`protocol/huawei-pake.kat.json`). Randomness is injected in the order the
 * drivers draw it, so every message we send is checked byte for byte.
 *
 * AGPL-3.0-or-later (same as upstream Gadgetbridge).
 */

import { expect, test } from "bun:test";

import { nodeHuaweiAes, nodeHuaweiCrypto } from "../crypto/huawei-node-crypto.test-helpers";
import { decodeHuaweiTlv, encodeHuaweiTlv, type HuaweiTlv } from "../protocol/huawei";
import { huaweiHexUpper, huaweiUnhex } from "../protocol/huawei-hichain";
import KAT from "../protocol/huawei-pake.kat.json";
import { HONOR_PAKE_INPUTS as INPUT } from "../protocol/huawei-pake.test-helpers";
import { runHuaweiPakeBind, runHuaweiPakeReconnect, type HuaweiPakeContext } from "./huawei-pake";

type Sent = { dataType: number; data: Uint8Array; json?: Record<string, unknown> };

function sentOf(tlv: Uint8Array): Sent {
  const fields = decodeHuaweiTlv(tlv);
  const dataType = fields.find((field) => field.tag === 0x01)!.value[0]!;
  const data = fields.find((field) => field.tag === 0x02)!.value;
  return dataType === 0x02
    ? {
        dataType,
        data,
        json: JSON.parse(new TextDecoder().decode(data)) as Record<string, unknown>,
      }
    : { dataType, data };
}

const dh = (publicKey: Uint8Array): HuaweiTlv => [
  { tag: 0x01, value: Uint8Array.of(0x01) },
  { tag: 0x02, value: publicKey },
];
const reply = (message: number, payload: Record<string, unknown>): HuaweiTlv =>
  decodeHuaweiTlv(
    encodeHuaweiTlv([
      { tag: 0x01, value: Uint8Array.of(0x02) },
      { tag: 0x02, value: new TextEncoder().encode(JSON.stringify({ message, payload })) },
    ]),
  );
const identityFrame: HuaweiTlv = [
  { tag: 0x01, value: Uint8Array.of(0x03) },
  { tag: 0x02, value: new TextEncoder().encode("serial;mac;name") },
];

/** A context whose watch answers each request with the scripted frames (skipped ones first). */
function scripted(randoms: Uint8Array[], answer: (sent: Sent, index: number) => HuaweiTlv[]) {
  const sent: Sent[] = [];
  const skipped: number[] = [];
  const context: HuaweiPakeContext = {
    io: {
      async request(tlv, accept) {
        const message = sentOf(tlv);
        sent.push(message);
        for (const frame of answer(message, sent.length - 1)) {
          if (accept(frame)) return frame;
          skipped.push(sent.length - 1);
        }
        throw new Error("HUAWEI_REQUEST_TIMEOUT");
      },
    },
    crypto: nodeHuaweiCrypto(),
    aes: nodeHuaweiAes(),
    randomBytes: (size) => {
      const next = randoms.shift();
      if (!next || next.length !== size) throw new Error(`unexpected random draw of ${size}`);
      return next;
    },
    authId: INPUT.authId,
    seed: INPUT.phoneSeed,
  };
  return { context, sent, skipped, randoms };
}

const bindRandoms = () => [INPUT.phoneDh, INPUT.phoneChallenge, INPUT.phonePrivate, INPUT.phoneIv];

function bindWatch(overrides: { proof?: string; exAuthInfo?: string } = {}) {
  return (message: Sent, index: number): HuaweiTlv[] => {
    if (index === 0) {
      expect(message.dataType).toBe(0x01);
      expect(huaweiHexUpper(message.data)).toBe(KAT.phoneDhPub);
      // A device-identity frame first: not a reply, skipped.
      return [identityFrame, dh(huaweiUnhex(KAT.watchDhPub))];
    }
    const payload = message.json!.payload as Record<string, string>;
    if (index === 1)
      return [
        reply(32769, {
          challenge: huaweiHexUpper(INPUT.watchChallenge),
          salt: huaweiHexUpper(INPUT.salt),
          epk: KAT.watchEpk,
        }),
      ];
    if (index === 2) {
      expect(payload).toEqual({
        challenge: huaweiHexUpper(INPUT.phoneChallenge),
        epk: KAT.selfEpk,
        kcfData: KAT.proof,
      });
      return [reply(32770, { kcfData: overrides.proof ?? KAT.peerProof })];
    }
    expect(payload.exAuthInfo).toBe(KAT.exAuthInfo);
    return [reply(32771, { exAuthInfo: overrides.exAuthInfo ?? KAT.watchExAuthInfo })];
  };
}

test("the bind sends the known-answer bytes and returns the verified watch identity", async () => {
  const run = scripted(bindRandoms(), bindWatch());
  const peer = await runHuaweiPakeBind(run.context);
  expect(new TextDecoder().decode(peer.authId)).toBe("HONOR-WATCH-0001");
  expect(huaweiHexUpper(peer.authPk)).toBe(KAT.watchEdPub);
  expect(run.skipped).toEqual([0]);
  expect(run.randoms).toEqual([]);
  expect(run.sent.map((message) => message.json?.message ?? "dh")).toEqual(["dh", 1, 2, 3]);
  expect(run.sent[1]!.json).toEqual({
    message: 1,
    payload: {
      support256mod: true,
      serviceType: "WEAR_MBB",
      version: { minVersion: "1.0.0", currentVersion: "2.0.15" },
      operationCode: 1,
    },
  });
  // No authForm on bind messages.
  expect(run.sent.some((message) => message.json && "authForm" in message.json)).toBe(false);
});

test("a wrong watch proof or a forged identity fails the bind", async () => {
  await expect(
    runHuaweiPakeBind(scripted(bindRandoms(), bindWatch({ proof: "00".repeat(32) })).context),
  ).rejects.toThrow("HUAWEI_PAKE_FAILED");
  // The watch's own exAuthInfo replayed back: opens only under the request AAD.
  await expect(
    runHuaweiPakeBind(scripted(bindRandoms(), bindWatch({ exAuthInfo: KAT.exAuthInfo })).context),
  ).rejects.toThrow("HUAWEI_PAKE_FAILED");
});

const peer = () => ({ authId: INPUT.watchAuthId, authPk: huaweiUnhex(KAT.watchEdPub) });
const stsRandoms = () => [
  new Uint8Array(16).fill(1),
  new Uint8Array(32).fill(2),
  INPUT.stsPhoneChallenge,
  INPUT.stsPhonePrivate,
];

function stsWatch(overrides: { start?: HuaweiTlv; proof?: string } = {}) {
  return (message: Sent, index: number): HuaweiTlv[] => {
    const payload = message.json!.payload as Record<string, unknown>;
    if (index === 0) {
      expect(message.json!.authForm).toBe(0);
      expect(message.json!.message).toBe(17);
      expect(Object.keys(payload)).toEqual([
        "challenge",
        "epk",
        "serviceType",
        "peerAuthId",
        "keyLength",
        "keyInfoSize",
        "version",
        "operationCode",
      ]);
      expect(payload.peerAuthId).toBe(huaweiHexUpper(INPUT.authId));
      expect(payload.operationCode).toBe(2);
      return [
        overrides.start ??
          reply(32785, {
            challenge: huaweiHexUpper(INPUT.stsWatchChallenge),
            epk: KAT.stsWatchEpk,
            salt: huaweiHexUpper(INPUT.stsSalt),
            nonce: huaweiHexUpper(INPUT.stsNonce),
          }),
      ];
    }
    expect(message.json).toEqual({
      authForm: 0,
      message: 18,
      payload: {
        challenge: huaweiHexUpper(INPUT.stsPhoneChallenge),
        epk: KAT.stsSelfEpk,
        kcfData: KAT.stsProof,
      },
    });
    return [reply(32786, { kcfData: overrides.proof ?? KAT.stsPeerProof })];
  };
}

test("the STS reconnect proves both identities with the known-answer bytes", async () => {
  const run = scripted(stsRandoms(), stsWatch());
  await runHuaweiPakeReconnect(run.context, peer());
  expect(run.sent).toHaveLength(2);
  expect(run.randoms).toEqual([]);
});

test("a refused or mismatched STS reconnect asks for a re-bind", async () => {
  await expect(
    runHuaweiPakeReconnect(
      scripted(stsRandoms(), stsWatch({ start: reply(32785, { errorCode: 0x2001 }) })).context,
      peer(),
    ),
  ).rejects.toThrow("HUAWEI_PAKE_REBIND_REQUIRED");
  await expect(
    runHuaweiPakeReconnect(
      scripted(stsRandoms(), stsWatch({ proof: "00".repeat(32) })).context,
      peer(),
    ),
  ).rejects.toThrow("HUAWEI_PAKE_REBIND_REQUIRED");
  // A reply we cannot use (no nonce) also ends in a re-bind, not a stuck reconnect.
  await expect(
    runHuaweiPakeReconnect(
      scripted(
        stsRandoms(),
        stsWatch({ start: reply(32785, { challenge: "01", epk: KAT.stsWatchEpk, salt: "02" }) }),
      ).context,
      peer(),
    ),
  ).rejects.toThrow("HUAWEI_PAKE_REBIND_REQUIRED");
  // No answer at all keeps its own error: the watch may just be out of reach.
  await expect(
    runHuaweiPakeReconnect(scripted(stsRandoms(), () => []).context, peer()),
  ).rejects.toThrow("HUAWEI_REQUEST_TIMEOUT");
});
