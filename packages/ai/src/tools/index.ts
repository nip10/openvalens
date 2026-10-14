import type { AiHealthToolContext } from "./access";
import { createHealthSnapshotTool } from "./health-snapshot";
import { createMarkerTrendTool } from "./marker-trend";

/**
 * Builds the AI health tool set offered in chat (Issue #124), bound to one
 * request's organization, user and permission check. Build it per request —
 * never share a tool set across callers.
 */
export function createAiHealthTools(context: AiHealthToolContext) {
  return {
    healthSnapshot: createHealthSnapshotTool(context),
    markerTrend: createMarkerTrendTool(context),
  };
}

export type AiHealthTools = ReturnType<typeof createAiHealthTools>;
