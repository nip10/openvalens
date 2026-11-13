/**
 * Zepp OS sleep sessions: fetch type 0x48, 594-byte records (issue #419).
 *
 * Ported from Gadgetbridge 8976702fc3d00e6008c91fe994668cb4027f7bc2
 * (FetchSleepSessionOperation, HuamiSleepSessionSampleProvider.SleepSession,
 * HuamiSleepSessionProvider); see
 * docs/research/notes/Zepp OS activity history/zepp-os-activity-history.md §5.1.
 *
 * Stage minutes are offsets from `midnight − 24 h` (upstream's formula in
 * HuamiSleepSessionProvider; its own comment only guesses "since noon"): a
 * stage spans `base + start·60` to `base + (end + 1)·60`, because the watch
 * includes both endpoint minutes in each stage.
 *
 * A night can be re-reported with shifted bounds. Upstream replaces any earlier
 * session that overlaps it, and so does this parser within one transfer; a
 * nap and the night of the same day stay separate. Across syncs the caller
 * reuses the record id of an overlapping, already-published session (see
 * `assignZeppSleepIds` in sync/controller.ts).
 *
 * AGPL-3.0-or-later (same as upstream Gadgetbridge).
 */

/** The fetch-data type for sleep sessions (HuamiFetchDataType.SLEEP_SESSION). */
export const ZEPP_SLEEP_SESSION_TYPE = 0x48;
export const ZEPP_SLEEP_RECORD_BYTES = 594;

/** The direct-device contract's stage vocabulary. */
export type ZeppSleepStageName = "light" | "deep" | "rem" | "awake";

export type ZeppSleepSession = Readonly<{
  /** The record's report time (Unix seconds); may be the following day. */
  reportTime: number;
  /** Midnight boundary of the night's day in the user's zone (Unix seconds). */
  midnight: number;
  startTime: string;
  endTime: string;
  stages: readonly Readonly<{ stage: ZeppSleepStageName; startTime: string; endTime: string }>[];
}>;

const u16 = (bytes: Uint8Array, offset: number) => bytes[offset]! | (bytes[offset + 1]! << 8);
const u32 = (bytes: Uint8Array, offset: number) =>
  (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16)) +
  bytes[offset + 3]! * 0x1000000;

/**
 * Stage types: 4 light, 5 deep, 7 awake, 8 REM. Upstream maps anything else
 * to SLEEP_ANY, which the direct-device contract has no stage for: such a
 * stage still counts toward the session bounds but is not listed.
 */
function stageName(type: number): ZeppSleepStageName | null {
  switch (type) {
    case 4:
      return "light";
    case 5:
      return "deep";
    case 7:
      return "awake";
    case 8:
      return "rem";
    default:
      return null;
  }
}

/**
 * Parses one transfer. Throws when the length is not a multiple of 594, as
 * upstream fails. `lastReportTime` is the latest record time, stageless
 * records included: upstream advances its `since` from it.
 */
export function parseZeppSleepSessions(bytes: Uint8Array): {
  sessions: readonly ZeppSleepSession[];
  lastReportTime: number | null;
} {
  if (bytes.length % ZEPP_SLEEP_RECORD_BYTES !== 0) throw new Error("ZEPP_SLEEP_LENGTH_INVALID");
  const sessions: ZeppSleepSession[] = [];
  let lastReportTime: number | null = null;
  for (let offset = 0; offset < bytes.length; offset += ZEPP_SLEEP_RECORD_BYTES) {
    const record = bytes.subarray(offset, offset + ZEPP_SLEEP_RECORD_BYTES);
    const reportTime = u32(record, 0x00);
    const midnight = u32(record, 0x04);
    if (lastReportTime === null || reportTime > lastReportTime) lastReportTime = reportTime;
    const count = record[0x54]!;
    // At most (0x024a − 0x56) / 5 = 100 stages fit before the totals block.
    if (count === 0 || count > 100) continue;
    const base = midnight - 24 * 3600;
    const raw: { type: number; start: number; end: number }[] = [];
    for (let index = 0; index < count; index += 1) {
      const at = 0x56 + 5 * index;
      const start = base + u16(record, at) * 60;
      // Both endpoint minutes are included in a stage.
      const end = base + (u16(record, at + 2) + 1) * 60;
      if (end > start) raw.push({ type: record[at + 4]!, start, end });
    }
    if (!raw.length) continue;
    raw.sort((left, right) => left.start - right.start);
    const sessionStart = raw[0]!.start;
    const sessionEnd = Math.max(...raw.map((stage) => stage.end));
    // Stages that touch share an endpoint minute, and one stage can enclose a
    // shorter one. A later-starting stage wins its span: the earlier stage is
    // cut at its start and resumes after its end, so the listed stages are
    // ordered and never overlap.
    const timeline: { type: number; start: number; end: number }[] = [];
    for (const stage of raw) {
      const remainders: { type: number; start: number; end: number }[] = [];
      for (const previous of timeline) {
        if (previous.end > stage.start && previous.start < stage.start) {
          if (previous.end > stage.end)
            remainders.push({ type: previous.type, start: stage.end, end: previous.end });
          previous.end = stage.start;
        }
      }
      timeline.push({ ...stage }, ...remainders);
      timeline.sort((left, right) => left.start - right.start);
    }
    const stages = [];
    for (let index = 0; index < timeline.length; index += 1) {
      const stage = timeline[index]!;
      const next = timeline[index + 1];
      const end = next ? Math.min(stage.end, next.start) : stage.end;
      const name = stageName(stage.type);
      if (!name || end <= stage.start) continue;
      stages.push({
        stage: name,
        startTime: new Date(stage.start * 1000).toISOString(),
        endTime: new Date(end * 1000).toISOString(),
      });
    }
    const candidate: ZeppSleepSession = {
      reportTime,
      midnight,
      startTime: new Date(sessionStart * 1000).toISOString(),
      endTime: new Date(sessionEnd * 1000).toISOString(),
      stages,
    };
    // Upstream (HuamiSleepSessionProvider): records arrive in report order and
    // a later one replaces only earlier sessions it overlaps, so a nap and the
    // night of the same day stay separate.
    for (let index = sessions.length - 1; index >= 0; index -= 1) {
      const other = sessions[index]!;
      if (
        Date.parse(other.startTime) < sessionEnd * 1000 &&
        sessionStart * 1000 < Date.parse(other.endTime)
      )
        sessions.splice(index, 1);
    }
    sessions.push(candidate);
  }
  return {
    sessions: sessions.sort(
      (left, right) => Date.parse(left.startTime) - Date.parse(right.startTime),
    ),
    lastReportTime,
  };
}
