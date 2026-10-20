# Plain-water backend checkpoint (#83)

This checkpoint provides a private domain-service, additive persistence
foundation, and authenticated HTTP contract for manually recorded **plain water**.
Its web and native client surfaces are described below. It has no reminders, streaks, hydration advice, or
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
data-rights exports. The native outbox ships separately; the client surface (#83) is described
below. Neither changes the contract above.

Export remains member-private and includes only the subject's own water rows.
Erasure preview/deletion also includes water rows in containers the subject
owns and is deleting (including other members' water records in that removed
container), plus the subject's own water rows in memberships that remain. The
organization foreign keys cascade for container deletion; the composite member
integrity constraints remain restrictive. Subject erasure explicitly deletes
water entries, preferences, and replay receipts before membership rows.

## Native outbox integration

`usePlainWaterOutbox()` is exported from `apps/native/lib/plain-water/sync.ts`. It returns `{ scope, items, busy, error, enqueue, retry, discard, resolveConflict, syncNow }`. Enqueue takes `{ kind: "add" | "change" | "delete", input }` with the corresponding `plainWater` strict API input; callers must retain a mutation ID for a logical operation. It returns a persisted item or `null`; `null` plus `error: "STORAGE"` means persistence failed and no queued success should be shown. Items expose a stable ID, status, original payload, attempts, error code, and server conflict entry. `discard(id)` returns true only after confirmed local removal and is fail-closed for uncertain/in-flight writes. `resolveConflict(oldId)` atomically replaces a current authoritative conflict row with a fresh queued operation using the server conflict revision and preserved intent. It returns true only after SQLite confirms the conditional row update; unsupported stores, stale conflicts, collisions, and failed/no-op updates return false. There is no enqueue-then-discard fallback. After confirmed replacement, notification or sync-refresh errors do not turn the committed replacement into a reported rollback. A restart sees either the original conflict or the replacement; retries keep the replacement's new ID and exact payload. Current session scope is revalidated before each transport; confirmed application/replay invalidates `orpc.plainWater`. Day reads should be queried by date and timezone and invalidated after edits. For offline display privacy, use the existing scoped `nutrition-display-preference` cache (`readCache` with the outbox scope), not a water-owned setting; if neither a successful current read nor that cache establishes visibility, render quantities hidden. Server projection remains authoritative.

Water rows are stored in the scoped SQLite `plain_water_outbox` table, separate from the meal-diary `nutrition_outbox`. The two outboxes never list, drain or clear each other's rows; meal "clear diary data" therefore preserves pending water changes. Existing offline storage protections and retention behavior apply; this adds no separate encryption claim.

## Client surface (#83)

The optional plain-water card appears in the web and native nutrition screens
between the day's targets and the meal add flow. It records plain water only:
its sum is labelled **Plain water subtotal** and is never added to meal totals,
never called total hydration, and never shown as progress, a percentage, a
streak or a verdict. There is no default or universal goal. A goal exists only
after the member sets one, is stored in millilitres, and is rendered as their
own reference in the chosen display unit. The single definitional line is
"Plain water only, separate from meals and other drinks."

The feature follows the existing `hideNumbers` preference. Visibility comes
from the current success or the scoped `nutrition-display-preference` cache; if
neither is available, numbers stay hidden. Redaction happens when the display
model is built and again when it is formatted, from the day read, the
preferences and the queue, so a cached or queued amount cannot reach text,
placeholders, accessibility labels or conflict previews. Server-nulled
quantities are not the only guard: a visible preference with a stale redacted
read shows "Not available on this device" instead of a sum. Logging, editing
by re-entering a hidden amount, and deleting keep working while hidden.

The card is off by default, using the server `enabled` value. While off, saved
entries are not listed and no amount, goal or sum is shown; Turn on writes the
preference. Enabling and goal changes are direct mutations with a visible
failure, never queued writes, so the switch never reports success it did not
get. An unknown preference or a failed read shows a retry and no numbers.

Display unit (ml, L, fl oz) is session-local; no persisted display preference
and no new wire field. Web remains online-only. Its pending operation and exact
mutation ID/payload are immutable in-memory state for retrying an uncertain
acknowledgement; navigation, unmount, or reload loses that retry state, so it
is not durable. Retrying the mutation reuses its ID and payload. Refreshing
reads current server state but is not a mutation retry. Settings failures use
uncertainty-aware copy and do not claim the setting remained unchanged. While
an add may have committed but is unresolved, the UI does not show a duplicate
optimistic row or a definitive subtotal; the aggregate is described as
unconfirmed instead. Adds are grouped by the requested diary day's timezone,
while retaining the operation's recorded timezone for its original timestamp.

The web form lifecycle retires only the exact draft generation that submitted
an operation after confirmed completion, successful rebase, or Keep other.
An uncertain retry remains attached to its original generation; a newly opened
form cannot claim or resubmit that operation. Privacy resets may clear rendered
fields without discarding the pending immutable retry.

Delete coordination is independent of an originating add/edit form generation:
retry resends the same immutable mutation ID and payload, conflict rebase uses a
fresh ID and the current server revision, and Keep other releases only an
authoritative conflict. A refused add/edit while a delete is active does not
adopt or resolve the delete. Successful add/edit continuations retire a form
only while its submitted generation is still the live editor, preserving a
newer reopened draft.

Native uses `usePlainWaterOutbox()` and shows queued, syncing, needs-attention
and conflict states. A conflict is never treated as a save. `discard(id)` is
true only after confirmed local removal. It is allowed for a demonstrably
unsent queued item (zero attempts), an authoritative conflict receipt, or a
first authoritative known rejection. Attempted/recovered uncertainty persists
through later attention errors; later rejections after a prior attempt and
syncing writes cannot be discarded or treated as proof of non-application.
Conflict "Keep my change" uses `resolveConflict(oldId)` to atomically replace
the conflict row with a fresh mutation ID and the current server revision,
preserving the original intent. There is no compensating enqueue/discard path;
the UI reports success only after confirmed local replacement and says it is
saved on this device, not that the server accepted it. A retry reuses the
replacement's same ID and payload. Native time entry is a validated 24-hour
`HH:MM` field plus a Now shortcut; skipped DST wall times are refused and
ambiguous times resolve to the earlier instant. Time-only edits preserve the
exact stored quantity and unit; an amount or unit edit submits an intentional
quantity. Privacy changes synchronously reset displayed form/editor state.
Persisted proof is runtime-validated before it is treated as authoritative:
receipt identity/payload and the expected conflict marker/target must agree, or
the record must be an authoritative first-attempt known rejection. Missing,
malformed, or contradictory proof remains uncertain and cannot authorize
discard. A corrupt/unreadable queue is represented as a storage error rather
than an empty queue; the existing screen withholds queue/day/settings actions
until storage can be read again, and can recover after the persisted row is
repaired.
Delete is an inline two-step confirmation with no undo, because there is no
restore endpoint.

Drafts, open editors and conflict revisions are scoped to one diary day and
reset on a day or account change. Unresolved attempted adds/changes do not
produce duplicate optimistic records, definitive subtotals, or a false empty
state. An attempted write that later enters needs-attention remains uncertain
unless an authoritative server conflict receipt or first-attempt known rejection
establishes non-application. This prevents cached totals from being presented
as definitive while reconciliation is unresolved. The client adds no new
dependency, motion, colour, font or icon, and does not change routers,
contracts, schema, the nutrition domain or the meal diary. Water is not
included in insights, coach, nutrition targets or meal totals.

## Mounted regression evidence

The actual web `PlainWaterSection` is exercised with Happy DOM, Testing Library,
a fresh real `QueryClientProvider`, and a controlled global-fetch boundary that
uses the real oRPC `RPCHandler` wire codec. Run the isolated DOM process from
`apps/web` with `bun run test:mounted-water`; it currently executes five mounted
regressions. Default `bun test` discovery leaves this entry environment-gated
and skips it without importing the DOM setup, so it does not contaminate the
ordinary non-DOM suite. CI runs the dedicated command after root tests.

These mounted tests cover delete acknowledgement-loss Retry with stable ID and
payload, delete conflict rebase/Keep other, add/edit refusal while delete is
uncertain, and held add/edit success while a newer draft/editor is open. The
delete regression failed before the fix with expected two transport attempts,
received one. The mounted add race reproduced disappearance of the newer Amount
input before the generation guard; held add and edit cases pass afterward.
Native SQLite tests also reproduce false certainty from invalid proof and silent
empty results from corrupt persisted JSON. An earlier missing-helper-import
failure was a harness failure, not behavioral RED evidence. Mounted DOM
assertions are not evidence of actual browser layout/rendering or native-device
behavior.
