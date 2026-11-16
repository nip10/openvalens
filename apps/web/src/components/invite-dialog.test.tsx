import "@/testing/varlock-test-setup";
import { describe, expect, test } from "bun:test";
import { I18nProvider } from "@lingui/react";
import { englishI18n } from "@openvalens/i18n/testing";
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { InviteForm } from "./invite-dialog";

function render(overrides: Partial<ComponentProps<typeof InviteForm>> = {}) {
  return renderToStaticMarkup(
    <I18nProvider i18n={englishI18n}>
      <InviteForm
        pending={false}
        failed={false}
        delivery={null}
        onSubmit={() => {}}
        onDone={() => {}}
        {...overrides}
      />
    </I18nProvider>,
  );
}

describe("InviteForm (#sharing-6)", () => {
  test("asks for an email and a role, member chosen by default", () => {
    const html = render();
    expect(html).toContain('type="email"');
    expect(html).toMatch(/<input type="radio"[^>]*checked="" value="member"/);
    expect(html).not.toMatch(/checked="" value="owner"/);
    expect(html).toContain(">Send invite<");
  });

  test("says in one line what each role gets (#sharing-0)", () => {
    const html = render();
    expect(html).toContain("except your workouts, sleep and body measurements");
    expect(html).toContain("Full control, including inviting and removing people");
  });

  test("Send stays off until the email looks like one", () => {
    expect(render()).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
  });

  test("an invitation saved without an email says how to accept it", () => {
    const html = render({ delivery: "unavailable" });
    expect(html).toContain("email is not configured on this server");
    expect(html).toContain(">Done<");
    expect(html).not.toContain('type="email"');
  });

  test("a failed invite is announced", () => {
    expect(render({ failed: true })).toContain("Could not send invite.");
  });
});
