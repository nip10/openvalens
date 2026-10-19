# Object storage

OpenValens keeps files — progress photos, lab PDF originals, clinical PDF
exports, export bundles — in object storage (Issue #62). Two backends are
supported and both are **private by default**:

| `STORAGE_PROVIDER` | Where objects live                                         | Default |
| ------------------ | ---------------------------------------------------------- | ------- |
| `local`            | Files under `STORAGE_LOCAL_DIR` on the server's disk       | Yes     |
| `s3`               | Any S3-compatible bucket: AWS S3, Cloudflare R2, MinIO, B2 | No      |

The full variable list is in the [environment reference](reference/env.md).
Switching backends is an env change and a restart.

## Privacy model

- **No public URLs, no public buckets.** The server never sends an ACL or
  bucket policy and never needs public access; keep the bucket private.
- **Access is authorized, then signed.** A client asks the API for a download
  URL (`storage.downloadUrl`). The server checks the session, that the object
  belongs to the caller's _active_ organization, and that the caller's role
  grants `read` on the object's resource. For `progress_photo`, the caller must
  additionally be the authenticated `createdByUserId`; workspace owners and
  admins do not bypass this private-per-member restriction, and a missing
  creator fails closed. The same restriction applies to the client-facing
  delete operation. Other purposes retain organization-role authorization.
  Only then does it return a short-lived URL
  (`STORAGE_SIGNED_URL_TTL_SECONDS`, default 5 minutes, at most 1 hour):
  - S3: a SigV4 presigned `GET` that forces `attachment` and `no-store`.
  - Local: `/api/storage/objects/<id>?e=<expiry>&s=<HMAC>`, signed with a key
    derived from `BETTER_AUTH_SECRET`. Forged, altered and expired URLs are
    refused with `403`.
- Signed URLs are bounded bearer capabilities, not session-bound URLs. Anyone
  holding a still-valid URL can use it until expiry; only the photo owner may
  mint one through the client-facing API. Do not describe signed downloads as
  re-checking the user's session or as immediately revocable.
- **Keys carry no PHI.** Every key is `org/<organization id>/<random UUID>` —
  never a filename, metric name, purpose or date — so bucket listings, access
  logs and backup manifests reveal nothing about a person.
- **Only safe content types.** Each purpose has an allowlist (JPEG, PNG, WebP,
  HEIC images; PDF; ZIP/JSON bundles). SVG, HTML and other active content are
  refused, and downloads are served `nosniff`, `attachment` and sandboxed.
- **Nothing sensitive is logged or reported.** Errors carry a category and an
  HTTP status only; readiness reports the provider id and whether storage is
  writable, never a path, endpoint, bucket or key.

## Local disk (default)

Objects are written atomically (temp file, `fsync`, rename) with `0700`
directories and `0600` files. In the production stack
([`deploy/compose.yml`](../deploy/compose.yml)) the `storage` named volume is
mounted at `/var/lib/openvalens/storage`, so uploads survive container
restarts and upgrades. In development the default is `./.data/storage`
(relative to `apps/server`, ignored by git).

Encryption at rest for local storage is the host's job: use an encrypted disk
or volume (LUKS, cloud-provider volume encryption).

## S3-compatible buckets

Set `STORAGE_PROVIDER=s3` plus:

| Setting                                                     | AWS S3                          | Cloudflare R2                                   | MinIO                    |
| ----------------------------------------------------------- | ------------------------------- | ----------------------------------------------- | ------------------------ |
| `STORAGE_S3_ENDPOINT`                                       | unset (regional endpoint)       | `https://<account id>.r2.cloudflarestorage.com` | `http://<host>:9000`     |
| `STORAGE_S3_REGION`                                         | the bucket's region             | `auto`                                          | `us-east-1`              |
| `STORAGE_S3_BUCKET`                                         | bucket name                     | bucket name                                     | bucket name              |
| `STORAGE_S3_FORCE_PATH_STYLE`                               | `false`                         | `false`                                         | `true`                   |
| `STORAGE_S3_SSE`                                            | `AES256`                        | `AES256` (R2 also encrypts at rest)             | `none` unless KMS is set |
| `STORAGE_S3_ACCESS_KEY_ID` / `STORAGE_S3_SECRET_ACCESS_KEY` | an IAM key scoped to the bucket | an R2 API token scoped to the bucket            | a MinIO user             |

The access keys are sensitive and accept `_FILE` variants; in the self-host
stack put them in `deploy/secrets/server/STORAGE_S3_ACCESS_KEY_ID` and
`.../STORAGE_S3_SECRET_ACCESS_KEY` and rerun `deploy/setup.sh install`, which
writes the `_FILE` paths. Grant the key only `s3:PutObject`, `s3:GetObject` and
`s3:DeleteObject` on the bucket. If the bucket, a key or the secret is missing,
storage reports `off` and uploads fail closed — the server still boots.

The adapter is plain `fetch` + SigV4 (no vendor SDK). CI tests it against a
disposable MinIO; Cloudflare R2 and AWS S3 use the same requests but are not
exercised in CI — smoke-test them once against your own bucket before relying
on them (upload a photo, open it, delete it).

### Moving from local disk to S3

```bash
cd apps/server
bun run storage:migrate            # dry run: counts what would be copied
bun run storage:migrate -- --apply # copy and verify
```

The tool reads `STORAGE_LOCAL_DIR` as the source and the `STORAGE_S3_*`
settings as the target, whatever `STORAGE_PROVIDER` currently says. Every copy
is checked against the SHA-256 recorded at upload, both before and after it is
written. Reruns skip objects already in the bucket, and the source is never
deleted. Switch `STORAGE_PROVIDER=s3` and restart only after an `--apply` run
reports no failures.

## Backups

The `stored_object` table is the index of every object; the bytes live in the
storage backend. Back up both from the same point in time:

- **Local disk:** back up the `storage` volume (or `STORAGE_LOCAL_DIR`) with
  the database. The pre-migrate `pg_dump` hook covers the database only (see
  [Backups](self-hosting/backup.md)).
  Encrypted, automated backups that include this volume are Issue #64.
- **S3:** use bucket versioning or replication on the provider side.

## Data rights

`stored_object` is registered with the data-rights registry (Issue #89), so a
subject's export includes their object metadata (id, purpose, content type,
size, checksum). "Delete everything" collects the subject's storage keys,
deletes the database rows in its transaction, then deletes the bytes; if the
subject has objects while storage is off, deletion is refused rather than
leaving orphaned files.

The internal `photo_cleanup_intent` table is system data and is never included
in exports. Lifecycle-managed photo rows bind to a versioned SHA-256 identity
of the configured store (local resolved root, or S3 endpoint/bucket/region and
addressing style). Credentials are excluded, so credential rotation preserves
the binding. A changed root, bucket, or endpoint changes it. This configuration
binding is not proof of physical volume identity or continuity. Legacy objects
retain NULL lifecycle identity; their provenance is unknown and is never
inferred from the active provider. Until reservation-based writes land, the
existing generic progress-photo PUT remains a legacy/unmanaged compatibility
path and does not enable the new photo lifecycle.

Lifecycle photo writes use `reservePhoto` followed by `writePhoto`: reservation
stores the canonical byte count/hash and opaque key before publication; only one
writer can arm that key. Pending/deleting rows are not readable. An ambiguous
PUT or publication-link failure stays tracked by the cleanup-intent table; the
physical cleanup runner is a separate follow-up and deletion is not reported as
physically complete here. The transaction-bound link callback must use its
provided transaction (no nested/root transaction) for photo metadata and
consent revalidation.

## For feature code (#85, #132)

Use the tenant-scoped `StorageService` (`@openvalens/storage`), bound on the
oRPC context as `context.storage` (`null` when storage is off — fail closed):

```ts
const object = await context.storage.putObject({
  organizationId: authz.activeOrganizationId, // from the session, never input
  createdByUserId: authz.user.id,
  purpose: "lab_document", // generic puts cannot create new progress photos
  contentType: "application/pdf",
  body, // Uint8Array | ArrayBuffer | Blob | ReadableStream, ≤ STORAGE_MAX_OBJECT_BYTES
});
// Store object.id on your own row. Read with getObject / createDownloadUrl,
// remove with deleteObject — always passing the active organization id.
```

For a sanitized progress photo, use `reservePhoto`/`writePhoto` instead of the
generic `putObject` path; do not upload original bytes. This API is a storage
primitive only and does not itself authorize a caller or define photo metadata.

| Method                                      | Notes                                                         |
| ------------------------------------------- | ------------------------------------------------------------- |
| `putObject(input)`                          | Validates type and size, hashes, stores, inserts metadata.    |
| `findObject({ organizationId, objectId })`  | Metadata or `null` (another tenant's id is `null` too).       |
| `getObject(ref)`                            | Metadata plus a byte stream, e.g. to embed in a PDF export.   |
| `listObjects({ organizationId, purpose? })` | Newest first, at most 500.                                    |
| `createDownloadUrl(ref, ttl?)`              | Short-lived signed URL; TTL capped by the configured maximum. |
| `deleteObject(ref)`                         | Bytes first, then metadata.                                   |

Check the purpose's resource with `requirePermission` before calling (see
`PURPOSE_POLICIES`). The `storage.downloadUrl` and `storage.delete` procedures
already do this for any stored object. A new purpose needs an entry in
`PURPOSE_POLICIES` and a migration widening `stored_object_purpose_check`.

Uploads larger than `API_MAX_BODY_BYTES` (1 MiB by default) are rejected by the
global body limit, so an upload route for photos or PDFs needs its own
route-specific limit; that belongs with the first feature that uploads (#85).
