import { AiUsageLimitError, type AiUsageMeter, type AiUsageTokens } from "@openvalens/ai";
import { createStructuredLogger } from "@openvalens/observability";

import { raiseApiError } from "./errors";

/**
 * Issue #299 — the monthly AI usage cap at the API boundary.
 *
 * {@link beginAiUsage} checks the cap (and reserves budget) before a provider
 * call. A person over the cap gets `429 AI_USAGE_LIMIT_REACHED` with
 * `data.resetsOn` (`YYYY-MM-DD`, the first day of next month in UTC) and no
 * provider call is made. The caller passes `record` to the AI call as its
 * `onUsage` and always awaits `finish()` (in a `finally`), so a failed call
 * that still billed is recorded too. Logs carry the correlation id only.
 */

const logger = createStructuredLogger({ level: "info" });

export type AiUsageScope = {
  meter: AiUsageMeter | undefined;
  userId: string;
  /** Prompt size in characters, to size the reservation. Never the prompt. */
  promptChars: number;
  correlationId: string;
};

export type AiUsageHandle = {
  record: (usage: AiUsageTokens) => void;
  finish: () => Promise<void>;
};

const NO_METER: AiUsageHandle = { record: () => {}, finish: async () => {} };

/** The stable envelope for a used-up monthly AI budget. */
export function aiUsageLimitApiError(resetsOn: string) {
  return raiseApiError("AI_USAGE_LIMIT_REACHED", "This month's AI usage limit has been reached.", {
    resetsOn,
  });
}

export async function beginAiUsage(scope: AiUsageScope): Promise<AiUsageHandle> {
  if (!scope.meter) return NO_METER;
  try {
    const lease = await scope.meter.begin({
      userId: scope.userId,
      promptChars: scope.promptChars,
    });
    return { record: (usage) => lease.add(usage), finish: () => lease.finish() };
  } catch (error) {
    if (error instanceof AiUsageLimitError) {
      logger.warn("ai.usage.limit_reached", {
        correlationId: scope.correlationId,
        resetsOn: error.resetsOn,
      });
      throw aiUsageLimitApiError(error.resetsOn);
    }
    logger.error("ai.usage.check_failed", { correlationId: scope.correlationId, error });
    throw raiseApiError("INTERNAL", "AI usage check failed.");
  }
}
