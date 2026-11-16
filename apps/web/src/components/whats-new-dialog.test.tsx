import "@/testing/varlock-test-setup";
import { describe, expect, test } from "bun:test";
import { I18nProvider } from "@lingui/react";
import { englishI18n } from "@openvalens/i18n/testing";
import { renderToStaticMarkup } from "react-dom/server";

import { ChangelogView, splitLead } from "./whats-new-changelog";
import { shouldOfferWhatsNew } from "@/utils/whats-new";

const CARD = { date: "2026-11-14", headlines: ["Custom trackers", "Goals on your trackers"] };

describe("the What's new dialog (#dashboard-6)", () => {
  test("opens for accounts older than the release, with headlines for the web", () => {
    expect(shouldOfferWhatsNew(CARD, "2026-10-01T09:00:00Z")).toBe(true);
    expect(shouldOfferWhatsNew(CARD, new Date("2026-11-13T23:00:00Z"))).toBe(true);
    // Unknown age: offer it.
    expect(shouldOfferWhatsNew(CARD, null)).toBe(true);
  });

  test("stays closed for a new account, without headlines, or without a card", () => {
    expect(shouldOfferWhatsNew(CARD, "2026-11-14T08:00:00Z")).toBe(false);
    expect(shouldOfferWhatsNew(CARD, "2026-11-20T08:00:00Z")).toBe(false);
    expect(shouldOfferWhatsNew({ ...CARD, headlines: [] }, "2026-01-01")).toBe(false);
    expect(shouldOfferWhatsNew(null, "2026-01-01")).toBe(false);
  });
});

describe("Settings › What's new", () => {
  test("lists every release newest first, the lead of each item in bold", () => {
    const html = renderToStaticMarkup(
      <I18nProvider i18n={englishI18n}>
        <ChangelogView
          currentVersion="1.2.1"
          entries={[
            {
              version: "1.2.1",
              date: "2026-11-14",
              locale: "en",
              highlights: [
                { kind: "list", items: ["Custom trackers. Keep a record of anything."] },
              ],
            },
            {
              version: "1.2.0",
              date: "2026-11-01",
              locale: "en",
              highlights: [{ kind: "paragraph", text: "Fixes." }],
            },
          ]}
        />
      </I18nProvider>,
    );
    expect(html.indexOf("1.2.1")).toBeLessThan(html.indexOf("1.2.0"));
    expect(html).toContain("<strong");
    expect(html).toContain("Custom trackers.</strong> Keep a record of anything.");
    expect(html).toContain("This version");
    expect(html).toContain("Nov 14, 2026");
  });

  test("splits a short lead from the rest, and leaves plain items whole", () => {
    expect(splitLead("Goals on your trackers. Set a goal.")).toEqual({
      lead: "Goals on your trackers.",
      rest: "Set a goal.",
    });
    expect(splitLead("Your record in one place: a dashboard")).toEqual({
      lead: "Your record in one place:",
      rest: "a dashboard",
    });
    expect(splitLead("No lead here")).toEqual({ lead: null, rest: "No lead here" });
  });
});
