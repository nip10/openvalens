/**
 * Zepp OS sleep from activity minutes, for the models without the 0x48
 * sleep-session fetch (issue #419). A port of Gadgetbridge
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2 SleepSessionSegmenter and the
 * threshold stage map in HuamiExtendedSampleProvider (which upstream itself
 * calls arbitrary); see docs/research/notes/Zepp OS activity history §5.2.
 *
 * AGPL-3.0-or-later (same as upstream Gadgetbridge).
 */

import type { ZeppSleepStageName } from "./zepp-sleep";

/** Zepp OS activity kind 120: asleep (any stage). */
export const ZEPP_KIND_SLEEP = 120;

export const MIN_SESSION_SECONDS = 5 * 60;
export const MAX_WAKE_SECONDS = 60 * 60;
export const TRAILING_STAGE_SECONDS = 60;

/** One activity minute as the segmenter needs it. */
export type ZeppFallbackMinute = Readonly<{
  /** Unix seconds of the minute's start. */
  time: number;
  steps: number;
  /** Light/deep/REM for a kind-120 minute, null for any other minute. */
  sleep: Exclude<ZeppSleepStageName, "awake"> | null;
}>;

/** HuamiExtendedSampleProvider's fallback stage thresholds for a kind-120 minute. */
export function zeppFallbackStage(
  kind: number,
  deepSleep: number,
  remSleep: number,
): ZeppFallbackMinute["sleep"] {
  if (kind !== ZEPP_KIND_SLEEP) return null;
  if ((remSleep & 127) > 55) return "rem";
  if ((deepSleep & 127) > 42) return "deep";
  return "light";
}

export type ZeppFallbackSession = Readonly<{
  startTime: string;
  endTime: string;
  stages: readonly Readonly<{ stage: ZeppSleepStageName; startTime: string; endTime: string }>[];
}>;

const iso = (seconds: number) => new Date(seconds * 1000).toISOString();

/**
 * Segments minutes (sorted, one per minute) like upstream. Returns the closed
 * sessions, and the start of a session still open when the data ends: upstream
 * would emit it at the end of the data, but a night still in progress must not
 * be published half-finished, so the caller re-reads from there next time.
 */
export function segmentZeppSleep(minutes: readonly ZeppFallbackMinute[]): {
  sessions: readonly ZeppFallbackSession[];
  openStart: number | null;
} {
  const sessions: ZeppFallbackSession[] = [];
  let firstSleep = -1;
  let lastSleep = -1;
  let sinceLastSleep = 0;

  const emit = (first: number, last: number) => {
    const span = minutes[last]!.time + TRAILING_STAGE_SECONDS - minutes[first]!.time;
    if (span <= MIN_SESSION_SECONDS) return;
    // Upstream quirk kept: the first stage takes its kind from the second minute.
    const kindOf = (index: number): ZeppSleepStageName => minutes[index]!.sleep ?? "awake";
    const stages: { stage: ZeppSleepStageName; startTime: string; endTime: string }[] = [];
    let stageStart = minutes[first]!.time;
    let current = kindOf(first + 1);
    for (let index = first + 2; index <= last; index += 1) {
      const kind = kindOf(index);
      if (kind !== current) {
        const stageEnd = minutes[index - 1]!.time;
        if (stageEnd > stageStart)
          stages.push({ stage: current, startTime: iso(stageStart), endTime: iso(stageEnd) });
        current = kind;
        stageStart = stageEnd;
      }
    }
    const end = minutes[last]!.time + TRAILING_STAGE_SECONDS;
    stages.push({ stage: current, startTime: iso(stageStart), endTime: iso(end) });
    sessions.push({ startTime: iso(minutes[first]!.time), endTime: iso(end), stages });
  };

  for (let index = 0; index < minutes.length; index += 1) {
    const minute = minutes[index]!;
    const previous = index > 0 ? minutes[index - 1]! : null;
    const isSleep = minute.sleep !== null;
    if (isSleep) {
      if (firstSleep === -1) firstSleep = index;
      lastSleep = index;
      sinceLastSleep = 0;
    } else if (firstSleep !== -1) {
      const gap = minute.time - previous!.time;
      if (minute.steps > 0 || sinceLastSleep + gap > MAX_WAKE_SECONDS) {
        emit(firstSleep, lastSleep);
        firstSleep = -1;
        lastSleep = -1;
      }
    }
    if (previous && !isSleep) {
      sinceLastSleep += minute.time - previous.time;
      if (firstSleep !== -1 && sinceLastSleep > MAX_WAKE_SECONDS) {
        emit(firstSleep, lastSleep);
        firstSleep = -1;
        lastSleep = -1;
      }
    }
  }
  return { sessions, openStart: firstSleep === -1 ? null : minutes[firstSleep]!.time };
}
