import { describe, expect, test } from "bun:test";
import { setupI18n } from "@lingui/core";
import { compileMessage } from "@lingui/message-utils/compileMessage";

import { messagesFor, reviewStatusOf } from "./catalogs";
import { LOCALES, resolveLocale } from "./locales";
import { messages as en } from "./locales/en/messages";
import { messages as ptPT } from "./locales/pt-PT/messages";

const c = (message: string) => compileMessage(message);
const catalogs = {
  en: { hello: c("Hello"), dose: c("Take {n} mg"), only: c("Only in English") },
  "pt-PT": { hello: c("Olá"), dose: c("Tomar {n} mg") },
};
const safety = new Set(["dose"]);

describe("messagesFor (#67)", () => {
  test("a safety-tagged string in an unreviewed locale renders in English", () => {
    const messages = messagesFor(
      "pt-PT",
      catalogs as never,
      { "pt-PT": { status: "community", approvedSafetyIds: [] } },
      safety,
    );
    const i18n = setupI18n();
    i18n.loadAndActivate({ locale: "pt-PT", messages });
    expect(i18n._("hello")).toBe("Olá");
    expect(i18n._("dose", { n: 5 })).toBe("Take 5 mg");
  });

  test("an approved safety string, or a reviewed locale, shows the translation", () => {
    const approved = messagesFor(
      "pt-PT",
      catalogs as never,
      { "pt-PT": { status: "community", approvedSafetyIds: ["dose"] } },
      safety,
    );
    expect(approved.dose).toEqual(c("Tomar {n} mg"));
    const reviewed = messagesFor(
      "pt-PT",
      catalogs as never,
      { "pt-PT": { status: "reviewed", approvedSafetyIds: [] } },
      safety,
    );
    expect(reviewed.dose).toEqual(c("Tomar {n} mg"));
  });

  test("a message missing from a translation falls back to English, never an id", () => {
    const messages = messagesFor("pt-PT", catalogs as never, {}, safety);
    expect(messages.only).toEqual(c("Only in English"));
  });

  test("shipped catalogs cover the same messages in every locale", () => {
    expect(Object.keys(ptPT).sort()).toEqual(Object.keys(en).sort());
    for (const locale of LOCALES)
      expect(Object.keys(messagesFor(locale)).length).toBe(Object.keys(en).length);
  });

  test("pt-PT is reviewed; English is the source", () => {
    expect(reviewStatusOf("en")).toBe("reviewed");
    expect(reviewStatusOf("pt-PT")).toBe("reviewed");
  });
});

describe("resolveLocale", () => {
  test("prefers a saved choice, maps any Portuguese to pt-PT and defaults to English", () => {
    expect(resolveLocale(["pt-PT", "en-GB"])).toBe("pt-PT");
    expect(resolveLocale([null, "pt-BR"])).toBe("pt-PT");
    expect(resolveLocale(["en-US"])).toBe("en");
    expect(resolveLocale(["de-DE", "fr"])).toBe("en");
    expect(resolveLocale(["xx", "pt_PT"])).toBe("pt-PT");
    expect(resolveLocale([])).toBe("en");
  });
});
