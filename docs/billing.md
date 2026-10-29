# Billing (OpenValens Cloud)

Issue #297. Stripe subscriptions with a 30-day free trial, for **OpenValens
Cloud only** (`DEPLOYMENT_MODE=cloud`). A self-hosted server never loads the
billing package or the Stripe SDK, mounts no billing route, shows no Plan &
billing screen, and needs none of the settings below.

## What people see

- **Sign-up starts a 30-day trial with no card.** The trial is tracked by
  OpenValens (`subscription.trial_ends_at`); no Stripe customer exists until the
  person subscribes. Someone who signs up in the mobile app can use Cloud with
  no purchase flow.
- **Settings › Plan & billing** on the web: status, days left in the trial,
  **Subscribe** (Stripe Checkout, monthly or annual) and **Manage** (Stripe
  Customer Portal: card, invoices, cancel).
- Subscribing during the trial keeps the rest of it: the first charge is when
  the trial would have ended (when more than 48 hours are left).
- **Only the workspace owner pays.** People invited into someone else's
  workspace are covered by that owner.
- **The mobile app has no billing UI**: no price, no Subscribe button, no link
  to Checkout or to Plan & billing (App Store Review Guideline 3.1.3(f)).
  `scripts/native-no-billing.test.ts` guards this.
- Emails (en, pt-PT): trial ends in 3 days, trial ended, payment failed,
  subscription cancelled. They link to Plan & billing on the web and say the
  person's records stay and can be exported.

Prices: **€7.99 per month or €69 per year, VAT included.** The amounts shown on
Plan & billing are read from the Stripe prices, so Stripe is the single source.

## Subscription states

| State      | Meaning                                                               |
| ---------- | --------------------------------------------------------------------- |
| `trialing` | The free trial is running (or Stripe's trial after an early Checkout) |
| `active`   | Paid and current; may be set to cancel at the period end              |
| `past_due` | Stripe could not collect a renewal (`past_due` or `unpaid`)           |
| `canceled` | The Stripe subscription ended                                         |
| `ended`    | The trial ran out and the person never subscribed                     |

`effectiveStatus` in `packages/billing/src/status.ts` treats a local trial past
its end as `ended` even before the scheduled job records it.

## What each state allows (Issue #298)

| State                                    | Read | Write | Export / delete account | AI coach |
| ---------------------------------------- | ---- | ----- | ----------------------- | -------- |
| `trialing`, `active`                     | yes  | yes   | yes                     | yes      |
| `past_due`, within the grace period      | yes  | yes   | yes                     | yes      |
| `past_due` after the grace period        | yes  | no    | yes                     | no       |
| `canceled`, `ended`, no subscription row | yes  | no    | yes                     | no       |

- **Ended means read-only, never deleted.** Every write is refused with the
  typed error `ACCESS_READ_ONLY` (HTTP 403); reading, export (JSON, CSV, PDF,
  clinical bundle) and account deletion always work (#89).
- **Grace period:** `BILLING_PAST_DUE_GRACE_DAYS` (default 7) days from the
  first failed renewal (`subscription.past_due_since`). Stripe's automatic
  retries do not restart it; a paid invoice clears it.
- **Access follows the workspace owner.** The check resolves the owner of the
  active workspace and uses that person's plan: an invited member never pays
  and is read-only exactly when the owner is. Plan & billing shows members a
  neutral "your access comes from <owner>'s plan" note with no prices,
  Checkout or portal, and `billing.checkout` refuses them.
- **Self-host never runs the check**: it returns before resolving anything.

### How procedures are classified

`packages/api/src/access-policy.ts` gives every oRPC procedure a class:
`read`, `write`, `ai` (refused when read-only, like `write`) or `always` (data
rights, exports, consent withdrawal, removing someone's access, billing,
sign-in, the access state itself). The check runs in `protectedProcedure`, so
every authenticated procedure passes through it, and a procedure **missing
from the map is treated as `write`** (default deny). `access-policy.test.ts`
walks the whole router and fails when a procedure is unclassified or a listed
one no longer exists, so a new procedure cannot ship without a reviewed class.
Reads never query the plan; only `write`/`ai` calls on Cloud do (one indexed
query).

### Apps

- **Web:** a calm banner on every signed-in page while read-only (and, for the
  owner, during the payment grace period with its end date), linking owners to
  Plan & billing. `access.status` is the plan-neutral read behind it.
- **Mobile:** a neutral notice ("Your OpenValens Cloud access has ended. Your
  records are still here, and you can export them.") with a link to the in-app
  export screen only: no price, Subscribe button or Checkout link.
- **Phone sync** (HealthKit / Health Connect) reads `access.status` before
  each run and skips while read-only, without reading the health store or
  moving its cursors, so the next run after access is back resumes where it
  stopped. A refused batch also stops the run (`ACCESS_READ_ONLY` is fatal for
  that run), and the offline outbox does not queue writes that would be
  refused. Cloud wearable vendor syncs skip the workspace the same way.

### Retention of ended accounts

`CLOUD_ENDED_RETENTION_MONTHS` (unset by default: **nothing is ever deleted**)
sets how long an owner may stay read-only before their account is deleted. The
operator chooses N and states it in the privacy policy (#300). With N set, the
hourly billing job:

1. Sends one "your records will be deleted" email when the owner has been
   read-only for N months less 30 days. It names the date (N months after the
   end, and never less than 30 days after the email) and links to Plan &
   billing.
2. Deletes the account when it has been read-only for N months **and** the
   email went out at least 30 days earlier, through the same erasure as "delete
   everything" (database rows, stored objects, Apple tokens, the Stripe
   customer, an erasure-ledger entry). The state is re-checked inside the
   deletion transaction, so an owner who subscribed in the meantime is kept.
   Subscribing again also clears the warning.

The start of the clock is `subscription.ended_at` (or, past due, the end of
the grace period). `CLOUD_ENDED_RETENTION_DRY_RUN=true` only counts and logs
what is due (`billing.retention.dry_run`); use it to check the numbers before
turning deletion on. Logs carry counts only.

## Set up Stripe (owner, once per Stripe account)

Do this in test mode first, then repeat in live mode.

1. **Product and prices.** Create one product, "OpenValens Cloud", with two
   recurring prices in EUR: **7.99 monthly** and **69.00 yearly**. On both,
   set _Include tax in price_ (`tax_behavior: inclusive`). Copy the two price
   ids (`price_…`) into `STRIPE_PRICE_MONTHLY` and `STRIPE_PRICE_ANNUAL`.
2. **Stripe Tax.** Turn on Stripe Tax, set the head office address, and add
   the registrations you hold (for an EU seller selling to consumers, typically
   your home country plus the EU One-Stop Shop, OSS). Set the product's tax
   code to _Software as a service (SaaS) – personal use_ (or the one your
   accountant advises). Checkout sends `automatic_tax: { enabled: true }` and
   collects the address Stripe needs to apply each EU country's VAT, so the
   person always pays exactly €7.99 or €69.
3. **Customer Portal** (Settings › Billing › Customer portal): allow updating
   the payment method, viewing invoice history and cancelling subscriptions
   (at the end of the billing period is recommended). Optionally allow
   switching between the two prices. Set the business name, privacy policy and
   terms links (#300). Leave customer name/address/tax id editing off unless
   you need it.
4. **Invoices and emails.** In Settings › Billing › Subscriptions and emails,
   turn on emailed receipts/invoices if you want Stripe to send them (OpenValens
   sends only the four emails above). Enable Smart Retries for failed payments.
5. **Webhook endpoint** (Developers › Webhooks): add
   `https://<domain>/api/billing/webhook` with exactly these events:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
   - `invoice.payment_failed`

   Copy its signing secret (`whsec_…`) into `STRIPE_WEBHOOK_SECRET`.

6. **API key.** Create a **restricted key** (`rk_…`) with _Write_ on Customers,
   Checkout Sessions, Customer portal and Subscriptions, and _Read_ on Prices
   (and Events). Put it in `STRIPE_SECRET_KEY`.

## Configure the server

```bash
# deploy/.env
DEPLOYMENT_MODE=cloud
STRIPE_PRICE_MONTHLY=price_...
STRIPE_PRICE_ANNUAL=price_...
LEGAL_CHECKOUT_ACK_VERSION=<lawyer-reviewed-version>
```

Cloud startup also requires `LEGAL_CHECKOUT_ACK_VERSION` (1–64 characters).
Set it only after the checkout acknowledgement wording has been approved; the
server returns this exact version with the existing `LEGAL_TERMS_URL`. Each
owner must separately confirm immediate paid-service commencement and the
withdrawal-right implications before Checkout. Invited workspace members
remain covered by their owner's plan and are not offered billing.

The two secrets are files, as for every other secret
(`deploy/secrets/server/STRIPE_SECRET_KEY` and
`deploy/secrets/server/STRIPE_WEBHOOK_SECRET`); `deploy/setup.sh install` sets
the `_FILE` variables when the files exist. In Cloud the server refuses to start
when any required Cloud legal/billing key is missing or malformed; the error names the key, never the
value.

With AI configured, Cloud also refuses to start without a monthly AI cost cap
per person (`AI_MONTHLY_COST_LIMIT` and the model's prices); see
[AI providers › Monthly usage cap](ai-providers.md#monthly-usage-cap).

Schedule the billing job hourly with the other jobs (see
[configuration](self-hosting/configuration.md#scheduled-jobs)):

```bash
50 * * * * curl -fsS -X POST https://<domain>/rpc/cron/billingRun -H "Authorization: Bearer $(cat .../CRON_SECRET)" -H 'Content-Type: application/json' -d '{"json":{}}' >/dev/null
```

It sends the trial emails (each once per owner), marks ran-out trials as
`ended`, retries the Stripe side of account deletion, prunes webhook event
ids older than 90 days and, when configured, runs the retention of ended
accounts (see above).

To try it locally with the Stripe CLI:

```bash
stripe listen --forward-to localhost:3000/api/billing/webhook   # prints a whsec_ for STRIPE_WEBHOOK_SECRET
stripe trigger checkout.session.completed
```

## How webhooks are applied

`POST /api/billing/webhook` (Caddy routes `/api/*` to the server):

- The signature is verified over the **raw request body**. The global body
  limit (`API_MAX_BODY_BYTES`, 1 MiB by default) runs first and passes the same
  bytes through; Stripe events are far smaller.
- Each event id is recorded (`billing_webhook_event`) in the same transaction
  that applies it. A duplicate is a no-op; a failure rolls back and answers 500,
  so Stripe's retry applies it.
- The state is never taken from the event payload. Each event re-reads the
  customer's subscriptions from Stripe under a row lock, so events that arrive
  out of order, late or twice all end in Stripe's current state.
- Emails go out on transitions: "subscription cancelled" when the state first
  becomes `canceled`, "payment failed" for the first `invoice.payment_failed`
  of a run (Stripe's automatic retries do not send it again).

## Privacy

- Stripe receives the account **email** (for receipts and invoices) and an
  **opaque reference** (`customer_ref`, random, not the user id) as
  `metadata.ov_ref` and `client_reference_id`. Nothing else: no name, no
  workspace name, no health data. Tests assert the metadata has no other key.
- Billing logs carry event types, counts and value-free error codes only.
- The `subscription` row is the person's data: it is in their export and is
  erased with the account.

## Account deletion

Deleting an account (in any subscription state) removes the `subscription`
row. A database trigger queues its Stripe customer in
`billing_customer_erasure` in the same transaction, whatever path removed the
row. Right after the deletion commits, the billing service **cancels the Stripe
subscription immediately** (no proration, no final invoice) and **deletes the
Stripe customer**; a failure is retried by the hourly billing job.

Invoices that Stripe already finalized stay in the Stripe account after the
customer is deleted. They are the operator's accounting records, which tax law
requires keeping (in Portugal, 10 years); they hold the billing email and
address Stripe collected, not health data. Say so in the privacy policy (#300).
