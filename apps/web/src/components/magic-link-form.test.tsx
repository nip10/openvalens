import "@/testing/varlock-test-setup";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { I18nProvider } from "@lingui/react";
import { englishI18n } from "@openvalens/i18n/testing";
import type { ReactElement } from "react";
import { renderToStaticMarkup as renderMarkup } from "react-dom/server";

import MagicLinkForm from "./magic-link-form";

/** Renders inside an English I18nProvider: the component is translated (#67). */
function renderToStaticMarkup(node: ReactElement): string {
  return renderMarkup(<I18nProvider i18n={englishI18n}>{node}</I18nProvider>);
}

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

describe("MagicLinkForm sign-up link (Issue #294)", () => {
  test("self-hosted: no Create account link, invitation copy stays", () => {
    const html = renderToStaticMarkup(<MagicLinkForm />);
    expect(html).not.toInclude('href="/signup"');
    expect(html).toInclude("New accounts require an invitation.");
  });

  test("cloud: shows Create account linking to /signup", () => {
    const html = renderToStaticMarkup(<MagicLinkForm signUpAvailable />);
    expect(html).toInclude('href="/signup"');
    expect(html).toInclude("Create account");
    expect(html).not.toInclude("New accounts require an invitation.");
  });
});

describe("MagicLinkForm Google and Apple (Issue #296)", () => {
  test("nothing configured: no Google or Apple button", () => {
    const html = renderToStaticMarkup(<MagicLinkForm />);
    expect(html).not.toInclude("Continue with Google");
    expect(html).not.toInclude("Continue with Apple");
  });

  test("shows only the providers the server advertises", () => {
    const html = renderToStaticMarkup(<MagicLinkForm google />);
    expect(html).toInclude("Continue with Google");
    expect(html).not.toInclude("Continue with Apple");
    const both = renderToStaticMarkup(<MagicLinkForm google apple />);
    expect(both).toInclude("Continue with Apple");
  });

  test("an unknown identity: invitation copy on self-host, sign-up copy in Cloud", () => {
    const selfHosted = renderToStaticMarkup(
      <MagicLinkForm google socialError={{ provider: "google", code: "signup_disabled" }} />,
    );
    expect(selfHosted).toInclude("Ask your administrator for an invitation");
    expect(selfHosted).not.toInclude("That sign-in link is invalid");
    const cloud = renderToStaticMarkup(
      <MagicLinkForm
        apple
        signUpAvailable
        socialError={{ provider: "apple", code: "account_not_linked" }}
      />,
    );
    expect(cloud).toInclude("No account is connected to that Apple account");
    expect(cloud).not.toInclude("account_not_linked");
  });
});

describe("MagicLinkForm sign-in code", () => {
  test("always offers 'Have a sign-in code?', with the code field hidden until asked", () => {
    for (const html of [
      renderToStaticMarkup(<MagicLinkForm />),
      renderToStaticMarkup(<MagicLinkForm signUpAvailable google apple />),
    ]) {
      expect(html).toInclude("Have a sign-in code?");
      expect(html).not.toInclude("Sign-in code<");
      expect(html).not.toInclude('name="code"');
    }
  });
});

describe("MagicLinkForm failed link", () => {
  test("an invalid or expired link points a newcomer at sign-up", () => {
    const html = renderToStaticMarkup(<MagicLinkForm linkError="INVALID_TOKEN" signUpAvailable />);
    expect(html).toInclude("That sign-in link is invalid or has expired");
    expect(html).toInclude("If you don&#x27;t have an account yet,");
    expect(html).toInclude('href="/signup"');
  });

  test("without public sign-up the hint names an invitation instead", () => {
    const html = renderToStaticMarkup(<MagicLinkForm linkError="" />);
    expect(html).toInclude("you need an invitation first");
    expect(html).not.toInclude("/signup");
  });

  test("a link for an email with no account says so, with sign-up", () => {
    const html = renderToStaticMarkup(
      <MagicLinkForm linkError="new_user_signup_disabled" signUpAvailable />,
    );
    expect(html).toInclude("There is no account for this email yet.");
    expect(html).toInclude("first, then sign in.");
    expect(html).not.toInclude("invalid or has expired");
  });

  test("no error, no alert", () => {
    expect(renderToStaticMarkup(<MagicLinkForm />)).not.toInclude('role="alert"');
  });
});
