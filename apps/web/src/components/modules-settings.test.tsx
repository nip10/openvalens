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
    expect(html.match(/aria-checked="false"/g)?.length).toBe(8);
  });

  test("the switch alone shows the state: no On or Hidden pill", () => {
    const html = render(
      <ModulesSettingsForm
        snapshot={{ enabledModules: ["sleep"] }}
        saving={null}
        message={null}
        onToggle={noop}
      />,
    );
    expect(html).not.toContain(">On<");
    expect(html).not.toContain(">Hidden<");
  });

  test("an on Coach says when AI is off and links to the AI settings", () => {
    const html = render(
      <ModulesSettingsForm
        snapshot={{ enabledModules: null }}
        saving={null}
        message={null}
        onToggle={noop}
        coachAiOff="workspace"
      />,
    );
    expect(html).toContain("AI is off for this workspace.");
    expect(html).toContain('href="/settings"');
    const quiet = render(
      <ModulesSettingsForm
        snapshot={{ enabledModules: null }}
        saving={null}
        message={null}
        onToggle={noop}
      />,
    );
    expect(quiet).not.toContain("AI is off");
  });

  test("#settings-modules-3: cards sit under the sidebar's headings and say what leaves the menu", () => {
    const html = render(
      <ModulesSettingsForm
        snapshot={{ enabledModules: null }}
        saving={null}
        message={null}
        onToggle={noop}
      />,
    );
    const headings = [...html.matchAll(/<h2 id="modules-group-\d+"[^>]*>([^<]+)<\/h2>/g)].map(
      (match) => match[1],
    );
    expect(headings).toEqual(["Overview", "Body", "Daily", "Care"]);
    // Sleep is listed under Body, after the Body heading and before Daily.
    const body = html.indexOf(">Body</h2>");
    const daily = html.indexOf(">Daily</h2>");
    expect(html.indexOf('for="module-sleep"')).toBeGreaterThan(body);
    expect(html.indexOf('for="module-sleep"')).toBeLessThan(daily);
    expect(html).toMatch(/data-testid="module-sleep-menu"[^>]*>Hides Sleep</);
    expect(html).toMatch(/data-testid="module-labs-menu"[^>]*>Hides Labs and Clinical export</);
    expect(html).toMatch(/data-testid="module-food-menu"[^>]*>Hides Meal diary/);
  });

  test("#settings-modules-4: the focus answer marks its modules as recommended", () => {
    const html = render(
      <ModulesSettingsForm
        snapshot={{
          enabledModules: null,
          focus: { state: "recorded", value: ["sleep_recovery"] },
        }}
        saving={null}
        message={null}
        onToggle={noop}
      />,
    );
    // sleep_recovery picks Sleep and Heart & vitals.
    expect(html.match(/>Recommended</g)?.length).toBe(2);
    const sleepCard = html.slice(
      html.indexOf('for="module-sleep"'),
      html.indexOf('id="module-sleep"'),
    );
    expect(sleepCard).toContain(">Recommended<");
    expect(html).toContain("Recommended modules match what you told us in");

    const unanswered = render(
      <ModulesSettingsForm
        snapshot={{ enabledModules: null, focus: { state: "unknown" } }}
        saving={null}
        message={null}
        onToggle={noop}
      />,
    );
    expect(unanswered).not.toContain(">Recommended<");
    expect(unanswered).toContain("and we&#x27;ll mark the modules that fit.");
  });
});

describe("hidden module note", () => {
  test("says the module is hidden and links to Settings › Modules", () => {
    const html = render(<ModuleHiddenNoteView />);
    expect(html).toContain("This module is hidden. Turn it on in Settings › Modules.");
    expect(html).toContain('href="/settings/modules"');
  });
});
