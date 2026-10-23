import { describe, expect, test } from "bun:test";

import { displayLabValue } from "./clinical-units";

const glucose = Object.freeze({ code: "blood_marker_glucose", unit: "mg/dL" });

describe("displayLabValue (#67)", () => {
  test("the unit setting changes the displayed value, never the stored one", () => {
    const stored = { ...glucose, value: 99 };
    const shown = displayLabValue(stored, stored.value, "mmol_l");
    expect(shown.unit).toBe("mmol/L");
    expect(shown.value).toBeCloseTo(5.495, 3);
    expect(shown.converted).toBe(true);
    expect(stored).toEqual({ code: "blood_marker_glucose", unit: "mg/dL", value: 99 });
    expect(displayLabValue(stored, stored.value, "as_reported")).toEqual({
      value: 99,
      unit: "mg/dL",
      converted: false,
    });
  });

  test("converts both ways for known analytes, with their own factors", () => {
    expect(
      displayLabValue({ code: "blood_marker_ldl", unit: "mmol/L" }, 3, "mg_dl").value,
    ).toBeCloseTo(116.01, 2);
    expect(
      displayLabValue({ code: "blood_marker_triglycerides", unit: "mg/dL" }, 150, "mmol_l").value,
    ).toBeCloseTo(1.694, 3);
    expect(
      displayLabValue({ code: "blood_marker_creatinine", unit: "mg/dL" }, 1, "mmol_l"),
    ).toMatchObject({
      unit: "µmol/L",
    });
    expect(
      displayLabValue({ code: "blood_marker_creatinine", unit: "mg/dL" }, 1, "mmol_l").value,
    ).toBeCloseTo(88.42, 2);
    expect(
      displayLabValue({ code: "blood_marker_glucose", unit: "MMOL/L" }, 5.5, "mg_dl").unit,
    ).toBe("mg/dL");
  });

  test("leaves unknown analytes, other units and already-matching units as reported", () => {
    expect(displayLabValue({ code: "blood_marker_hba1c", unit: "%" }, 5.4, "mmol_l")).toEqual({
      value: 5.4,
      unit: "%",
      converted: false,
    });
    expect(
      displayLabValue({ code: "blood_marker_ferritin", unit: "ng/mL" }, 40, "mmol_l").converted,
    ).toBe(false);
    expect(displayLabValue(glucose, 99, "mg_dl").converted).toBe(false);
    expect(
      displayLabValue({ code: "blood_marker_glucose", unit: null }, 99, "mmol_l").unit,
    ).toBeNull();
  });
});
