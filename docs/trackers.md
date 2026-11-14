# Custom trackers

Custom trackers (#441) are small trackers a member defines: a number, a 1–5
scale, yes/no or a duration. The service is `@openvalens/trackers`
(`packages/trackers/src/service.ts`); the API is `trackers.*` in
`packages/api/src/routers/trackers.ts`; the tables are in
`packages/db/src/schema/trackers.ts`.

## Phone feeds (#452)

A member links a feed from their phone to one of their own trackers:

| Feed                         | Source           | Tracker type |
| ---------------------------- | ---------------- | ------------ |
| `healthkit_mindful_sessions` | `healthkit`      | duration     |
| `health_connect_mindfulness` | `health_connect` | duration     |
| `healthkit_state_of_mind`    | `healthkit`      | 1–5 scale    |

The link lives on the server (`custom_tracker_feed`), one tracker per feed per
member. The phone sends what it reads to `trackers.importFeed`, which writes
`custom_tracker_entry` rows with `source` and `source_record_id`. The partial
unique index on (organization, user, tracker, source, source record id) makes
a re-import a no-op, so a retry or a re-read after a cursor reset never
duplicates. Health Connect re-reads the last 7 days on every sync; HealthKit
clears its cursors on sign-out and re-reads the full history at the next
sign-in.

`importFeed` returns three counts:

- `imported`: new entries written.
- `duplicates`: records already imported into this tracker, left as they are
  (with any change the member made).
- `skipped`: records refused: a value the tracker cannot hold, a time in the
  future, or a record whose entry the member deleted (see below).

## Deleted imports (#506)

Deleting an entry hard-deletes it. For an imported entry, the same transaction
also writes a tombstone to `custom_tracker_entry_tombstone`: organization,
user (the tracker's owner), tracker, source and source record id, plus
`deleted_at`. `importFeed` skips a record that has a tombstone for the same
tracker and source and counts it as `skipped`. Without it, the next re-read
would bring the deleted entry back. Deleting a manual entry writes no
tombstone.

What clears tombstones:

- **Unlinking a feed keeps them.** Unlinking stops imports and keeps the
  entries already imported. Linking the feed to the same tracker again must
  not bring back what the member deleted, so the tombstones stay too.
- **Moving a feed to another tracker** does not carry them over. Tombstones
  belong to a tracker, so the other tracker imports those records. The
  member asked for that tracker to be filled.
- **Deleting the tracker clears them.** The tombstone has the same composite
  foreign key to `custom_tracker` as the entries, `ON DELETE CASCADE`.
- **The member leaving the workspace, or account deletion,** cascades through
  the same member, user and organization foreign keys as the entries.

There is no way to undo a deletion and import the record again, other than
deleting and recreating the tracker.

## Data rights

`custom_tracker`, `custom_tracker_entry`, `custom_tracker_feed` and
`custom_tracker_entry_tombstone` are `user` tables in
`packages/data-rights/src/registry.ts`: the subject export includes the
member's rows and subject erasure deletes them. See
[the data map](legal/data-map.md).
