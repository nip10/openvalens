import { expect, test } from "bun:test";

import {
  encodeZeppSppChannelAck,
  encodeZeppSppChannelData,
  encodeZeppSppFrame,
  encodeZeppSppPong,
  encodeZeppSppSessionStart,
  parseZeppSppChannelData,
  parseZeppSppChannels,
  parseZeppSppSessionAck,
  ZEPP_SPP_CMD,
  zeppSppCrc16,
  ZeppSppDeframer,
} from "./zepp-spp";

// Vectors come from a separate transliteration of upstream's
// CheckSums.getCRC16 and ZeppOsBtbrSupport.write (Gadgetbridge 8976702f).
const hex = (value: string) => Uint8Array.from(Buffer.from(value, "hex"));
const toHex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

const CHANNELS_RET = hex(
  "55025a510001020030303030303031362d303030302d333531322d323131382d30303039616631303037303000050030303030303031372d303030302d333531322d323131382d303030396166313030373030000600596eaa",
);
const SESSION_START_ACK = hex("55045b08007856341201020002fcbcaa");

test("getCRC16 is CRC-16/CCITT-FALSE with upstream's 0xFFFF seed", () => {
  expect(zeppSppCrc16(new TextEncoder().encode("123456789"))).toBe(0x29b1);
  expect(zeppSppCrc16(new Uint8Array(0))).toBe(0xffff);
});

test("frames match upstream's write(builder, cmd, payload) byte for byte", () => {
  expect(toHex(encodeZeppSppFrame(ZEPP_SPP_CMD.CHANNELS_GET, 0, new Uint8Array(0)))).toBe(
    "550100000074f2aa",
  );
  expect(
    toHex(encodeZeppSppFrame(ZEPP_SPP_CMD.SESSION_START, 1, encodeZeppSppSessionStart(0x12345678))),
  ).toBe("5503010400785634127197aa");
  expect(
    toHex(
      encodeZeppSppFrame(
        ZEPP_SPP_CMD.CHANNEL_DATA,
        2,
        encodeZeppSppChannelData(2, 5, Uint8Array.of(3, 0, 1)),
      ),
    ),
  ).toBe("55070207000205000003000100f8aa");
  expect(
    toHex(encodeZeppSppFrame(ZEPP_SPP_CMD.CHANNEL_ACK, 3, encodeZeppSppChannelAck(2, 0x41))),
  ).toBe("5508030400024101000305aa");
  expect(toHex(encodeZeppSppFrame(ZEPP_SPP_CMD.PONG, 4, encodeZeppSppPong(2)))).toBe(
    "550a040400020100007dbdaa",
  );
  expect(() => encodeZeppSppFrame(7, 0, new Uint8Array(0x10000))).toThrow(
    "ZEPP_SPP_FRAME_TOO_LARGE",
  );
});

test("the deframer reassembles frames split at every offset and packed together", () => {
  const stream = new Uint8Array(CHANNELS_RET.length + SESSION_START_ACK.length);
  stream.set(CHANNELS_RET);
  stream.set(SESSION_START_ACK, CHANNELS_RET.length);
  for (let split = 0; split <= stream.length; split += 1) {
    const deframer = new ZeppSppDeframer();
    const frames = [
      ...deframer.push(stream.subarray(0, split)),
      ...deframer.push(stream.subarray(split)),
    ];
    expect(frames.map((frame) => [frame.cmd, frame.seq])).toEqual([
      [ZEPP_SPP_CMD.CHANNELS_RET, 0x5a],
      [ZEPP_SPP_CMD.SESSION_START_ACK, 0x5b],
    ]);
  }
  // One byte at a time.
  const deframer = new ZeppSppDeframer();
  const frames = [...stream].flatMap((byte) => deframer.push(Uint8Array.of(byte)));
  expect(frames).toHaveLength(2);
});

test("resync follows upstream: skip one non-preamble byte, drop bad CRCs, retry the bad trailer byte", () => {
  const deframer = new ZeppSppDeframer();
  // Garbage before a frame is skipped a byte at a time.
  expect(deframer.push(Uint8Array.of(0x00, 0x13, ...SESSION_START_ACK))).toHaveLength(1);

  // A corrupted CRC drops the whole frame; the next frame still parses.
  const badCrc = SESSION_START_ACK.slice();
  badCrc[badCrc.length - 2] ^= 0xff;
  expect(deframer.push(Uint8Array.of(...badCrc, ...SESSION_START_ACK))).toHaveLength(1);

  // A wrong trailer rewinds to that byte; here it is the start of a real frame.
  const noTrailer = SESSION_START_ACK.slice(0, -1);
  expect(
    deframer.push(Uint8Array.of(...noTrailer, ...SESSION_START_ACK)).map((frame) => frame.cmd),
  ).toEqual([ZEPP_SPP_CMD.SESSION_START_ACK]);
});

test("fewer than eight pending bytes wait for more, even without a preamble", () => {
  const deframer = new ZeppSppDeframer();
  expect(deframer.push(Uint8Array.of(1, 2, 3, 4, 5, 6, 7))).toEqual([]);
  // The seven bytes are kept and then skipped once more arrive.
  expect(deframer.push(SESSION_START_ACK)).toHaveLength(1);
});

test("the receive buffer is capped at 64 KiB", () => {
  const deframer = new ZeppSppDeframer();
  // A header that still fits the buffer keeps everything pending...
  deframer.push(Uint8Array.of(0x55, 7, 0, 0xf0, 0xff, 0, 0, 0));
  expect(deframer.push(new Uint8Array(0xff00))).toEqual([]);
  // ...until the buffer would overflow.
  expect(() => deframer.push(new Uint8Array(0x200))).toThrow("ZEPP_SPP_BUFFER_OVERFLOW");
  // A length that can never fit is a false preamble: skipped, not waited on.
  expect(
    new ZeppSppDeframer().push(Uint8Array.of(0x55, 7, 0, 0xff, 0xff, ...SESSION_START_ACK)),
  ).toHaveLength(1);
  // A length of 0x8000 or more is read unsigned (upstream's signed read throws).
  const big = new Uint8Array(0x8000);
  const frame = encodeZeppSppFrame(ZEPP_SPP_CMD.CHANNEL_DATA, 9, big);
  expect(new ZeppSppDeframer().push(frame)[0]?.payload.length).toBe(0x8000);
});

test("CHANNELS_RET parses into the characteristic ↔ channel map", () => {
  const [frame] = new ZeppSppDeframer().push(CHANNELS_RET);
  const map = parseZeppSppChannels(frame!.payload);
  expect(map.version).toBe(1);
  expect([...map.byCharacteristic]).toEqual([
    ["00000016-0000-3512-2118-0009af100700", 5],
    ["00000017-0000-3512-2118-0009af100700", 6],
  ]);
  expect(map.byChannel.get(6)).toBe("00000017-0000-3512-2118-0009af100700");
  // Upstream refuses versions above 1.
  const v2 = frame!.payload.slice();
  v2[0] = 2;
  expect(() => parseZeppSppChannels(v2)).toThrow("ZEPP_SPP_UNSUPPORTED_VERSION");
  // A missing NUL terminator or a truncated channel number is malformed.
  expect(() => parseZeppSppChannels(Uint8Array.of(1, 1, 0, 0x30, 0x30))).toThrow(
    "ZEPP_SPP_CHANNELS_MALFORMED",
  );
  expect(() => parseZeppSppChannels(frame!.payload.slice(0, -1))).toThrow(
    "ZEPP_SPP_CHANNELS_MALFORMED",
  );
  // `getShort()` is signed: a negative count reads no entries.
  expect(parseZeppSppChannels(Uint8Array.of(1, 0xff, 0xff)).byChannel.size).toBe(0);
});

test("SESSION_START_ACK and CHANNEL_DATA read upstream's little-endian fields", () => {
  const [frame] = new ZeppSppDeframer().push(SESSION_START_ACK);
  expect(parseZeppSppSessionAck(frame!.payload)).toEqual({
    nonce: 0x12345678,
    status: 1,
    session: 2,
    mtu: 512,
  });
  expect(parseZeppSppSessionAck(Uint8Array.of(1, 2, 3))).toBeNull();
  expect(parseZeppSppChannelData(Uint8Array.of(2, 6, 0, 1, 0xaa, 0xbb))).toEqual({
    session: 2,
    channel: 6,
    mustAck: true,
    value: Uint8Array.of(0xaa, 0xbb),
  });
  expect(parseZeppSppChannelData(Uint8Array.of(2, 6, 0))).toBeNull();
});
