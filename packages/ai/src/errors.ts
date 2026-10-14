/**
 * Value-free AI provider failure summary (Issues #57, #59).
 *
 * Provider errors from the AI SDK carry the request body, response body and
 * URL; none of that may be logged. This reduces any failure to a category,
 * HTTP status and retryability so operators can tell a bad key from an outage
 * or an endpoint that rejects a request shape, from the structured log alone.
 * Categories mirror `EmailDeliveryErrorCategory` in `@openvalens/email`.
 */
import { APICallError, RetryError } from "ai";

import { AiConfigError } from "./config";

export type AiProviderErrorCategory =
  | "config"
  | "network"
  | "rate_limited"
  | "provider_unavailable"
  | "auth"
  | "rejected"
  | "unknown";

export type AiProviderErrorSummary = {
  category: AiProviderErrorCategory;
  /** HTTP status, or `null` when no response was received. */
  status: number | null;
  retryable: boolean;
};

function categorizeStatus(status: number): AiProviderErrorCategory {
  if (status === 429) return "rate_limited";
  if (status >= 500) return "provider_unavailable";
  if (status === 401 || status === 403) return "auth";
  if (status >= 400) return "rejected";
  return "unknown";
}

export function describeAiProviderError(error: unknown): AiProviderErrorSummary {
  if (error instanceof AiConfigError) {
    return { category: "config", status: null, retryable: false };
  }
  const candidate = RetryError.isInstance(error) ? error.lastError : error;
  if (APICallError.isInstance(candidate)) {
    const status = candidate.statusCode ?? null;
    return {
      category: status === null ? "network" : categorizeStatus(status),
      status,
      retryable: candidate.isRetryable,
    };
  }
  return { category: "unknown", status: null, retryable: false };
}
