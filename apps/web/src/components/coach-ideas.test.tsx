import "@/testing/varlock-test-setup";
import { describe, expect, test } from "bun:test";
import { I18nProvider } from "@lingui/react";
import { englishI18n } from "@openvalens/i18n/testing";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CoachComposer, CoachIdeas } from "./coach-ideas";

function render(node: ReactNode): string {
  return renderToStaticMarkup(<I18nProvider i18n={englishI18n}>{node}</I18nProvider>);
}

const GROUPS = [
  {
    subject: "sleep" as const,
    ideas: [
      { key: "a", text: "Why is my sleep 1h 19m above my usual this week?" },
      { key: "b", text: "How has my sleep been this week?" },
    ],
  },
  { subject: "food" as const, ideas: [{ key: "c", text: "What could I eat tonight?" }] },
  {
    subject: "training" as const,
    ideas: [
      { key: "d", text: "Plan this week's workouts around a readiness of 62" },
      { key: "e", text: "How active have I been?" },
    ],
  },
];

describe("the coach's empty state (#coach-4)", () => {
  test("groups ideas by subject with the module icons; each idea is a plain button", () => {
    const html = render(<CoachIdeas groups={GROUPS} onPick={() => {}} />);
    expect(html).toContain("Ideas to ask");
    expect(html).toContain("lucide-moon");
    expect(html).toContain("lucide-utensils-crossed");
    expect(html).toContain("lucide-footprints");
    // A tap fills the box: never a submit button.
    expect(html.match(/<button type="button"/g)?.length).toBeGreaterThanOrEqual(5);
    expect(html).not.toContain('type="submit"');
    // A phone shows the first four, then "More ideas".
    expect(html).toContain("max-sm:hidden");
    expect(html).toContain("More ideas");
  });

  test("shows nothing without ideas", () => {
    expect(render(<CoachIdeas groups={[]} onPick={() => {}} />)).toBe("");
  });

  test("the message box sends only what the person wrote", () => {
    const empty = render(
      <CoachComposer value="" onChange={() => {}} onSubmit={() => {}} pending={false} />,
    );
    expect(empty).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
    const filled = render(
      <CoachComposer value="My question" onChange={() => {}} onSubmit={() => {}} pending={false} />,
    );
    expect(filled).toContain("My question");
    expect(filled).not.toMatch(/type="submit"[^>]*disabled=""/);
  });
});
