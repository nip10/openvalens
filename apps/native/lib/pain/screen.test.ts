import { describe, expect, test } from "bun:test";

import { bodyMapParams, initialView, painKeys } from "./screen";

describe("bodyMapParams", () => {
  test("opens the pain layer with a known region", () => {
    expect(bodyMapParams({ layer: "pain", region: "joint.knee_left" })).toEqual({
      layer: "pain",
      region: "joint.knee_left",
    });
    expect(bodyMapParams({ layer: ["pain"], region: ["back.calf_right", "x"] })).toEqual({
      layer: "pain",
      region: "back.calf_right",
    });
  });

  test("drops an unknown region and ignores other layers", () => {
    expect(bodyMapParams({ layer: "pain", region: "joint.tail" })).toEqual({ layer: "pain" });
    expect(bodyMapParams({ layer: "pain" })).toEqual({ layer: "pain" });
    expect(bodyMapParams({ layer: "training", region: "joint.knee_left" })).toEqual({});
    expect(bodyMapParams({})).toEqual({});
  });
});

test("initialView shows the back for a back region", () => {
  expect(initialView("back.lower_back_left")).toBe("back");
  expect(initialView("joint.knee_left")).toBe("front");
  expect(initialView(undefined)).toBe("front");
});

test("painKeys are scoped to the member and share the pain prefix", () => {
  const a = painKeys({ organizationId: "org-1", userId: "user-1" });
  const b = painKeys({ organizationId: "org-1", userId: "user-2" });
  expect(a.preference).not.toEqual(b.preference);
  for (const key of [a.preference, a.map(7), a.history("joint.knee_left")]) {
    expect(key.slice(0, a.all.length)).toEqual([...a.all]);
    expect(key[0]).toBe("pain");
  }
});
