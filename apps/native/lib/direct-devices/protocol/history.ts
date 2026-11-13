import type { HelioSessionChannel } from "./channel-types";
import type {
  HelioCursor,
  HelioHistoryOptions,
  HelioHistoryResult,
  HelioLink,
  HelioProtocolLimits,
  HelioStepsPage,
  ZeppSleepPage,
} from "./types";
import { ZEPP_SLEEP_SESSION_TYPE, parseZeppSleepSessions } from "./zepp-sleep";
import {
  segmentZeppSleep,
  zeppFallbackStage,
  type ZeppFallbackMinute,
} from "./zepp-sleep-fallback";
import { crc32 } from "./chunked";
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
    // Sleep fallback: re-read from a night left open last time, so it is
    // segmented whole; only minutes from `cursor` on are published as steps.
    const fallback = options.sleepFallback;
    const fallbackMinutes = new Map<number, ZeppFallbackMinute>();
    let fetchFrom: HelioCursor = cursor;
    if (
      fallback?.pendingStart &&
      Date.parse(fallback.pendingStart) < Date.parse(cursor.nextMinuteUtc) &&
      Date.parse(cursor.nextMinuteUtc) - Date.parse(fallback.pendingStart) <= MAX_PENDING_MS
    )
      fetchFrom = { ...cursor, nextMinuteUtc: fallback.pendingStart };
    /**
     * Segments the classified minutes before the committed activity cursor
     * (minutes past it may belong to a transfer cut short, and would be read
     * again), with gaps filled by empty minutes as upstream's sample provider
     * does. Returns an error code instead of throwing.
     */
    const runFallback = async (): Promise<string | null> => {
      if (!fallback) return null;
      try {
        const limit = Date.parse(cursor.nextMinuteUtc) / 1000;
        const known = [...fallbackMinutes.values()]
          .filter((minute) => minute.time < limit)
          .sort((left, right) => left.time - right.time);
        const sorted: ZeppFallbackMinute[] = [];
        for (const minute of known) {
          const previous = sorted.at(-1);
          if (previous)
            for (let time = previous.time + 60; time < minute.time; time += 60)
              sorted.push({ time, steps: 0, sleep: null });
          sorted.push(minute);
        }
        let { sessions, openStart } = segmentZeppSleep(sorted);
        // A session open far too long (e.g. the watch off the wrist all day
        // flagged as sleep) is closed rather than re-read forever.
        const last = sorted.at(-1);
        if (openStart !== null && last && (last.time - openStart) * 1000 > MAX_PENDING_MS) {
          ({ sessions, openStart } = segmentZeppSleep([
            ...sorted,
            { time: last.time + 60, steps: 1, sleep: null },
          ]));
        }
        await fallback.onResult({
          sessions,
          openStart: openStart === null ? null : new Date(openStart * 1000).toISOString(),
        });
        return null;
      } catch (error) {
        if (signal.aborted) throw error;
        return error instanceof Error && /^[A-Z0-9_]{1,64}$/.test(error.message)
          ? error.message
          : "ZEPP_SLEEP_FETCH_FAILED";
      }
    };
    try {
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
          historyStart(fetchFrom),
          (p) => p[0] === 0x10 && p[1] === 1,
        );
        const meta = parseMeta(metaPayload);
        // Activity samples are 8 bytes each on every Zepp OS model.
        if (meta.length % 8 !== 0) throw new Error("UNSUPPORTED_ACTIVITY_FORMAT");
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
          const all = makeStepMinutes(raw, meta.first, undefined, now);
          if (fallback) {
            const first = Date.parse(meta.first) / 1000;
            for (let index = 0; index * 8 < raw.length; index += 1) {
              const time = first + index * 60;
              // The in-progress minute is never classified (nor published).
              if (time * 1000 >= now - (now % 60_000)) continue;
              fallbackMinutes.set(time, {
                time,
                steps: raw[index * 8 + 2]!,
                sleep: zeppFallbackStage(raw[index * 8]!, raw[index * 8 + 6]!, raw[index * 8 + 7]!),
              });
            }
          }
          const records = all.filter(
            (r) => Date.parse(r.startTime) >= Date.parse(cursor.nextMinuteUtc),
          );
          if (records.length === 0) {
            // A transfer that only re-read minutes before the activity cursor
            // (for the sleep fallback) moves the fetch on and continues.
            const transferEnd = Date.parse(meta.first) + (raw.length / 8) * 60_000;
            if (
              fallback &&
              raw.length > 0 &&
              transferEnd > Date.parse(fetchFrom.nextMinuteUtc) &&
              transferEnd <= Date.parse(cursor.nextMinuteUtc)
            ) {
              await control.keep();
              fetchFrom = { ...fetchFrom, nextMinuteUtc: new Date(transferEnd).toISOString() };
              continue;
            }
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
        fetchFrom = cursor;
        if (truncated) break;
        if (Date.parse(cursor.nextMinuteUtc) >= Math.floor(now / 60_000) * 60_000) {
          complete = true;
          break;
        }
      }
    } catch (error) {
      // Activity failed partway: still segment what was committed, so the
      // open-night marker keeps up with the advanced cursor.
      if (fallback && !signal.aborted) await runFallback().catch(() => undefined);
      throw error;
    }
    const fallbackError = fallback ? await runFallback() : null;
    // Sleep sessions run after activity in the same authenticated session.
    // Activity pages are already committed, so a sleep failure is reported
    // next to them rather than thrown (unless the session was cancelled).
    let sleep: HelioHistoryResult["sleep"];
    if (options.sleep) {
      try {
        sleep = await runSleepRounds(link, control, options.sleep, signal, limits, now);
      } catch (error) {
        if (signal.aborted) throw error;
        sleep = Object.freeze({
          pages: 0,
          sessions: 0,
          complete: false,
          errorCode:
            error instanceof Error && /^[A-Z0-9_]{1,64}$/.test(error.message)
              ? error.message
              : "ZEPP_SLEEP_FETCH_FAILED",
        });
      }
    }
    if (fallback)
      sleep = Object.freeze({
        pages: 0,
        sessions: 0,
        complete: fallbackError === null,
        errorCode: fallbackError,
      });
    return Object.freeze({ pages, minutes, complete, ...(sleep ? { sleep } : {}) });
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

/**
 * Fetch type 0x48 rounds (FetchSleepSessionOperation): same request /
 * metadata / data / completion exchange as activity. Unlike activity, upstream
 * enforces the completion CRC here. Only the keep ACK (03 09) is ever sent.
 */
async function runSleepRounds(
  link: HelioLink,
  control: ActivityControl,
  sleep: NonNullable<HelioHistoryOptions["sleep"]>,
  signal: AbortSignal,
  limits: HelioProtocolLimits,
  now: number,
): Promise<NonNullable<HelioHistoryResult["sleep"]>> {
  let cursor = sleep.since;
  let pages = 0;
  let sessions = 0;
  let complete = false;
  for (let round = 0; round < limits.maxPages; round += 1) {
    checkAbort(signal);
    let raw = new Uint8Array(0);
    let expectedCounter = 0;
    let failure: Error | undefined;
    const unsubscribe = link.subscribe(
      "activity_data",
      (incoming) => {
        if (failure) return;
        if (incoming.length < 2 || incoming[0] !== expectedCounter) {
          failure = new Error("HISTORY_BAD_COUNTER");
          return;
        }
        expectedCounter = (expectedCounter + 1) & 0xff;
        const part = incoming.subarray(1);
        if (raw.length + part.length > limits.maxMessageBytes) {
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
    try {
      const meta = parseMeta(
        await control.request(
          historyStart(cursor, ZEPP_SLEEP_SESSION_TYPE),
          (p) => p[0] === 0x10 && p[1] === 1,
        ),
      );
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
      let page: ZeppSleepPage | null = null;
      try {
        checkAbort(signal);
        if (failure) throw failure;
        if (raw.length !== meta.length) throw new Error("HISTORY_LENGTH_MISMATCH");
        if (
          (completion.length !== 3 && completion.length !== 7) ||
          completion[0] !== 0x10 ||
          completion[1] !== 2 ||
          completion[2] !== 1 ||
          (completion.length === 7 && readU32le(completion, 3) !== crc32(raw))
        )
          throw integrityError();
        const parsed = parseZeppSleepSessions(raw);
        if (parsed.lastReportTime === null) {
          await control.keep();
          complete = true;
          break;
        }
        // Upstream: since = last record time + 1 minute.
        const nextMinute = (Math.floor(parsed.lastReportTime / 60) + 1) * 60_000;
        // Upstream stops the rounds (needsAnotherFetch) rather than failing.
        if (nextMinute <= Date.parse(cursor.nextMinuteUtc)) {
          await control.keep();
          complete = true;
          break;
        }
        page = Object.freeze({
          sessions: parsed.sessions,
          nextCursor: Object.freeze({
            version: 1,
            nextMinuteUtc: new Date(nextMinute).toISOString(),
            offsetQuarterHours: meta.offset,
          }),
        });
        await sleep.onPage(page);
        checkAbort(signal);
      } catch (error) {
        if (!signal.aborted) await control.keep().catch(() => undefined);
        throw error;
      }
      await control.keep();
      cursor = page.nextCursor;
      pages += 1;
      sessions += page.sessions.length;
      if (Date.parse(cursor.nextMinuteUtc) >= Math.floor(now / 60_000) * 60_000) {
        complete = true;
        break;
      }
    } finally {
      unsubscribe();
    }
  }
  return Object.freeze({ pages, sessions, complete, errorCode: null });
}

type ActivityControl = {
  request(payload: Uint8Array, accept: (reply: Uint8Array) => boolean): Promise<Uint8Array>;
  /** `03 09`: acknowledge but keep the data on the watch. Never `03 01`. */
  keep(): Promise<void>;
};

const CONTROL_TIMEOUT_MS = 30_000;
/** A night left open is re-read for at most this long. */
const MAX_PENDING_MS = 16 * 60 * 60 * 1000;
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
