import { describe, expect, test } from "bun:test";

import {
  decorateMetricDefinitionRow,
  isCanonicalRow,
  type TenantMetricDefinitionRow,
} from "./metric-loader";

describe("metric loader (Issue #17 bounded read-side)", () => {
  test("decorateMetricDefinitionRow attaches canonical code and taxonomy", () => {
    const row: TenantMetricDefinitionRow = {
      id: 1,
      code: "weight",
      displayName: "Weight",
      category: "body",
      unit: "kg",
      valueType: "number",
      aggregationDefault: "latest",
      isActive: true,
    };
    const decorated = decorateMetricDefinitionRow(row);
    expect(decorated.canonicalMetricCode).toBe("weight");
    expect(decorated.isBloodMarkerFamily).toBe(false);
    expect(decorated.taxonomy?.code).toBe("weight");
  });

  test("decorateMetricDefinitionRow resolves blood_marker family to wildcard taxonomy", () => {
    const row: TenantMetricDefinitionRow = {
      id: 2,
      code: "blood_marker_glucose",
      displayName: "Glucose",
      category: "labs",
      unit: "mg/dL",
      valueType: "number",
      aggregationDefault: "latest",
      isActive: true,
    };
    const decorated = decorateMetricDefinitionRow(row);
    expect(decorated.canonicalMetricCode).toBe("blood_marker_glucose");
    expect(decorated.isBloodMarkerFamily).toBe(true);
    expect(decorated.taxonomy?.code).toBe("blood_marker");
  });

  test("decorateMetricDefinitionRow leaves taxonomy null for unknown metric codes", () => {
    const row: TenantMetricDefinitionRow = {
      id: 3,
      code: "custom_marker",
      displayName: "Custom",
      category: "labs",
      unit: null,
      valueType: "number",
      aggregationDefault: "latest",
      isActive: true,
    };
    const decorated = decorateMetricDefinitionRow(row);
    expect(decorated.canonicalMetricCode).toBe("custom_marker");
    expect(decorated.taxonomy).toBeNull();
    expect(decorated.isBloodMarkerFamily).toBe(false);
  });

  test("isCanonicalRow detects canonical rows vs family vs unknown", () => {
    expect(
      isCanonicalRow({
        id: 1,
        code: "weight",
        displayName: "W",
        category: null,
        unit: null,
        valueType: "number",
        aggregationDefault: "latest",
        isActive: true,
      }),
    ).toBe(true);
    expect(
      isCanonicalRow({
        id: 2,
        code: "blood_marker_glucose",
        displayName: "G",
        category: null,
        unit: null,
        valueType: "number",
        aggregationDefault: "latest",
        isActive: true,
      }),
    ).toBe(false);
    expect(
      isCanonicalRow({
        id: 3,
        code: "custom",
        displayName: "C",
        category: null,
        unit: null,
        valueType: "number",
        aggregationDefault: "latest",
        isActive: true,
      }),
    ).toBe(false);
  });
});
