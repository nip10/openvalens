/**
 * Inputs of the Honor PAKE/STS known-answer script (`huawei-pake.kat.json`),
 * shared by the codec and driver tests (never bundled: only tests import it).
 *
 * AGPL-3.0-or-later (same as upstream Gadgetbridge).
 */

import { huaweiUnhex } from "./huawei-hichain";

const seq = (start: number, length: number) =>
  Uint8Array.from({ length }, (_, index) => (start + index) & 0xff);

export const HONOR_PAKE_INPUTS = Object.freeze({
  androidId: "000102030405060708090A0B0C0D0E0F",
  authId: new TextEncoder().encode("000102030405060708090A0B0C0D0E0F"),
  phoneSeed: seq(0x00, 32),
  watchSeed: huaweiUnhex("a1b2c3d4e5f60718293a4b5c6d7e8f900f1e2d3c4b5a69788796a5b4c3d2e1f0"),
  phoneDh: seq(0x20, 32),
  watchDh: seq(0x40, 32),
  salt: seq(0x60, 16),
  watchChallenge: seq(0x70, 16),
  watchPrivate: seq(0x80, 32),
  phoneChallenge: seq(0xa0, 16),
  phonePrivate: seq(0xb0, 32),
  phoneIv: seq(0xd0, 12),
  watchIv: seq(0xe0, 12),
  watchAuthId: new TextEncoder().encode("HONOR-WATCH-0001"),
  stsNonce: seq(0x11, 32),
  stsSalt: seq(0x31, 16),
  stsWatchChallenge: seq(0x41, 16),
  stsWatchPrivate: seq(0x51, 32),
  stsPhoneChallenge: seq(0x71, 16),
  stsPhonePrivate: seq(0x81, 32),
});
