import type { HelioLink } from "./types";
import type { HelioSessionChannel } from "./channel-types";
import type { OpenHelioChannelOptions } from "./channel-types";
export type { HelioSessionChannel } from "./channel-types";
import { decodeServiceList } from "./codec";
import { encodeChunkedMessage, ChunkReassembler, crc32 } from "./chunked";
import { loadHelioCrypto, type HelioCryptoProvider } from "../crypto/helio-session";
import { publicPointToWire, reverseHexBytes, sharedXToWire } from "../crypto/encoding";

const hexBytes = (s: string) => Uint8Array.from(s.match(/../g) ?? [], x => parseInt(x, 16));
const hex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
const join = (...parts: Uint8Array[]) => { const r = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let i = 0; for (const p of parts) { r.set(p, i); i += p.length; } return r; };
function wirePointToOpenSsl(wire: Uint8Array): string {
  if (wire.length !== 48) throw new Error("INVALID_REMOTE_POINT");
  const x = wire.slice(0, 21), y = wire.slice(24, 45);
  if (wire.slice(21, 24).some(Boolean) || wire.slice(45, 48).some(Boolean)) throw new Error("INVALID_REMOTE_POINT");
  return `04${reverseHexBytes(hex(x))}${reverseHexBytes(hex(y))}`;
}
function abort(signal: AbortSignal) { if (signal.aborted) throw new Error("CANCELLED"); }

export async function openHelioChannel(link: HelioLink, options: OpenHelioChannelOptions, injected?: HelioCryptoProvider): Promise<HelioSessionChannel> {
  const crypto = injected ?? await loadHelioCrypto(); abort(options.signal);
  if (options.authKey.length !== 16) throw new Error("INVALID_AUTH_KEY");
  const key = options.authKey.slice(), reassembler = new ChunkReassembler();
  const lifecycle = new AbortController();
  let sessionKey: Uint8Array | undefined, sequence = 0, handle = 1, closed = false;
  type Waiter = { endpoint: number; accept: (p: Uint8Array) => boolean; settle: (p?: Uint8Array, error?: Error) => void; signal: AbortSignal; cancel: () => void };
  let waiter: Waiter | undefined;
  const pendingWrites = new Set<Promise<void>>();
  const unsub = link.subscribe("chunk_read", bytes => {
    try {
      const result = reassembler.accept(bytes); if (!result) return;
      // Only the final inbound fragment requests the channel-level ACK.
      const w = waiter;
      if (result.last) {
        const ackAbort = new AbortController(), cancelAck = () => ackAbort.abort();
        options.signal.addEventListener("abort", cancelAck, { once: true });
        lifecycle.signal.addEventListener("abort", cancelAck, { once: true });
        const ack = link.write("chunk_read", Uint8Array.of(4, 0, result.handle, 1, result.count), ackAbort.signal);
        pendingWrites.add(ack); void ack.catch(() => { if (w && result.endpoint === w.endpoint) w.settle(undefined, new Error("CHANNEL_TRANSPORT_ERROR")); }).finally(() => { options.signal.removeEventListener("abort", cancelAck); lifecycle.signal.removeEventListener("abort", cancelAck); pendingWrites.delete(ack); });
      }
      if (!result.payload || !w || result.endpoint !== w.endpoint) return;
      let data = result.payload;
      if (result.encrypted) {
        if (!sessionKey || result.originalLength === undefined) throw new Error("CHANNEL_ENCRYPTION_UNAVAILABLE");
        const k = Uint8Array.from(sessionKey, b => b ^ result.handle), d = crypto.createDecipheriv("aes-128-ecb", k, null); d.setAutoPadding(false);
        const plain = join(d.update(data), d.final()); k.fill(0);
        if (plain.length < result.originalLength + 8) throw new Error("CHANNEL_LENGTH_ERROR");
        const expected = (plain[result.originalLength + 4]! | plain[result.originalLength + 5]! << 8 | plain[result.originalLength + 6]! << 16 | plain[result.originalLength + 7]! << 24) >>> 0;
        if (crc32(plain, result.originalLength + 4) !== expected) throw new Error("CHANNEL_CRC_ERROR");
        if (plain.slice(result.originalLength + 8).some(Boolean)) throw new Error("CHANNEL_PADDING_ERROR");
        data = plain.slice(0, result.originalLength); plain.fill(0);
      }
      if (w.accept(data)) w.settle(data);
    } catch (e) { waiter?.settle(undefined, e instanceof Error ? e : new Error("CHANNEL_FRAME_ERROR")); }
  }, () => waiter?.settle(undefined, new Error("CHANNEL_TRANSPORT_ERROR")));
  const request: HelioSessionChannel["request"] = (endpoint, payload, accept, signal) => new Promise((resolve, reject) => {
    if (closed || waiter) { reject(new Error("CHANNEL_BUSY")); return; }
    if (signal.aborted) { reject(new Error("CANCELLED")); return; }
    let timer: ReturnType<typeof setTimeout>;
    const localSignal = new AbortController();
    let current!: Waiter;
    const fail = () => { localSignal.abort(); current?.settle(undefined, new Error("CANCELLED")); };
    const cancel = () => { clearTimeout(timer); signal.removeEventListener("abort", fail); lifecycle.signal.removeEventListener("abort", fail); };
    current = { endpoint, accept, signal: localSignal.signal, cancel, settle: () => undefined };
    current.settle = (p, e) => {
      if (waiter !== current) return;
      waiter = undefined; cancel();
      if (e) localSignal.abort();
      if (e) reject(e); else if (p) resolve(p); else reject(new Error("CHANNEL_EMPTY_RESPONSE"));
    };
    waiter = current;
    signal.addEventListener("abort", fail, { once: true });
    lifecycle.signal.addEventListener("abort", fail, { once: true });
    timer = setTimeout(() => current.settle(undefined, new Error("CHANNEL_TIMEOUT")), options.requestTimeoutMs ?? 15000);
    const encrypted = !!sessionKey && services.get(endpoint) === true;
    try {
      const packets = encodeChunkedMessage({ payload, endpoint, mtu: link.maxWriteBytes + 3, handle, encrypted, sequence, sessionKey, crypto, extendedFlags: true });
      handle = (handle + 1) & 0xff;
      if (encrypted) sequence = (sequence + 1) >>> 0;
      const write = packets.reduce((p, packet) => p.then(() => link.write("chunk_write", packet, localSignal.signal)), Promise.resolve());
      pendingWrites.add(write); void write.catch(e => current.settle(undefined, e instanceof Error ? e : new Error("CHANNEL_WRITE_FAILED"))).finally(() => pendingWrites.delete(write));
    } catch (e) { current.settle(undefined, e instanceof Error ? e : new Error("CHANNEL_WRITE_FAILED")); }
  });
  const services = new Map<number, boolean>();
  const channel: HelioSessionChannel = { services, request, async close() { if (closed) return; closed = true; lifecycle.abort(); unsub(); reassembler.reset(); waiter?.settle(undefined, new Error("CANCELLED")); key.fill(0); sessionKey?.fill(0); await Promise.allSettled(pendingWrites); } };
  try {
    options.onPhase("authenticating");
    const ec = crypto.createECDH("sect163r2");
    const generated = ec.generateKeys();
    const pub = publicPointToWire(generated);
    const challenge = await request(0x0082, join(Uint8Array.of(4, 2, 0, 2), hexBytes(pub)), p => p[0] === 0x10 && p[1] === 4, options.signal);
    if (challenge.length !== 67) throw new Error("AUTH_CHALLENGE_LENGTH");
    if (challenge[2] !== 1) throw new Error("AUTH_FAILED");
    const random = challenge.slice(3, 19), peer = challenge.slice(19, 67);
    const shared = sharedXToWire(hex(ec.computeSecret(wirePointToOpenSsl(peer), "hex")));
    sequence = parseInt(reverseHexBytes(shared.slice(0, 8)), 16) >>> 0;
    sessionKey = Uint8Array.from(key, (b, i) => b ^ hexBytes(shared)[i + 8]!);
    const aes = crypto.createCipheriv("aes-128-ecb", key, null); aes.setAutoPadding(false); const first = join(aes.update(random), aes.final());
    const aes2 = crypto.createCipheriv("aes-128-ecb", sessionKey, null); aes2.setAutoPadding(false); const second = join(aes2.update(random), aes2.final());
    const status = await request(0x0082, join(Uint8Array.of(5), first, second), p => p[0] === 0x10 && p[1] === 5, options.signal);
    if (status.length !== 3) throw new Error("AUTH_STATUS_LENGTH");
    if (status[2] !== 1) throw new Error(status[2] === 0x25 ? "AUTH_FAILED" : "AUTH_NEGOTIATION_FAILED");
    options.onPhase("discovering_services");
    const list = await request(0, Uint8Array.of(3), p => p[0] === 4, options.signal);
    for (const [id, encrypted] of decodeServiceList(list)) services.set(id, encrypted);
    return channel;
  } catch (e) { await channel.close(); throw e; }
}
