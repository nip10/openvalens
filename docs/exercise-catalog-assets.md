# Exercise catalog media assets

Catalog asset publication is an operator-only, manual process and is disabled
unless `EXERCISE_CATALOG_ASSETS_ENABLED=true`. Enabling it mounts the own-origin
`GET /api/exercise-assets/:assetId` route only when the configured storage
adapter exposes its stable provider/store identity. Keep this URL same-origin
with the API/web deployment or use an own-origin reverse proxy; do not widen
CORS to arbitrary origins. The route serves only current, verified global wger
manifest entries, never upstream URLs, redirects, signed generic-storage URLs,
or custom-exercise media.

The catalog snapshot is prepared explicitly from public wger endpoints. This
command makes bounded HTTPS requests to the fixed `wger.de` API origin, captures
all exerciseinfo pages and the license/language lookups, verifies complete
pagination/counts/unique IDs, and writes a new immutable local artifact (it will
not overwrite an existing path):

```sh
bun run exercises:prepare --output ./snapshots/wger-YYYY-MM-DD.json
bun run exercises:import --file ./snapshots/wger-YYYY-MM-DD.json
bun run exercises:import --file ./snapshots/wger-YYYY-MM-DD.json --apply
bun run exercises:media-stage --file ./snapshots/wger-YYYY-MM-DD.json --output-dir ./staged-media --manifest ./media-manifest.json --media-id 359
bun run exercises:media-import --manifest ./media-manifest.json --input-dir ./staged-media
bun run exercises:media-import --manifest ./media-manifest.json --input-dir ./staged-media --apply
```

Preparation is operator-only: it is never run at app startup or during library
views, sends no user/session/auth headers, and never connects to a database.
The artifact carries its capture timestamp, source URLs, per-response SHA-256
digests, page counts, and the complete adapted records. The importer's normal
default remains dry-run; only its separate `--apply` opens the explicitly
configured database. Missing/unknown/mismatched rights and incomplete English
attribution are rejected rather than guessed. Public source descriptions use
`description_source` where present; otherwise descriptions remain plain text.
Entity, translation, and image rights are independent. Image eligibility is
always based on that image's own source/license/author evidence, never exercise
or translation rights. CC BY-SA derivatives require independent attribution
and share-alike review; this tooling is not legal certification.

`exercises:media-stage` is a separate explicit network operation. It requires
the snapshot already imported into the selected database; it reads (but never
writes) the DB to bind source media IDs and rights to catalog rows. By default it stages at most one eligible
image; `--media-id` selects a specific wger image. Downloads are limited to
fixed HTTPS `wger.de/media/exercise-images/...` paths, redirects are rejected,
and streaming/time are bounded. Filenames are generated and outputs are
create-only; the output directory and manifest must be new. Staging does not
sanitize or publish bytes; the existing media importer remains the only
publication path.

The media-import operator workflow accepts a local JSON manifest and relative
files under an explicit input directory:

```sh
bun run exercises:media-import --manifest ./exercise-media.json --input-dir ./media
bun run exercises:media-import --manifest ./exercise-media.json --input-dir ./media --apply
```

When the feature is enabled, exercise catalog search/get responses may include
up to four ready-only metadata previews per exercise. Their `path` is a locally
constructed same-origin `/api/exercise-assets/<opaque-id>` path; `sourceUrl` is
attribution provenance only, never an image request target. Metadata readiness
does not prove current byte integrity: the binary route revalidates the binding
and stored content on every read, and clients must tolerate unavailable assets.

The first command is the default and validates bounded manifest/file input,
source SHA-256 values, JPEG/PNG decoding, and canonical output limits. It does
not open the database or initialize storage and reports that publication and
database eligibility remain unverified. `--apply` is explicit operator intent;
it additionally verifies current global wger exercise/media metadata and
per-image rights in the database before storage I/O. Manifest source IDs,
snapshot identity, image license/URL/author/attribution/source URL, original
SHA-256, and transformation notice must match the catalog record. Each image
must independently declare an allowlisted CC0 or CC BY-SA 3.0/4.0 license;
the exercise license does not license its images. CC BY-SA requires author and
attribution. Never use Gymvisual or ExerciseDB assets.

Only local JPEG and PNG source bytes are accepted. They are decoded, oriented,
resized, metadata-stripped, and re-encoded before storage. The service records
uncertain writes before upload and does not retry unknown writes, overwrite
ready keys, or automatically delete objects. Media stays unavailable if its
rights/snapshot binding changes. No license-compliance conclusion follows from
the tooling; operators remain responsible for source provenance and legal
review. No asset import or storage binding is performed automatically.
