import "@/testing/varlock-test-setup";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import MagicLinkForm from "./magic-link-form";

const globalWithWindow = globalThis as { window?: unknown };
const previousWindow = globalWithWindow.window;

beforeAll(() => {
  globalWithWindow.window ??= { location: { origin: "https://app.test" } };
});

afterAll(() => {
  globalWithWindow.window = previousWindow;
});

describe("MagicLinkForm OIDC option (Issue #65)", () => {
  test("no OIDC configured: the login page is unchanged (no provider button)", () => {
    const html = renderToStaticMarkup(<MagicLinkForm />);
    expect(html).toInclude("Email me a sign-in link");
    expect(html).not.toInclude("Continue with");
  });

  test("OIDC configured: renders Continue with <display name>", () => {
    const html = renderToStaticMarkup(
      <MagicLinkForm oidc={{ providerId: "authentik", displayName: "Acme SSO" }} />,
    );
    expect(html).toInclude("Continue with Acme SSO");
    expect(html).toInclude("Email me a sign-in link");
  });

  test("a refused OIDC identity shows the neutral invitation message, not the link error", () => {
    const html = renderToStaticMarkup(
      <MagicLinkForm
        oidc={{ providerId: "authentik", displayName: "Acme SSO" }}
        oidcError="account_not_linked"
      />,
    );
    expect(html).toInclude("Ask your administrator for an invitation");
    expect(html).not.toInclude("That sign-in link is invalid");
    expect(html).not.toInclude("account_not_linked");
  });
});
