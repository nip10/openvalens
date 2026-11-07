export type HelioCursor = Readonly<{ version: 1; nextMinuteUtc: string; offsetQuarterHours: number }>;
export type HelioStepMinute = Readonly<{ externalRecordId: string; startTime: string; endTime: string; count: number }>;
export type HelioStepsPage = Readonly<{ minutes: readonly HelioStepMinute[]; nextCursor: HelioCursor }>;
export type HelioHistoryOptions = {
  authKey: Uint8Array;
  since: HelioCursor;
  signal: AbortSignal;
  onPage(page: HelioStepsPage): Promise<void>;
  onPhase(phase: "authenticating" | "discovering_services" | "fetching"): void;
};
export type HelioHistoryResult = Readonly<{ pages: number; minutes: number; complete: boolean }>;

export interface HelioLink {
  readonly maxWriteBytes: number;
  subscribe(characteristic: "chunk_read" | "activity_data", onBytes: (bytes: Uint8Array) => void, onFailure: () => void): () => void;
  write(characteristic: "chunk_write" | "chunk_read", bytes: Uint8Array, signal: AbortSignal): Promise<void>;
}

export type HelioProtocolLimits = Readonly<{
  maxMessageBytes: number;
  maxPages: number;
  maxMinutes: number;
  maxDurationMs: number;
}>;
