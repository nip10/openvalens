import { describe, expect, test } from "bun:test";

import { createAppI18n } from "@openvalens/i18n";

import { ambiguousDecimalMessage } from "./decimal-input";

describe("ambiguousDecimalMessage (#455)", () => {
  test("names both readings and asks for one", () => {
    const message = ambiguousDecimalMessage("2,000", "en");
    expect(message).not.toBeNull();
    expect(createAppI18n("en")._(message!)).toBe(
      "“2,000” could mean 2000 or 2. Type 2000 or 2, whichever you mean.",
    );
    expect(createAppI18n("pt-PT")._(ambiguousDecimalMessage("1.250", "pt-PT")!)).toBe(
      "“1.250” pode ser 1250 ou 1,25. Escreva 1250 ou 1,25, conforme o que pretende.",
    );
  });

  test("is null when the text parses or is wrong for another reason", () => {
    expect(ambiguousDecimalMessage("1.250", "en")).toBeNull();
    expect(ambiguousDecimalMessage("1,250", "pt-PT")).toBeNull();
    expect(ambiguousDecimalMessage("abc", "en")).toBeNull();
    expect(ambiguousDecimalMessage("1,234.5", "en")).toBeNull();
  });
});
