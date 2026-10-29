# OpenValens Cloud subprocessors

> **Draft — not yet in force, not legal advice; to be reviewed** by the owner
> and a lawyer before publication. `[CONFIRM]` marks a location, entity or
> transfer mechanism that must be checked against the live configuration and
> the vendor's current DPA. English only; a pt-PT version follows.

**Last updated:** `[YYYY-MM-DD]` · Controller: `[COMPANY LEGAL NAME]`

These are the service providers that process personal data for OpenValens
Cloud on our behalf. Each one works under a data-processing agreement. We
announce a new subprocessor here, and by email to customers who signed a DPA,
at least `[30]` days before it starts processing personal data.

Health records are stored only with the hosting provider, in the EU. The
others receive only the data listed, and the optional ones only when you use
the feature.

## Always used

| Name                                                                   | Purpose                                                                                                                      | Data                                                                                                                                      | Location                                                                  | Transfer mechanism                                                           | Link                                                                                            |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Hetzner Online GmbH (Germany)                                          | Hosting of the servers, database, file storage and backups of Cloud, managed with Coolify                                    | All Cloud data, including health records (stored encrypted at rest `[CONFIRM]`)                                                           | EU: `[CONFIRM: Nuremberg / Falkenstein, Germany, or Helsinki, Finland]`   | None needed (EU)                                                             | [Privacy](https://www.hetzner.com/legal/privacy-policy), DPA in the Hetzner console `[CONFIRM]` |
| `[BACKUP STORAGE PROVIDER]` `[CONFIRM: may be Hetzner Object Storage]` | Off-site copy of the encrypted backups (#308)                                                                                | Encrypted backups; the provider has no key                                                                                                | EU `[CONFIRM]`                                                            | None needed if EU                                                            | `[LINK]`                                                                                        |
| Resend (Plus Five Five, Inc., USA)                                     | Sending email: sign-in links and codes, invitations, trial and billing notices, the deletion warning, opt-in insight digests | Recipient email, subject and body (the opt-in weekly insights email contains insight text derived from health data)                       | USA `[CONFIRM: sending region; Resend offers an EU region]`               | EU–US Data Privacy Framework and/or Standard Contractual Clauses `[CONFIRM]` | [DPA](https://resend.com/legal/dpa), [Subprocessors](https://resend.com/legal/subprocessors)    |
| Stripe Payments Europe, Ltd. (Ireland), with Stripe, Inc. (USA)        | Subscription payments, invoices, VAT calculation (Stripe Tax), Customer Portal                                               | Workspace owners only: email, random customer reference; Stripe collects card, billing address and checkout device data itself            | EU and USA                                                                | Data Privacy Framework, Standard Contractual Clauses `[CONFIRM]`             | [Privacy center](https://stripe.com/legal/privacy-center), [DPA](https://stripe.com/legal/dpa)  |
| `[SUPPORT MAILBOX PROVIDER]` `[CONFIRM]`                               | The `[SUPPORT EMAIL]` mailbox                                                                                                | What you write to support and our replies                                                                                                 | `[CONFIRM]`                                                               | `[CONFIRM]`                                                                  | `[LINK]`                                                                                        |
| Functional Software, Inc. ("Sentry", USA)                              | Error reporting for the server, web app and mobile app                                                                       | Scrubbed crash reports: exception type, code frames, release, environment, runtime and OS name and version; connection IP seen in transit | `[CONFIRM: EU (Frankfurt) if the DSN is *.ingest.de.sentry.io, else USA]` | Standard Contractual Clauses / DPF for any US processing `[CONFIRM]`         | [DPA](https://sentry.io/legal/dpa/)                                                             |

Coolify is used as deployment software on our own Hetzner servers and is not a
separate subprocessor. `[CONFIRM: self-hosted Coolify, not Coolify Cloud — if
Coolify Cloud manages the servers, list coolLabs as a subprocessor.]`

## Used only when you turn a feature on

| Name                                                                                 | Purpose                                                                                          | Data                                                                                             | Location                   | Transfer mechanism                                          | Link                                                                                                               |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | -------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Anthropic, PBC (USA) `[CONFIRM: contracting entity for EEA customers]`               | AI coach, insights and extraction (food and recipe drafts), only after you turn on AI processing | Your messages, earlier messages of the conversation, the health records needed to answer         | USA `[CONFIRM]`            | Standard Contractual Clauses in Anthropic's DPA `[CONFIRM]` | [Commercial terms](https://www.anthropic.com/legal/commercial-terms), [Privacy center](https://privacy.claude.com) |
| 650 Industries, Inc. ("Expo", USA)                                                   | Push notification relay to APNs and FCM                                                          | Expo push token, notification title and body (fixed generic text, no health values), in-app path | USA `[CONFIRM]`            | Standard Contractual Clauses / DPF `[CONFIRM]`              | [Privacy](https://expo.dev/privacy) `[CONFIRM: DPA link]`                                                          |
| Apple Inc. / Apple Distribution International Ltd. — Apple Push Notification service | Delivering notifications to iPhones                                                              | Device push token, notification content                                                          | USA and global `[CONFIRM]` | DPF / Standard Contractual Clauses `[CONFIRM]`              | [Apple privacy](https://www.apple.com/legal/privacy/)                                                              |
| Google Ireland Ltd. / Google LLC — Firebase Cloud Messaging                          | Delivering notifications to Android phones                                                       | Device push token, notification content                                                          | USA and global `[CONFIRM]` | DPF / Standard Contractual Clauses `[CONFIRM]`              | [Firebase privacy](https://firebase.google.com/support/privacy)                                                    |

## Not used at launch

| Name                          | Purpose                                                      | Data                                                                                                           | Location                   | Transfer mechanism                             | Link                           |
| ----------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | -------------------------- | ---------------------------------------------- | ------------------------------ |
| PostHog, Inc. (USA), EU Cloud | Product analytics, **off by default**, only with your opt-in | One event (`preferences_opened`) with a random id never linked to you; PostHog sees the server's IP, not yours | EU (Frankfurt) `[CONFIRM]` | EU storage; SCCs for any US access `[CONFIRM]` | [DPA](https://posthog.com/dpa) |

`[CONFIRM: enabled in Cloud?]` Optional server integrations that would be
added here if turned on: Telegram reminders (Telegram Messenger Inc.), Open
Food Facts barcode lookup (sends only the barcode), S3-compatible object
storage outside Hetzner.

## Not subprocessors: services you connect yourself

These act as independent controllers under their own terms when you choose to
use them. We do not send them your OpenValens data.

- **Google** and **Apple** when you sign in with them (they tell us your
  account id and email).
- **Apple Health** and **Health Connect** on your phone (the app reads from
  them with your permission).
- **Wearable vendors** `[CONFIRM: enabled in Cloud]` (Oura, Whoop, Polar,
  Withings, Google Health) when you connect your account with them; they send
  us your data from that vendor.
- **Apple App Store** and **Google Play**, which distribute the free apps.
- **Let's Encrypt**, which issues our HTTPS certificates and receives no user
  data.
