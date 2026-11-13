export type HelioCursor = Readonly<{
  version: 1;
  nextMinuteUtc: string;
  offsetQuarterHours: number;
}>;
export type HelioStepMinute = Readonly<{
  externalRecordId: string;
  startTime: string;
  endTime: string;
  count: number;
  /** Zepp OS byte 3: bpm for the minute, present only for a plausible worn reading. */
  heartRate?: number;
}>;
export type HelioStepsPage = Readonly<{
  minutes: readonly HelioStepMinute[];
  nextCursor: HelioCursor;
}>;
/** One committed batch of Zepp OS sleep sessions (fetch type 0x48). */
export type ZeppSleepPage = Readonly<{
  sessions: readonly import("./zepp-sleep").ZeppSleepSession[];
  nextCursor: HelioCursor;
}>;

export type HelioHistoryOptions = {
  authKey: Uint8Array;
  since: HelioCursor;
  signal: AbortSignal;
  onPage(page: HelioStepsPage): Promise<void>;
  /** Zepp OS: also fetch sleep sessions after activity, from their own cursor. */
  sleep?: Readonly<{ since: HelioCursor; onPage(page: ZeppSleepPage): Promise<void> }>;
  onPhase(phase: "authenticating" | "discovering_services" | "fetching"): void;
};
export type HelioHistoryResult = Readonly<{
  pages: number;
  minutes: number;
  complete: boolean;
  /** Xiaomi only: whether the emitted records are minute- or day-granular. */
  granularity?: "minute" | "daily" | "none";
  /** Zepp OS sleep fetch, when requested. A failure here never undoes activity pages. */
  sleep?: Readonly<{
    pages: number;
    sessions: number;
    complete: boolean;
    errorCode: string | null;
  }>;
}>;

export interface HelioLink {
  readonly maxWriteBytes: number;
  subscribe(
    characteristic: "chunk_read" | "activity_data" | "activity_control",
    onBytes: (bytes: Uint8Array) => void,
    onFailure: () => void,
  ): () => void;
  write(
    characteristic: "chunk_write" | "chunk_read" | "activity_control",
    bytes: Uint8Array,
    signal: AbortSignal,
  ): Promise<void>;
}

export type HelioProtocolLimits = Readonly<{
  maxMessageBytes: number;
  maxPages: number;
  maxMinutes: number;
  maxDurationMs: number;
}>;
