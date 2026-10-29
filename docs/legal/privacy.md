<!-- Published at https://openvalens.com/privacy from apps/site/src/privacy.html, which is the
source of truth. Change the page first, then regenerate this copy. The company's
legal name, NIPC and registered address are still to be added to section 1. -->

# Privacy policy

Version 2026-10-29 · Applies from 29 October 2026

This policy explains what personal data OpenValens collects, why, on what legal basis, where it is kept, for how long, who else receives it, and your rights. It covers:

- **OpenValens Cloud**, the hosted service at `app.openvalens.com`, on the web and in the mobile apps;
- **the OpenValens mobile apps** for iOS and Android;
- **this website**, `openvalens.com`.

**It does not cover self-hosted servers.** The app can connect to a server you or someone else runs instead of Cloud. See section 13.

## 1. Who is responsible

The controller for Cloud, the apps (when connected to Cloud) and this website is the company that operates OpenValens, based in Portugal. Write to us at hello@openvalens.com for privacy requests and for support.

## 2. The short version

- Your health records are stored in the EU, in Germany. They are not sold, not used for advertising and not shared with anyone you have not chosen to share them with.
- No analytics or tracking, no advertising SDKs, and no cookies beyond the ones that keep you signed in. This website makes no third-party requests at all.
- We process your health data on the basis of your **explicit consent**, which you give at sign-up and can withdraw.
- Optional features that send data elsewhere (the AI assistant, push notifications, Google or Apple sign-in, phone health data) only do so when you turn them on.
- You can export your data and delete your account at any time, also after your subscription ends.

## 3. What we collect

**Account and sign-in data.** Your email address; your name if you add one (or Apple shares it the first time you sign in with Apple); your language; your sign-in methods (for Google or Apple, the provider's stable account id and encrypted tokens, never your password for those services); your sessions (with the IP address and browser or device type that opened them); the versions of our terms, this policy and the health-data consent you accepted, and when.

**Health and wellness data (special category data).** Whatever you choose to record, which can include: weight and body composition, body scans (DEXA), body measurements, laboratory results, vital signs (for example heart rate, blood pressure, heart-rate variability), sleep, activity and workouts, nutrition and water, supplements and medications, menstrual cycle, goals, clinical records and notes, preventive-care answers (which can include smoking history, pregnancy and **family medical history, which is data about your relatives**), your wellness profile, private progress photos, and the scores and insights the app calculates from all of this. Health data is a special category of personal data under Article 9 GDPR.

**Phone health data.** If you allow it, the mobile app reads from **Apple Health** (iOS) or **Health Connect** (Android): steps, heart rate, sleep, weight, body fat, active energy, distance and workouts. It only reads; it never writes to them. You choose each permission in the system's own screen and can revoke it there.

**AI assistant.** If you use the assistant, your messages and its replies, and counts of how much you used it each month (tokens, estimated cost, number of calls; never the content).

**Billing data.** For a workspace owner: plan, subscription status, trial and period dates, the Stripe customer and subscription ids, and the versions of the checkout acknowledgements you accepted. Stripe itself collects your payment card, billing address and the email for receipts.

**Devices and notifications.** If you turn on push notifications, a push token for each phone. Your notification preferences and a history of what was sent (when and on which channel, not the content).

**Workspace sharing.** The workspaces you belong to, your role, invitations you sent or received (with the invitee's email), and an access log of who viewed or changed records in a workspace.

**Technical and security data.** Server and proxy logs (IP address, time, request path without query values, response status, a request id), security events (for example a sign-in or a deletion, recorded with ids only), rate-limiting counters, and browser security-policy reports reduced to host and path. Logs never contain health values.

**Error reports.** If the server, web app or mobile app crashes, a report with the error type, the code location (file, function, line), the release, and the runtime and operating system name and version. Error messages, URLs, request data, user, device and session details are removed before sending (section 7).

**Support.** What you write to us and our replies.

**What we do not collect.** No advertising identifiers, no location, no contacts, no microphone. The camera is used only while you scan a food barcode and no image is kept. No analytics.

## 4. Why we use it and on what legal basis

| Purpose                                                                                                                                         | Data                                                                   | Legal basis (GDPR)                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Storing, organising and showing your health records, calculating scores and insights, syncing phone health data, sharing with people you invite | Health and wellness data, phone health data                            | **Explicit consent**, Art. 9(2)(a) and Art. 6(1)(a).                                 |
| AI assistant                                                                                                                                    | Your messages and the records the assistant uses to answer             | **Explicit consent**, Art. 9(2)(a), given separately when you turn on AI processing. |
| Opt-in insight emails and push notifications                                                                                                    | Insight text (email), generic text (push), contact details, push token | Consent, Art. 6(1)(a) (and 9(2)(a) where the content is health data).                |
| Your account, sign-in, the subscription, billing emails, support                                                                                | Account, billing and support data                                      | Performance of the contract, Art. 6(1)(b).                                           |
| Invoices and tax records                                                                                                                        | Billing data held by Stripe                                            | Legal obligation, Art. 6(1)(c) (Portuguese tax and accounting law).                  |
| Security, preventing abuse, investigating incidents, error reports, keeping backups                                                             | Technical, security and error data; backups of all data                | Legitimate interest, Art. 6(1)(f): keeping the service and your data safe.           |
| Proving consent and honouring deletions after a restore                                                                                         | Consent records, erasure records (ids and row counts)                  | Legal obligation, Art. 6(1)(c) (Art. 7(1) and Art. 17 GDPR).                         |

**Explicit consent to health data.** When you create a Cloud account, and again when this consent changes, you give your explicit consent to us processing your health data to provide the service. Because keeping your health records is what Cloud does, we cannot provide Cloud without it. You can withdraw it at any time by writing to hello@openvalens.com or by deleting your account; withdrawal does not affect processing before it. When you withdraw, we stop processing your health data except to let you export it, and delete it as described in section 8.

We do not use your data for automated decisions with legal or similarly significant effects, and we do not build advertising profiles.

## 5. Where your data is stored

Cloud runs on servers of **netcup GmbH** in Nuremberg, Germany. Your records live in a database that is not reachable from the internet, and progress photos and exports in private storage on the same servers. Backups are kept on the same infrastructure in the EU.

The mobile app keeps a cache of recently viewed data and a queue of changes not yet sent on your phone, separated per account, and your session in the phone's secure storage. They are removed when you sign out or uninstall the app.

## 6. Who receives your data

We use a small number of service providers (processors) who act on our instructions under a data-processing agreement. The full list, with locations and transfer safeguards, is on the [subprocessors page](https://openvalens.com/subprocessors). In short:

- **netcup** (hosting, Germany): all data, as described in section 5.
- **Resend** (email): your email address and each email we send you. This includes the content of the weekly insights email if you turn it on.
- **Stripe** (payments, workspace owners only): your email and a random reference that is not your account id. Never your name, workspace or health data. Stripe also acts as an independent controller for payment processing, fraud prevention and its own legal obligations.
- **Anthropic** (AI assistant, only when you use it): your message and the records needed to answer it.
- **Expo, Apple (APNs) and Google (Firebase Cloud Messaging)** (push, only if you turn on notifications): your push token and the notification. Push text is fixed and generic and never contains a health value.
- **Sentry** (error reports): the reduced crash reports described in section 3.

**People you share with.** Members you invite into your workspace see what their role allows. Records you add to someone else's workspace are visible to its owner and members according to their roles.

**Our staff.** Only authorised people can access the production systems, and only to run and secure the service. We look at your account only at your request (for example to help you with a problem) or to investigate abuse or a security incident.

**Services you choose to connect** are independent controllers, under their own privacy policies: Google or Apple when you sign in with them; Apple Health or Health Connect on your phone; and a wearable vendor if you connect your account with it, which then sends us your data from that vendor.

**Authorities.** We disclose data only where the law requires it, and we tell you unless the law forbids it.

We do **not** sell or rent your data, share it with advertisers or data brokers, or use it to train AI models.

## 7. Specific features

**Apple Health and Health Connect.** Data read from Apple Health or Health Connect is used only to show and analyse it in your OpenValens record and in features you turn on (such as the AI assistant). It is never used for advertising or marketing, never sold, never shared with data brokers, and never used to decide eligibility for credit, insurance or employment. We do not store it in iCloud. Our use of Health Connect data follows the Health Connect permissions policy, including its Limited Use requirements.

**AI assistant.** The assistant is off until the workspace owner allows AI in the workspace **and** you turn on AI processing for yourself; you can turn it off at any time. When you send a message, we send it, the previous messages of that conversation and the health records needed to answer to **Anthropic**, which generates the reply. Your conversations are private to you, also in a shared workspace. Under our agreement Anthropic does not use this data to train its models and keeps it for up to 30 days. There is a monthly usage allowance; we count usage, never content.

**Push notifications.** You allow them in your phone's settings and can turn them off there or in the app.

**Error reporting.** Before any crash report leaves the server or your device it is reduced to an allowlist: exception type, code frames, release, environment, runtime and OS name and version. Messages, URLs and query strings, request data, cookies, headers, user and device details and breadcrumbs are removed, and reports without an exception are dropped. Sentry can see the IP address of the connection that sends a report.

**Analytics.** We do not use analytics in Cloud, the apps or this website. If we ever offer it, it will be off until you opt in, and we will update this policy first.

**Cookies.** Cloud uses only strictly necessary cookies to keep you signed in and protect sign-in. No tracking or advertising cookies, so there is no cookie banner.

**This website.** `openvalens.com` is a static site. It sets no cookies, runs no scripts, loads nothing from third parties (its security policy forbids it) and uses no analytics. The web server keeps standard access logs (IP address, time, page, browser type) for 14 days for security.

## 8. How long we keep it

| Data                                                                   | Kept for                                                                                                                                                                                   |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Account, health records, photos, AI conversations                      | While your account exists. Deleted when you delete your account.                                                                                                                           |
| After your access ends (trial ended, subscription cancelled or unpaid) | Read-only for 6 months, then deleted. We email you at least 30 days before.                                                                                                                |
| Backups                                                                | Up to 14 days after deletion, then overwritten. If a backup is ever restored, your deletion is applied again.                                                                              |
| Sessions                                                               | Until you sign out or they expire.                                                                                                                                                         |
| Unfinished sign-up links                                               | Deleted about a day after they expire.                                                                                                                                                     |
| Server and proxy logs                                                  | 14 days.                                                                                                                                                                                   |
| Security events and erasure records                                    | Ids and counts only, no content. Your user reference is removed from security events when you delete your account; erasure records are kept so a deletion can be repeated after a restore. |
| Invoices (held by Stripe)                                              | 10 years, as Portuguese tax law requires. They contain your billing email and address, never health data.                                                                                  |
| Error reports (Sentry)                                                 | 30 days.                                                                                                                                                                                   |
| AI requests (Anthropic)                                                | Up to 30 days at Anthropic.                                                                                                                                                                |
| Emails (Resend)                                                        | Delivery logs according to Resend's retention; we keep no copy of the content.                                                                                                             |
| Support emails                                                         | 2 years after the request is closed.                                                                                                                                                       |

## 9. Transfers outside the EU

Your health records are stored in the EU. Some providers are based in, or use infrastructure in, the United States or elsewhere (Resend, Stripe, Anthropic, Expo, Apple, Google and Sentry). When data is transferred outside the European Economic Area, we rely on an adequacy decision (including the EU–US Data Privacy Framework for certified companies) or on the European Commission's Standard Contractual Clauses, as listed for each provider on the [subprocessors page](https://openvalens.com/subprocessors). You can ask us for a copy of the safeguards.

## 10. Your rights

You have the right to:

- **access** your data and get a copy;
- **portability**: receive the data you gave us in a machine-readable format. In the app, **Settings › Export records** prepares a complete export of your account as a ZIP file, and you can also export the clinical record (JSON) and sections (CSV, PDF) at any time;
- **rectification**: correct it, mostly directly in the app;
- **erasure**: delete your account and everything in workspaces you own in **Settings › Delete account and all data**, at any time and in every subscription state (see [how to delete your account](https://openvalens.com/support#delete-account));
- **restriction** and **objection** (to processing based on legitimate interest);
- **withdraw consent** at any time (health data, AI assistant, insight emails, push), without affecting earlier processing.

Write to hello@openvalens.com. We answer within one month (extendable by two months for complex requests, in which case we tell you). We may need to confirm it is you.

You can also complain to a supervisory authority: in Portugal, the **Comissão Nacional de Proteção de Dados (CNPD)**, [www.cnpd.pt](https://www.cnpd.pt), or the authority where you live or work.

## 11. Security

Data is encrypted in transit (HTTPS). The database has no public port, stored files are private and only reachable through short-lived signed links, sign-in tokens from Google and Apple are encrypted at rest, and logs carry no health values. Account deletion needs a recent sign-in and a typed confirmation. If a breach puts your data at risk, we notify the CNPD within 72 hours where required and tell you without undue delay when the risk to you is high.

## 12. Children

Cloud is not for people under 16. If you add records about a child as their parent or guardian, you are responsible for doing so lawfully.

## 13. Using the app with a self-hosted server

The mobile app can connect to OpenValens Cloud or to any OpenValens server you choose. When you connect it to a **self-hosted server**:

- the app talks **only to that server** (and, for features you turn on, to the phone's own health store and to Expo, Apple or Google for push, as configured by that server);
- the **operator of that server is the controller** of your data and decides what it collects, which providers it uses and how long it keeps data. Ask them for their privacy policy;
- **this policy does not apply** to your data on that server: we do not see your records, your account or your use of the app;
- **one exception: crash reports.** If the store app has error reporting built in and it crashes, the reduced crash report described in section 7 (no personal data beyond the connection IP address Sentry sees) comes to us whichever server you use, and this policy applies to it.

## 14. Changes to this policy

We update this policy when our processing changes. We tell you by email or in the app before a material change applies, and ask for your consent again when the law requires it. Earlier versions stay available on request and in the history of this page.
