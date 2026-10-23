import { describe, expect, test } from "bun:test";
import { generateMessageId } from "@lingui/message-utils/generateMessageId";

import { safetyIds } from "./i18n-safety-ids";

describe("i18n safety ids (#67)", () => {
  test("collects ids of messages commented `safety`, including context and explicit ids", () => {
    const po = `msgid ""
msgstr ""

#. safety
#: apps/web/src/a.tsx
msgid "Take with food"
msgstr "Take with food"

#: apps/web/src/b.tsx
msgid "Settings"
msgstr "Settings"

#. safety
msgctxt "unit"
msgid "mg"
msgstr "mg"

#. safety
#. js-lingui-explicit-id
msgid "consent.text"
msgstr "I agree"

#. safety
msgid ""
"A long "
"message"
msgstr ""
`;
    expect(safetyIds(po)).toEqual(
      [
        generateMessageId("Take with food", ""),
        generateMessageId("mg", "unit"),
        "consent.text",
        generateMessageId("A long message", ""),
      ].sort(),
    );
  });
});
