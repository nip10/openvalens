import "@/testing/varlock-test-setup";

import { describe, expect, test } from "bun:test";

import { oidcConnectErrorMessage, oidcSignInErrorMessage } from "./sign-in-options";

describe("oidcSignInErrorMessage (Issue #65)", () => {
  test("unknown and unlinked identities get the same neutral invitation message", () => {
    const unknown = oidcSignInErrorMessage("signup_disabled", "Acme SSO");
    expect(oidcSignInErrorMessage("account_not_linked", "Acme SSO")).toBe(unknown);
    expect(oidcSignInErrorMessage("registration_not_allowed", "Acme SSO")).toBe(unknown);
    expect(unknown).toContain("Ask your administrator for an invitation");
  });

  test("other failures name the provider without echoing the code", () => {
    const message = oidcSignInErrorMessage("invalid_code", "Acme SSO");
    expect(message).toContain("Acme SSO");
    expect(message).not.toContain("invalid_code");
  });
});

describe("oidcConnectErrorMessage (Issue #65)", () => {
  test("maps link refusals to specific messages", () => {
    expect(oidcConnectErrorMessage("email_does_not_match", "Acme SSO")).toContain(
      "different email",
    );
    expect(
      oidcConnectErrorMessage("account_already_linked_to_different_user", "Acme SSO"),
    ).toContain("another user");
    expect(oidcConnectErrorMessage(undefined, "Acme SSO")).toContain("Could not connect");
  });
});
