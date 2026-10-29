import { describe, expect, test } from "bun:test";

import { appSourceCodeUrl, UPSTREAM_SOURCE_CODE_URL } from "./source-code";

describe("appSourceCodeUrl (#306)", () => {
  test("links a release version to its tag", () => {
    expect(appSourceCodeUrl("1.0.0")).toBe("https://github.com/nip10/openvalens/tree/v1.0.0");
    expect(appSourceCodeUrl(" 0.2.13 ")).toBe(`${UPSTREAM_SOURCE_CODE_URL}/tree/v0.2.13`);
  });

  test("anything else links to the repository", () => {
    for (const version of [null, undefined, "", "1.0", "1.0.0-rc.1", "v1.0.0", "../main"])
      expect(appSourceCodeUrl(version)).toBe(UPSTREAM_SOURCE_CODE_URL);
  });
});
