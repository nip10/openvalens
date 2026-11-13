import { describe, expect, test } from "bun:test";
import { I18nProvider } from "@lingui/react";
import type { WhatsNewCard } from "@openvalens/api/whats-new";
import { englishI18n } from "@openvalens/i18n/testing";
import { renderToStaticMarkup } from "react-dom/server";

import { WhatsNewCardView } from "./whats-new-card-view";

const CARD: WhatsNewCard = {
  version: "1.2.3",
  shortVersion: "1.2",
  date: "2026-11-20",
  locale: "en",
  highlights: [
    { kind: "list", items: ["Goals. Set private goals.", "Faster sync."] },
    { kind: "paragraph", text: "More to come." },
  ],
  changelogUrl: "https://openvalens.com/changelog#v1.2.3",
};

function render(props: Partial<Parameters<typeof WhatsNewCardView>[0]> = {}) {
  return renderToStaticMarkup(
    <I18nProvider i18n={englishI18n}>
      <WhatsNewCardView
        card={CARD}
        dismissing={false}
        failed={false}
        onDismiss={() => {}}
        {...props}
      />
    </I18nProvider>,
  );
}

describe("WhatsNewCardView (#446)", () => {
  test("titles the card with X.Y and lists the Highlights in the notes' language", () => {
    const html = render();
    expect(html).toContain('aria-labelledby="whats-new-title"');
    expect(html).toContain("What&#x27;s new in 1.2");
    expect(html).toContain("<li>Goals. Set private goals.</li>");
    expect(html).toContain("<li>Faster sync.</li>");
    expect(html).toContain("<p>More to come.</p>");
    expect(html).toContain('lang="en"');
  });

  test("links to the full changelog and offers Dismiss", () => {
    const html = render();
    expect(html).toContain('href="https://openvalens.com/changelog#v1.2.3"');
    expect(html).toContain("Dismiss");
    expect(html).not.toContain('role="alert"');
  });

  test("disables Dismiss while saving and reports a failure", () => {
    const html = render({ dismissing: true, failed: true });
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Dismiss<\/button>/);
    expect(html).toContain('role="alert"');
  });
});
