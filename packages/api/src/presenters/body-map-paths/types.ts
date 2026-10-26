// SPDX-FileCopyrightText: 2022 ELABBASSI Hicham
// SPDX-License-Identifier: MIT
//
// The `BodyPart` shape from HichamELBSI/react-native-body-highlighter index.tsx
// at commit 8ed39ac2ae9cb46fb79d77eedec7e5b029a75174, narrowed to the fields the
// vendored asset files use.

export type Slug =
  | "abs"
  | "adductors"
  | "ankles"
  | "biceps"
  | "calves"
  | "chest"
  | "deltoids"
  | "feet"
  | "forearm"
  | "gluteal"
  | "hamstring"
  | "hands"
  | "hair"
  | "head"
  | "knees"
  | "lower-back"
  | "neck"
  | "obliques"
  | "quadriceps"
  | "tibialis"
  | "trapezius"
  | "triceps"
  | "upper-back";

export interface BodyPart {
  color?: string;
  slug?: Slug;
  path?: {
    common?: string[];
    left?: string[];
    right?: string[];
  };
}
