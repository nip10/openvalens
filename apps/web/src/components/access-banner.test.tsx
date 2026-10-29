import "@/testing/varlock-test-setup";

import { describe, expect, test } from "bun:test";
import { I18nProvider } from "@lingui/react";
import { englishI18n } from "@openvalens/i18n/testing";
import { renderToStaticMarkup } from "react-dom/server";

import { AccessBannerView, type AccessState } from "./access-banner";

/** Issue #298 — the web banner for each access state. */

const base: AccessState = {
  mode: "cloud",
  level: "full",
  state: "active",
  graceEndsAt: null,
  viewer: "owner",
  ownerName: null,
};

function render(access: Partial<AccessState>) {
  return renderToStaticMarkup(
    <I18nProvider i18n={englishI18n}>
      <AccessBannerView
        access={{ ...base, ...access }}
        billingLink={<a href="/settings/billing">Plan & billing</a>}
      />
    </I18nProvider>,
  );
}

describe("AccessBannerView", () => {
  test("nothing on self-host, or with full access", () => {
    expect(render({ mode: "self-hosted", level: "full", state: null })).toBe("");
    expect(render({ state: "trialing" })).toBe("");
    expect(render({ state: "active" })).toBe("");
  });

  test("ended, owner: what still works, and a link to Plan & billing", () => {
    const html = render({ level: "read_only", state: "ended" });
    expect(html).toInclude("Your OpenValens Cloud access has ended");
    expect(html).toInclude("read, export or delete them");
    expect(html).toInclude('href="/settings/billing"');
  });

  test("ended, member: a neutral note naming the owner's plan, no link", () => {
    const html = render({
      level: "read_only",
      state: "canceled",
      viewer: "member",
      ownerName: "Ana",
    });
    expect(html).toInclude("comes from Ana’s plan");
    expect(html).not.toInclude("/settings/billing");
  });

  test("payment grace: the owner sees the date; members see nothing", () => {
    const html = render({ state: "past_due", graceEndsAt: "2026-11-17T12:00:00.000Z" });
    expect(html).toInclude("by November 17, 2026");
    expect(html).toInclude('href="/settings/billing"');
    expect(render({ state: "past_due", viewer: "member" })).toBe("");
  });
});
