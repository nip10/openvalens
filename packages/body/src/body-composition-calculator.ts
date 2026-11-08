/*  Copyright (C) 2026 oddballza

    This file is part of Gadgetbridge.

    Gadgetbridge is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published
    by the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    Gadgetbridge is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>. */

/**
 * TypeScript port of Gadgetbridge's `BodyCompositionCalculator`.
 *
 * Upstream: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/util/BodyCompositionCalculator.java`
 * Source: https://codeberg.org/Freeyourgadget/Gadgetbridge/src/commit/8976702fc3d00e6008c91fe994668cb4027f7bc2/app/src/main/java/nodomain/freeyourgadget/gadgetbridge/util/BodyCompositionCalculator.java
 * Revision: 8976702fc3d00e6008c91fe994668cb4027f7bc2
 * Ported: 2026-11-08
 * Licence: AGPL-3.0-or-later (same as upstream).
 *
 * Estimates body composition from a single-frequency bio-impedance
 * measurement, using published prediction equations rather than any vendor's
 * proprietary curves. Consumer scales are imprecise and hydration changes
 * impedance considerably, so the values are useful mainly to track trends
 * under consistent measurement conditions.
 *
 * Equations (re-derived from the published papers; no openScale code is
 * copied):
 * - Fat-free mass and total body water: Sun SS et al., "Development of
 *   bioelectrical impedance analysis prediction equations for body
 *   composition with the use of a multicomponent model for use in
 *   epidemiologic surveys", Am J Clin Nutr 2003;77:331-40.
 * - Skeletal muscle mass: Janssen I et al., "Estimation of skeletal muscle
 *   mass by bioelectrical impedance analysis", J Appl Physiol
 *   2000;89:465-71.
 * - Basal metabolic rate: Katch-McArdle, from fat-free mass.
 *
 * The upstream header notes that its approach mirrors openScale's
 * StandardImpedanceLib (GPLv3). This port follows the upstream Java
 * implementation and the papers' equations, not openScale source.
 *
 * Upstream returned `float` composition values and a rounded `int` BMR. This
 * port uses JavaScript numbers (float64) for the values and keeps the same
 * integer rounding for BMR; only intermediate precision is higher.
 *
 * Upstream `ActivityUser` coupling is replaced by explicit inputs. Gender
 * codes match upstream: female 0, male 1, other 2. Any other value uses the
 * 0.5 male/female blend, as upstream's `default` branch does.
 */

/** Upstream `ActivityUser` gender codes. */
export const BodyCompositionGender = {
  FEMALE: 0,
  MALE: 1,
  OTHER: 2,
} as const;

export type BodyCompositionGender =
  (typeof BodyCompositionGender)[keyof typeof BodyCompositionGender];

/** Sun et al. equations were validated with impedances roughly in this range. */
export const MIN_IMPEDANCE_OHM = 200;
export const MAX_IMPEDANCE_OHM = 1200;

/** Fraction of fat-free mass that is bone mineral, commonly used by BIA devices. */
export const BONE_FRACTION_MALE = 0.057;
export const BONE_FRACTION_FEMALE = 0.05;

/** Density of water at body temperature, to convert litres to kg. */
export const WATER_KG_PER_LITRE = 0.99513;

export type BodyCompositionInput = {
  gender: BodyCompositionGender;
  ageYears: number;
  heightCm: number;
  weightKg: number;
  impedanceOhm: number;
};

export type BodyComposition = {
  bodyFatPercent: number;
  bodyWaterPercent: number;
  muscleMassKg: number;
  boneMassKg: number;
  basalMetabolicRate: number;
};

/**
 * Estimates body composition, or returns null when it cannot be estimated:
 * a missing/implausible profile, impedance outside the validated range, or a
 * nonsensical result (fat or water outside 0–100%, or muscle at least as
 * heavy as the body).
 */
export function computeBodyComposition(input: BodyCompositionInput): BodyComposition | null {
  const { gender, ageYears, heightCm, weightKg, impedanceOhm } = input;

  if (heightCm <= 0 || ageYears <= 0 || weightKg <= 0) return null;
  if (impedanceOhm < MIN_IMPEDANCE_OHM || impedanceOhm > MAX_IMPEDANCE_OHM) {
    return null;
  }

  const maleWeight =
    gender === BodyCompositionGender.MALE ? 1 : gender === BodyCompositionGender.FEMALE ? 0 : 0.5;

  // height² / resistance, the impedance index all the equations are built on.
  const h2r = (heightCm * heightCm) / impedanceOhm;

  const fatFreeMassMale = -10.68 + 0.65 * h2r + 0.26 * weightKg + 0.02 * impedanceOhm;
  const fatFreeMassFemale = -9.53 + 0.69 * h2r + 0.17 * weightKg + 0.02 * impedanceOhm;
  const fatFreeMassKg = blend(fatFreeMassMale, fatFreeMassFemale, maleWeight);

  const bodyWaterMaleLitres = 1.2 + 0.45 * h2r + 0.18 * weightKg;
  const bodyWaterFemaleLitres = 3.75 + 0.45 * h2r + 0.11 * weightKg;
  const bodyWaterKg =
    WATER_KG_PER_LITRE * blend(bodyWaterMaleLitres, bodyWaterFemaleLitres, maleWeight);

  const skeletalMuscleMassKg = 0.401 * h2r + 3.825 * maleWeight - 0.071 * ageYears + 5.102;
  const boneMassKg = blend(BONE_FRACTION_MALE, BONE_FRACTION_FEMALE, maleWeight) * fatFreeMassKg;
  const basalMetabolicRate = 21.6 * fatFreeMassKg + 370;

  const bodyFatPercent = 100 * (1 - fatFreeMassKg / weightKg);
  const bodyWaterPercent = (100 * bodyWaterKg) / weightKg;

  if (
    bodyFatPercent <= 0 ||
    bodyFatPercent >= 100 ||
    bodyWaterPercent <= 0 ||
    bodyWaterPercent >= 100 ||
    skeletalMuscleMassKg <= 0 ||
    skeletalMuscleMassKg >= weightKg
  ) {
    return null;
  }

  return {
    bodyFatPercent,
    bodyWaterPercent,
    muscleMassKg: skeletalMuscleMassKg,
    boneMassKg,
    basalMetabolicRate: Math.round(basalMetabolicRate),
  };
}

function blend(male: number, female: number, maleWeight: number): number {
  return male * maleWeight + female * (1 - maleWeight);
}
