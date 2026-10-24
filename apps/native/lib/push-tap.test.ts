import { describe, expect, test } from "bun:test";

import { PUSH_TAP_PATHS, pushTapPath, pushTapTarget, type PushTapResponse } from "./push-tap";

const DEFAULT = "expo.modules.notifications.actions.DEFAULT";

const response = (data: unknown, actionIdentifier = DEFAULT): PushTapResponse => ({
  actionIdentifier,
  notification: { request: { content: { data } } },
});

describe("pushTapPath", () => {
  test("accepts exactly the paths the server sends", () => {
    expect(PUSH_TAP_PATHS).toEqual(["/", "/preventive-care"]);
    expect(pushTapPath({ path: "/" })).toBe("/");
    expect(pushTapPath({ path: "/preventive-care" })).toBe("/preventive-care");
  });

  test("rejects anything that is not an allowlisted in-app path", () => {
    for (const path of [
      "https://evil.example/",
      "//evil.example/preventive-care",
      "openvalens://preventive-care",
      "javascript:alert(1)",
      "/preventive-care/",
      "/preventive-care?next=https://evil.example",
      "/preventive-care#x",
      "/Preventive-Care",
      " /preventive-care",
      "/../preventive-care",
      "/settings",
      "/admin/settings",
      "preventive-care",
      "",
    ]) {
      expect(pushTapPath({ path })).toBeNull();
    }
  });

  test("ignores malformed data", () => {
    for (const data of [
      undefined,
      null,
      "/",
      ["/"],
      {},
      { url: "/" },
      { path: 1 },
      { path: ["/"] },
      { path: null },
      Object.create({ path: "/" }),
    ]) {
      expect(pushTapPath(data)).toBeNull();
    }
  });
});

describe("pushTapTarget", () => {
  test("opens the allowlisted path for a plain tap", () => {
    expect(pushTapTarget(response({ path: "/preventive-care" }), DEFAULT)).toBe("/preventive-care");
  });

  test("does nothing without a response, for other actions, or for a bad path", () => {
    expect(pushTapTarget(null, DEFAULT)).toBeNull();
    expect(pushTapTarget(undefined, DEFAULT)).toBeNull();
    expect(pushTapTarget(response({ path: "/" }, "dismiss"), DEFAULT)).toBeNull();
    expect(pushTapTarget(response({ path: "https://evil.example" }), DEFAULT)).toBeNull();
    expect(
      pushTapTarget({ actionIdentifier: DEFAULT } as unknown as PushTapResponse, DEFAULT),
    ).toBeNull();
  });
});
