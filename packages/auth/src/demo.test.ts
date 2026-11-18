import { expect, test } from "bun:test";

import { demoAuthPathAllowed, parseDemoEmail } from "./demo";

test("public demo is optional, normalized, and separate from store review", () => {
  expect(parseDemoEmail({})).toBeNull();
  expect(parseDemoEmail({ DEMO_ACCOUNT_EMAIL: " Demo@Example.test " })).toBe("demo@example.test");
  expect(() => parseDemoEmail({ DEMO_ACCOUNT_EMAIL: "bad" })).toThrow("DEMO_ACCOUNT_EMAIL");
  expect(() =>
    parseDemoEmail({
      DEMO_ACCOUNT_EMAIL: "demo@example.test",
      REVIEW_ACCOUNT_EMAIL: "DEMO@example.test",
    }),
  ).toThrow("must differ");
});

test("auth mutations and cross-visitor session management are default denied", () => {
  for (const path of [
    "/get-session",
    "/sign-out",
    "/organization/get-active-member",
    "/organization/has-permission",
  ])
    expect(demoAuthPathAllowed(path)).toBe(true);
  for (const path of [
    "/update-user",
    "/delete-user",
    "/change-email",
    "/revoke-sessions",
    "/list-sessions",
    "/organization/set-active",
    "/organization/invite-member",
    "/link-social",
    "/oauth2/consent",
    "/unknown",
    "/sign-out/anything",
  ])
    expect(demoAuthPathAllowed(path)).toBe(false);
});
