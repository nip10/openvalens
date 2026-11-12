import { describe, expect, test } from "bun:test";

import { parseDecimal } from "./numbers";

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
