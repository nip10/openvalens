import "@/testing/varlock-test-setup";

import { describe, expect, test } from "bun:test";

import { inEnglish } from "@openvalens/i18n/testing";

import {
  oidcConnectErrorMessage as connectDescriptor,
  oidcSignInErrorMessage as signInDescriptor,
} from "./sign-in-options";

const oidcSignInErrorMessage = (code: string | undefined, name: string) =>
  inEnglish(signInDescriptor(code, name));
const oidcConnectErrorMessage = (code: string | undefined, name: string) =>
  inEnglish(connectDescriptor(code, name));

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
    expect(oidcConnectErrorMessage(undefined, "Acme SSO")).toBe(
      "Could not connect Acme SSO. Please try again.",
    );
    expect(oidcSignInErrorMessage("invalid_code", "Acme SSO")).toBe(
      "Sign-in with Acme SSO did not complete. Try again or use an email link.",
    );
  });
});
