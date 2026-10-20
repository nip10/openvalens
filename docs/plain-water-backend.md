# Plain-water backend checkpoint (#83)

This checkpoint provides a private domain-service, additive persistence
foundation, and authenticated HTTP contract for manually recorded **plain water**.
It is not wired into a client yet. It has no reminders, streaks, hydration advice, or
universal goal; it does not combine logged water with other beverages or water
in foods. A displayed amount must be called a **Plain water subtotal**, never
total hydration or total dietary water.

The member's feature preference defaults off. Enable it explicitly before
adding, editing, or listing water entries. When disabled, a day read returns
only `enabled: false` and an empty entry list with a null subtotal and goal;
manual own-data deletion remains available so opting out does not prevent
removing personal records. Opting out hides rather than erases entries and
does not modify a personal goal. Re-enabling makes retained entries visible
again. Goals are unset until explicitly supplied by the member and can be
cleared independently.

Amounts normalize to millilitres from `ml`, `l`, or US fluid ounces. The
technical storage cap is solely an input/overflow guard and is not a clinical
cutoff or recommendation. Day queries use the requested IANA timezone and
calendar date, including DST transitions. Entries, preferences and replay
receipts are user-owned in the data-rights registry so export and subject
erasure include them, including when the subject owns a shared workspace.

The water-specific durable receipt table binds a mutation ID to its operation,
canonical payload fingerprint, and result. An identical retry returns its
original result; reuse for a different operation or payload is rejected.
Transactions take a member/mutation advisory lock before receipt lookup and
write, so parallel retries cannot create duplicate entries. Edit/delete use
expected revisions and return a recorded conflict instead of overwriting stale
state. The `plainWater` router scopes requests to the trusted, non-impersonated
session member and server-resolved active organization; client identity and
tenant fields are rejected. Until #80's preference is wired, API display
responses fail closed and suppress quantities/goals (including replay and
conflict entries). Canonical data remains available to explicit user-initiated
data-rights exports. Client outbox and UI remain pending; this API alone is not
a shipped feature.

Export remains member-private and includes only the subject's own water rows.
Erasure preview/deletion also includes water rows in containers the subject
owns and is deleting (including other members' water records in that removed
container), plus the subject's own water rows in memberships that remain. The
organization foreign keys cascade for container deletion; the composite member
integrity constraints remain restrictive. Subject erasure explicitly deletes
water entries, preferences, and replay receipts before membership rows.

## Native outbox integration

`usePlainWaterOutbox()` is exported from `apps/native/lib/plain-water/sync.ts`. It returns `{ scope, items, busy, error, enqueue, retry, discard, syncNow }`. Enqueue takes `{ kind: "add" | "change" | "delete", input }` with the corresponding `plainWater` strict API input; callers must retain a mutation ID for a logical operation. It returns a persisted item or `null`; `null` plus `error: "STORAGE"` means persistence failed and no queued success should be shown. Items expose a stable ID, status, original payload, attempts, error code, and server conflict entry. Conflicts stay held; retry only restarts non-conflict failures, while discard is explicit. Current session scope is revalidated before each transport; confirmed application/replay invalidates `orpc.plainWater`. Day reads should be queried by date and timezone and invalidated after edits. For offline display privacy, use the existing scoped `nutrition-display-preference` cache (`readCache` with the outbox scope), not a water-owned setting; if neither a successful current read nor that cache establishes visibility, render quantities hidden. Server projection remains authoritative.

Water rows are stored in the existing scoped SQLite `nutrition_outbox` table with a water-specific key prefix. Existing offline storage protections and retention behavior apply; this adds no separate encryption claim.
