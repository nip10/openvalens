import type { AiHealthToolContext } from "./access";
import { createBodyCompTool } from "./body-comp";
import { createGoalsTool } from "./goals";
import { createHealthSnapshotTool } from "./health-snapshot";
import { createLabsTool } from "./labs";
import { createMarkerTrendTool } from "./marker-trend";
import { createNutritionContextTool } from "./nutrition-context";
import { createOutOfRangeTool } from "./out-of-range";
import { createPanelCompareTool } from "./panel-compare";
import { createSupplementsTool } from "./supplements";
import { createTimelineSummaryTool } from "./timeline-summary";
import { createWeightTrendTool } from "./weight-trend";

/**
 * Builds the AI health tool set offered in chat — the ten tools planned in
 * Issue #13 (`healthSnapshot` and `markerTrend` since Issue #124, the other
 * eight since Issue #130) — bound to one request's organization, user and
 * permission check. Build it per request; never share a tool set across
 * callers.
 */
export function createAiHealthTools(context: AiHealthToolContext) {
  return {
    healthSnapshot: createHealthSnapshotTool(context),
    labs: createLabsTool(context),
    markerTrend: createMarkerTrendTool(context),
    panelCompare: createPanelCompareTool(context),
    outOfRange: createOutOfRangeTool(context),
    bodyComp: createBodyCompTool(context),
    weightTrend: createWeightTrendTool(context),
    supplements: createSupplementsTool(context),
    goals: createGoalsTool(context),
    timelineSummary: createTimelineSummaryTool(context),
  };
}

export type AiHealthTools = ReturnType<typeof createAiHealthTools>;

/**
 * The Coach's full tool set: the ten health tools plus the consent-gated
 * `nutritionContext` tool (Issue #86). Offered to the chat model as a whole;
 * each tool re-checks its own permission and consent at execution, so no data
 * leaves the server without them.
 */
export function createAiCoachTools(context: AiHealthToolContext) {
  return {
    ...createAiHealthTools(context),
    nutritionContext: createNutritionContextTool(context),
  };
}

export type AiCoachTools = ReturnType<typeof createAiCoachTools>;
