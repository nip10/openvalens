import "@/testing/varlock-test-setup";
import { describe, expect, mock, test } from "bun:test";
import { I18nProvider } from "@lingui/react";
import { englishI18n } from "@openvalens/i18n/testing";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => options,
  Link: ({ children, to, className }: { children: ReactNode; to: string; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
  useNavigate: () => () => {},
}));

const { SectionTabsView } = await import("./section-tabs");
const { sectionTabs } = await import("./nav-links");

function render(node: ReactNode): string {
  return renderToStaticMarkup(<I18nProvider i18n={englishI18n}>{node}</I18nProvider>);
}

describe("section tabs (#app-shell-2)", () => {
  test("Body, Body map and Private measurements as links in one nav", () => {
    const html = render(<SectionTabsView links={sectionTabs("/body")} enabled={() => true} />);
    expect(html).toContain('aria-label="Sections"');
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
    expect(hrefs).toEqual(["/body", "/body-map", "/private-measurements"]);
    expect(html).toContain(">Body map<");
    expect(html).toContain(">Private measurements<");
  });

  test("the food screens follow the meal diary", () => {
    const html = render(<SectionTabsView links={sectionTabs("/nutrition")} enabled={() => true} />);
    for (const name of ["Meal diary", "My foods", "New recipe"])
      expect(html).toContain(`>${name}<`);
    // Micronutrients are part of the diary's All nutrients (micronutrients#4).
    expect(html).not.toContain(">Micronutrients<");
  });

  test("a hidden module's tabs drop out, and one tab left renders nothing", () => {
    const html = render(
      <SectionTabsView links={sectionTabs("/body")} enabled={(module) => module !== "body"} />,
    );
    expect(html).toBe("");
  });
});
