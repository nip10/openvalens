export type ServerLeaveSafety =
  | { kind: "safe" }
  | { kind: "pending"; records: number; drafts: number }
  | { kind: "busy" }
  | { kind: "unknown" };

export type ServerLeaveOptions = {
  pendingDataPolicy?: "preserve";
  hasInFlightWrites?: () => boolean;
};

export type ServerLeaveSafetyOptions = Pick<ServerLeaveOptions, "hasInFlightWrites">;

export type PreserveServerLeaveOptions = ServerLeaveOptions & {
  pendingDataPolicy: "preserve";
  hasInFlightWrites: () => boolean;
};

export type BlockedServerLeaveSafety = Exclude<ServerLeaveSafety, { kind: "safe" }>;

export class ServerLeaveBlockedError extends Error {
  readonly safety: BlockedServerLeaveSafety;

  constructor(safety: BlockedServerLeaveSafety) {
    super("Server change blocked to preserve local data.");
    this.name = "ServerLeaveBlockedError";
    this.safety = safety;
  }
}

export function isServerLeaveBlockedError(error: unknown): error is ServerLeaveBlockedError {
  return error instanceof ServerLeaveBlockedError;
}

export function requireSafeServerLeave(safety: ServerLeaveSafety): void {
  if (safety.kind !== "safe") throw new ServerLeaveBlockedError(safety);
}
