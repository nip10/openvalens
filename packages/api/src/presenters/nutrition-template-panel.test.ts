import { describe, expect, test } from "bun:test";
import { inEnglish } from "@openvalens/i18n/testing";

import { TEMPLATE_PANEL_COPY } from "./nutrition-template-panel";

describe("nutrition template panel copy", () => {
  test("provides translated success and undo notices", () => {
    expect(inEnglish(TEMPLATE_PANEL_COPY.logged)).toBe("Saved meal added to your diary.");
    expect(inEnglish(TEMPLATE_PANEL_COPY.undo)).toBe("Undo");
    expect(inEnglish(TEMPLATE_PANEL_COPY.undoQueued)).toBe("Undo added to the sync queue.");
  });
});
