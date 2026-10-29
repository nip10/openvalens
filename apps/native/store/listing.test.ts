/**
 * Store listing guards (#307): every field fits the store's limit, the copy
 * keeps the landing site's wording rules (in en and pt-PT), carries the
 * intended-purpose statement and the AGPL source notice, and names no price
 * or purchase — the app sells nothing (App Store guideline 3.1.3(f)).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ALLOWED_PHRASES, BANNED_TERMS } from "../../site/scripts/wording-rules";
import storeConfig from "../store.config.json";

const LOCALES = ["en-US", "pt-PT"] as const;
type Locale = (typeof LOCALES)[number];

/** Portuguese counterparts of the banned terms in `wording-rules.ts`. */
const BANNED_TERMS_PT = [
  /diagnóstic|diagnostic/i,
  /\bdetet|\bdetect/i,
  /\brastre(ar|io)\b/i,
  /\bprev(er|ê|isão|isões)\b/i,
  /\btrat(ar|amento)/i,
  /\bcura(r)?\b/i,
  /aviso precoce/i,
  /(grau|qualidade) (clínic|médic)/i,
  /clinicamente (validad|comprovad)/i,
  /\banormal/i,
  /\bem risco\b/i,
  /(pontuação|índice) de risco/i,
  /idade biológica/i,
  /médico (de|com) IA/i,
  /aconselhamento médico/i,
  /melhora(r)? a sua saúde/i,
  /longevidade/i,
  /otimiz/i,
  /\breverter/i,
  /nunca partilhamos/i,
];
const ALLOWED_PHRASES_PT = [/Não é aconselhamento médico e pode estar errado\./g];

/** Prices and calls to purchase; the store apps have no purchase flow. */
const PURCHASE_TERMS = [
  /€|\$|£/,
  /\bprice|\bpricing/i,
  /subscri/i,
  /free trial|\btrial\b/i,
  /\bbuy\b|purchase/i,
  /preço|assinatura|subscrev|teste gratuito|período experimental|comprar|compra/i,
];

const PURPOSE = {
  "en-US": ["Intended purpose", "OpenValens is a personal record-keeping", "about your health."],
  "pt-PT": [
    "Finalidade prevista",
    "O OpenValens é uma aplicação de registo pessoal",
    "sobre a sua saúde.",
  ],
} as const;

const SOURCE_URL = "https://github.com/nip10/openvalens";

function play(locale: Locale, field: string): string {
  return readFileSync(join(import.meta.dir, "play", locale, `${field}.txt`), "utf8").replace(
    /\n$/,
    "",
  );
}

function apple(locale: Locale) {
  return storeConfig.apple.info[locale];
}

/** Every listing text of one locale, as `[label, text]`. */
function texts(locale: Locale): [string, string][] {
  const a = apple(locale);
  return [
    ["apple.title", a.title],
    ["apple.subtitle", a.subtitle],
    ["apple.promoText", a.promoText],
    ["apple.keywords", a.keywords.join(",")],
    ["apple.description", a.description],
    ["apple.releaseNotes", a.releaseNotes],
    ["play.title", play(locale, "title")],
    ["play.short_description", play(locale, "short_description")],
    ["play.full_description", play(locale, "full_description")],
    ["play.changelog", play(locale, "changelogs/default")],
  ];
}

function withoutPurpose(locale: Locale, text: string): string {
  const [, start, end] = PURPOSE[locale];
  const from = text.indexOf(start);
  if (from === -1) return text;
  const to = text.indexOf(end, from) + end.length;
  return text.slice(0, from) + text.slice(to);
}

for (const locale of LOCALES) {
  describe(`store listing ${locale}`, () => {
    test("fits the App Store limits", () => {
      const a = apple(locale);
      expect(a.title.length).toBeLessThanOrEqual(30);
      expect(a.subtitle.length).toBeLessThanOrEqual(30);
      expect(a.promoText.length).toBeLessThanOrEqual(170);
      expect(a.keywords.join(",").length).toBeLessThanOrEqual(100);
      expect(a.description.length).toBeLessThanOrEqual(4000);
      expect(a.releaseNotes.length).toBeLessThanOrEqual(4000);
    });

    test("fits the Google Play limits", () => {
      expect(play(locale, "title").length).toBeLessThanOrEqual(30);
      expect(play(locale, "short_description").length).toBeLessThanOrEqual(80);
      expect(play(locale, "full_description").length).toBeLessThanOrEqual(4000);
      expect(play(locale, "changelogs/default").length).toBeLessThanOrEqual(500);
    });

    test("uses none of the banned terms outside the intended-purpose statement", () => {
      const banned = locale === "en-US" ? BANNED_TERMS : [...BANNED_TERMS, ...BANNED_TERMS_PT];
      const allowed = locale === "en-US" ? ALLOWED_PHRASES : ALLOWED_PHRASES_PT;
      for (const [label, text] of texts(locale)) {
        let scanned = withoutPurpose(locale, text);
        for (const phrase of allowed) scanned = scanned.replace(phrase, " ");
        expect({ label, hits: banned.filter((term) => term.test(scanned)).map(String) }).toEqual({
          label,
          hits: [],
        });
      }
    });

    test("names no price and no purchase", () => {
      for (const [label, text] of texts(locale)) {
        expect({
          label,
          hits: PURCHASE_TERMS.filter((term) => term.test(text)).map(String),
        }).toEqual({
          label,
          hits: [],
        });
      }
    });

    test("full descriptions carry the intended purpose and the source notice", () => {
      for (const description of [apple(locale).description, play(locale, "full_description")]) {
        const [heading, start, end] = PURPOSE[locale];
        expect(description.toLowerCase()).toContain(heading.toLowerCase());
        expect(description).toContain(start);
        expect(description).toContain(end);
        expect(description).toContain(SOURCE_URL);
      }
    });

    test("each store names its own health platform", () => {
      expect(apple(locale).description).toContain("Apple Health");
      expect(apple(locale).description).not.toContain("Health Connect");
      expect(play(locale, "full_description")).toContain("Health Connect");
      expect(play(locale, "full_description")).not.toContain("Apple Health");
    });
  });
}
