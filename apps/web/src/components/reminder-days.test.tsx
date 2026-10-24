import "@/testing/varlock-test-setup";
import { describe, expect, test } from "bun:test";
import { I18nProvider } from "@lingui/react";
import { REMINDER_DAYS_COPY } from "@openvalens/api/presenters/supplements";
import { englishI18n, inEnglish } from "@openvalens/i18n/testing";
import type { ReactElement } from "react";
import { renderToStaticMarkup as renderMarkup } from "react-dom/server";

import { ReminderDaysField, ReminderDaysRow, WeekdayPicker } from "./reminder-days";

function renderToStaticMarkup(node: ReactElement): string {
  return renderMarkup(<I18nProvider i18n={englishI18n}>{node}</I18nProvider>);
}

describe("reminder days (web)", () => {
  test("the picker lists Monday to Sunday and marks the chosen days", () => {
    const html = renderToStaticMarkup(<WeekdayPicker value={[1, 4]} onChange={() => {}} />);
    const labels = [...html.matchAll(/aria-label="([A-Za-z]+day)"/g)].map((match) => match[1]);
    expect(labels).toEqual([
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ]);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(2);
    expect(html).toContain('aria-pressed="true" aria-label="Monday"');
    expect(html).toContain('aria-pressed="true" aria-label="Thursday"');
  });

  test("a weekly item shows its days, or says reminders need days", () => {
    const withDays = renderToStaticMarkup(
      <ReminderDaysRow
        item={{ frequency: "weekly", daysOfWeek: [1, 4] }}
        pending={false}
        onSave={() => {}}
      />,
    );
    expect(withDays).toContain("Weekly · Mon, Thu");
    expect(withDays).not.toContain(inEnglish(REMINDER_DAYS_COPY.needed));

    const withoutDays = renderToStaticMarkup(
      <ReminderDaysRow
        item={{ frequency: "weekly", daysOfWeek: null }}
        pending={false}
        onSave={() => {}}
      />,
    );
    expect(withoutDays).toContain(inEnglish(REMINDER_DAYS_COPY.needed));
    expect(withoutDays).toContain(inEnglish(REMINDER_DAYS_COPY.edit));
  });

  test("training days explain that the member picks the days they train", () => {
    const html = renderToStaticMarkup(
      <ReminderDaysField frequency="training_days" value={[]} onChange={() => {}} />,
    );
    expect(html).toContain(inEnglish(REMINDER_DAYS_COPY.trainingNote));
  });
});
