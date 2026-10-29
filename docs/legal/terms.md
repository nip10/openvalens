# OpenValens Cloud Terms of Service

> **Draft — not yet in force, not legal advice; to be reviewed** by the owner
> and a lawyer before publication. Placeholders in `[BRACKETS]` must be filled
> in; `[CONFIRM]` marks facts to check; **Lawyer:** notes are questions for
> review and are removed on publication. English only; a pt-PT version follows.

**Version:** `draft-2026-10-29` (published as `[YYYY-MM-DD]`, the value of
`LEGAL_TERMS_VERSION`) · **Applies from:** `[EFFECTIVE DATE]`

## 1. Who we are and what these terms cover

OpenValens Cloud ("Cloud", "the service") is the hosted version of OpenValens
at `app.openvalens.com`, run by `[COMPANY LEGAL NAME]` ("we", "us"), a company
registered in Portugal (details in section 19).

These terms are the contract between you and us for using Cloud, on the web
and through the OpenValens mobile apps. Our [Privacy Policy](privacy.md)
explains how we handle your personal data, including your health data.

These terms do **not** cover:

- **Self-hosted servers.** OpenValens is free software that anyone can run.
  When you connect the app to a server you or someone else runs, that server's
  operator, not us, provides the service and is responsible for your data.
- **The source code.** The code is licensed under the GNU AGPL-3.0-or-later
  with an additional permission for app stores (`LICENSE`,
  `LICENSE-APP-STORE`). Nothing in these terms limits your rights under that
  licence. The OpenValens name and logo are covered by our trademark policy
  (`TRADEMARK.md`).
- **The app stores.** Apple and Google distribute the free mobile apps under
  their own terms. Cloud is not sold through the app stores.

## 2. What OpenValens is, and what it is not

OpenValens is a personal record-keeping and general-wellness app. It helps you
store, organise and view your own health-related records and track healthy
habits. **It is not a medical device**, it is not intended to diagnose, screen
for, prevent, monitor, predict, treat or alleviate any disease or condition,
and it does not provide medical advice. Talk to a qualified healthcare
professional about your health.

Scores, trends, insights, reference ranges and anything the AI coach writes
are general information to help you look at your own records. Do not use them
to make medical decisions or to delay seeking care. In an emergency, call your
local emergency number (112 in the EU).

## 3. Your account

- You need an account to use Cloud. You can sign up with an email link, or
  with Google or Apple if you prefer. You must be at least `[MINIMUM AGE]`
  years old and able to enter into a contract.
- At sign-up you accept these terms and confirm you have read the Privacy
  Policy, and you give your explicit consent to the processing of your health
  data (Privacy Policy, section 4). We record the versions you accepted and
  when.
- Keep access to your email and sign-in methods secure. You are responsible
  for what happens in your account unless it is caused by our failure to
  protect it. Tell us at `[SUPPORT EMAIL]` if you think someone else has
  access.
- **Workspaces.** Your account comes with your own workspace, the place where
  your records are kept, and you are its owner. You can invite other people
  into your workspace and decide what they can see and do. You are responsible
  for whom you invite. People you invite need their own account; they do not
  pay, because your plan covers them.

## 4. Free trial

- A new workspace owner gets a **30-day free trial**. No payment card is
  needed and nothing is charged during the trial.
- The trial does not turn into a paid plan by itself. If you do not subscribe
  before it ends, your access becomes read-only (section 12).
- One trial per person. We may refuse a new trial to someone who has already
  had one. `[CONFIRM: is this enforced or only a policy?]`

## 5. Price, billing and renewal

- **Price:** €7.99 per month or €69 per year. **Prices include VAT.** VAT is
  calculated by our payment provider for your country, so the amount you pay
  is always the price shown.
- **Who pays:** only the owner of a workspace. People you invite are not
  charged.
- **Where you pay:** subscriptions are bought only on the web, through Stripe
  Checkout, under **Settings › Plan & billing**. The mobile apps are free
  companions and do not sell anything.
- **Payment:** Stripe processes your payment. We never see or store your full
  card details.
- **Subscribing during the trial** keeps the rest of the trial: your first
  charge is on the day the trial would have ended (when more than 48 hours of
  it are left).
- **Renewal:** your subscription renews automatically at the end of each
  monthly or yearly period, and the price is charged to your payment method,
  until you cancel. Your invoices are available in the Stripe Customer Portal
  (**Manage** under Plan & billing).
- **Failed payments:** if a renewal cannot be collected, you keep full access
  for `[BILLING_PAST_DUE_GRACE_DAYS, default 7]` days while Stripe retries.
  After that, your access becomes read-only until the payment succeeds.
- **Price changes:** we will tell you by email at least `[30]` days before a
  new price applies to you. A new price applies only from your next renewal
  after that notice, and you can cancel before it takes effect.

## 6. Your right of withdrawal (EU consumers)

If you are a consumer in the EU, you have the right to withdraw from the paid
subscription within **14 days** without giving any reason.

- The withdrawal period runs for 14 days from the day the paid subscription
  contract is concluded, which is when you complete Stripe Checkout. The free
  trial is not a paid contract; you can stop using it at any time without
  doing anything.
- To withdraw, tell us clearly, for example by email to `[SUPPORT EMAIL]`, or
  using the model form in the annex. Sending it before the 14 days end is
  enough.
- **If the paid service starts during the withdrawal period.** When you
  subscribe, you ask us to start (or continue) the paid service immediately,
  without waiting for the 14 days to pass, and you acknowledge that if you
  withdraw you will pay for the service provided until you told us. If you
  then withdraw, we refund everything you paid **minus an amount proportionate
  to the service provided** up to your withdrawal, within 14 days of receiving
  it, to the payment method you used.
- If you subscribe during the trial and withdraw before the first charge,
  nothing is charged and nothing is owed.

> **Lawyer:** (1) Directive 2011/83/EU art. 14(3) and Decreto-Lei 24/2014
> require the express request and the acknowledgement to be made by the
> consumer and confirmed on a durable medium. Stripe Checkout does not capture
> either today (#297 follow-up); without it, a withdrawing consumer owes
> nothing. (2) Alternative the owner may prefer: always refund in full on
> withdrawal within 14 days, which avoids the proportionate calculation.
> (3) Confirm that the period starts at Checkout, and not at the end of the
> trial, when someone subscribes during the trial. (4) Confirm the wording of
> the model withdrawal form and the confirmation email.

## 7. Cancellation and refunds

- You can cancel at any time in the Stripe Customer Portal (**Settings › Plan &
  billing › Manage** on the web). You do not need to contact us.
- Cancellation takes effect **at the end of the current billing period**. You
  keep full access until then, and you are not charged again.
- Apart from the right of withdrawal (section 6) and anything consumer law
  requires, payments already made for a period that has started are not
  refunded, also when you cancel or delete your account in the middle of a
  period. `[CONFIRM: owner's refund policy — e.g. pro-rata refund of an annual
plan on request?]`
- Deleting your account cancels your subscription immediately (section 12).

## 8. Your data

- **Your records are yours.** You keep all rights in the records, files and
  text you put into Cloud. You give us only the permission we need to store,
  process, display and back them up in order to provide the service to you
  and to the people you share your workspace with, as described in the
  Privacy Policy.
- **Export.** You can export your data at any time, in every subscription
  state, including after your access has ended: the clinical record as JSON,
  selected sections as CSV or PDF, and a complete copy on request. `[CONFIRM:
update when the complete export ships in the app]`
- **Deletion.** You can delete your account and everything in workspaces you
  own at any time from **Settings › Delete account and all data**, also when
  your access is read-only.
- We do not sell your data, and we never use your health data for advertising.

## 9. The AI coach

- The AI coach is optional. It runs only after you turn on **AI processing**
  for yourself, and only in a workspace whose owner has turned on AI. You can
  turn it off at any time.
- When you use it, the coach sends your message and the records it needs to
  answer to our AI provider (currently Anthropic). See the Privacy Policy.
- **You are talking to an AI**, not a person and not a healthcare
  professional. Its answers can be wrong or incomplete. Section 2 applies to
  everything it writes.
- Use of the coach is included in your plan up to a **monthly usage
  allowance** per person. When it is used up, the coach pauses until the first
  day of the next month; the rest of the service is not affected. We may
  change the allowance; if we reduce it materially we will tell you in
  advance. `[CONFIRM: whether to state the allowance in the terms]`

## 10. Acceptable use

You agree not to:

- break the law, or use Cloud to store or share content you have no right to;
- add another person's health data without the right to do so (for example
  their consent, or being their parent or legal guardian where the law allows
  it);
- try to access other people's accounts or workspaces, or data you were not
  given access to;
- probe, scan, test or overload the service, bypass its limits (including the
  AI allowance), or interfere with its security, except through our security
  policy (`SECURITY.md`);
- use automated means to create accounts or trials, or resell or sublicense
  access to Cloud; `[CONFIRM: business use]`
- upload malware or use the AI coach to produce unlawful or harmful content.

We may suspend access to stop a serious breach or to protect the service,
other people or their data. Unless the law or the urgency prevents it, we tell
you first and give you a chance to fix the problem, and you can always export
your data (section 8).

## 11. Availability and changes to the service

- We work to keep Cloud available and to back up your data, but we do not
  promise uninterrupted or error-free service. We may need to pause it for
  maintenance, and we try to do that at quiet times. `[CONFIRM: status page URL]`
- We improve the service over time. We may add, change or remove features.
  If we remove or materially reduce a feature that is a main reason you pay
  for Cloud, we tell you in advance and you may cancel and receive a pro-rata
  refund of any prepaid period that has not started. `[Lawyer: confirm against
Decreto-Lei 84/2021 (digital content and services) on modifications]`

## 12. When your access ends

- **Read-only.** Your access ends when your trial runs out without a
  subscription, when a cancelled subscription reaches the end of its period,
  or when a renewal payment stays unpaid after the grace period. From then on
  your workspace is **read-only**: you, and the people in your workspace, can
  still sign in, read your records, **export** them and **delete** your
  account, but cannot add or change anything, and the AI coach and phone sync
  are paused. Subscribing again restores full access.
- **Deletion after [RETENTION MONTHS] months.** If your access stays ended for
  `[RETENTION MONTHS]` months, we delete your account and every workspace you
  own, with all their records. We email you at least **30 days before** with
  the date. Subscribing again before then keeps everything.
- **When you delete your account** we cancel your subscription immediately
  (no further charges, no refund except under sections 6 and 7) and delete
  your data as described in the Privacy Policy. If you share ownership of a
  workspace with someone else, you need to remove them or transfer the
  workspace first.
- **When we end the contract.** We may end it for a serious or repeated breach
  of these terms (section 10), or if we stop offering Cloud. When we stop
  offering Cloud, we give at least `[90]` days' notice, refund any prepaid
  period that has not been used, and keep export available until the end of
  the notice period.

## 13. Our responsibility

- We provide Cloud with reasonable care and skill and in line with these terms
  and the law. If you are a consumer, you have the legal rights that apply to
  digital services in your country (in Portugal, Decreto-Lei 84/2021), and
  nothing in these terms limits them.
- We are not responsible for losses that we could not reasonably foresee, for
  decisions you or anyone else makes based on information in the service
  (section 2), for the services of third parties you choose to connect (for
  example a self-hosted server, Google, Apple, or a wearable vendor), or for
  events outside our reasonable control.
- To the extent the law allows, our total liability to you in any 12-month
  period is limited to `[the amount you paid us in that period / €X]`.
- None of this limits liability for death or personal injury caused by our
  negligence, for fraud, for wilful misconduct or gross negligence, or any
  other liability the law does not allow us to limit.

> **Lawyer:** check the cap and the exclusions against Decreto-Lei 446/85
> (unfair contract terms) and Decreto-Lei 84/2021.

## 14. Your responsibility

You are responsible for the accuracy of what you enter, for the people you
invite into your workspace, and for using Cloud in line with these terms. If
you use Cloud for business purposes, you compensate us for claims by third
parties that result from your breach of these terms. `[CONFIRM: only if
business use is allowed]`

## 15. Changes to these terms

We may update these terms, for example when we change the service or the law
changes. For a material change we tell you by email or in the app at least
`[30]` days before it applies, and you can cancel before then. We record which
version you accepted. Earlier versions stay available at
`https://openvalens.com/terms`.

## 16. Complaints and disputes

- Contact us first at `[SUPPORT EMAIL]`; we try to answer within
  `[RESPONSE TIME]`.
- Consumers in Portugal can also use the electronic complaints book (Livro de
  Reclamações Eletrónico) at `https://www.livroreclamacoes.pt`.
- **Alternative dispute resolution.** You may refer a dispute to a consumer
  arbitration centre: `[NAME, WEBSITE AND ADDRESS OF THE COMPETENT ADR
ENTITY, e.g. CNIACC — Centro Nacional de Informação e Arbitragem de Conflitos
de Consumo]`. Lei 144/2015 requires us to name it. `[CONFIRM: whether we
commit to using it]`

## 17. Governing law and courts

These terms are governed by **Portuguese law**. If you are a consumer living
in another country, you also keep the protection of the mandatory consumer
laws of your country, and you can bring proceedings in the courts of the
country where you live. Otherwise the courts of `[CITY]`, Portugal, have
jurisdiction.

## 18. General

- If a part of these terms is found invalid, the rest stays in force.
- Not enforcing a term straight away does not mean we give up the right to.
- You may not transfer this contract to someone else without our agreement. We
  may transfer it to a company that takes over Cloud, and will tell you; this
  does not reduce your rights, and you may cancel.
- These terms are offered in English and Portuguese. `[CONFIRM: which version
prevails, if any]`

## 19. Company information

|                     |                                                                                |
| ------------------- | ------------------------------------------------------------------------------ |
| Company             | `[COMPANY LEGAL NAME]`                                                         |
| Registered office   | `[REGISTERED ADDRESS]`, Portugal                                               |
| NIPC / VAT number   | `[NIPC]` / `[VAT NUMBER, PT…]`                                                 |
| Commercial registry | `[CONSERVATÓRIA DO REGISTO COMERCIAL]` `[CONFIRM: share capital, if required]` |
| Email               | `[SUPPORT EMAIL]`                                                              |
| Privacy contact     | `[DPO / privacy contact]`                                                      |

---

## Annex: model withdrawal form

_(Complete and return this form only if you wish to withdraw from the
contract.)_

To `[COMPANY LEGAL NAME]`, `[REGISTERED ADDRESS]`, `[SUPPORT EMAIL]`:

I hereby give notice that I withdraw from my contract for the provision of the
following service: OpenValens Cloud subscription (`monthly` / `annual`)

- Ordered on: `____________`
- Name of consumer: `____________`
- Email address of the OpenValens account: `____________`
- Address of consumer: `____________`
- Signature of consumer (only if this form is sent on paper): `____________`
- Date: `____________`
