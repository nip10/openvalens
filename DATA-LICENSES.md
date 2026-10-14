# Data licenses

OpenValens code is AGPL-3.0-or-later (see [`LICENSE`](LICENSE)). Third-party
datasets keep their own licenses and are recorded here. Non-commercial data
(for example CC BY-NC) is not accepted.

**No third-party dataset is bundled in this repository.** Tests use small
synthetic fixtures only. Operators import public food catalogs into their own
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
  (`openfoodfacts-products.jsonl`), then apply the overlay rows.
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

- Import a download (Foundation, SR Legacy, Survey or Branded) flattened to
  JSON Lines, for example `jq -c '.FoundationFoods[]' <download>.json`.
- No attribution is legally required under CC0; USDA requests it and the app
  always shows it.

### Not used

INSA/PortFIR and other regional databases are not used without written
permission and a license review. Commercial food databases are not used.
