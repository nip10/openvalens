import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { SETTINGS_SELECT } from "./settings-rows";

describe("settings select styling", () => {
  test("keeps the native select while reserving an inset for the custom chevron", () => {
    const markup = renderToStaticMarkup(
      <select aria-label="Language" className={SETTINGS_SELECT} defaultValue="en">
        <option value="en">English</option>
      </select>,
    );
    expect(markup).toContain("<select");
    expect(markup).toContain("settings-select");
    expect(SETTINGS_SELECT).toContain("pl-3");
    expect(SETTINGS_SELECT).not.toContain("px-3");
    expect(SETTINGS_SELECT).not.toContain("pr-");
    expect(SETTINGS_SELECT).toContain("max-w-full");
  });
});
