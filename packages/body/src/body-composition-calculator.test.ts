/**
 * Behavioural tests for the `BodyCompositionCalculator` port.
 *
 * Upstream has no tests for this class, so these are written from the source
 * semantics at revision 8976702fc3d00e6008c91fe994668cb4027f7bc2 and the
 * cited prediction equations. AGPL-3.0-or-later.
 */

import { expect, test } from "bun:test";

import {
  BodyCompositionGender,
  computeBodyComposition,
  MAX_IMPEDANCE_OHM,
  MIN_IMPEDANCE_OHM,
} from "./body-composition-calculator";

const profile = {
  ageYears: 30,
  heightCm: 175,
  weightKg: 70,
  impedanceOhm: 500,
};

test("computes the published male equations", () => {
  const result = computeBodyComposition({
    gender: BodyCompositionGender.MALE,
    ...profile,
  })!;

  expect(result.bodyFatPercent).toBeCloseTo(18.09642857142858, 9);
  expect(result.bodyWaterPercent).toBeCloseTo(58.80152089285714, 9);
  expect(result.muscleMassKg).toBeCloseTo(31.35825, 9);
  expect(result.boneMassKg).toBeCloseTo(3.2679525, 9);
  expect(result.basalMetabolicRate).toBe(1608);
});

test("computes the published female equations", () => {
  const result = computeBodyComposition({
    gender: BodyCompositionGender.FEMALE,
    ...profile,
  })!;

  expect(result.bodyFatPercent).toBeCloseTo(21.95357142857144, 9);
  expect(result.bodyWaterPercent).toBeCloseTo(55.46072732142857, 9);
  expect(result.muscleMassKg).toBeCloseTo(27.53325, 9);
  expect(result.boneMassKg).toBeCloseTo(2.731625, 9);
  expect(result.basalMetabolicRate).toBe(1550);
});

test("the masculine and feminine equations differ in the expected direction", () => {
  const male = computeBodyComposition({
    gender: BodyCompositionGender.MALE,
    ...profile,
  })!;
  const female = computeBodyComposition({
    gender: BodyCompositionGender.FEMALE,
    ...profile,
  })!;

  expect(male.bodyFatPercent).toBeLessThan(female.bodyFatPercent);
  expect(male.muscleMassKg).toBeGreaterThan(female.muscleMassKg);
  expect(male.basalMetabolicRate).toBeGreaterThan(female.basalMetabolicRate);
});

test("non-binary gender blends the male and female equations 50/50", () => {
  const male = computeBodyComposition({
    gender: BodyCompositionGender.MALE,
    ...profile,
  })!;
  const female = computeBodyComposition({
    gender: BodyCompositionGender.FEMALE,
    ...profile,
  })!;
  const other = computeBodyComposition({
    gender: BodyCompositionGender.OTHER,
    ...profile,
  })!;

  expect(other.bodyFatPercent).toBeCloseTo((male.bodyFatPercent + female.bodyFatPercent) / 2, 9);
  expect(other.bodyWaterPercent).toBeCloseTo(
    (male.bodyWaterPercent + female.bodyWaterPercent) / 2,
    9,
  );
  expect(other.muscleMassKg).toBeCloseTo((male.muscleMassKg + female.muscleMassKg) / 2, 9);
  // Bone is the blended bone fraction times the blended fat-free mass, so it is
  // not the average of the male and female bone masses.
  const otherFatFreeMass = profile.weightKg * (1 - other.bodyFatPercent / 100);
  expect(other.boneMassKg).toBeCloseTo(0.0535 * otherFatFreeMass, 9);
  expect(other.boneMassKg).toBeGreaterThan(female.boneMassKg);
  expect(other.boneMassKg).toBeLessThan(male.boneMassKg);
  // BMR is rounded independently, so it may differ by one from the average.
  expect(
    Math.abs(other.basalMetabolicRate - (male.basalMetabolicRate + female.basalMetabolicRate) / 2),
  ).toBeLessThanOrEqual(1);
});

test("impedance boundaries are inclusive at 200 and 1200 ohm", () => {
  const base = {
    gender: BodyCompositionGender.MALE,
    ageYears: 30,
    heightCm: 120,
    weightKg: 70,
  };

  expect(computeBodyComposition({ ...base, impedanceOhm: MIN_IMPEDANCE_OHM - 1 })).toBeNull();
  expect(computeBodyComposition({ ...base, impedanceOhm: MIN_IMPEDANCE_OHM })).not.toBeNull();
  expect(computeBodyComposition({ ...base, impedanceOhm: MAX_IMPEDANCE_OHM })).not.toBeNull();
  expect(computeBodyComposition({ ...base, impedanceOhm: MAX_IMPEDANCE_OHM + 1 })).toBeNull();
});

test("missing or non-positive profile values return null", () => {
  const base = { gender: BodyCompositionGender.MALE, ...profile };

  expect(computeBodyComposition({ ...base, heightCm: 0 })).toBeNull();
  expect(computeBodyComposition({ ...base, heightCm: -175 })).toBeNull();
  expect(computeBodyComposition({ ...base, ageYears: 0 })).toBeNull();
  expect(computeBodyComposition({ ...base, weightKg: 0 })).toBeNull();
  expect(computeBodyComposition({ ...base, weightKg: -70 })).toBeNull();
});

test("an implausible body-fat result returns null", () => {
  // Fat-free mass comes out negative, so body fat would exceed 100%.
  expect(
    computeBodyComposition({
      gender: BodyCompositionGender.MALE,
      ageYears: 30,
      heightCm: 40,
      weightKg: 5,
      impedanceOhm: 200,
    }),
  ).toBeNull();
});

test("an implausible body-water result returns null", () => {
  // Body water would exceed 100% of weight.
  expect(
    computeBodyComposition({
      gender: BodyCompositionGender.FEMALE,
      ageYears: 5,
      heightCm: 80,
      weightKg: 20,
      impedanceOhm: 200,
    }),
  ).toBeNull();
});

test("muscle at least as heavy as the body returns null", () => {
  // Fat and water are in range, but skeletal muscle exceeds body weight.
  expect(
    computeBodyComposition({
      gender: BodyCompositionGender.MALE,
      ageYears: 5,
      heightCm: 80,
      weightKg: 20,
      impedanceOhm: 200,
    }),
  ).toBeNull();
});
