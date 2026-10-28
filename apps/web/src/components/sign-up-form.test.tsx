import "@/testing/varlock-test-setup";

import { describe, expect, test } from "bun:test";
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

describe("SignUpForm", () => {
  test("asks for an email and links the terms and privacy policy", () => {
    const html = renderToStaticMarkup(
      <SignUpForm terms={terms} privacy={privacy} onSubmit={async () => {}} />,
    );
    expect(html).toInclude("Create your account");
    expect(html).toInclude('type="email"');
    expect(html).toInclude('type="checkbox"');
    expect(html).toInclude('href="https://legal.test/terms"');
    expect(html).toInclude('href="https://legal.test/privacy"');
    expect(html).toInclude('href="/login"');
  });

  test("explains a link that came back expired or already used", () => {
    expect(
      renderToStaticMarkup(
        <SignUpForm
          terms={terms}
          privacy={privacy}
          linkError="expired"
          onSubmit={async () => {}}
        />,
      ),
    ).toInclude("That sign-up link has expired");
    expect(
      renderToStaticMarkup(
        <SignUpForm terms={terms} privacy={privacy} linkError="used" onSubmit={async () => {}} />,
      ),
    ).toInclude("your account exists");
    const used = renderToStaticMarkup(
      <SignUpForm terms={terms} privacy={privacy} linkError="used" onSubmit={async () => {}} />,
    );
    // The used-link notice links to sign-in (in addition to the footer link).
    expect(used.split('href="/login"').length - 1).toBe(2);
    expect(
      renderToStaticMarkup(
        <SignUpForm
          terms={terms}
          privacy={privacy}
          linkError="expired"
          onSubmit={async () => {}}
        />,
      ).split('href="/login"').length - 1,
    ).toBe(1);
  });
});
