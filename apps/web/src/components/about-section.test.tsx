import { describe, expect, test } from "bun:test";
import { I18nProvider } from "@lingui/react";
import { englishI18n } from "@openvalens/i18n/testing";
import { renderToStaticMarkup } from "react-dom/server";

import { AboutCard } from "./about-section";

function render(sourceCodeUrl: string | null): string {
  return renderToStaticMarkup(
    <I18nProvider i18n={englishI18n}>
      <AboutCard sourceCodeUrl={sourceCodeUrl} />
    </I18nProvider>,
  );
}

describe("AboutCard (Issue #56)", () => {
  test("states the licence and links the server's source", () => {
    const html = render("https://git.example.org/me/fork");
    expect(html).toContain("GNU Affero General Public License");
    expect(html).toContain('href="https://git.example.org/me/fork"');
    expect(html).toContain("Source code for this server");
  });

  test("omits the link until the server reports it", () => {
    expect(render(null)).not.toContain("href=");
  });
});
