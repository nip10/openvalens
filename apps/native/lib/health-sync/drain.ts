import type {
  IngestBatchInput,
  MobileHealthRecordInput,
} from "@openhealth/api/contracts/mobile-ingest";

import { DEFAULT_BATCH_LIMITS, splitIntoBatches, type BatchLimits } from "./batching";
import type { MobileRecordType } from "./map-health-connect";

/**
 * Cursor-driven ingest (docs/architecture/mobile-sync-decision.md, issue #27).
 *
 * Health Connect is the durable outbox; the device only keeps a cursor per
 * record type and moves it after the server acknowledged every batch read
 * from it. Retries re-read the same data and produce identical batches,
 * which the server answers with `duplicate`.
 *
 * First run (or expired token): capture a changes token *first*, then read
 * the backfill window one day at a time, then switch to changes. Anything
 * written during the backfill is picked up by the captured token (the
 * server dedupes the overlap).
 */
export type CursorState =
  | { phase: "backfill"; changesToken: string; from: string; to: string; next: string }
  | { phase: "changes"; changesToken: string; lastAckedAt: string };

export type ChangesPage = {
  upserts: MobileHealthRecordInput[];
  deletions: { externalRecordId: string }[];
  nextToken: string;
  hasMore: boolean;
  expired: boolean;
};

export type HealthSource = {
  /** Types the user granted read access to. */
  grantedTypes(): Promise<MobileRecordType[]>;
  /** A changes token positioned at "now" for this type. */
  captureToken(type: MobileRecordType): Promise<string>;
  readWindow(type: MobileRecordType, from: Date, to: Date): Promise<MobileHealthRecordInput[]>;
  getChanges(type: MobileRecordType, token: string): Promise<ChangesPage>;
};

export type CursorStore = {
  get(type: MobileRecordType): Promise<CursorState | null>;
  set(type: MobileRecordType, state: CursorState): Promise<void>;
};

export type DrainDeps = {
  deviceId: string;
  provider: IngestBatchInput["provider"];
  clientTimezone: string;
  now: () => Date;
  source: HealthSource;
  cursors: CursorStore;
  /** Resolves once the server acknowledged (applied, queued or duplicate). */
  send(batch: IngestBatchInput): Promise<void>;
};

export type DrainOptions = {
  /** Upper bound on batches per run (background runs are time-limited). */
  maxBatches: number;
  /** Stop starting new work after this epoch ms. */
  deadline?: number;
  backfillDays?: number;
  limits?: BatchLimits;
};

export type TypeResult = {
  status: "ok" | "error" | "budget_exhausted";
  batchesSent: number;
  /** Stable code only; never a message, which could carry PHI. */
  errorCode?: string;
};

export type DrainSummary = {
  types: Partial<Record<MobileRecordType, TypeResult>>;
  /** Set when the server refused the device or session; nothing else should run. */
  fatalErrorCode?: string;
};

const DAY_MS = 86_400_000;
const FATAL_CODES = new Set([
  "PERMISSION_DENIED",
  "UNAUTHENTICATED",
  "NO_MEMBERSHIP",
  "TENANT_VIOLATION",
]);

class BudgetExhausted extends Error {}
class SendFailed extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function errorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}

export async function drainHealthChanges(
  deps: DrainDeps,
  options: DrainOptions,
): Promise<DrainSummary> {
  const summary: DrainSummary = { types: {} };
  const backfillDays = options.backfillDays ?? 30;
  const limits = options.limits ?? DEFAULT_BATCH_LIMITS;
  let budget = options.maxBatches;

  const outOfTime = () =>
    budget <= 0 || (options.deadline !== undefined && Date.now() >= options.deadline);

  for (const type of await deps.source.grantedTypes()) {
    const result: TypeResult = { status: "ok", batchesSent: 0 };
    summary.types[type] = result;

    const sendAll = async (
      upserts: MobileHealthRecordInput[],
      deletions: { externalRecordId: string }[],
      extra: { mode: IngestBatchInput["mode"]; window?: IngestBatchInput["window"] },
    ) => {
      for (const part of splitIntoBatches(upserts, deletions, limits)) {
        if (outOfTime()) throw new BudgetExhausted();
        try {
          await deps.send({
            schemaVersion: 1,
            deviceId: deps.deviceId,
            provider: deps.provider,
            recordType: type,
            clientTimezone: deps.clientTimezone,
            ...extra,
            ...part,
          });
        } catch (error) {
          throw new SendFailed(errorCode(error) ?? "SEND_FAILED");
        }
        budget -= 1;
        result.batchesSent += 1;
      }
    };

    try {
      let cursor = await deps.cursors.get(type);
      for (;;) {
        if (!cursor) {
          const now = deps.now();
          const changesToken = await deps.source.captureToken(type);
          const from = new Date(now.getTime() - backfillDays * DAY_MS).toISOString();
          cursor = { phase: "backfill", changesToken, from, to: now.toISOString(), next: from };
          await deps.cursors.set(type, cursor);
        }

        if (cursor.phase === "backfill") {
          const windowStart = new Date(cursor.next);
          const end = new Date(cursor.to);
          if (windowStart >= end) {
            // Backfill done. Changes since the captured token are read next run.
            cursor = {
              phase: "changes",
              changesToken: cursor.changesToken,
              lastAckedAt: deps.now().toISOString(),
            };
            await deps.cursors.set(type, cursor);
            break;
          }
          if (outOfTime()) throw new BudgetExhausted();
          const windowEnd = new Date(Math.min(windowStart.getTime() + DAY_MS, end.getTime()));
          const records = await deps.source.readWindow(type, windowStart, windowEnd);
          await sendAll(records, [], {
            mode: "backfill",
            window: { from: windowStart.toISOString(), to: windowEnd.toISOString() },
          });
          cursor = { ...cursor, next: windowEnd.toISOString() };
          await deps.cursors.set(type, cursor);
          continue;
        }

        // Changes phase.
        if (outOfTime()) throw new BudgetExhausted();
        const page = await deps.source.getChanges(type, cursor.changesToken);
        if (page.expired) {
          const now = deps.now();
          const changesToken = await deps.source.captureToken(type);
          const from = new Date(
            Math.max(
              new Date(cursor.lastAckedAt).getTime() - DAY_MS,
              now.getTime() - backfillDays * DAY_MS,
            ),
          ).toISOString();
          cursor = { phase: "backfill", changesToken, from, to: now.toISOString(), next: from };
          await deps.cursors.set(type, cursor);
          continue;
        }
        await sendAll(page.upserts, page.deletions, { mode: "changes" });
        cursor = {
          phase: "changes",
          changesToken: page.nextToken,
          lastAckedAt: deps.now().toISOString(),
        };
        await deps.cursors.set(type, cursor);
        if (!page.hasMore) break;
      }
    } catch (error) {
      if (error instanceof BudgetExhausted) {
        result.status = "budget_exhausted";
        break;
      }
      result.status = "error";
      if (error instanceof SendFailed) {
        result.errorCode = error.code;
        if (FATAL_CODES.has(error.code)) {
          summary.fatalErrorCode = error.code;
          break;
        }
      } else result.errorCode = "SOURCE_FAILED";
    }
  }
  return summary;
}
