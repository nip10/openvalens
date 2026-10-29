<!-- Published at https://openvalens.com/subprocessors from apps/site/src/subprocessors.html, which is the
source of truth. Change the page first, then regenerate this copy. The company's
legal name, NIPC and registered address are still to be added to section 1. -->

# Subprocessors

Last updated 29 October 2026

These are the service providers that process personal data for OpenValens Cloud on our behalf, as described in the [privacy policy](https://openvalens.com/privacy). Each one works under a data-processing agreement. Health records are stored only with the hosting provider, in the EU. The others receive only the data listed, and the optional ones only when you use the feature.

We announce a new subprocessor on this page at least 30 days before it starts processing personal data.

## Always used

| Provider | Purpose | Data | Location | Safeguard |
| --- | --- | --- | --- | --- |
| netcup GmbH (Germany) | Hosting of the servers, database, file storage and backups of Cloud | All Cloud data, including health records | Nuremberg, Germany | None needed (EU) |
| Resend (Plus Five Five, Inc., USA) | Sending email: sign-in links, invitations, trial and billing notices, the deletion warning, opt-in insight digests | Recipient email, subject and body (the opt-in weekly insights email contains insight text derived from health data) | USA | EU–US Data Privacy Framework and Standard Contractual Clauses |
| Stripe Payments Europe, Ltd. (Ireland), with Stripe, Inc. (USA) | Subscription payments, invoices, VAT calculation, customer portal | Workspace owners only: email and a random customer reference; Stripe collects card, billing address and checkout device data itself | EU and USA | EU–US Data Privacy Framework and Standard Contractual Clauses |
| Functional Software, Inc. (Sentry, USA) | Error reporting for the server, web app and mobile app | Reduced crash reports: exception type, code frames, release, environment, runtime and OS name and version; connection IP seen in transit | USA or EU | Standard Contractual Clauses for any US processing |

## Used only when you turn a feature on

| Provider | Purpose | Data | Location | Safeguard |
| --- | --- | --- | --- | --- |
| Anthropic, PBC (USA) | AI assistant, insights and food and recipe drafts, only after you turn on AI processing | Your messages, earlier messages of the conversation, the health records needed to answer | USA | Standard Contractual Clauses |
| 650 Industries, Inc. (Expo, USA) | Push notification relay to Apple and Google | Expo push token, notification title and body (fixed generic text, no health values), in-app path | USA | Standard Contractual Clauses |
| Apple Inc. (Apple Push Notification service) | Delivering notifications to iPhones | Device push token, notification content | USA and global | EU–US Data Privacy Framework and Standard Contractual Clauses |
| Google LLC (Firebase Cloud Messaging) | Delivering notifications to Android phones | Device push token, notification content | USA and global | EU–US Data Privacy Framework and Standard Contractual Clauses |

## Not subprocessors: services you connect yourself

These act as independent controllers under their own terms when you choose to use them. We do not send them your OpenValens data.

- **Google** and **Apple** when you sign in with them (they tell us your account id and email).
- **Apple Health** and **Health Connect** on your phone, which the app reads from with your permission.
- A **wearable vendor**, if you connect your account with it.
