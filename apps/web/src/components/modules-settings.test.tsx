import "@/testing/varlock-test-setup";
import { describe, expect, mock, test } from "bun:test";
import { I18nProvider } from "@lingui/react";
import { englishI18n } from "@openvalens/i18n/testing";
import type { ReactNode } from "react";
import { renderToStaticMarkup as renderMarkup } from "react-dom/server";

mock.module("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => options,
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
  useNavigate: () => () => {},
}));

const { ModulesSettingsForm } = await import("./modules-settings");
const { ModuleHiddenNoteView } = await import("./module-hidden-note");

function render(node: ReactNode): string {
  return renderMarkup(<I18nProvider i18n={englishI18n}>{node}</I18nProvider>);
}

const noop = () => {};

describe("Settings › Modules", () => {
  test("every module has a card with a labelled switch and the keep-data note", () => {
    const html = render(
      <ModulesSettingsForm
        snapshot={{ enabledModules: null }}
        saving={null}
        message={null}
        onToggle={noop}
      />,
    );
    for (const label of [
      "Sleep",
      "Activity &amp; workouts",
      "Heart &amp; vitals",
      "Body &amp; weight",
      "Food &amp; water",
      "Supplements &amp; medications",
      "Labs &amp; clinical",
      "Cycle",
      "Coach (AI)",
      "Preventive care",
    ])
      expect(html).toContain(label);
    expect(html).toContain("Hiding a module keeps its data.");
    expect(html.match(/role="switch"/g)?.length).toBe(10);
    // Not chosen yet: every switch is on.
    expect(html.match(/aria-checked="true"/g)?.length).toBe(10);
  });

  test("a chosen list shows only those modules on", () => {
    const html = render(
      <ModulesSettingsForm
        snapshot={{ enabledModules: ["sleep", "food"] }}
        saving={null}
        message={null}
        onToggle={noop}
      />,
    );
    expect(html.match(/aria-checked="true"/g)?.length).toBe(2);
    expect(html.match(/>Hidden</g)?.length).toBe(8);
  });
});

describe("hidden module note", () => {
  test("says the module is hidden and links to Settings › Modules", () => {
    const html = render(<ModuleHiddenNoteView />);
    expect(html).toContain("This module is hidden. Turn it on in Settings › Modules.");
    expect(html).toContain('href="/settings/modules"');
  });
});
