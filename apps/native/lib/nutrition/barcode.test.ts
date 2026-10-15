import { describe, expect, test } from "bun:test";
import { NUTRIENT_KEYS, type NutrientValues } from "@openvalens/api/contracts/nutrition-diary";
import type { BarcodeLookup, FoodResult } from "@openvalens/api/contracts/nutrition-foods";
import { BARCODE_COPY } from "@openvalens/api/presenters/food-lookup";

import {
  BARCODE_CACHE_PREFIX,
  barcodeCacheKey,
  createScanGate,
  resolveBarcode,
  scannerMessage,
  scannerStateFor,
  type BarcodeResolver,
} from "./barcode";

const CODE = "5901234123457";

function nutrients(values: Partial<NutrientValues>): NutrientValues {
  return Object.fromEntries(
    NUTRIENT_KEYS.map((key) => [key, values[key] ?? null]),
  ) as NutrientValues;
}

const match: FoodResult = {
  id: `off:${CODE}`,
  source: "off",
  sourceFoodId: CODE,
  sourceVersion: "2026-05-01T00:00:00.000Z",
  origin: "catalog",
  dataType: null,
  name: "Synthetic crispbread",
  brand: null,
  barcode: CODE,
  basis: {
    nutrientBasisAmount: 100,
    nutrientBasisUnit: "g",
    servingSizeAmount: null,
    servingSizeUnit: null,
    servingLabel: null,
  },
  nutrients: nutrients({ energyKcal: 390 }),
  attribution: {
    source: "off",
    sourceName: "Open Food Facts",
    homepage: "https://world.openfoodfacts.org/",
    license: "ODbL-1.0",
    licenseUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
    notice: "Contains data from Open Food Facts.",
  },
  release: null,
  overlay: null,
};

const hit: BarcodeLookup = {
  barcode: CODE,
  status: "found",
  matches: [match],
  live: { status: "off", reason: null, retryAfterSeconds: null },
  manualDraft: null,
};

const miss: BarcodeLookup = {
  barcode: CODE,
  status: "not_found",
  matches: [],
  live: { status: "off", reason: null, retryAfterSeconds: null },
  manualDraft: { barcode: CODE, reason: "no_match" },
};

function fakes(overrides: Partial<BarcodeResolver> = {}) {
  const cache = new Map<string, { data: BarcodeLookup; savedAt: number }>();
  const lookups: string[] = [];
  const deps: BarcodeResolver = {
    online: true,
    lookup: async (barcode) => {
      lookups.push(barcode);
      return hit;
    },
    readCached: (barcode) => cache.get(barcode) ?? null,
    writeCached: (barcode, result) => cache.set(barcode, { data: result, savedAt: 42 }),
    ...overrides,
  };
  return { deps, cache, lookups };
}

describe("camera permission states", () => {
  test("allowed, denied, blocked and unavailable each have a non-blocking state", () => {
    expect(scannerStateFor(true, { granted: true, canAskAgain: true })).toBe("ready");
    expect(scannerStateFor(true, { granted: false, canAskAgain: true })).toBe("denied");
    expect(scannerStateFor(true, { granted: false, canAskAgain: false })).toBe("blocked");
    expect(scannerStateFor(true, null)).toBe("denied");
    expect(scannerStateFor(false, { granted: true, canAskAgain: true })).toBe("unavailable");
    expect(scannerMessage("denied")).toBe(BARCODE_COPY.cameraDenied);
    expect(scannerMessage("blocked")).toBe(BARCODE_COPY.cameraDenied);
    expect(scannerMessage("unavailable")).toBe(BARCODE_COPY.cameraUnavailable);
  });
});

describe("scan gate", () => {
  test("accepts one valid code per session and ignores repeats and junk", () => {
    const gate = createScanGate();
    expect(gate.accept("https://example.test/qr")).toBeNull();
    expect(gate.accept(CODE)).toBe(CODE);
    expect(gate.accept(CODE)).toBeNull();
    expect(gate.accept("4006381333931")).toBeNull();
    gate.reset();
    expect(gate.accept("4006381333931")).toBe("4006381333931");
  });
});

describe("resolveBarcode", () => {
  test("malformed text is rejected before any request", async () => {
    const { deps, lookups } = fakes();
    expect(await resolveBarcode("123", deps)).toEqual({
      kind: "invalid",
      message: BARCODE_COPY.invalid,
    });
    expect(lookups).toEqual([]);
  });

  test("online hit lists the match and caches it for offline use", async () => {
    const { deps, cache } = fakes();
    const resolution = await resolveBarcode("5901-2341 23457", deps);
    expect(resolution).toMatchObject({
      kind: "outcome",
      outcome: { kind: "matches", cachedAt: null, barcode: CODE },
    });
    expect(cache.get(CODE)?.data).toEqual(hit);
  });

  test("online miss is a manual draft with the code prefilled and is not cached", async () => {
    const { deps, cache } = fakes({ lookup: async () => miss });
    expect(await resolveBarcode(CODE, deps)).toMatchObject({
      kind: "outcome",
      outcome: { kind: "manual", reason: "no_match", barcode: CODE },
    });
    expect(cache.size).toBe(0);
  });

  test("offline cache hit returns the cached candidate, labelled as cached", async () => {
    const { deps, cache, lookups } = fakes({ online: false });
    cache.set(CODE, { data: hit, savedAt: 7 });
    const resolution = await resolveBarcode(CODE, deps);
    expect(resolution).toMatchObject({
      kind: "outcome",
      outcome: { kind: "matches", cachedAt: 7 },
    });
    expect(lookups).toEqual([]);
  });

  test("offline cache miss says so and offers a manual draft; nothing is fabricated", async () => {
    const { deps } = fakes({ online: false });
    const resolution = await resolveBarcode(CODE, deps);
    expect(resolution).toEqual({
      kind: "outcome",
      outcome: {
        kind: "manual",
        barcode: CODE,
        reason: "offline",
        message: BARCODE_COPY.manual.offline,
        canRetry: true,
      },
    });
  });

  test("a failed request falls back to the cache, then to a manual draft", async () => {
    const failing = fakes({
      lookup: async () => {
        throw new TypeError("Network request failed");
      },
    });
    expect(await resolveBarcode(CODE, failing.deps)).toMatchObject({
      outcome: { kind: "manual", reason: "offline" },
    });
    failing.cache.set(CODE, { data: hit, savedAt: 9 });
    expect(await resolveBarcode(CODE, failing.deps)).toMatchObject({
      outcome: { kind: "matches", cachedAt: 9 },
    });
  });

  test("server INVALID_INPUT is shown as invalid digits", async () => {
    const { deps } = fakes({
      lookup: async () => {
        throw Object.assign(new Error("Barcode must be 8 to 14 digits"), {
          code: "INVALID_INPUT",
        });
      },
    });
    expect(await resolveBarcode(CODE, deps)).toEqual({
      kind: "invalid",
      message: BARCODE_COPY.invalid,
    });
  });

  test("store codes never reach the cache or a guessed product offline", async () => {
    const { deps } = fakes({ online: false });
    expect(await resolveBarcode("2012345678901", deps)).toMatchObject({
      outcome: { kind: "manual", reason: "variable_measure", barcode: null },
    });
  });

  test("lookups are cached under the diary prefix, so clearing diary data removes them", () => {
    expect(barcodeCacheKey(CODE)).toBe(`${BARCODE_CACHE_PREFIX}${CODE}`);
    expect(BARCODE_CACHE_PREFIX.startsWith("nutritionDiary.")).toBe(true);
  });
});
