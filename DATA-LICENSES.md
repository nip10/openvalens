# Data licenses

OpenValens code is AGPL-3.0-or-later (see [`LICENSE`](LICENSE)). Third-party
datasets keep their own licenses and are recorded here. Non-commercial data
(for example CC BY-NC) is not accepted.

**No full third-party dataset is bundled in this repository.** Tests use small
synthetic fixtures, and the demo seed uses one small licensed exercise sample
(see [Exercise library](#exercise-library-issue-93-and-400)). Operators import public food catalogs into their own
database with [`scripts/food-catalog-import.ts`](scripts/food-catalog-import.ts);
each import records the exact artifact, its SHA-256, the license and the
attribution notice in `nutrition_catalog_release`.

The license and notice strings used by the app live in
[`packages/nutrition/src/catalog/sources.ts`](packages/nutrition/src/catalog/sources.ts).

## Public food catalogs (Issue #72)

Each source has its own table and is never merged into another source or into
user tables. Search and barcode lookup combine them only at query time, and
every result carries its source, version, release and attribution.

| Source                                              | Tables                                                           | License                                                                                                                                    | Attribution                                                                                                            |
| --------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| [USDA FoodData Central](https://fdc.nal.usda.gov/)  | `nutrition_catalog_fdc_food`                                     | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)                                                                              | "Source: U.S. Department of Agriculture, Agricultural Research Service. FoodData Central. fdc.nal.usda.gov (CC0 1.0)." |
| [Open Food Facts](https://world.openfoodfacts.org/) | `nutrition_catalog_off_product`, `nutrition_catalog_off_overlay` | Database: [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/); contents: [DbCL 1.0](https://opendatacommons.org/licenses/dbcl/1-0/) | "Contains data from Open Food Facts, available under the Open Database License." (both linked)                         |

### Open Food Facts (ODbL)

- `nutrition_catalog_off_product` is an unmodified mirror apart from mapping
  into the core nutrient columns (sodium g → mg). Next to FDC it forms a
  Collective Database (ODbL §4.5a), so FDC data, app code and user data stay
  outside ODbL.
- **The OFF-derived tables (`nutrition_catalog_off_product` and
  `nutrition_catalog_off_overlay`) are licensed under ODbL 1.0.** Filtering,
  transformations and corrections are never written into the mirror; they live
  in the overlay table. On a hosted instance, offer these two tables under
  ODbL, or point to the method to regenerate them (§4.6b): run
  `scripts/food-catalog-import.ts` over the same OFF dump
  (`openfoodfacts-products.jsonl.gz`), then apply the overlay rows.
- The notice above must appear on every OFF-backed product view and search
  result, in About/Settings and in export footers. Users' food logs are
  Produced Works; exports containing OFF-derived nutrient values carry the
  same notice (snapshots copy it into `nutrition_food_snapshot.attribution`).
- Product images (CC BY-SA) are not requested, stored or redistributed.
- Bulk data comes from the published dumps. Live API calls are for real user
  scans only, with a User-Agent naming the app and an operator contact, and no
  user identity (see `packages/nutrition/src/catalog/off-client.ts`).
- This is not a legal safe harbor; operators remain responsible for their own
  redistribution.

### USDA FoodData Central (CC0)

- Import a download (Foundation, SR Legacy, Survey or Branded) as published:
  the importer streams the items of the JSON file or its `.zip`. Self-hosters
  use `deploy/setup.sh catalogs` (see
  [Food catalogs](docs/self-hosting/food-catalogs.md)).
- No attribution is legally required under CC0; USDA requests it and the app
  always shows it.

### Not used

INSA/PortFIR and other regional databases are not used without written
permission and a license review. Commercial food databases are not used.

## Exercise library (Issue #93 and #400)

| Source                                                    | Tables                                                                                                       | License                                                                                                                                                                                                                                   | Attribution                                                                                                                |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| [wger](https://wger.de/)                                  | `exercise`, `exercise_translation`, `exercise_media`, `exercise_catalog_asset` (rows with `source = 'wger'`) | Per entry: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) or [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)                              | "From wger · <licence> · <author>" on every exercise and image                                                             |
| [Workout Guide](https://github.com/bryllim/workout-guide) | `exercise_media` and `exercise_catalog_asset` rows with `source = 'workout-guide'`                           | Artwork: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) ([LICENSE-ASSETS](https://github.com/bryllim/workout-guide/blob/main/LICENSE-ASSETS)); based on [Everkinetic](https://github.com/everkinetic/data), CC BY-SA 4.0 | "Illustration: Workout Guide by Bryl Lim, after Everkinetic · CC BY-SA 4.0", with the upstream changes and our re-encoding |

- **Automatic, once per server.** A new server imports the wger catalog,
  attaches Workout Guide frames and publishes the images by itself, once
  (see [`docs/exercise-catalog-assets.md`](docs/exercise-catalog-assets.md)).
  The manual `exercises:*` commands remain as optional maintenance tools.
- Each exercise, translation and image keeps its own licence, author, source URL
  and snapshot version. Records without a recognised licence, or CC BY-SA
  records without an author, are rejected rather than imported.
- **One image source per exercise.** Workout Guide frames are used when the
  exercise has a match (a committed, hand-checked map); wger images only when
  it has none. No custom or generated drawings are used as exercise images;
  the muscle guide (#94) is only the muscles diagram.
- Images are served from the instance's own storage, never hotlinked. They are
  re-encoded before publication, so each published image carries a
  modification notice and stays under its original CC BY-SA licence
  (share-alike).
- When a later snapshot rejects a record, its rights fields are cleared and its
  images are withdrawn from publication. A wger re-import never withdraws
  Workout Guide frames.

### Workout Guide (CC BY-SA 4.0)

- Checked on 2026-11-06 in the repository itself: `LICENSE-ASSETS` (artwork
  under CC BY-SA 4.0, © 2026 Bryl Lim except where `ATTRIBUTION.md` names an
  upstream source), `ATTRIBUTION.md` (pose artwork from Everkinetic, CC BY-SA
  4.0) and `LICENSES.md` (code and metadata MIT). Everkinetic's own
  `LICENSE.md` is CC BY-SA 4.0.
- Pinned to commit `aac599224bb9780305239607ef98540b7e0ce389`; the manifest is
  checked against its SHA-256 before use, and every frame must declare the
  expected creator and licence.
- Each stored frame credits Bryl Lim and Everkinetic, links the licence, names
  the source drawing and upstream changes where the manifest records them, and
  notes our re-encoding.

### Committed sample

`packages/exercise-catalog/sample/` holds 12 wger records (CC BY-SA 3.0 and
4.0, author per record), their 36 Workout Guide frames (CC BY-SA 4.0, copied
unmodified) and the matching manifest entries (MIT). It is used by the demo
seed and e2e only; `REUSE.toml` and the folder's `ATTRIBUTION.md` record the
licences.

### Not used

[hasaneyldrm/exercises-dataset](https://github.com/hasaneyldrm/exercises-dataset)
(the media is © Gym visual, not redistributable; the same media as ExerciseDB)
and [RepDB/exercise-dataset](https://github.com/RepDB/exercise-dataset) (no
republishing as a dataset, AI-generated images) are not used.

## Gadgetbridge device catalog (Issue #430)

The committed snapshot
`packages/health-record/src/device-catalog/source/device_support.yml` and its
normalized artifact `gadgetbridge-catalog.json` come from the Gadgetbridge
website ([codeberg.org/Freeyourgadget/website](https://codeberg.org/Freeyourgadget/website)).

- **Licence:** AGPL-3.0-or-later, the same as upstream.
- **Attribution:** "Device support data from the Gadgetbridge website
  (codeberg.org/Freeyourgadget/website), AGPL-3.0-or-later, revision
  `<commit-sha>`." The artifact records the exact string in `meta.attribution`.
- **Committed, not downloaded at runtime.** The verbatim source bytes, the
  pinned commit and the SHA-256 are committed together so the catalog is
  reproducible offline.

Refresh, verification and attribution obligations are documented in
[`docs/device-catalog.md`](docs/device-catalog.md).

## Micronutrient reference values (Issue #78)

Unlike the catalogs above, these values are committed, in
`packages/nutrition/src/micronutrient-references.ts` (dataset
`micronutrient-references/v1`, retrieved 2026-10-23). The file covers adult
values for eight nutrients only.

| Source                                                                                     | What is stored                                                  | License or terms                                                                                                                      | Attribution                                                                                                             |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| [EFSA Dietary Reference Values](https://multimedia.efsa.europa.eu/drvs/index.htm)          | PRI, AI, UL and safe-level numbers, each with its opinion's DOI | Re-use is authorised, provided EFSA is acknowledged as the source                                                                     | The summary names EFSA as the source and links the DRV Finder.                                                          |
| [NASEM Dietary Reference Intakes](https://www.nationalacademies.org/read/25353/chapter/28) | RDA, AI and UL numbers with report citations                    | NASEM text and tables are all rights reserved. Only individual numeric facts and citations are stored; no text or table is reproduced | The summary names NASEM and cites the report for each value; NIH ODS fact sheets (public domain) are linked for reading |

- Values were checked against the EFSA DRV Finder data and Appendix J of the
  2019 NASEM sodium and potassium report (see `docs/micronutrients.md`).
- They are shown only after the member chooses a source and population, and
  only as references, never as a diagnosis.
