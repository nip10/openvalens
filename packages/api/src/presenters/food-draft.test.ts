import { expect, test } from "bun:test";
import { englishI18n } from "@openvalens/i18n/testing";
import { foodDraftExampleText } from "./food-draft";

test("recent-meal text keeps portions explicit and respects either side's number redaction", () => {
  const example = {
    id: 1,
    items: [
      { name: "Synthetic oats", amount: 40, unit: "g" as const },
      { name: "Synthetic milk", amount: 150, unit: "ml" as const },
    ],
  };
  expect(foodDraftExampleText(example, false, englishI18n)).toBe(
    "40 g Synthetic oats, 150 ml Synthetic milk",
  );
  expect(foodDraftExampleText(example, true, englishI18n)).toBe("Synthetic oats, Synthetic milk");
  expect(
    foodDraftExampleText(
      { ...example, items: [{ ...example.items[0]!, amount: null }] },
      false,
      englishI18n,
    ),
  ).toBe("Synthetic oats");
});
