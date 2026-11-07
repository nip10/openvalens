import type { HelioSessionChannel } from "./channel-types";
import type { HelioCursor, HelioHistoryOptions, HelioHistoryResult, HelioLink, HelioProtocolLimits, HelioStepsPage } from "./types";
import { decodeDeviceDate, deviceDateToUtcMinute, historyStart, makeStepMinutes, readU32le } from "./codec";
import { crc32 } from "./chunked";

const DEFAULT_LIMITS: HelioProtocolLimits = Object.freeze({ maxMessageBytes: 1_048_576, maxPages: 32, maxMinutes: 20_000, maxDurationMs: 120_000 });
const abortError = () => new Error("HISTORY_ABORTED");
const integrityError = () => new Error("HISTORY_INTEGRITY_ERROR");
function checkAbort(signal: AbortSignal): void { if (signal.aborted) throw abortError(); }
function parseMeta(payload: Uint8Array): { length: number; first: string; offset: number } {
  if ((payload.length !== 15 && (payload.length !== 16 || payload[15] !== 0)) || payload[0] !== 0x10 || payload[1] !== 1 || payload[2] !== 1) throw new Error("HISTORY_METADATA_ERROR");
  const length = readU32le(payload, 3);
  if (length % 8 !== 0) throw new Error("UNSUPPORTED_ACTIVITY_FORMAT");
  const date = decodeDeviceDate(payload.slice(7, 15));
  return { length, first: deviceDateToUtcMinute(date), offset: date.offsetQuarterHours };
}

export async function runHelioStepsHistory(
  link: HelioLink,
  options: HelioHistoryOptions,
  deps: { openChannel?: (link: HelioLink, options: Pick<HelioHistoryOptions, "authKey" | "signal" | "onPhase">) => Promise<HelioSessionChannel>; now?: () => number; limits?: Partial<HelioProtocolLimits> } = {},
): Promise<HelioHistoryResult> {
  const limits = { ...DEFAULT_LIMITS, ...deps.limits }, now = (deps.now ?? Date.now)();
  if (!Number.isFinite(now) || !Number.isSafeInteger(limits.maxMessageBytes) || limits.maxMessageBytes < 8 || limits.maxPages < 1 || limits.maxMinutes < 1 || limits.maxDurationMs < 1) throw new Error("INVALID_HISTORY_LIMITS");
  const started = now, controller = new AbortController();
  const abort = () => controller.abort();
  options.signal.addEventListener("abort", abort, { once: true });
  if (options.signal.aborted) controller.abort();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, limits.maxDurationMs);
  const signal = controller.signal;
  checkAbort(signal);
  const open = deps.openChannel ?? (async (l, o) => (await import("./channel")).openHelioChannel(l, o));
  let channel: HelioSessionChannel | undefined, unsubscribe: (() => void) | undefined;
  try {
    channel = await open(link, { ...options, signal }); checkAbort(signal);
    if (!channel.services.has(0x004b)) throw new Error("HISTORY_UNSUPPORTED");
    options.onPhase("fetching");
    let cursor: HelioCursor = options.since, pages = 0, minutes = 0, complete = false;
    while (pages < limits.maxPages && minutes < limits.maxMinutes) {
      checkAbort(signal);
      if ((deps.now ?? Date.now)() - started > limits.maxDurationMs) throw new Error("HISTORY_TIMEOUT");
      let raw = new Uint8Array(0), expectedCounter = 0, packetBytes = 0, failure: Error | undefined;
      unsubscribe?.();
      unsubscribe = link.subscribe("activity_data", (incoming) => {
        if (failure) return;
        if (incoming.length < 2) { failure = new Error("HISTORY_TRUNCATED_PACKET"); return; }
        const counter = incoming[0]!;
        if (counter !== expectedCounter) { failure = new Error("HISTORY_BAD_COUNTER"); return; }
        expectedCounter = (expectedCounter + 1) & 0xff;
        const part = incoming.subarray(1);
        packetBytes += part.length;
        if (packetBytes > limits.maxMessageBytes) { failure = new Error("HISTORY_SIZE_LIMIT"); return; }
        const next = new Uint8Array(raw.length + part.length); next.set(raw); next.set(part, raw.length); raw = next;
      }, () => { failure = new Error("HISTORY_TRANSPORT_ERROR"); });
      const metaPayload = await channel.request(0x004b, historyStart(cursor), p => p[0] === 0x10 && p[1] === 1, signal);
      const meta = parseMeta(metaPayload);
      if (meta.length > limits.maxMessageBytes) throw new Error("HISTORY_SIZE_LIMIT");
      if (meta.length === 0) {
        const ack = await channel.request(0x004b, Uint8Array.of(3, 9), p => p[0] === 0x10 && p[1] === 3 && p[2] === 1, signal);
        if (ack.length !== 3 || ack[2] !== 1) throw new Error("HISTORY_ACK_ERROR");
        complete = true; break;
      }
      const completion = await channel.request(0x004b, Uint8Array.of(2), p => p[0] === 0x10 && p[1] === 2, signal);
      checkAbort(signal);
      if (failure) throw failure;
      if (raw.length !== meta.length || raw.length % 8 !== 0) throw new Error("HISTORY_LENGTH_MISMATCH");
      if (completion.length !== 3 && completion.length !== 7) throw integrityError();
      if (completion[0] !== 0x10 || completion[1] !== 2 || completion[2] !== 1) throw integrityError();
      if (completion.length === 7 && readU32le(completion, 3) !== crc32(raw)) throw integrityError();
      const records = makeStepMinutes(raw, meta.first, undefined, now).filter(r => Date.parse(r.startTime) >= Date.parse(cursor.nextMinuteUtc));
      if (records.length === 0) {
        const ack = await channel.request(0x004b, Uint8Array.of(3, 9), p => p[0] === 0x10 && p[1] === 3 && p[2] === 1, signal);
        if (ack.length !== 3 || ack[2] !== 1) throw new Error("HISTORY_ACK_ERROR");
        complete = Date.parse(meta.first) >= Math.floor(now / 60_000) * 60_000; break;
      }
      if (records.length + minutes > limits.maxMinutes) break;
      const last = records[records.length - 1]!;
      const nextCursor: HelioCursor = Object.freeze({ version: 1, nextMinuteUtc: last.endTime, offsetQuarterHours: meta.offset });
      if (Date.parse(nextCursor.nextMinuteUtc) <= Date.parse(cursor.nextMinuteUtc)) throw new Error("HISTORY_NONADVANCING_CURSOR");
      const page: HelioStepsPage = Object.freeze({ minutes: records, nextCursor });
      checkAbort(signal);
      await options.onPage(page);
      checkAbort(signal);
      // 0x09 retains detailed records. Never send the destructive 0x01 ACK.
      const ack = await channel.request(0x004b, Uint8Array.of(3, 9), p => p[0] === 0x10 && p[1] === 3 && p[2] === 1, signal);
      if (ack.length !== 3 || ack[2] !== 1) throw new Error("HISTORY_ACK_ERROR");
      cursor = nextCursor; pages += 1; minutes += records.length;
      if (Date.parse(cursor.nextMinuteUtc) >= Math.floor(now / 60_000) * 60_000) { complete = true; break; }
    }
    return Object.freeze({ pages, minutes, complete });
  } catch (error) {
    if (timedOut) throw new Error("HISTORY_TIMEOUT");
    throw error;
  } finally {
    clearTimeout(timer); options.signal.removeEventListener("abort", abort);
    unsubscribe?.();
    if (channel) await channel.close();
  }
}
