import { describe, expect, mock, test } from "bun:test";
import { I18nProvider } from "@lingui/react";
import type { CycleStrip } from "@openvalens/api/presenters/cycle";
import { englishI18n } from "@openvalens/i18n/testing";
import { renderToStaticMarkup } from "react-dom/server";

// Loading the real `orpc` reads the server URL from `@/env`; the root test run
// has no web env unless an earlier file set one up.
mock.module("@/env", () => ({ ENV: { VITE_SERVER_URL: "https://health.example/" } }));

const { DayStrip } = await import("./cycle");

const strip: CycleStrip = {
  startDate: "2026-11-01",
  lengthDays: null,
  current: true,
  days: Array.from({ length: 6 }, (_, index) => ({
    date: `2026-11-0${index + 1}`,
    day: index + 1,
    period: index < 2 ? "medium" : null,
    estimated: false,
    today: index === 3,
  })),
};

function render(onPick?: (date: string) => void) {
  return renderToStaticMarkup(
    <I18nProvider i18n={englishI18n}>
      <DayStrip
        strip={strip}
        columns={28}
        label="Current cycle"
        today="2026-11-04"
        onPick={onPick}
      />
    </I18nProvider>,
  );
}

describe("cycle day strip", () => {
  test("is one tab stop: a button per day up to today, only today focusable", () => {
    const html = render(() => {});
    expect(html).toInclude('role="group"');
    expect(html.match(/<button/g)).toHaveLength(4);
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html).toMatch(
      /<button[^>]*tabindex="0"[^>]*aria-label="Day 4, [^"]*Log a period from this day\."/,
    );
    expect(html.match(/tabindex="-1"/g)).toHaveLength(3);
  });

  test("without a picker it stays a single image", () => {
    const html = render();
    expect(html).toInclude('role="img"');
    expect(html).not.toInclude("<button");
  });
});
