import { createCipheriv, createDecipheriv } from "node:crypto";
import { expect, test } from "bun:test";
import fixture from "../__fixtures__/b163-reference.json";
import { reverseHexBytes } from "../crypto/encoding";
import { encodeChunkedMessage, ChunkReassembler, crc32 } from "./chunked";
import { openHelioChannel } from "./channel";
import type { HelioLink } from "./types";

const fromHex = (s: string) => Uint8Array.from(s.match(/../g) ?? [], (b) => parseInt(b, 16));
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const concat = (...a: Uint8Array[]) => Uint8Array.from(a.flatMap((x) => [...x]));
const pointFromWire = (w: Uint8Array) =>
  `04${reverseHexBytes(hex(w.slice(0, 21)))}${reverseHexBytes(hex(w.slice(24, 45)))}`;
const provider = {
  createECDH(curve: string) {
    expect(curve).toBe("sect163r2");
    return {
      setPrivateKey: () => {
        throw new Error("MANUAL_SCALAR_FORBIDDEN");
      },
      getPublicKey: () => pointFromWire(fromHex(fixture.vectors[0]!.publicPointLe)),
      computeSecret: (p: string) => {
        if (p !== pointFromWire(fromHex(fixture.vectors[1]!.publicPointLe)))
          throw new Error("INVALID_TEST_PEER_POINT");
        return fromHex(reverseHexBytes(fixture.vectors[0]!.sharedXLe.slice(0, 42)));
      },
      generateKeys: () => {
        generateCalls++;
        return pointFromWire(fromHex(fixture.vectors[0]!.publicPointLe));
      },
    };
  },
  createCipheriv: (a: string, k: Uint8Array, iv: Uint8Array | null) =>
    createCipheriv(a, k, iv as never),
  createDecipheriv: (a: string, k: Uint8Array, iv: Uint8Array | null) =>
    createDecipheriv(a, k, iv as never),
  randomBytes: () => {
    throw new Error("RANDOM_SCALAR_FORBIDDEN");
  },
};
let generateCalls = 0;

class Peer implements HelioLink {
  maxWriteBytes = 182;
  readonly writes: Uint8Array[] = [];
  readonly requests: { endpoint: number; payload: Uint8Array }[] = [];
  readonly encryptedSequences: number[] = [];
  private onData?: (bytes: Uint8Array) => void;
  private inboundHandle = 1;
  private session?: Uint8Array;
  constructor(
    private readonly wrongKey = false,
    private readonly mode?: "short_challenge" | "invalid_point" | "timeout" | "bad_crc",
  ) {}
  subscribe(
    _characteristic: "chunk_read" | "activity_data",
    onBytes: (bytes: Uint8Array) => void,
  ): () => void {
    this.onData = onBytes;
    return () => {
      this.onData = undefined;
    };
  }
  async write(characteristic: "chunk_write" | "chunk_read", bytes: Uint8Array): Promise<void> {
    if (characteristic !== "chunk_write" || bytes[0] !== 3) {
      this.writes.push(bytes.slice());
      return;
    }
    this.writes.push(bytes.slice());
    const packet = bytes,
      first = !!(packet[1]! & 1),
      ext = packet[2] === 0,
      head = first ? 11 : 5;
    const endpoint = first ? packet[9]! | (packet[10]! << 8) : -1;
    const chunked = new ChunkReassembler().accept(packet);
    if (!chunked?.payload) return;
    let command = chunked.payload;
    if (chunked.encrypted) {
      command = this.decrypt(command, chunked.originalLength!, chunked.handle);
      this.encryptedSequences.push(this.lastSequence);
    }
    this.requests.push({ endpoint, payload: command.slice() });
    let response: Uint8Array;
    if (endpoint === 0x82 && command[0] === 4) {
      const random = fromHex("00112233445566778899aabbccddeeff");
      const pub = fixture.vectors[1]!.publicPointLe;
      response = concat(Uint8Array.of(0x10, 4, 1), random, fromHex(pub));
      if (this.mode === "short_challenge") response = response.slice(0, 66);
      if (this.mode === "invalid_point") response[19 + 21] = 1;
    } else if (endpoint === 0x82 && command[0] === 5) {
      this.session = fromHex(fixture.vectors[0]!.sessionKey);
      response = Uint8Array.of(0x10, 5, this.wrongKey ? 0x25 : 1);
    } else if (endpoint === 0 && command[0] === 3) response = Uint8Array.of(4, 1, 0, 0x4b, 0, 1);
    else if (endpoint === 0x4b) {
      response = Uint8Array.of(0x10, 1);
    } else throw new Error(`UNEXPECTED_REQUEST_${endpoint}_${hex(command)}`);
    if (endpoint === 0x82 && command[0] === 4) {
      const wrong = encodeChunkedMessage({
        payload: response,
        endpoint: 0x83,
        mtu: 185,
        handle: this.inboundHandle++,
        encrypted: false,
        extendedFlags: true,
      });
      for (const item of wrong) this.onData?.(item);
    }
    const out = encodeChunkedMessage({
      payload: response,
      endpoint,
      mtu: 185,
      handle: this.inboundHandle++,
      encrypted: endpoint === 0x4b,
      sequence: 0x76543210,
      sessionKey: this.session,
      crypto: provider,
      extendedFlags: true,
    });
    if (this.mode === "bad_crc" && endpoint === 0x4b) out[0]![out[0]!.length - 1] ^= 1;
    if (this.mode !== "timeout") for (const item of out) this.onData?.(item);
    void head;
    void ext;
  }
  private lastSequence = 0;
  private decrypt(wire: Uint8Array, length: number, handle: number): Uint8Array {
    const key = Uint8Array.from(this.session!, (b) => b ^ handle),
      d = createDecipheriv("aes-128-ecb", key, null);
    d.setAutoPadding(false);
    const p = Buffer.concat([d.update(wire), d.final()]);
    this.lastSequence = p.readUInt32LE(length);
    expect(p.readUInt32LE(length + 4)).toBe(crc32(p.subarray(0, length + 4)));
    expect(p.subarray(length + 8).some(Boolean)).toBe(false);
    return Uint8Array.from(p.subarray(0, length));
  }
}

test("authenticates with native-shaped sect163r2 generateKeys and negotiates services", async () => {
  generateCalls = 0;
  const peer = new Peer();
  const controller = new AbortController();
  const channel = await openHelioChannel(
    peer,
    { authKey: fromHex(fixture.syntheticKey), signal: controller.signal, onPhase: () => {} },
    provider as never,
  );
  expect(generateCalls).toBe(1);
  expect(channel.services.get(0x4b)).toBe(true);
  expect(peer.requests.map((x) => [x.endpoint, x.payload[0]])).toEqual([
    [0x82, 4],
    [0x82, 5],
    [0, 3],
  ]);
  expect(hex(peer.requests[0]!.payload.slice(4))).toBe(fixture.vectors[0]!.publicPointLe);
  expect(peer.writes.some((x) => hex(x) === "0400010100")).toBe(true);
  const authFinish = peer.requests[1]!.payload;
  expect(authFinish).toHaveLength(33);
  const aesA = createCipheriv("aes-128-ecb", fromHex(fixture.syntheticKey), null);
  aesA.setAutoPadding(false);
  expect(hex(authFinish.slice(1, 17))).toBe(
    hex(concat(aesA.update(fromHex("00112233445566778899aabbccddeeff")), aesA.final())),
  );
  const aesB = createCipheriv("aes-128-ecb", fromHex(fixture.vectors[0]!.sessionKey), null);
  aesB.setAutoPadding(false);
  expect(hex(authFinish.slice(17))).toBe(
    hex(concat(aesB.update(fromHex("00112233445566778899aabbccddeeff")), aesB.final())),
  );
  await channel.request(0x4b, Uint8Array.of(7), (p) => p[0] === 0x10, controller.signal);
  await channel.request(0x4b, Uint8Array.of(8), (p) => p[0] === 0x10, controller.signal);
  expect(peer.encryptedSequences).toEqual([
    fixture.vectors[0]!.sequence,
    fixture.vectors[0]!.sequence + 1,
  ]);
  await channel.close();
});

test("rejects wrong-key status without querying services", async () => {
  const peer = new Peer(true);
  await expect(
    openHelioChannel(
      peer,
      {
        authKey: fromHex(fixture.syntheticKey),
        signal: new AbortController().signal,
        onPhase: () => {},
      },
      provider as never,
    ),
  ).rejects.toThrow("AUTH_FAILED");
  expect(peer.requests.map((x) => x.payload[0])).toEqual([4, 5]);
});

test("rejects short and invalid B163 challenges before service discovery", async () => {
  for (const [mode, error] of [
    ["short_challenge", "AUTH_CHALLENGE_LENGTH"],
    ["invalid_point", "INVALID_REMOTE_POINT"],
  ] as const) {
    const peer = new Peer(false, mode);
    await expect(
      openHelioChannel(
        peer,
        {
          authKey: fromHex(fixture.syntheticKey),
          signal: new AbortController().signal,
          onPhase: () => {},
        },
        provider as never,
      ),
    ).rejects.toThrow(error);
    expect(peer.requests.map((r) => r.payload[0])).toEqual([4]);
  }
});

test("bounded request timeout and caller abort settle auth without service discovery", async () => {
  const timeoutPeer = new Peer(false, "timeout");
  await expect(
    openHelioChannel(
      timeoutPeer,
      {
        authKey: fromHex(fixture.syntheticKey),
        signal: new AbortController().signal,
        onPhase: () => {},
        requestTimeoutMs: 5,
      },
      provider as never,
    ),
  ).rejects.toThrow("CHANNEL_TIMEOUT");
  expect(timeoutPeer.requests.map((r) => r.payload[0])).toEqual([4]);
  const abortPeer = new Peer(false, "timeout"),
    abort = new AbortController();
  const pending = openHelioChannel(
    abortPeer,
    { authKey: fromHex(fixture.syntheticKey), signal: abort.signal, onPhase: () => {} },
    provider as never,
  );
  abort.abort();
  await expect(pending).rejects.toThrow("CANCELLED");
  expect(abortPeer.requests.map((r) => r.payload[0])).toEqual([4]);
});

test("rejects corrupted encrypted channel CRC", async () => {
  const peer = new Peer(false, "bad_crc");
  const channel = await openHelioChannel(
    peer,
    {
      authKey: fromHex(fixture.syntheticKey),
      signal: new AbortController().signal,
      onPhase: () => {},
    },
    provider as never,
  );
  await expect(
    channel.request(0x4b, Uint8Array.of(7), (p) => p[0] === 0x10, new AbortController().signal),
  ).rejects.toThrow("CHANNEL_CRC_ERROR");
  await channel.close();
});
