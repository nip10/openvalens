import { countServerLeaveData } from "../offline/cache";
import { isMetricOutboxBusy } from "../offline/sync";
import {
  ServerLeaveBlockedError,
  type ServerLeaveSafety,
  type ServerLeaveSafetyOptions,
} from "./server-leave-policy";

export type { ServerLeaveSafety, ServerLeaveSafetyOptions } from "./server-leave-policy";

function busyState(options?: ServerLeaveSafetyOptions): boolean | null {
  try {
    return isMetricOutboxBusy() || options?.hasInFlightWrites?.() === true;
  } catch {
    return null;
  }
}

export function readServerLeaveSafety(options?: ServerLeaveSafetyOptions): ServerLeaveSafety {
  const beforeRead = busyState(options);
  if (beforeRead === null) return { kind: "unknown" };
  if (beforeRead) return { kind: "busy" };

  let counts: { records: number; drafts: number } | null = null;
  try {
    counts = countServerLeaveData();
  } catch {}

  // Metric sync dequeues before awaiting transport; recheck both sources after
  // the raw counts so a send beginning during this read cannot appear empty.
  const afterRead = busyState(options);
  if (afterRead === null) return { kind: "unknown" };
  if (afterRead) return { kind: "busy" };
  if (!counts) return { kind: "unknown" };
  if (counts.records > 0 || counts.drafts > 0) return { kind: "pending", ...counts };
  return { kind: "safe" };
}

export async function guardServerLeave(
  leave: () => Promise<void>,
  options?: ServerLeaveSafetyOptions,
): Promise<ServerLeaveSafety> {
  const safety = readServerLeaveSafety(options);
  if (safety.kind !== "safe") return safety;
  try {
    await leave();
    return safety;
  } catch (error) {
    if (error instanceof ServerLeaveBlockedError) return error.safety;
    throw error;
  }
}
