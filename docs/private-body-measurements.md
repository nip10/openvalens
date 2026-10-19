# Private manual body measurements (#85 backend)

Manual measurements are stored in `private_body_measurement`, scoped to both
the active organization and the authenticated user. They are intentionally
separate from legacy organization-visible weight/body-composition records.
Every read and mutation requires the `weight` permission and a trusted,
non-impersonated self session; owner/admin roles do not expose another member's
records. Client inputs cannot select a user or organization.

The feature is opt-in per account through `privateBody.setPreference`; no
preference row means disabled. The preference is independent from weight
targets and does not change them. Turning it off gates measurement access but
does not erase records; explicit delete or the existing subject-erasure flow
removes them.

## API handoff

- `privateBody.preference({})` → `{ enabled }`
- `privateBody.setPreference({ enabled })` → `{ enabled }`
- `privateBody.list({})` → own measurements in the active organization, newest
  first (maximum 500); returns an empty array while disabled.
- `privateBody.create({ kind, value, unit, measuredAt })` → created row.
- `privateBody.update({ id, value: { kind, value, unit, measuredAt } })` → row.
- `privateBody.delete({ id })` → `{ deleted: true }`.

Supported `kind` values: `weight` (`kg`, `lb`), `waist`, `hip`, `neck`,
`chest`, `upper_arm`, `thigh` (`cm`, `in`). The value must be finite, positive,
and at most 1000; this is a technical input bound, not a recommended or
clinical range. `measuredAt` must be a valid ISO timestamp with an explicit
timezone offset. Stored rows retain the entered numeric value, unit, timestamp,
and fixed `manual` source; no conversions, scores, inferences or ranges are
applied.

Both measurement and preference tables are classified as user-owned by the
data-rights registry, so subject exports contain only that user's rows and
subject erasure removes them. Photo processing and sharing remain out of scope.
The web and native screens support opt-in, manual entry, and history. Both omit
stored numeric values until the client can confirm the hide-numbers preference;
users enter a replacement value to edit a saved record. The native screen is
online-only and scopes query cache entries to the signed-in user and active
workspace. Turning measurements off gates access but does not delete records.
Hide-numbers preference integration and photos remain pending.
