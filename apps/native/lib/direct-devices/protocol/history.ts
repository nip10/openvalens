import type { HelioSessionChannel } from "./channel-types";
import type {
  HelioCursor,
  HelioHistoryOptions,
  HelioHistoryResult,
  HelioLink,
  HelioProtocolLimits,
  HelioStepsPage,
} from "./types";
import {
  decodeDeviceDate,
  deviceDateToUtcMinute,
  historyStart,
  makeStepMinutes,
  readU32le,
} from "./codec";

const DEFAULT_LIMITS: HelioProtocolLimits = Object.freeze({
  maxMessageBytes: 1_048_576,
  maxPages: 32,
  maxMinutes: 20_000,
  maxDurationMs: 120_000,
});
const abortError = () => new Error("HISTORY_ABORTED");
const integrityError = () => new Error("HISTORY_INTEGRITY_ERROR");
function checkAbort(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}
function parseMeta(payload: Uint8Array): { length: number; first: string; offset: number } {
  // Upstream's check is lax (FetchActivityOperation:190-195): trailing bytes
  // (e.g. the Mi Band 7's extra 00) are ignored.
  if (payload.length < 15 || payload[0] !== 0x10 || payload[1] !== 1 || payload[2] !== 1)
    throw new Error("HISTORY_METADATA_ERROR");
  const length = readU32le(payload, 3);
  if (length % 8 !== 0) throw new Error("UNSUPPORTED_ACTIVITY_FORMAT");
  const date = decodeDeviceDate(payload.slice(7, 15));
  return { length, first: deviceDateToUtcMinute(date), offset: date.offsetQuarterHours };
}

export async function runHelioStepsHistory(
  link: HelioLink,
  options: HelioHistoryOptions,
  deps: {
    openChannel?: (
      link: HelioLink,
      options: Pick<HelioHistoryOptions, "authKey" | "signal" | "onPhase">,
    ) => Promise<HelioSessionChannel>;
    now?: () => number;
    limits?: Partial<HelioProtocolLimits>;
  } = {},
): Promise<HelioHistoryResult> {
  const limits = { ...DEFAULT_LIMITS, ...deps.limits },
    now = (deps.now ?? Date.now)();
  if (
    !Number.isFinite(now) ||
    !Number.isSafeInteger(limits.maxMessageBytes) ||
    limits.maxMessageBytes < 8 ||
    limits.maxPages < 1 ||
    limits.maxMinutes < 1 ||
    limits.maxDurationMs < 1
  )
    throw new Error("INVALID_HISTORY_LIMITS");
  const started = now,
    controller = new AbortController();
  const abort = () => controller.abort();
  options.signal.addEventListener("abort", abort, { once: true });
  if (options.signal.aborted) controller.abort();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, limits.maxDurationMs);
  const signal = controller.signal;
  checkAbort(signal);
  const open =
    deps.openChannel ?? (async (l, o) => (await import("./channel")).openHelioChannel(l, o));
  let channel: HelioSessionChannel | undefined, unsubscribe: (() => void) | undefined;
  try {
    channel = await open(link, { ...options, signal });
    checkAbort(signal);
    // Activity control goes over encrypted endpoint 0x004b when the watch
    // lists it, otherwise in plain text over characteristic 0004 (upstream
    // ZeppOsSupport.writeActivityControl). Replies are matched the same way.
    const control = createActivityControl(link, channel, signal);
    options.onPhase("fetching");
    let cursor: HelioCursor = options.since,
      pages = 0,
      minutes = 0,
      complete = false;
    while (pages < limits.maxPages && minutes < limits.maxMinutes) {
      checkAbort(signal);
      if ((deps.now ?? Date.now)() - started > limits.maxDurationMs)
        throw new Error("HISTORY_TIMEOUT");
      let raw = new Uint8Array(0),
        expectedCounter = 0,
        packetBytes = 0,
        failure: Error | undefined;
      unsubscribe?.();
      unsubscribe = link.subscribe(
        "activity_data",
        (incoming) => {
          if (failure) return;
          if (incoming.length < 2) {
            failure = new Error("HISTORY_TRUNCATED_PACKET");
            return;
          }
          const counter = incoming[0]!;
          if (counter !== expectedCounter) {
            failure = new Error("HISTORY_BAD_COUNTER");
            return;
          }
          expectedCounter = (expectedCounter + 1) & 0xff;
          const part = incoming.subarray(1);
          packetBytes += part.length;
          if (packetBytes > limits.maxMessageBytes) {
            failure = new Error("HISTORY_SIZE_LIMIT");
            return;
          }
          const next = new Uint8Array(raw.length + part.length);
          next.set(raw);
          next.set(part, raw.length);
          raw = next;
        },
        () => {
          failure = new Error("HISTORY_TRANSPORT_ERROR");
        },
      );
      const metaPayload = await control.request(
        historyStart(cursor),
        (p) => p[0] === 0x10 && p[1] === 1,
      );
      const meta = parseMeta(metaPayload);
      if (meta.length > limits.maxMessageBytes) throw new Error("HISTORY_SIZE_LIMIT");
      if (meta.length === 0) {
        await control.keep();
        complete = true;
        break;
      }
      const completion = await control.request(
        Uint8Array.of(2),
        (p) => p[0] === 0x10 && p[1] === 2,
      );
      // Every failure after the data arrived still tells the watch to keep
      // it (upstream does so on a bad counter or failed processing), unless
      // the session itself was cancelled.
      let truncated = false;
      try {
        checkAbort(signal);
        if (failure) throw failure;
        if (raw.length !== meta.length || raw.length % 8 !== 0)
          throw new Error("HISTORY_LENGTH_MISMATCH");
        if (
          (completion.length !== 3 && completion.length !== 7) ||
          completion[0] !== 0x10 ||
          completion[1] !== 2 ||
          completion[2] !== 1
        )
          throw integrityError();
        // Upstream deliberately skips the activity checksum
        // (FetchActivityOperation:135-140); enforcing it would stall a watch
        // whose CRC differs forever. Counter, length and sample-size checks stay.
        const records = makeStepMinutes(raw, meta.first, undefined, now).filter(
          (r) => Date.parse(r.startTime) >= Date.parse(cursor.nextMinuteUtc),
        );
        if (records.length === 0) {
          await control.keep();
          complete = Date.parse(meta.first) >= Math.floor(now / 60_000) * 60_000;
          break;
        }
        // One watch transfer can be days long. Commit it in bounded pages so
        // a single capture never exceeds the outbox byte limit, and stop at
        // the minute and page budgets after committing what fits (the next
        // sync resumes from the advanced cursor instead of retrying forever).
        const budget = Math.min(records.length, limits.maxMinutes - minutes);
        for (let offset = 0; offset < budget; offset += PAGE_MINUTES) {
          if (pages >= limits.maxPages) {
            truncated = true;
            break;
          }
          const chunk = records.slice(offset, Math.min(offset + PAGE_MINUTES, budget));
          const last = chunk[chunk.length - 1]!;
          const nextCursor: HelioCursor = Object.freeze({
            version: 1,
            nextMinuteUtc: last.endTime,
            offsetQuarterHours: meta.offset,
          });
          if (Date.parse(nextCursor.nextMinuteUtc) <= Date.parse(cursor.nextMinuteUtc))
            throw new Error("HISTORY_NONADVANCING_CURSOR");
          const page: HelioStepsPage = Object.freeze({ minutes: chunk, nextCursor });
          checkAbort(signal);
          await options.onPage(page);
          checkAbort(signal);
          cursor = nextCursor;
          pages += 1;
          minutes += chunk.length;
        }
        if (budget < records.length) truncated = true;
      } catch (error) {
        if (!signal.aborted) await control.keep().catch(() => undefined);
        throw error;
      }
      await control.keep();
      if (truncated) break;
      if (Date.parse(cursor.nextMinuteUtc) >= Math.floor(now / 60_000) * 60_000) {
        complete = true;
        break;
      }
    }
    return Object.freeze({ pages, minutes, complete });
  } catch (error) {
    if (timedOut) throw new Error("HISTORY_TIMEOUT");
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal.removeEventListener("abort", abort);
    unsubscribe?.();
    if (channel) await channel.close();
  }
}

type ActivityControl = {
  request(payload: Uint8Array, accept: (reply: Uint8Array) => boolean): Promise<Uint8Array>;
  /** `03 09`: acknowledge but keep the data on the watch. Never `03 01`. */
  keep(): Promise<void>;
};

const CONTROL_TIMEOUT_MS = 30_000;
/** Minutes per committed page: steps + heart rate stay well under 4 MB. */
export const PAGE_MINUTES = 4_000;

function createActivityControl(
  link: HelioLink,
  channel: HelioSessionChannel,
  signal: AbortSignal,
): ActivityControl {
  const viaEndpoint = channel.services.has(0x004b);
  const request = viaEndpoint
    ? (payload: Uint8Array, accept: (reply: Uint8Array) => boolean) =>
        channel.request(0x004b, payload, accept, signal)
    : (payload: Uint8Array, accept: (reply: Uint8Array) => boolean) =>
        new Promise<Uint8Array>((resolve, reject) => {
          // Register before writing so a fast reply cannot be missed.
          let settled = false;
          let unsubscribe: () => void = () => undefined;
          const finish = (error: Error | null, reply?: Uint8Array) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            signal.removeEventListener("abort", onAbort);
            unsubscribe();
            if (error) reject(error);
            else resolve(reply!);
          };
          const onAbort = () => finish(abortError());
          const timer = setTimeout(
            () => finish(new Error("HISTORY_CONTROL_TIMEOUT")),
            CONTROL_TIMEOUT_MS,
          );
          try {
            unsubscribe = link.subscribe(
              "activity_control",
              (reply) => {
                if (accept(reply)) finish(null, reply);
              },
              () => finish(new Error("HISTORY_TRANSPORT_ERROR")),
            );
          } catch {
            finish(new Error("HISTORY_TRANSPORT_ERROR"));
            return;
          }
          // A failure reported synchronously during subscribe already settled.
          if (settled) {
            unsubscribe();
            return;
          }
          signal.addEventListener("abort", onAbort, { once: true });
          if (signal.aborted) {
            finish(abortError());
            return;
          }
          link
            .write("activity_control", payload, signal)
            .catch(() => finish(new Error("HISTORY_TRANSPORT_ERROR")));
        });
  return {
    request,
    async keep() {
      // 0x09 retains detailed records on the watch (and for the Zepp app).
      // Any `10 03 …` reply finishes the round, as upstream accepts.
      await request(Uint8Array.of(3, 9), (p) => p[0] === 0x10 && p[1] === 3);
    },
  };
}
