import { describe, expect, test } from "bun:test";
import { MICRONUTRIENT_KEYS } from "@openvalens/nutrition/micronutrients";
import {
  MICRONUTRIENT_POPULATION_IDS,
  MICRONUTRIENT_REFERENCE_SOURCES,
} from "@openvalens/nutrition/micronutrient-references";

import {
  MICRONUTRIENT_POPULATION_KEYS,
  MICRONUTRIENT_SOURCES,
  MICRONUTRIENT_WIRE_KEYS,
} from "./nutrition-micronutrients";

describe("micronutrient wire contract (#78)", () => {
  test("id lists match the dataset", () => {
    expect([...MICRONUTRIENT_SOURCES]).toEqual([...MICRONUTRIENT_REFERENCE_SOURCES]);
    expect([...MICRONUTRIENT_POPULATION_KEYS]).toEqual(MICRONUTRIENT_POPULATION_IDS);
    expect([...MICRONUTRIENT_WIRE_KEYS]).toEqual([...MICRONUTRIENT_KEYS]);
  });
});
