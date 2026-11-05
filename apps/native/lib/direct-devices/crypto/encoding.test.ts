import { expect, test } from "bun:test";

import fixture from "../__fixtures__/b163-reference.json";
import { publicPointToWire, reverseHexBytes, sharedXToWire } from "./encoding";

test("B-163 fixture point/shared formats convert to Gadgetbridge little-endian slots", () => {
  for (const vector of fixture.vectors) {
    const point = `04${reverseHexBytes(vector.publicPointLe.slice(0, 48)).slice(6)}${reverseHexBytes(vector.publicPointLe.slice(48)).slice(6)}`;
    expect(publicPointToWire(point)).toBe(vector.publicPointLe);
    expect(sharedXToWire(reverseHexBytes(vector.sharedXLe.slice(0, 42)))).toBe(vector.sharedXLe);
  }
});

test("malformed and wrong-length points/shared coordinates are rejected", () => {
  expect(() => publicPointToWire(`05${"00".repeat(42)}`)).toThrow("INVALID_POINT_FORMAT");
  expect(() => publicPointToWire("abcd")).toThrow("INVALID_POINT_FORMAT");
  expect(() => sharedXToWire("00".repeat(20))).toThrow("INVALID_SHARED_X_FORMAT");
});
