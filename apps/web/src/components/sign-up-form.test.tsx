import "@/testing/varlock-test-setup";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { I18nProvider } from "@lingui/react";
import { englishI18n } from "@openvalens/i18n/testing";
import type { ReactElement } from "react";
import { renderToStaticMarkup as renderMarkup } from "react-dom/server";

import SignUpForm from "./sign-up-form";

/** Issue #294 — Cloud sign-up form. */

function renderToStaticMarkup(node: ReactElement): string {
  return renderMarkup(<I18nProvider i18n={englishI18n}>{node}</I18nProvider>);
}

const terms = { url: "https://legal.test/terms", version: "t-1" };
const privacy = { url: "https://legal.test/privacy", version: "p-1" };
const healthDataConsent = { url: "https://legal.test/privacy", version: "health-1" };

describe("SignUpForm", () => {
  test("asks for an email and links the terms and privacy policy", () => {
    const html = renderToStaticMarkup(
      <SignUpForm
        terms={terms}
        privacy={privacy}
        healthDataConsent={healthDataConsent}
        onSubmit={async () => {}}
      />,
    );
    expect(html).toInclude("Create your account");
    expect(html).toInclude('type="email"');
    expect(html).toInclude('type="checkbox"');
    expect(html).toInclude('href="https://legal.test/terms"');
    expect(html).toInclude('href="https://legal.test/privacy"');
    expect(html).toInclude(
      "I consent to OpenValens processing my health data to provide the service.",
    );
    expect(html).toInclude('href="/login"');
  });

  test("explains a link that came back expired or already used", () => {
    expect(
      renderToStaticMarkup(
        <SignUpForm
          terms={terms}
          privacy={privacy}
          healthDataConsent={healthDataConsent}
          linkError="expired"
          onSubmit={async () => {}}
        />,
      ),
    ).toInclude("That sign-up link has expired");
    expect(
      renderToStaticMarkup(
        <SignUpForm
          terms={terms}
          privacy={privacy}
          healthDataConsent={healthDataConsent}
          linkError="used"
          onSubmit={async () => {}}
        />,
      ),
    ).toInclude("your account exists");
    const used = renderToStaticMarkup(
      <SignUpForm
        terms={terms}
        privacy={privacy}
        healthDataConsent={healthDataConsent}
        linkError="used"
        onSubmit={async () => {}}
      />,
    );
    // The used-link notice links to sign-in (in addition to the footer link).
    expect(used.split('href="/login"').length - 1).toBe(2);
    expect(
      renderToStaticMarkup(
        <SignUpForm
          terms={terms}
          privacy={privacy}
          healthDataConsent={healthDataConsent}
          linkError="expired"
          onSubmit={async () => {}}
        />,
      ).split('href="/login"').length - 1,
    ).toBe(1);
  });
});

describe("SignUpForm with Google and Apple (Issue #296)", () => {
  const globalWithWindow = globalThis as { window?: unknown };
  const previousWindow = globalWithWindow.window;
  beforeAll(() => {
    globalWithWindow.window ??= { location: { origin: "https://app.test" } };
  });
  afterAll(() => {
    globalWithWindow.window = previousWindow;
  });

  test("offers the configured providers under the email form", () => {
    const html = renderToStaticMarkup(
      <SignUpForm
        terms={terms}
        privacy={privacy}
        healthDataConsent={healthDataConsent}
        google
        apple
        onSubmit={async () => {}}
      />,
    );
    expect(html).toInclude("Continue with Google");
    expect(html).toInclude("Continue with Apple");
    const none = renderToStaticMarkup(
      <SignUpForm
        terms={terms}
        privacy={privacy}
        healthDataConsent={healthDataConsent}
        onSubmit={async () => {}}
      />,
    );
    expect(none).not.toInclude("Continue with");
  });

  test("an email that already has an account is pointed at sign-in, never linked", () => {
    const html = renderToStaticMarkup(
      <SignUpForm
        terms={terms}
        privacy={privacy}
        healthDataConsent={healthDataConsent}
        google
        socialError={{ provider: "google", code: "account_not_linked" }}
        onSubmit={async () => {}}
      />,
    );
    expect(html).toInclude("That email already has an account");
    expect(html).toInclude('href="/login"');
  });
});
