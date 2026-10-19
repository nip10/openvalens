# Plain-water backend checkpoint (#83)

This checkpoint provides a private domain-service and additive persistence
foundation for manually recorded **plain water**. It is not wired into an HTTP
contract or a client yet. It has no reminders, streaks, hydration advice, or
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
state. A client API contract, authentication/impersonation gates and client
outbox integration remain pending; this service alone is not a shipped feature.
