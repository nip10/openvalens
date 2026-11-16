import { describe, expect, test } from "bun:test";

import { avatarInitial, cleanDisplayName, displayNameOf, DISPLAY_NAME_MAX } from "./display-name";

describe("displayNameOf", () => {
  test("returns a chosen name", () => {
    expect(displayNameOf("Alex Morgan", "alex@example.com")).toBe("Alex Morgan");
  });

  test("treats a blank name or one equal to the email as no name", () => {
    expect(displayNameOf("", "alex@example.com")).toBeNull();
    expect(displayNameOf("  ", "alex@example.com")).toBeNull();
    expect(displayNameOf(null, "alex@example.com")).toBeNull();
    expect(displayNameOf("Alex@Example.com", "alex@example.com")).toBeNull();
  });
});

describe("avatarInitial", () => {
  test("uses the name, then the email", () => {
    expect(avatarInitial("alex morgan", "zed@example.com")).toBe("A");
    expect(avatarInitial("review@example.com", "review@example.com")).toBe("R");
    expect(avatarInitial(null, null)).toBe("?");
  });
});

describe("cleanDisplayName", () => {
  test("trims and collapses spaces", () => {
    expect(cleanDisplayName("  Alex   Morgan ")).toBe("Alex Morgan");
  });

  test("rejects blank or overlong names", () => {
    expect(cleanDisplayName("   ")).toBeNull();
    expect(cleanDisplayName("a".repeat(DISPLAY_NAME_MAX + 1))).toBeNull();
  });
});
