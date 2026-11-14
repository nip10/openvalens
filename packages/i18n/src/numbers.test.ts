import { describe, expect, test } from "bun:test";

import { ambiguousDecimal, parseDecimal, parseNumberInputValue } from "./numbers";

describe("parseDecimal (#448)", () => {
  test("accepts a decimal point or a decimal comma, trimmed", () => {
    expect(parseDecimal("82,4")).toBe(82.4);
    expect(parseDecimal("82.4")).toBe(82.4);
    expect(parseDecimal(" 82,4 ")).toBe(82.4);
    expect(parseDecimal("1,5")).toBe(1.5);
    expect(parseDecimal("0,125")).toBe(0.125);
    expect(parseDecimal("1234,567")).toBe(1234.567);
    expect(parseDecimal(",5")).toBe(0.5);
    expect(parseDecimal("5,")).toBe(5);
    expect(parseDecimal("70")).toBe(70);
    expect(parseDecimal("-2,5")).toBe(-2.5);
  });

  test("refuses blank and non-numeric text", () => {
    for (const raw of ["", "   ", "abc", "82,4kg", "8 2", ",", "-", "1e3", "0x10", "Infinity"])
      expect(parseDecimal(raw)).toBeNull();
  });

  test("refuses mixed or repeated separators instead of guessing", () => {
    for (const raw of ["1,234.5", "1.234,5", "1.234.567", "1,234,567", "1,,5"])
      expect(parseDecimal(raw)).toBeNull();
  });

  test("a thousands-shaped value needs a locale whose decimal separator it uses", () => {
    expect(parseDecimal("2,000")).toBeNull();
    expect(parseDecimal("1.250")).toBeNull();
    expect(parseDecimal("2,000", "en")).toBeNull();
    expect(parseDecimal("1.250", "en")).toBe(1.25);
    expect(parseDecimal("1,250", "pt-PT")).toBe(1.25);
    expect(parseDecimal("1.250", "pt-PT")).toBeNull();
    expect(parseDecimal("1,250", "not a locale")).toBeNull();
  });
});

describe("parseNumberInputValue (#455)", () => {
  test("reads a browser number input's value, which always uses a point", () => {
    expect(parseNumberInputValue("1.250")).toBe(1.25);
    expect(parseNumberInputValue("82.4")).toBe(82.4);
    expect(parseNumberInputValue("2000")).toBe(2000);
    expect(parseNumberInputValue("")).toBeNull();
  });
});

describe("ambiguousDecimal (#455)", () => {
  test("names both readings of a refused thousands-shaped value", () => {
    expect(ambiguousDecimal("2,000", "en")).toEqual({
      typed: "2,000",
      whole: "2000",
      decimal: "2",
    });
    expect(ambiguousDecimal(" 1,250 ", "en")).toEqual({
      typed: "1,250",
      whole: "1250",
      decimal: "1.25",
    });
    expect(ambiguousDecimal("1.250", "pt-PT")).toEqual({
      typed: "1.250",
      whole: "1250",
      decimal: "1,25",
    });
    expect(ambiguousDecimal("-2,500", "en")).toEqual({
      typed: "-2,500",
      whole: "-2500",
      decimal: "-2.5",
    });
  });

  test("without a locale the decimal reading keeps the typed separator", () => {
    expect(ambiguousDecimal("2,000")).toEqual({ typed: "2,000", whole: "2000", decimal: "2" });
    expect(ambiguousDecimal("1.250")?.decimal).toBe("1.25");
    expect(ambiguousDecimal("1,253")?.decimal).toBe("1,2530");
  });

  test("each reading parses on its own", () => {
    for (const [raw, locale] of [
      ["2,000", "en"],
      ["1,253", "en"],
      ["1.253", "pt-PT"],
      ["1,253", undefined],
      ["9.999", undefined],
    ] as const) {
      const readings = ambiguousDecimal(raw, locale);
      expect(readings).not.toBeNull();
      expect(parseDecimal(readings!.whole, locale)).not.toBeNull();
      expect(parseDecimal(readings!.decimal, locale)).not.toBeNull();
    }
  });

  test("is null for text that parses or is invalid for another reason", () => {
    for (const [raw, locale] of [
      ["1.250", "en"],
      ["1,250", "pt-PT"],
      ["82,4", "en"],
      ["2000", "en"],
      ["1,234.5", "en"],
      ["1.234.567", "en"],
      ["abc", "en"],
      ["", "en"],
      ["0,500", undefined],
    ] as const)
      expect(ambiguousDecimal(raw, locale)).toBeNull();
  });
});
