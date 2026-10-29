# Legal documents for OpenValens Cloud

> **Status (2026-10-29):** the privacy policy, subprocessors list and terms are
> published on openvalens.com as version `2026-10-29`; the published pages
> (`apps/site/src/*.html`) are the source of truth and `privacy.md` and
> `subprocessors.md` are generated copies. Still open: the company's legal
> name, NIPC and registered address, and a lawyer's review. The DPA and data
> map remain drafts. Issue #300.

These are the first drafts of the legal documents OpenValens Cloud needs
before launch (epic #293). Claude wrote them from the owner's decisions and
from what the code in this repository actually does. They are English only;
the pt-PT versions come later, after the English text is reviewed, and both
languages will carry the same version label.

Placeholders are in square brackets. `[COMPANY LEGAL NAME]`, `[NIPC]` and the
like are facts only the owner can supply. `[CONFIRM]` marks a statement drawn
from the code, the docs or general knowledge of a vendor that must be checked
against the live setup or the vendor's current terms before publication.

## The documents

| File                                 | What it is                                                                                                                                                         | Published at (#309)                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| [terms.md](terms.md)                 | Terms of Service for OpenValens Cloud: the service, trial, billing, withdrawal, cancellation, acceptable use, liability, end of access, governing law.             | `https://openvalens.com/terms`         |
| [privacy.md](privacy.md)             | Privacy policy for Cloud, the mobile apps and the website, including the notice for people who connect the app to a self-hosted server.                            | `https://openvalens.com/privacy`       |
| [subprocessors.md](subprocessors.md) | The vendors that process personal data for Cloud, with purpose, data, location and transfer mechanism.                                                             | `https://openvalens.com/subprocessors` |
| [dpa.md](dpa.md)                     | A short Data Processing Agreement (GDPR Art. 28) template for customers who use Cloud for other people's data and ask for one. Sent on request, not published.     | —                                      |
| [data-map.md](data-map.md)           | One table: data category → purpose → legal basis → where stored → retention → shared with. Source for the store privacy labels and Google Data safety form (#307). | — (internal; seeds the Art. 30 record) |

## Version labels

Each published document carries a version label, a date in `YYYY-MM-DD` form.
The server records the terms and privacy versions a person accepted at
sign-up (`legal_acceptance`, #294), so the labels must match the server
settings exactly:

| Document         | Server setting                                    | Draft label        | Published label |
| ---------------- | ------------------------------------------------- | ------------------ | --------------- |
| Terms of Service | `LEGAL_TERMS_VERSION` (and `LEGAL_TERMS_URL`)     | `draft-2026-10-29` | `2026-10-29`    |
| Privacy policy   | `LEGAL_PRIVACY_VERSION` (and `LEGAL_PRIVACY_URL`) | `draft-2026-10-29` | `2026-10-29`    |

The subprocessors list and the DPA have their own "Last updated" dates but no
server setting. A new version is needed whenever a change is material (a new
subprocessor, a new purpose, a price or retention change); the old versions
stay available on the site so an accepted version can always be read again.

## Store listings and other places the URLs go

Once #309 publishes the documents, these fields point at them:

| Where                                                   | Field                                      | URL                                                                     |
| ------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------- |
| App Store Connect (#304)                                | Privacy Policy URL                         | `https://openvalens.com/privacy`                                        |
| App Store Connect (#304)                                | License agreement (optional, custom)       | `https://openvalens.com/terms` [CONFIRM: or keep Apple's standard EULA] |
| Play Console (#305)                                     | Privacy policy                             | `https://openvalens.com/privacy`                                        |
| Play Console › Health Connect declaration (#305)        | Privacy policy (must cover Health Connect) | `https://openvalens.com/privacy`                                        |
| Google OAuth consent screen (#305)                      | Privacy policy / Terms of service          | `/privacy`, `/terms`                                                    |
| Sign in with Apple, Services ID (#304)                  | —                                          | (none required)                                                         |
| Stripe Customer Portal and Checkout (`docs/billing.md`) | Privacy policy / Terms of service          | `/privacy`, `/terms`                                                    |
| Server (`LEGAL_TERMS_URL`, `LEGAL_PRIVACY_URL`, #294)   | Linked from `/signup`                      | `/terms`, `/privacy`                                                    |

The store privacy labels (Apple) and Data safety form (Google) are built from
[data-map.md](data-map.md) in #307.

## Open questions for the owner and the lawyer

Company facts and settings

1. **Company details** for the controller block and the company information
   section: legal name, NIPC, registered address, commercial registry office
   and VAT number. Portugal has no German-style "Impressum", but Decreto-Lei
   7/2004 (e-commerce) requires this information to be easy to find; the
   documents put it in the terms and the privacy policy rather than in a
   separate imprint page. Confirm that is enough. _Open: the owner sends the
   details; the published pages leave the line out until then._
2. ~~Support address and response time.~~ Decided: `hello@openvalens.com` for
   support and privacy requests; replies on working days, usually within two.
3. ~~`CLOUD_ENDED_RETENTION_MONTHS`.~~ Decided: 6 months.
4. ~~Backup, log and error-report retention.~~ Decided: backups 14 days
   (Coolify daily backups enabled 2026-10-29), logs 14 days, Sentry 30 days,
   support email 2 years.
5. ~~Minimum age.~~ Decided: 16. Lawyer to confirm against Lei 58/2019 and the
   paid-contract question.

Health data and consent

6. **Legal basis for health data.** The drafts use explicit consent
   (Art. 9(2)(a)) for health data, contract for account and billing data, legal
   obligation for invoices and tax records and legitimate interest for security
   logs. Because storing health records _is_ the service, consent and the
   contract are intertwined (Art. 7(4)). Confirm the approach and how
   withdrawal of the health-data consent is handled (the draft: we stop
   processing and the person exports and deletes, or we delete).
7. ~~Explicit consent is not recorded yet.~~ Shipped in #322: a separate,
   versioned health-data consent (`LEGAL_HEALTH_CONSENT_VERSION`) is recorded at
   sign-up on every path and before an invitation is accepted, with re-consent
   when the version changes.
8. **DPIA and Art. 30 record.** CNPD Regulation 1/2018 makes a DPIA mandatory
   for health data transmitted from electronic devices, whatever the scale, so
   one is needed before launch. Art. 30 records are required because the data
   is Art. 9 data; [data-map.md](data-map.md) can seed them.
9. **DPO.** Probably not mandatory at launch scale (Art. 37(1)(c) needs "large
   scale"). Decide whether to appoint one voluntarily or to record the
   assessment and a review threshold.
10. **Apple and Google health-data rules.** Sending HealthKit or Health Connect
    data to the AI provider when the person uses the coach: confirm the opt-in
    satisfies App Store Guideline 5.1.3 and the Health Connect permissions
    policy (Limited Use).

Billing and consumer law

11. ~~Right of withdrawal and immediate start.~~ Shipped in #323: before
    Checkout the person gives the versioned immediate-start and withdrawal
    acknowledgements (`LEGAL_CHECKOUT_ACK_VERSION`, text in
    [checkout-acknowledgements.md](checkout-acknowledgements.md)), recorded by
    the server. Lawyer to confirm the wording.
12. **Annual renewals.** Whether to send a renewal reminder before an annual
    plan renews (not required in Portugal as far as the draft knows, required in
    some EU countries). [CONFIRM]
13. **Complaints and ADR.** Livro de Reclamações Eletrónico link and the
    consumer arbitration centre(s) to name (Lei 144/2015). The EU ODR platform
    closed in July 2025, so the draft does not link it.
14. **Liability cap** amount and wording, within what Portuguese consumer law
    allows.
15. **Business customers.** Whether Cloud is offered to businesses (for example
    a coach keeping clients' records). If so, the terms need a business section
    and the DPA becomes a real contract; if not, the DPA can say Cloud is for
    personal use and is offered only on request.

Product facts to confirm

16. ~~Full export.~~ Shipped in #324: Settings › Export records prepares a
    complete export of the account as a ZIP file.
17. **Which optional integrations are on in Cloud**: wearable vendors (Oura,
    Whoop, Polar, Withings, Google Health), Telegram reminders, Open Food Facts
    barcode lookup, S3 object storage, the insights email digest,
    `EMAIL_AUDIT_BCC`. The drafts list them as "[CONFIRM: enabled in Cloud]".
18. ~~PostHog at launch.~~ Off: no PostHog token is configured in Cloud, and
    the privacy policy says analytics is not used. Turning it on needs a policy
    update first.
19. **Staff access.** Instance administrators can impersonate accounts. Decide
    the policy (the draft: only at the person's request or to investigate abuse
    or a security incident, and logged) and confirm impersonation is logged.
20. **Subprocessor facts.** Resolved: hosting is netcup GmbH in Nuremberg,
    Germany (not Hetzner), with Coolify self-hosted on the same server; there is
    no separate support mailbox provider row until one is chosen. Still to
    confirm: the off-site backup provider (#308, netcup or Hetzner S3), the
    Resend and Sentry regions, the Anthropic contracting entity and retention,
    and the Expo DPA.

## Before publishing

- [ ] Fill every placeholder and resolve every `[CONFIRM]`; remove the draft banners.
- [ ] Lawyer review of the terms, the privacy policy and the DPA.
- [ ] Translate to pt-PT (same version labels).
- [ ] Set `LEGAL_TERMS_VERSION`, `LEGAL_PRIVACY_VERSION` and the URLs on Cloud.
- [ ] Publish at `/terms`, `/privacy`, `/subprocessors` (#309), keeping old versions reachable.
- [ ] Put the URLs in App Store Connect, Play Console, Google OAuth and Stripe.
