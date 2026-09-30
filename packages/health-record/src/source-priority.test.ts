import { describe, expect, test } from "bun:test";

import {
  buildSourcePriorityLookup,
  resolveMetricSourcePriority,
  resolveSourcePriorityList,
  SOURCE_PRIORITY_RULE,
  type SourcePreferenceRow,
} from "./source-priority";

const userRow = (metricCode: string, preferredSources: readonly string[]): SourcePreferenceRow => ({
  metricCode,
  scope: "user",
  preferredSources,
});

const orgRow = (metricCode: string, preferredSources: readonly string[]): SourcePreferenceRow => ({
  metricCode,
  scope: "organization",
  preferredSources,
});

describe("source priority resolver (Issue #17 bounded read-side)", () => {
  test("manual user override beats family-history entry and default", () => {
    const result = resolveMetricSourcePriority("weight", {
      organizationRows: [orgRow("weight", ["watch", "phone"])],
      userRows: [userRow("weight", ["phone", "watch"])],
    });
    expect(result.manualOverride).toEqual(["phone", "watch"]);
    expect(result.familyHistoryEntry).toEqual(["watch", "phone"]);
    expect(result.effectiveOrder).toEqual(["phone", "watch"]);
    expect(result.reason).toBe("manual_override");
    expect(result.rule).toBe(SOURCE_PRIORITY_RULE);
  });

  test("family-history entry wins when no manual override is set", () => {
    const result = resolveMetricSourcePriority("resting_heart_rate", {
      organizationRows: [orgRow("resting_heart_rate", ["phone", "watch"])],
      userRows: [],
    });
    expect(result.familyHistoryEntry).toEqual(["phone", "watch"]);
    expect(result.manualOverride).toBeNull();
    expect(result.effectiveOrder).toEqual(["phone", "watch"]);
    expect(result.reason).toBe("family_history_entry");
  });

  test("default order fills the gap when no preference is stored", () => {
    const result = resolveMetricSourcePriority("weight", {
      organizationRows: [],
      userRows: [],
    });
    expect(result.manualOverride).toBeNull();
    expect(result.familyHistoryEntry).toBeNull();
    expect(result.defaultOrder).toEqual(["phone", "watch", "scale"]);
    expect(result.effectiveOrder).toEqual(["phone", "watch", "scale"]);
    expect(result.reason).toBe("default_order");
  });

  test("missing preference for a no-default metric returns empty effective order", () => {
    const result = resolveMetricSourcePriority("height", {
      organizationRows: [],
      userRows: [],
    });
    expect(result.defaultOrder).toBeNull();
    expect(result.effectiveOrder).toEqual([]);
    expect(result.reason).toBe("unknown_metric_no_default");
  });

  test("unknown metric code with a stored preference still resolves", () => {
    const result = resolveMetricSourcePriority("custom_marker", {
      organizationRows: [orgRow("custom_marker", ["lab", "watch"])],
      userRows: [],
    });
    expect(result.canonicalMetricCode).toBe("custom_marker");
    expect(result.familyHistoryEntry).toEqual(["lab", "watch"]);
    expect(result.effectiveOrder).toEqual(["lab", "watch"]);
    expect(result.reason).toBe("family_history_entry");
  });

  test("invalid source vocab on the user row falls through to org or default", () => {
    const result = resolveMetricSourcePriority("resting_heart_rate", {
      organizationRows: [orgRow("resting_heart_rate", ["phone", "watch"])],
      userRows: [userRow("resting_heart_rate", ["ring", "watch"])],
    });
    expect(result.manualOverride).toBeNull();
    expect(result.effectiveOrder).toEqual(["phone", "watch"]);
    expect(result.reason).toBe("family_history_entry");
  });

  test("empty preference arrays fall through to the next layer", () => {
    const result = resolveMetricSourcePriority("weight", {
      organizationRows: [orgRow("weight", [])],
      userRows: [userRow("weight", [])],
    });
    expect(result.manualOverride).toBeNull();
    expect(result.familyHistoryEntry).toBeNull();
    expect(result.effectiveOrder).toEqual(["phone", "watch", "scale"]);
    expect(result.reason).toBe("default_order");
  });

  test("blood_marker family codes use the wildcard taxonomy resolution", () => {
    const result = resolveMetricSourcePriority("blood_marker_glucose", {
      organizationRows: [orgRow("blood_marker_glucose", ["lab_x", "phone"])],
      userRows: [],
    });
    expect(result.isBloodMarkerFamily).toBe(true);
    expect(result.canonicalMetricCode).toBe("blood_marker_glucose");
    expect(result.familyHistoryEntry).toEqual(["lab_x", "phone"]);
    expect(result.effectiveOrder).toEqual(["lab_x", "phone"]);
    expect(result.reason).toBe("family_history_entry");
  });

  test("resolveSourcePriorityList preserves input order across mixed layers", () => {
    const result = resolveSourcePriorityList(
      ["weight", "resting_heart_rate", "blood_marker_glucose"],
      {
        organizationRows: [orgRow("resting_heart_rate", ["phone", "watch"])],
        userRows: [userRow("weight", ["phone", "watch", "scale"])],
      },
    );
    expect(result.map((entry) => entry.metricCode)).toEqual([
      "weight",
      "resting_heart_rate",
      "blood_marker_glucose",
    ]);
    expect(result.map((entry) => entry.reason)).toEqual([
      "manual_override",
      "family_history_entry",
      "default_order",
    ]);
  });

  test("buildSourcePriorityLookup partitions user/organization scopes", () => {
    const result = buildSourcePriorityLookup(
      ["weight", "resting_heart_rate"],
      [userRow("weight", ["phone", "watch"]), orgRow("resting_heart_rate", ["phone", "watch"])],
    );
    expect(result[0]?.reason).toBe("manual_override");
    expect(result[1]?.reason).toBe("family_history_entry");
  });

  test("aliased metric code resolves to the canonical code", () => {
    const result = resolveMetricSourcePriority("heartRate", {
      organizationRows: [orgRow("heart_rate", ["phone", "watch"])],
      userRows: [],
    });
    expect(result.canonicalMetricCode).toBe("heart_rate");
    expect(result.familyHistoryEntry).toEqual(["phone", "watch"]);
  });

  test("empty org + active rows + missing preference still resolve to default", () => {
    const result = resolveMetricSourcePriority("weight", {
      organizationRows: [],
      userRows: [],
    });
    expect(result.effectiveOrder).toEqual(["phone", "watch", "scale"]);
  });
});
