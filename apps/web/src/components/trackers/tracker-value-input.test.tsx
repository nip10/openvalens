import { describe, expect, test } from "bun:test";
import { I18nProvider } from "@lingui/react";
import { englishI18n } from "@openvalens/i18n/testing";
import { renderToStaticMarkup } from "react-dom/server";

import { TrackerValueInput } from "./tracker-value-input";

const render = (props: Partial<Parameters<typeof TrackerValueInput>[0]>) =>
  renderToStaticMarkup(
    <I18nProvider i18n={englishI18n}>
      <TrackerValueInput
        id="mood"
        type="scale"
        unit={null}
        template="mood"
        text=""
        onText={() => {}}
        {...props}
      />
    </I18nProvider>,
  );

describe("tracker rating buttons", () => {
  test("the scale ends sit under 1 and 5 as opposites", () => {
    const html = render({});
    expect(html).toContain("Very low");
    expect(html).toContain("Very good");
    expect(html).not.toContain("Your own rating");
  });

  test("a custom scale still names both ends", () => {
    const html = render({ template: null });
    expect(html).toContain(">Low<");
    expect(html).toContain(">High<");
  });

  test("in the form the ratings are radios", () => {
    const html = render({});
    expect(html).toContain('role="radiogroup"');
    expect((html.match(/role="radio"/g) ?? []).length).toBe(5);
  });

  test("on a card a tap logs, so they are plain buttons", () => {
    const html = render({ instant: true });
    expect(html).not.toContain('role="radio"');
    expect(html).toContain('role="group"');
    expect((html.match(/aria-pressed="false"/g) ?? []).length).toBe(5);
  });
});
