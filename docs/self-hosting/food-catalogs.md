# Food catalogs

**Applies to:** OpenValens 0.1.0 · Last updated: 2026-10-24

Food search and barcode lookup read two public catalogs from your own
database: USDA FoodData Central (FDC) and Open Food Facts (OFF). **A new
install starts with both empty.** No dataset ships with OpenValens (see
[`DATA-LICENSES.md`](../../DATA-LICENSES.md)), and the downloads are large, so
importing them is a separate, opt-in step: `deploy/setup.sh catalogs`.

## Without catalogs

| Feature        | With no catalog imported                                                                                                                           |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Food search    | Finds only the member's own custom foods.                                                                                                          |
| Barcode lookup | Matches only the member's own custom foods. Every other code is a miss that offers manual entry, unless [live lookup](#live-barcode-lookup) is on. |
| Logging        | Works: members can always enter a food by hand or save it as a custom food.                                                                        |
| Micronutrients | Only foods that report them count. Custom foods usually report few, so the [daily summary](../micronutrients.md) shows low coverage.               |

## What to import

| `--source`    | Data                                                | Download                       | Import time (estimate)   | Barcodes                |
| ------------- | --------------------------------------------------- | ------------------------------ | ------------------------ | ----------------------- |
| `fdc`         | FDC Foundation (2026-04-30) and SR Legacy (2018-04) | ~14 MB, ~8,000 generic foods   | under a minute           | no                      |
| `fdc-branded` | FDC Branded Foods (2026-04-30)                      | ~200 MB, roughly 600,000 foods | several minutes          | yes, mostly US products |
| `off`         | Open Food Facts full dump, refreshed daily upstream | ~13 GB, millions of products   | tens of minutes to hours | yes, worldwide          |
| `all`         | all three                                           | ~13.2 GB                       |                          |                         |

The `fdc` time was measured on a laptop: Foundation and SR Legacy imported in
under two seconds. Times for `fdc-branded` and `off` are estimates from a
small sample, not measured on a full import; disk speed matters most.

Plan for **25 GB of free disk** before importing `off`: the dump stays in
`deploy/catalogs/` (about 13 GB), and the imported products add several GB to
the database volume and to every [pre-migrate dump](backup.md). For barcodes,
`off` is the catalog that matters. `fdc` alone is a quick way to make generic
food search useful.

## Import

```bash
deploy/setup.sh catalogs --source fdc            # small: generic foods
deploy/setup.sh catalogs --source off            # large: product barcodes
deploy/setup.sh catalogs --source fdc,off --dry-run
```

Run it after `deploy/setup.sh install`. It prints the licence notice and
sizes, asks before downloading (`--non-interactive` skips the question), then:

1. Downloads each file on the host with `curl` into `deploy/catalogs/`, with
   a progress bar. An interrupted download resumes on the next run. The
   directory is git-ignored and kept out of the image build context.
2. Starts `postgres` if it is not running.
3. Imports each file with `scripts/food-catalog-import.ts`, run from the
   server image as a one-off `migrate` container. It uses the same read-only
   `DATABASE_URL` secret file, sits on the internal `db` network only, and
   mounts `deploy/catalogs/` read-only. Files are streamed, never unpacked to
   disk. Progress is a count of items read; no food data is printed.

Each file is imported in one transaction: if an import fails, nothing from
that file is written, and you can re-run the command. The server needs no
restart. Search and barcode lookup use the new rows right away.

Every catalog result carries its source, release and attribution notice.
A logged food keeps a copy of the notice, so later imports never change it.

## Updating

Run the same command again:

- FDC releases are dated files. One that is already in `deploy/catalogs/` is
  not downloaded again, and a file that was already imported changes nothing.
  A new FDC release arrives with an OpenValens upgrade that bumps the
  pinned date in `deploy/setup.sh`.
- The OFF dump is downloaded again only if upstream has a newer one (a
  conditional request). A new dump is imported as a new release; products are
  updated in place and never replaced by an older revision. The release
  version is the dump's upstream date.

To free disk space, delete the files in `deploy/catalogs/`. The imported rows
stay in the database. Keep the OFF dump if you rely on it to regenerate the
OFF tables (see below).

## Licences

- **USDA FoodData Central:** CC0 1.0 (public domain). No attribution is
  legally required; USDA asks for it, and the app always shows it.
- **Open Food Facts:** the database is under the
  [Open Database License (ODbL 1.0)](https://opendatacommons.org/licenses/odbl/1-0/),
  its contents under the DbCL 1.0. Every OFF result carries the OFF notice,
  and a logged food keeps a copy of it. The two OFF tables in your database
  are ODbL as well. If you let others use your instance, offer those
  tables under ODbL, or point to how to regenerate them: run this importer
  over the same dump. Product images are never downloaded or stored.

Details: [`DATA-LICENSES.md`](../../DATA-LICENSES.md). This is not legal
advice; you remain responsible for how you redistribute data.

## Live barcode lookup

Instead of importing OFF, or as well as importing it, the server can ask the
public Open Food Facts API about a barcode that the member's custom foods and
the imported catalogs all miss. It is off by default. To turn it on, add to
`deploy/.env` (below the marker line) and apply with
`deploy/setup.sh upgrade`:

```dotenv
FOOD_LOOKUP_PROVIDER=openfoodfacts
FOOD_LOOKUP_USER_AGENT=OpenValens/0.1.0 (ops@example.org)
```

Open Food Facts requires the user agent to name the app and an operator
contact. Only the product code and the user agent are sent, for real scans
only; no member identity is sent. `FOOD_LOOKUP_BASE_URL` can point at a
privacy proxy. Live lookup only covers barcodes. Food search still needs the
imported catalogs. See [Integration adapters](../integrations.md) and
[Configuration](configuration.md#deployenv).

## Importing a file yourself

Use the importer directly for a release the script does not download, such
as an FDC Survey (FNDDS) file or a copy fetched on another machine.
`--file` accepts `.jsonl`, `.jsonl.gz`, an FDC `.json` download or its
`.zip`. Put the file in `deploy/catalogs/`, then:

```bash
docker compose -f deploy/compose.yml --env-file deploy/.env run --rm --no-deps -T \
  --workdir /app -v "$PWD/deploy/catalogs:/catalogs:ro" migrate \
  bun --no-env-file scripts/food-catalog-import.ts --source fdc \
  --file /catalogs/FoodData_Central_survey_food_json_2024-10-31.zip \
  --dataset survey --version 2024-10-31 \
  --source-url https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_survey_food_json_2024-10-31.zip \
  --allow-remote
```

`--allow-remote` is needed because, from inside the container, the database
host is `postgres`, not loopback.
