# Checkout acknowledgements — implementation handoff (DRAFT)

**Not approved for publication. Final wording requires lawyer review.** This
implementation records two distinct, affirmative owner acknowledgements before
Stripe Checkout. Neither control is preselected, and neither is a blanket
waiver of statutory rights.

## Wording concepts for counsel

1. Immediate commencement: the owner expressly requests that the paid service
   begin immediately after subscription, rather than waiting until the end of
   any applicable withdrawal period.
2. Withdrawal implications: the owner acknowledges that, if they withdraw
   during an applicable statutory period after service has begun, they may owe
   a proportionate amount for service already supplied, as applicable under
   governing law. This acknowledgment must not imply that withdrawal rights are
   waived or lost except where the law expressly permits that result.

Counsel must settle exact wording, applicable jurisdiction and how the
acknowledgements interact with the service start and subscription activation.
The applicable 14-day period's legally correct start point is an open question
for counsel; do not assume the click, Checkout completion, subscription start,
or another event without advice. Reconcile the final copy with pending PR320
before approval or publication.

## Implementation notes

- Cloud billing returns the server-owned `LEGAL_CHECKOUT_ACK_VERSION` and
  `LEGAL_TERMS_URL` in status. Checkout must submit that version and two
  independent true values; the billing service rechecks both and the current
  version before any Stripe customer or session call.
- Acceptance records hold user id, exact version, timestamp, both true-only
  flags and (when available) the Stripe Checkout session id. They are user-owned
  export/erasure data. A failed Checkout can leave an acceptance record; it is
  not evidence that a purchase completed.
- Stripe receives only an opaque acceptance-record reference in metadata, not
  the wording, version, workspace name or health information.
- Set `LEGAL_CHECKOUT_ACK_VERSION` only after counsel approves the deployed
  wording. Changing wording requires a new server-side version.

Do not close the related issue or publish this draft until counsel has approved
the wording and PR320 reconciliation is complete.
