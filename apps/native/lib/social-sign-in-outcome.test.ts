import { describe, expect, test } from "bun:test";

import { appleFlow, appleUserName, classifySocialError } from "./social-sign-in-outcome";

describe("Issue #296 — social sign-in outcomes", () => {
  test("Better Auth refusals map to one neutral outcome, never the raw text", () => {
    expect(classifySocialError(null)).toEqual({ kind: "ok" });
    expect(
      classifySocialError({ status: 401, message: "signup disabled", code: "OAUTH_LINK_ERROR" }),
    ).toEqual({ kind: "no-account" });
    expect(classifySocialError({ status: 401, message: "account not linked" })).toEqual({
      kind: "no-account",
    });
    expect(classifySocialError({ status: 400, code: "email_does_not_match" })).toEqual({
      kind: "email-mismatch",
    });
    expect(classifySocialError({ status: 409, message: "Social account already linked" })).toEqual({
      kind: "already-linked",
    });
    expect(classifySocialError({ status: 500, message: "boom" })).toEqual({ kind: "failed" });
  });

  test("Apple's split name becomes Better Auth's user name, or nothing", () => {
    expect(appleUserName({ givenName: "Ana", familyName: "Silva" })).toEqual({
      name: { firstName: "Ana", lastName: "Silva" },
    });
    expect(appleUserName({ givenName: " Inês ", familyName: null })).toEqual({
      name: { firstName: "Inês" },
    });
    expect(appleUserName({ givenName: null, familyName: null })).toBeUndefined();
    expect(appleUserName(null)).toBeUndefined();
  });

  test("the native sheet only on iOS with a server that accepts app id tokens", () => {
    expect(appleFlow("ios", true)).toBe("native");
    expect(appleFlow("ios", false)).toBe("browser");
    expect(appleFlow("android", true)).toBe("browser");
  });
});
