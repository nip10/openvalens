# Data Processing Agreement (template)

> **Draft — not yet in force, not legal advice; to be reviewed** by the owner
> and a lawyer before it is offered to anyone. Placeholders in `[BRACKETS]`
> must be filled in; `[CONFIRM]` marks facts to check. English only; a pt-PT
> version follows.

**Template version:** `draft-2026-10-29`

This template is for customers who use OpenValens Cloud to keep records about
**other people**, for example `[CONFIRM: whether business use is allowed — a
coach, trainer or practice]`, and who therefore act as controller for those
people's data and need an Article 28 GDPR agreement with us. For an
individual's own records, and for people they invite into their own
workspace, `[COMPANY LEGAL NAME]` is the controller under the Privacy Policy
and this agreement is not needed.

---

This Data Processing Agreement ("DPA") is entered into between:

- **Customer** (controller): `[CUSTOMER LEGAL NAME]`, `[ADDRESS]`,
  `[REGISTRATION / VAT NUMBER]`, contact `[EMAIL]`; and
- **Provider** (processor): `[COMPANY LEGAL NAME]`, `[REGISTERED ADDRESS]`,
  Portugal, NIPC `[NIPC]`, contact hello@openvalens.com.

It forms part of the OpenValens Cloud Terms of Service (version
`[TERMS VERSION]`) between the parties (the "Agreement"). Where they conflict
on the processing of personal data, this DPA prevails.

## 1. Subject matter and duration

The Provider processes personal data on the Customer's behalf only to provide
OpenValens Cloud under the Agreement, for as long as the Agreement is in force
and until the data is returned or deleted under section 9. Annex 1 describes
the processing.

## 2. Instructions

The Provider processes the personal data only on the Customer's documented
instructions. The Agreement, this DPA and the Customer's use and configuration
of the service (for example which features it turns on and whom it invites)
are those instructions. The Provider tells the Customer if it believes an
instruction breaks data-protection law, and need not follow it. If Union or
Member State law requires other processing, the Provider tells the Customer
first unless that law forbids it.

## 3. The Customer's obligations

The Customer is responsible for the lawfulness of the processing, including
having a legal basis and, for health data, a condition under Article 9 GDPR
(for example the data subjects' explicit consent), for informing data
subjects, and for the accuracy of the data it enters.

## 4. Confidentiality

The Provider ensures that everyone it authorises to process the personal data
is bound by confidentiality, and that only people who need access to run and
secure the service have it.

## 5. Security

The Provider implements the technical and organisational measures in Annex 2
and keeps them appropriate to the risk, taking into account that the data
includes special categories of data. It may update them as long as the
overall level of security is not reduced.

## 6. Subprocessors

The Customer gives general authorisation for the Provider to use
subprocessors. The current list is at `https://openvalens.com/subprocessors`.
The Provider gives the Customer at least `[30]` days' notice by email of a new
or replacement subprocessor; the Customer may object on reasonable
data-protection grounds within that period, and if the parties cannot agree,
the Customer may terminate the affected service and receive a refund of any
prepaid, unused period. The Provider imposes on each subprocessor
data-protection obligations equivalent to this DPA and remains responsible to
the Customer for them.

## 7. International transfers

The Provider stores the Customer's health records in the EU. Where a
subprocessor processes personal data outside the EEA, the Provider ensures a
valid transfer mechanism under Chapter V GDPR (an adequacy decision, including
the EU–US Data Privacy Framework, or the Standard Contractual Clauses), as
listed for each subprocessor.

## 8. Assistance

Taking into account the nature of the processing, the Provider helps the
Customer:

- answer data subjects' requests (access, rectification, erasure,
  restriction, portability, objection), mainly through the service's export
  and deletion features, and by forwarding any request it receives directly
  without answering it unless instructed;
- with security, breach notification, data-protection impact assessments and
  prior consultation (Articles 32 to 36 GDPR).

**Personal data breaches.** The Provider notifies the Customer without undue
delay, and in any event within `[48]` hours, after becoming aware of a
personal data breach affecting the Customer's data, with the information
Article 33(3) GDPR requires as it becomes available.

## 9. Return and deletion

At any time, and at the end of the Agreement, the Customer can export its data
with the service's export features and delete it with the account deletion
feature. Otherwise the Provider deletes the Customer's data
6 months after access ends, as described in the Terms, with
a warning email 30 days before. Deleted data remains in encrypted backups for
up to 14 days, and a restore re-applies the deletion.
Data that Union or Member State law requires the Provider to keep (for
example invoices) is kept only for that purpose.

## 10. Audits

The Provider makes available the information necessary to demonstrate
compliance with Article 28 GDPR, including this DPA, the subprocessor list and
a description of its security measures, and answers reasonable written
questions. Where that is not sufficient, the Customer may carry out an audit,
itself or through an independent auditor bound by confidentiality, with at
least `[30]` days' notice, no more than once a year unless required by a
supervisory authority or after a breach, and at the Customer's cost.

## 11. Liability and law

Liability under this DPA is subject to the limits in the Agreement, except
where the GDPR does not allow them. This DPA is governed by Portuguese law, and
the courts of `[CITY]`, Portugal, have jurisdiction.

Signed:

| Customer | Provider |
| -------- | -------- |
| Name:    | Name:    |
| Role:    | Role:    |
| Date:    | Date:    |

---

## Annex 1: Description of the processing

|                    |                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data subjects      | People whose records the Customer keeps in OpenValens Cloud; people the Customer invites into its workspaces                                                                                                                                                                                                                                                                                                                    |
| Categories of data | Identity and contact data (name, email); account and sign-in data; **health data** (Art. 9 GDPR): body measurements and composition, laboratory results, vital signs, sleep, activity and workouts, nutrition, supplements and medications, menstrual cycle, clinical records and notes, preventive-care answers, progress photos, and derived scores and insights; AI coach conversations if used; technical and security logs |
| Nature and purpose | Hosting, storage, organisation, display, calculation of scores and insights, synchronisation with mobile devices, sharing within workspaces as the Customer configures, optional AI coach, email and push notifications, backups, security                                                                                                                                                                                      |
| Duration           | The term of the Agreement and the retention in section 9                                                                                                                                                                                                                                                                                                                                                                        |
| Frequency          | Continuous                                                                                                                                                                                                                                                                                                                                                                                                                      |

## Annex 2: Technical and organisational measures

- Hosting in an EU data centre (netcup GmbH, Nuremberg, Germany); the database has no public network
  port.
- Encryption in transit (HTTPS/TLS) for all connections; encrypted backups
  with the key kept off the server; `[CONFIRM: disk encryption at rest]`.
- Stored files are private and only reachable through short-lived signed
  links issued after an authorisation check.
- Tokens from third-party sign-in providers are encrypted at rest; secrets are
  kept outside the application image.
- Role-based access within workspaces; an access audit log for workspace
  records; account deletion requires a recent sign-in.
- Application logs and error reports contain no health values; error reports
  are reduced to an allowlist before they are sent.
- Data minimisation towards subprocessors (for example Stripe receives only an
  email and a random reference; push text carries no health values).
- Daily backups with restore tests `[CONFIRM: schedule and drill, #308]`; an
  erasure ledger re-applies deletions after a restore.
- Restricted administrative access to production `[CONFIRM: MFA, named
people]`; incident response procedure `[CONFIRM: docs/cloud/operations.md]`.
- Security vulnerabilities can be reported through `SECURITY.md`.

## Annex 3: Subprocessors

As listed at `https://openvalens.com/subprocessors` on the date of signature.
