import { describe, expect, test } from "bun:test";
import { createAppI18n } from "@openvalens/i18n";
import { englishI18n, inEnglish } from "@openvalens/i18n/testing";
import { CATALOG_SOURCE_TERMS } from "@openvalens/nutrition/catalog/sources";
import {
  FOOD_SOURCES as DOMAIN_FOOD_SOURCES,
  isVariableMeasureBarcode as domainIsVariableMeasure,
} from "@openvalens/nutrition/food-search";
import { AMOUNT_UNITS, SERVING_SIZE_UNITS } from "@openvalens/nutrition/nutrients";
import { normalizeBarcode } from "@openvalens/nutrition/snapshot";

import { NUTRIENT_KEYS, type NutrientValues } from "../contracts/nutrition-diary";
import {
  FOOD_SOURCES,
  foodResult,
  type BarcodeLookup,
  type FoodResult,
} from "../contracts/nutrition-foods";
import {
  BARCODE_COPY,
  candidateFromChoice,
  candidateFromResult,
  describeBarcodeLookup,
  describeOfflineBarcode,
  formatFoodCandidateSummaryLine,
  isSearchable,
  isVariableMeasureBarcode,
  manualDraftFields,
  missingDataNote,
  parseBarcode,
  searchCandidates,
} from "./food-lookup";
import { parseQuickAdd } from "./nutrition-diary";

function nutrients(values: Partial<NutrientValues>): NutrientValues {
  return Object.fromEntries(
    NUTRIENT_KEYS.map((key) => [key, values[key] ?? null]),
  ) as NutrientValues;
}

const BASIS = {
  nutrientBasisAmount: 100,
  nutrientBasisUnit: "g" as const,
  servingSizeAmount: null,
  servingSizeUnit: null,
  servingLabel: null,
};

const OFF_NOTICE = CATALOG_SOURCE_TERMS.off.notice;

function result(overrides: Partial<FoodResult> = {}): FoodResult {
  return {
    id: "off:5901234123457",
    source: "off",
    sourceFoodId: "5901234123457",
    sourceVersion: "2026-05-01T00:00:00.000Z",
    origin: "catalog",
    dataType: null,
    name: "Synthetic granola bar",
    brand: "Synthetic Brand",
    barcode: "5901234123457",
    basis: BASIS,
    nutrients: nutrients({ energyKcal: 400, proteinG: 8 }),
    attribution: {
      source: "off",
      sourceName: "Open Food Facts",
      homepage: "https://world.openfoodfacts.org/",
      license: "ODbL-1.0",
      licenseUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
      notice: OFF_NOTICE,
    },
    release: null,
    overlay: null,
    ...overrides,
  };
}

function lookup(overrides: Partial<BarcodeLookup> = {}): BarcodeLookup {
  return {
    barcode: "5901234123457",
    status: "not_found",
    matches: [],
    live: { status: "off", reason: null, retryAfterSeconds: null },
    manualDraft: { barcode: "5901234123457", reason: "no_match" },
    ...overrides,
  };
}

describe("contract parity with @openvalens/nutrition", () => {
  test("food sources and units match the domain", () => {
    expect([...FOOD_SOURCES]).toEqual([...DOMAIN_FOOD_SOURCES]);
    const shape = foodResult.shape.basis.shape;
    expect(shape.nutrientBasisUnit.options).toEqual([...AMOUNT_UNITS]);
    expect(shape.servingSizeUnit.unwrap().options).toEqual([...SERVING_SIZE_UNITS]);
  });

  test("barcode parsing mirrors normalizeBarcode", () => {
    for (const raw of ["4006381333931", "4006-3813 33931", "12345678", "12345678901234"]) {
      const parsed = parseBarcode(raw);
      expect(parsed).toEqual({ ok: true, barcode: normalizeBarcode(raw) });
    }
    for (const raw of ["1234567", "123456789012345", "40063813339x1", "", "   "]) {
      expect(parseBarcode(raw)).toEqual({ ok: false, error: BARCODE_COPY.invalid });
      expect(() => normalizeBarcode(raw)).toThrow();
    }
  });

  test("variable-measure detection mirrors the domain", () => {
    for (const code of [
      "2012345678901",
      "0212345678901",
      "212345678901",
      "4006381333931",
      "5901234123457",
      "20123456",
      "02123456789012",
    ])
      expect(isVariableMeasureBarcode(code)).toBe(domainIsVariableMeasure(code));
  });
});

describe("candidates", () => {
  test("food row summary formats serving and 100 g/ml basis in English and Portuguese", () => {
    const candidate = candidateFromResult(
      result({
        basis: { ...BASIS, servingSizeAmount: 60, servingSizeUnit: "g", servingLabel: "bar" },
      }),
      "search",
    )!;
    expect(formatFoodCandidateSummaryLine(candidate, false, englishI18n)).toBe(
      "240 kcal · 4.8 g protein · per bar (60 g)",
    );
    const portuguese = createAppI18n("pt-PT");
    expect(formatFoodCandidateSummaryLine(candidate, false, portuguese)).toBe(
      "240 kcal · 4.8 g de proteína · por bar (60 g)",
    );
    expect(
      formatFoodCandidateSummaryLine(candidateFromResult(result(), "search")!, false, englishI18n),
    ).toBe("400 kcal · 8 g protein · per 100 g");
    expect(
      formatFoodCandidateSummaryLine(
        candidateFromResult(result({ basis: { ...BASIS, nutrientBasisUnit: "ml" } }), "search")!,
        false,
        englishI18n,
      ),
    ).toBe("400 kcal · 8 g protein · per 100 ml");
    expect(
      formatFoodCandidateSummaryLine(
        candidateFromResult(
          result({ basis: { ...BASIS, nutrientBasisAmount: 1.5, nutrientBasisUnit: "ml" } }),
          "search",
        )!,
        false,
        portuguese,
      ),
    ).toBe("400 kcal · 8 g de proteína · por 1,5 ml");
  });

  test("incompatible serving units fall back to the nutrient basis; unlabeled serving is named", () => {
    const candidate = candidateFromResult(
      result({
        basis: {
          ...BASIS,
          servingSizeAmount: 250,
          servingSizeUnit: "ml",
          servingLabel: null,
        },
      }),
      "search",
    )!;
    expect(formatFoodCandidateSummaryLine(candidate, false, englishI18n)).toBe(
      "400 kcal · 8 g protein · per 100 g",
    );
    const compatible = candidateFromResult(
      result({ basis: { ...BASIS, servingSizeAmount: 30, servingSizeUnit: "g" } }),
      "search",
    )!;
    expect(formatFoodCandidateSummaryLine(compatible, false, englishI18n)).toContain(
      "per serving (30 g)",
    );
  });

  test("both unknown values remain unknown and zero remains a real value", () => {
    const unknown = candidateFromResult(
      result({ nutrients: nutrients({ energyKcal: null, proteinG: null }) }),
      "search",
    )!;
    expect(formatFoodCandidateSummaryLine(unknown, false, englishI18n)).toBe(
      "Unknown · Unknown protein · per 100 g",
    );
    expect(formatFoodCandidateSummaryLine(unknown, false, createAppI18n("pt-PT"))).toBe(
      "Desconhecido · Desconhecido de proteína · por 100 g",
    );
    const zero = candidateFromResult(
      result({ nutrients: nutrients({ energyKcal: 0, proteinG: 0 }) }),
      "search",
    )!;
    expect(formatFoodCandidateSummaryLine(zero, false, englishI18n)).toBe(
      "0 kcal · 0 g protein · per 100 g",
    );
  });

  test("summary preserves unknown values and never converts them to zero", () => {
    const candidate = candidateFromResult(
      result({ nutrients: nutrients({ energyKcal: null, proteinG: 0 }) }),
      "search",
    )!;
    expect(formatFoodCandidateSummaryLine(candidate, false, englishI18n)).toBe(
      "Unknown · 0 g protein · per 100 g",
    );
    expect(formatFoodCandidateSummaryLine(candidate, false, createAppI18n("pt-PT"))).toContain(
      "Desconhecido",
    );
  });

  test("unknown number preference is hidden conservatively", () => {
    const candidate = candidateFromResult(result(), "search")!;
    expect(formatFoodCandidateSummaryLine(candidate, undefined, englishI18n)).toBe("Hidden");
    expect(formatFoodCandidateSummaryLine(candidate, true, englishI18n)).toBe("Hidden");
    expect(formatFoodCandidateSummaryLine(candidate, false, englishI18n)).toContain("400 kcal");
  });

  test("a catalog result keeps its source, attribution and unknown values", () => {
    const candidate = candidateFromResult(result(), "barcode");
    expect(candidate).toMatchObject({
      key: "off:5901234123457",
      ref: { kind: "catalog", id: "off:5901234123457" },
      method: "barcode",
      source: "off",
      attribution: OFF_NOTICE,
    });
    expect(inEnglish(candidate!.sourceLabel)).toBe("Open Food Facts");
    // Unknown values are listed, never filled in.
    expect(candidate!.missing.map(inEnglish)).toEqual(["Carbohydrate", "Fat", "Fibre"]);
    expect(candidate!.nutrientsPerBasis.fatG).toBeNull();
    expect(missingDataNote(candidate!, englishI18n)).toBe(
      "Not provided by the source: Carbohydrate, Fat, Fibre. Shown as unknown.",
    );
  });

  test("live results say so; nameless products cannot be logged as-is", () => {
    expect(inEnglish(candidateFromResult(result({ origin: "live" }), "barcode")!.sourceLabel)).toBe(
      "Open Food Facts (live lookup)",
    );
    expect(candidateFromResult(result({ name: null }), "barcode")).toBeNull();
  });

  test("a private food has no attribution and a complete food has no missing note", () => {
    const candidate = candidateFromResult(
      result({
        id: "custom:7",
        source: "custom",
        origin: "private",
        attribution: null,
        nutrients: nutrients({
          energyKcal: 1,
          proteinG: 0,
          carbohydrateG: 0,
          fatG: 0,
          fiberG: 0,
        }),
      }),
      "search",
    );
    expect(inEnglish(candidate!.sourceLabel)).toBe("My food");
    expect(candidate).toMatchObject({
      attribution: null,
      method: "search",
    });
    expect(missingDataNote(candidate!, englishI18n)).toBeNull();
  });

  test("saved foods become candidates with their own ref", () => {
    const candidate = candidateFromChoice({
      ref: { kind: "snapshot", snapshotId: 3 },
      source: "fdc",
      sourceQualifiedId: "fdc:1",
      attribution: "USDA notice",
      name: "Synthetic oats",
      brand: null,
      basis: BASIS,
      nutrientsPerBasis: nutrients({ energyKcal: 380 }),
      lastLoggedAt: null,
      lastAmount: null,
      lastUnit: null,
      lastSlot: null,
    });
    expect(candidate).toMatchObject({
      ref: { kind: "snapshot", snapshotId: 3 },
      method: "manual",
      attribution: "USDA notice",
    });
    expect(inEnglish(candidate.sourceLabel)).toBe("USDA FoodData Central");
  });

  test("search drops foods already listed and nameless products", () => {
    const list = searchCandidates(
      [
        result({ id: "custom:1", source: "custom" }),
        result({ name: null }),
        result({ id: "fdc:9" }),
      ],
      new Set(["custom:1"]),
    );
    expect(list.map((candidate) => candidate.key)).toEqual(["fdc:9"]);
    expect(list[0]!.method).toBe("search");
  });

  test("search needs 2 to 100 characters", () => {
    expect(isSearchable(" a ")).toBe(false);
    expect(isSearchable("oa")).toBe(true);
    expect(isSearchable("x".repeat(101))).toBe(false);
  });
});

describe("barcode outcomes", () => {
  test("a hit lists the matches for review; nothing is chosen for the member", () => {
    const outcome = describeBarcodeLookup(
      lookup({ status: "found", matches: [result()], manualDraft: null }),
    );
    expect(outcome.kind).toBe("matches");
    if (outcome.kind !== "matches") return;
    expect(outcome.candidates).toHaveLength(1);
    expect(outcome.cachedAt).toBeNull();
    expect(outcome.message).toEqual(BARCODE_COPY.found(1));
  });

  test("a miss is a manual draft with the code prefilled", () => {
    expect(describeBarcodeLookup(lookup())).toEqual({
      kind: "manual",
      barcode: "5901234123457",
      reason: "no_match",
      message: BARCODE_COPY.manual.no_match,
      canRetry: false,
    });
  });

  test("a store/weighed-item code is a manual draft without the code", () => {
    const outcome = describeBarcodeLookup(
      lookup({
        barcode: "2012345678901",
        live: { status: "skipped", reason: null, retryAfterSeconds: null },
        manualDraft: { barcode: null, reason: "variable_measure" },
      }),
    );
    expect(outcome).toMatchObject({ kind: "manual", barcode: null, reason: "variable_measure" });
  });

  test("an unreachable source offers a retry and a manual draft", () => {
    const outcome = describeBarcodeLookup(
      lookup({ live: { status: "unavailable", reason: "rate_limited", retryAfterSeconds: 30 } }),
    );
    expect(outcome).toMatchObject({
      kind: "manual",
      reason: "unavailable",
      barcode: "5901234123457",
      canRetry: true,
    });
  });

  test("a nameless product goes to a manual draft, not a guessed name", () => {
    const outcome = describeBarcodeLookup(
      lookup({ status: "found", matches: [result({ name: null })], manualDraft: null }),
    );
    expect(outcome).toMatchObject({ kind: "manual", reason: "unnamed", barcode: "5901234123457" });
  });

  test("offline: a cached hit is labelled cached; a cache miss never fabricates a product", () => {
    const cached = {
      data: lookup({ status: "found", matches: [result()], manualDraft: null }),
      savedAt: 1_000,
    };
    const hit = describeOfflineBarcode("5901234123457", cached);
    expect(hit).toMatchObject({ kind: "matches", cachedAt: 1_000 });
    expect(hit.message).toEqual(BARCODE_COPY.foundCached(1));

    const miss = describeOfflineBarcode("4006381333931", null);
    expect(miss).toEqual({
      kind: "manual",
      barcode: "4006381333931",
      reason: "offline",
      message: BARCODE_COPY.manual.offline,
      canRetry: true,
    });
    // A cached miss is still a miss offline.
    expect(describeOfflineBarcode("5901234123457", { data: lookup(), savedAt: 1 }).kind).toBe(
      "manual",
    );
    // A cache entry for another code is ignored.
    expect(describeOfflineBarcode("4006381333931", cached).kind).toBe("manual");
    expect(describeOfflineBarcode("2012345678901", null)).toMatchObject({
      reason: "variable_measure",
      barcode: null,
    });
  });
});

describe("manual draft", () => {
  test("prefills only the barcode; every value starts blank", () => {
    const fields = manualDraftFields("5901234123457");
    expect(fields).toEqual({
      name: "",
      basisAmount: "100",
      basisUnit: "g",
      nutrients: {},
      barcode: "5901234123457",
    });
    expect(manualDraftFields(null).barcode).toBe("");
  });

  test("the draft keeps the barcode and only the values the member typed", () => {
    const parsed = parseQuickAdd({
      ...manualDraftFields("5901234123457"),
      name: "Synthetic crackers",
      nutrients: { energyKcal: "420", proteinG: "" },
    });
    expect(parsed).toEqual({
      ok: true,
      food: {
        name: "Synthetic crackers",
        nutrientBasisAmount: 100,
        nutrientBasisUnit: "g",
        nutrients: { energyKcal: 420 },
        barcode: "5901234123457",
      },
    });
    expect(parseQuickAdd({ ...manualDraftFields(null), name: "Synthetic crackers" })).toMatchObject(
      { ok: true, food: { name: "Synthetic crackers" } },
    );
    expect(
      parseQuickAdd({ ...manualDraftFields("123"), name: "Synthetic crackers" }),
    ).toMatchObject({ ok: false });
  });

  test("copy stays neutral and never claims a product from a code", () => {
    const text = Object.values(BARCODE_COPY.manual).map(inEnglish).join("\n").toLowerCase();
    for (const word of ["healthy", "unhealthy", "good", "bad", "diagnos", "guess"])
      expect(text).not.toContain(word);
  });
});
