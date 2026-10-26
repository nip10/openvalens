# Body map artwork

Vendored from [HichamELBSI/react-native-body-highlighter](https://github.com/HichamELBSI/react-native-body-highlighter)
at commit `8ed39ac2ae9cb46fb79d77eedec7e5b029a75174`.

- Licence: MIT, held by ELABBASSI Hicham since 2022 (full text in `LICENSES/MIT.txt`).
- `body-front.ts`, `body-back.ts`, `body-female-front.ts`, `body-female-back.ts`: the upstream
  `assets/` files; only the import line changed (`BodyPart` now comes from `types.ts`).
- `outlines.ts`: the silhouette outline paths and view boxes from upstream
  `components/SvgMaleWrapper.tsx` and `components/SvgFemaleWrapper.tsx`, unchanged.
- `types.ts`: the upstream `Slug` and `BodyPart` types.

`../body-map-geometry.ts` moves this artwork into the body map's 200 × 400 view box at load
time; `../body-map.ts` names the parts each map region draws:

| Map region (front)    | Artwork slug(s)       |
| --------------------- | --------------------- |
| head                  | head, hair            |
| shoulder (left/right) | deltoids              |
| chest                 | chest                 |
| biceps                | biceps                |
| forearm               | forearm               |
| abs                   | abs                   |
| obliques              | obliques              |
| pelvis (one region)   | adductors, both sides |
| thigh                 | quadriceps            |
| shin                  | tibialis, calves      |

| Map region (back)  | Artwork slug(s)                                 |
| ------------------ | ----------------------------------------------- |
| head               | head, hair (the female back view has hair only) |
| traps (one region) | trapezius, both sides                           |
| shoulder           | deltoids                                        |
| upper_back         | upper-back                                      |
| triceps            | triceps                                         |
| forearm            | forearm                                         |
| lower_back         | lower-back                                      |
| glutes             | gluteal                                         |
| hamstrings         | hamstring                                       |
| calf               | calves                                          |

Every other part (neck, hands, feet, knees, ankles, the front trapezius and triceps, the back
adductors) is drawn as the plain body, with the outline underneath. The artwork's `left` and
`right` are the viewer's sides, so on the front view the member's left is the artwork's `right`.

To update, copy the files from a newer upstream commit, keep the SPDX headers, and record the
commit here.
