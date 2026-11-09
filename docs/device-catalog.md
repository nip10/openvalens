# Gadgetbridge device catalog (Issue #430)

`packages/health-record/src/device-catalog/gadgetbridge-catalog.json` is a
normalized snapshot of the upstream Gadgetbridge
[`device_support.yml`](https://codeberg.org/Freeyourgadget/website/src/branch/master/device_support.yml).
It answers "what does Gadgetbridge publish about this device?" — category,
vendor, implementation level, pairing mode, OS family, experimental status and
documentation links.

**It is reference data only.** Adding a device to this catalog does **not**
make it connectable in OpenValens. The registration allowlist for families the
app actually implements is
[`packages/health-record/src/direct-device-models.ts`](../packages/health-record/src/direct-device-models.ts).
The loader and lookup helpers live in
[`packages/health-record/src/device-catalog.ts`](../packages/health-record/src/device-catalog.ts);
the artifact schema is
[`types.ts`](../packages/health-record/src/device-catalog/types.ts).

## Files

| Path                                                                  | Contents                                              |
| --------------------------------------------------------------------- | ----------------------------------------------------- |
| `packages/health-record/src/device-catalog/source/device_support.yml` | Verbatim upstream bytes, pinned to one commit         |
| `packages/health-record/src/device-catalog/gadgetbridge-catalog.json` | Normalized artifact regenerated from those bytes      |
| `scripts/import-device-catalog.ts`                                    | Fetcher, normalizer and offline drift guard           |
| `scripts/import-device-catalog.test.ts`                               | Fixture-based tests; no network or full-source access |

Both snapshots are committed together. The YAML is never edited by hand: it is
the exact bytes the upstream commit served.

## Provenance

`meta` in the artifact records:

- `source` — upstream file name (`device_support.yml`).
- `repository` — upstream repository URL.
- `sourceUrl` — exact pinned raw URL, always `.../raw/commit/<revision>/...`.
- `revision` — full 40-character upstream commit SHA. Never a branch name.
- `retrievedAt` — ISO-8601 UTC timestamp of the fetch, seconds precision.
- `sha256` — SHA-256 of the verbatim source bytes.
- `license` — `AGPL-3.0-or-later`.
- `attribution` — the notice to display with derived UI; it names the upstream
  website and the pinned revision.
- `deviceCount` — number of `device_support` entries.

## Refreshing the snapshot

1. **Resolve a commit SHA** in the upstream repository. A commit, not a branch:

   ```sh
   git ls-remote https://codeberg.org/Freeyourgadget/website HEAD
   ```

   The first field is the full SHA to pin.

2. **Fetch and rewrite** both files (default `retrievedAt` is now, UTC):

   ```sh
   bun scripts/import-device-catalog.ts --revision <40-hex-commit-sha>
   ```

   Use `--retrieved-at <iso>` only when reproducing an earlier fetch. The
   command refuses branch names and short SHAs, and refuses non-200 or HTML
   responses.

3. **Review the diff.** Expect only the pinned commit's real changes plus
   `meta.revision`, `meta.sourceUrl`, `meta.retrievedAt` and `meta.sha256`:

   ```sh
   git diff -- packages/health-record/src/device-catalog/
   ```

4. **Run the offline check.** It re-parses the committed source, verifies the
   SHA-256 and regenerates the artifact:

   ```sh
   bun scripts/import-device-catalog.ts --check
   ```

5. **Run the type check and tests:**

   ```sh
   cd packages/health-record && bun run check-types
   cd ../.. && bun test scripts/import-device-catalog.test.ts
   ```

6. **Commit source and artifact together** with the refreshed provenance. A
   source change without its artifact (or the reverse) fails `--check`.

## `--check` is the CI drift guard

`bun scripts/import-device-catalog.ts --check` is the default mode. It performs
no network access. It fails, non-zero, when:

- the source file is missing or unreadable;
- the artifact is missing, unreadable or invalid JSON;
- `meta.revision` is not a full commit SHA;
- the source SHA-256 does not equal `meta.sha256`;
- `meta.deviceCount` does not equal the number of normalized entries;
- the artifact does not regenerate byte-for-byte from the committed source
  (apart from `meta.retrievedAt`, which is taken from the artifact itself).

The failure prints the offending lines. CI runs this check so a stale or
hand-edited artifact cannot land.

## Licence and attribution

Upstream `device_support.yml` is published under
[AGPL-3.0-or-later](https://www.gnu.org/licenses/agpl-3.0.html). The committed
snapshot and the normalized artifact are distributed under the same licence.

- Keep the verbatim source, its pinned revision and its licence notice in the
  repository. Do not relicense the snapshot.
- Any UI or export that shows catalog data must display the attribution string
  from `meta.attribution`, including the revision.
- If you redistribute a modified catalog, comply with AGPL-3.0-or-later,
  including offering the corresponding source.

The broader data-licence record is in
[`DATA-LICENSES.md`](../DATA-LICENSES.md).
