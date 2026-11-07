# Exercise catalog and images

Every OpenValens server, Cloud or self-hosted, sets up its exercise catalog and
the exercise images **once, automatically** (Issue #400). There is no setting
to turn on and nothing for the operator to run.

## What happens on a new server

Shortly after the server starts, it checks the `exercise_catalog_bootstrap`
row and does whatever is still missing:

1. **Catalog.** It captures the public [wger](https://wger.de) catalog (bounded
   HTTPS requests to the fixed `wger.de` API, no user or auth data sent),
   normalises it and imports it. Records whose licence or author is missing
   are rejected rather than guessed.
2. **Workout Guide frames.** It downloads the
   [Workout Guide](https://github.com/bryllim/workout-guide) manifest at a
   pinned commit, checks its SHA-256 and attaches the three frames of each
   matching exercise. The match is a committed, hand-checked map
   (`packages/exercise-catalog/src/workout-guide-map.ts`).
3. **Images.** It publishes the images through the sanitising asset service:
   each file is decoded, resized within limits, stripped of metadata and
   re-encoded before it is stored. An exercise gets its **Workout Guide frames
   when it has a match, and wger images only when it has none** — sources are
   never mixed for one exercise. Exercises with neither show no image.

Each step is recorded when it finishes and never runs again. A failed step is
logged (`exercise_catalog.*` events) and retried 30 minutes later and on the
next start. With several replicas, a database lease lets one server do the
work. Without object storage the catalog still imports and the images wait
until storage is configured.

The server needs outbound HTTPS to `wger.de` and `raw.githubusercontent.com`
for this one-time setup. Nothing is fetched afterwards, and the app never
hotlinks images: they are served by the server itself.

## Serving

`GET /api/exercise-assets/:assetId` is always mounted. It serves only
published images whose rights and source binding still match the catalog;
anything else is a 404. Keep it same-origin with the API (or behind an
own-origin reverse proxy); do not widen CORS. Catalog search and get
responses include up to three Workout Guide frames (in frame order) or up to
four wger images per exercise, each with its `source`, licence, author,
attribution, source URL and modification notice.

## Demo and e2e

`bun run demo:seed` imports the small committed sample in
`packages/exercise-catalog/sample/` (12 exercises and their Workout Guide
frames) and marks the database as a sample instance. The server then
publishes the committed frames from disk and never fetches the full catalog,
so e2e runs offline.

## Rights

See [`DATA-LICENSES.md`](../DATA-LICENSES.md). In short:

- wger records, translations and images each keep their own licence (CC BY-SA
  3.0/4.0 or CC0), author and source URL.
- Workout Guide frames are by Bryl Lim, after Everkinetic, under CC BY-SA 4.0.
  The per-frame credit names both, links the licence and lists the upstream
  changes; our re-encoding is noted too, and published copies stay under CC
  BY-SA 4.0 (share-alike).
- Never use Gym visual (ExerciseDB, hasaneyldrm/exercises-dataset) or RepDB
  media, and no generated exercise images (#282).

## Optional maintenance tools

The manual commands still exist for operators who want to inspect or refresh
a catalog by hand. They are not needed for a normal setup.

```sh
bun run exercises:prepare --output ./snapshots/wger-YYYY-MM-DD.json
bun run exercises:import --file ./snapshots/wger-YYYY-MM-DD.json          # dry run
bun run exercises:import --file ./snapshots/wger-YYYY-MM-DD.json --apply
bun run exercises:media-stage --file ./snapshots/wger-YYYY-MM-DD.json --output-dir ./staged-media --manifest ./media-manifest.json --media-id 359
bun run exercises:media-import --manifest ./media-manifest.json --input-dir ./staged-media --apply
```

A wger re-import never withdraws Workout Guide frames. To run the automatic
setup again from scratch, delete the `exercise_catalog_bootstrap` row and
restart the server.
