# Privacy and data rights

**Applies to:** OpenValens 0.1.0 · Last updated: 2026-10-14

This page is for operators. It describes where a self-hosted instance keeps
data, what the app lets people do with their own data, and the gaps you need
to know about. It is not legal advice.

## Who is responsible

Whoever runs an instance decides who uses it and holds their data. The
OpenValens project does not receive any of it: a default install sends nothing
to the project and has no analytics or error reporting. If people other than
you use your instance, data-protection law (for example the GDPR) may make you
responsible for their health data; take advice where it matters.

## Where data lives

| Data                                     | Where                                            |
| ---------------------------------------- | ------------------------------------------------ |
| Accounts, workspaces and health data     | Postgres, in the `postgres_data` volume          |
| Pre-migrate backups (unencrypted)        | `backups` volume ([Backups](backup.md))          |
| Server and proxy logs (no health values) | Docker's `json-file` logs, 3 × 10 MB per service |
| Secrets                                  | `deploy/secrets/` on the host                    |

Data leaves the host only through providers you enable
([Configuration](configuration.md#optional-providers)):

- **Resend** receives each email's recipient, subject and body (sign-in links,
  verification codes, invitations, reminders).
- **Anthropic** receives the content of AI conversations and the health data
  the AI features use, only after the user consents in the app.
- **Telegram** receives the reminder messages sent to users who connect it.

Caddy also contacts Let's Encrypt to obtain certificates for your domain, with
the `ACME_EMAIL` contact address and no user data.

## What people can do in the app

### Export

The **Clinical export** page (`/exports`, also in the mobile app) downloads a
person's clinical record as a JSON bundle, or selected sections as CSV or
PDF. The JSON bundle is capped (200 records by default), so it is **not** a
complete export.

The web PDF (**Download a PDF summary**) is a real PDF of the selected
clinical sections (lab results, body measurements, medications, supplements,
family history, imaging, cardiac, DEXA and weight). Each section names its
source, dates and units and shows values as stored, without flags or
interpretation; the document says it is not medical advice. It is generated
on request for anyone with read access to the active workspace and returned
once in the response: the server does not write it to disk or object storage
and keeps no download link. Each export writes a value-free `EXPORT_GENERATED`
audit entry. Sections list at most 500 rows each; the CSV export has the full
list. The mobile app still offers the older printable HTML view.

### Audit log

The **Audit log** page (`/audit`) lists who added, changed, deleted, shared or
exported records in the active workspace, newest first, filterable by event
and date range. It is available to workspace owners only. Entries show event
types, record identifiers and member ids. They never show record values,
previous values, IP addresses or user agents.

A complete, machine-readable export of everything a person owns (JSON and CSV
per table, with a manifest and checksums) is implemented in the server code
(`packages/data-rights`) but is **not offered in the app or API at 0.1.0**
(Issue #89). If someone asks for a complete copy of their data today, you
cannot produce it from the app.

### Delete everything

**Settings → Delete account and all data** (web and mobile) permanently
deletes the person's account and every workspace they own, with all its
records:

- The page shows how many rows will be deleted and links to the export first.
- It requires a sign-in within the last 10 minutes (the page can email a fresh
  sign-in link) and typing `DELETE`.
- It is blocked while a workspace they own has another owner; that owner must
  be removed, or the workspace transferred, first.
- Deletion runs in one database transaction. An erasure-ledger row keeps the
  deleted ids and row counts, without the data itself, so the deletion can be
  repeated after a restore.

Deletion removes data from the live database only. **Earlier backups still
contain it** until they are pruned or deleted, and restoring one brings the
data back; see [Backups](backup.md#deleted-accounts-and-old-backups).
Application logs do not contain health values, so they hold nothing to delete
beyond identifiers.

## Not covered yet

- A complete export in the app (#89).
- Export and deletion coverage for every module: each new module adds its own
  coverage (#89).
- Replaying the erasure ledger after a restore (#64).
