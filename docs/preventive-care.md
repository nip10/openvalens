# Preventive care by region

Issue #97. OpenValens shows what established public-health authorities in the
person's chosen region publish for people of their age and sex. Every item is
cited and dated and carries the authority's own grade. People can record what
they have done, set their own next date, and opt in to a reminder. A separate,
opt-in evidence-check library rates popular longevity practices and tests.

The app displays published guidance. It does not diagnose, compute a risk,
read a lab value, order or book a test, or invent an interval. The evidence
and regulatory background is in
[`research/reports/Preventive care recommendation evidence.md`](research/reports/Preventive%20care%20recommendation%20evidence.md).

## Where the code is

| Part                                     | File                                                                                            |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Contract (web and native safe)           | `packages/api/src/preventive-care-contract.ts`                                                  |
| Rule pack (versioned data)               | `packages/api/src/preventive-care-pack.ts`                                                      |
| Evidence-check library (versioned data)  | `packages/api/src/evidence-check-library.ts`                                                    |
| Pure engine (filtering, update rules)    | `packages/api/src/preventive-care-engine.ts`                                                    |
| Service and router (`preventiveCare.*`)  | `packages/api/src/preventive-care.ts`, `routers/preventive-care.ts`                             |
| Reminders (through #92 delivery)         | `packages/api/src/preventive-care-delivery.ts`                                                  |
| Copy and view models (web, native, push) | `packages/api/src/presenters/preventive-care.ts`                                                |
| Tables                                   | `packages/db/src/schema/preventive-care.ts`                                                     |
| Web page / native screen                 | `apps/web/src/routes/_auth/preventive-care.tsx`, `apps/native/app/(drawer)/preventive-care.tsx` |

## Rules

- **Region first.** Without a region in the #98 profile there is no list,
  only an explanation. Changing region swaps the rule set. Item ids include
  the region (`us.…`, `uk.…`, `pt.…`), so the previous region's history is
  kept.
- **Adults only, owner only.** The feature needs the #98 "18 or older"
  answer. Only the workspace owner, who is the person the record belongs to,
  can see or change it. Other members get `owner_only`.
- **Inputs are limited.** The engine reads exactly four inputs: region, the
  #98 age range (from birth year, with consent), the #98 sex for reference
  tables (with consent), and the person's self-declarations. A test asserts
  that no other input is read. A missing age or sex is shown as missing
  ("add your age band…"). Nothing is inferred. A birth year that straddles an
  age limit is reported as `age_edge`, not resolved.
- **Self-declared criteria** (for example "Have you ever smoked?") are only
  asked when an item in the region names them. They are never pre-selected,
  can be answered "Prefer not to say" (shown as "may apply"), and can be
  cleared, which deletes the row.
- **Grades mirror the authority.**
  - USPSTF A/B: "Recommended (USPSTF B)".
  - NHS/SNS programme: "Offered by … screening programme".
  - USPSTF C: "Individual decision: discuss with your clinician".
  - USPSTF I: "Evidence uncertain".
  - USPSTF D: "Not recommended".

  There is no app-invented band. Grades are always text, never colour alone.

- **States.**
  - Done date: every item.
  - Next date and reminder: recommended and programme items only.
  - "Expect your invitation": programme items.
  - "Decided: yes / no / later": individual-decision items.

  Decision and informational items never take a date and never count down.
  The word "overdue" is never used. When the person's own date arrives, the
  item says "The date you set has arrived". A next date is _suggested_ only
  when the source states a single fixed interval, and it is never applied
  until the person accepts it.

- **Framing on every item:** "Information from <authority>, published <date>.
  General public-health guidance, not personal medical advice. It may not
  apply to you." Each item also shows a non-endorsement line, the citation
  (statement, source version, retrieval and review dates), the source link,
  and a "Report a problem with this guidance" link.

## Reminders

Reminders reuse the #92 delivery contract (`insight-delivery.ts`). The insight
kind `reminder` was added to `INSIGHT_KINDS` and to the
`insight_preference_disabled_channels_check` constraint. A reminder goes out
only when all of these hold:

- the person set a date on a date-carrying item and turned "remind me" on;
- push and/or email is on for the workspace and `reminder:<channel>` is not
  switched off;
- they own the workspace, are a member, are not banned, are a confirmed adult,
  and the item belongs to their current region;
- the item is not past its review date;
- it is after their local delivery hour.

Reminders run in the hourly `cron.insightsRun` job, before insights. They
share the `insight_delivery` claim, so there is at most one push per local day
and one email per ISO week in total. Each reminder id is
`reminder:<item id>:<date>`, so one date is never sent twice on a channel.
Push and email text is generic ("You have a reminder") and never names the
item, a health topic, a date or a value. Logs hold ids and counts only.

## Source fidelity and expiry

Each item stores:

- authority and region;
- statement title and date;
- deep link;
- exact source version;
- retrieval date;
- grade, population (sex, age range, self-declared criteria) and interval;
- reviewer, review date and `reviewBy`.

Only short factual fields are stored. No guideline text is copied, and nothing
is merged across authorities. The USPSTF items are pinned to dated statements,
never to "current USPSTF".

`preventive-care-pack.test.ts` fails the build if any of these hold:

- an item lacks its source, dates, grade, reviewer or expiry;
- an item cites another region's authority or a different site;
- a suggestion has no published interval;
- a decision or informational item can count down;
- the review window exceeds 90 days.

Past `reviewBy`, an item is shown only with "This item is being reviewed…".
Its details and reminders are paused.

**To re-review an item:** open the source link, compare every field, update
the item, bump its `version`, set `retrievedOn`/`reviewedOn` to today and
`reviewBy` to at most 90 days later, then bump the pack `version`.

### Items in pack 2026-10-16.1

The authoring agent fetched each source on 2026-10-16 and compared its fields
with the page. A maintainer still has to sign off on fidelity before release.
The `reviewer` field says so.

| Region | Items                                                                                                                                                                                                                                                                                                            | Source                                    |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| US     | Colorectal 45–49 (B) and 50–75 (A), breast 40–74 biennial (B), cervical 21–65 (A), lung 50–80 with smoking history (B), AAA men 65–75 who ever smoked (B), osteoporosis women 65+ (B), blood pressure 18+ (A), hepatitis C 18–79 (B), HIV 18–65 (A), PSA 55–69 (C), PSA 70+ (D), hearing 50+ (I), vision 65+ (I) | USPSTF statement pages                    |
| UK     | Cervical 25–64 every 5 years, breast 50–70 every 3 years, bowel 50–74 every 2 years, AAA men at 65, lung health check 55–74 ever smoked, NHS Health Check 40–74 every 5 years (England only)                                                                                                                     | nhs.uk pages                              |
| PT     | Cervical (HPV) 30–69, repeated after 5 years if negative                                                                                                                                                                                                                                                         | Norma DGS n.º 09/2024 de 17/10/2024 (PDF) |

### Needs human verification (deliberately not shipped)

- **Portugal breast screening (45–74, biennial).** News reports cite Norma DGS
  n.º 012/2024 of 06/12/2024. The authoring agent could not retrieve the norma
  itself.
- **Portugal colorectal screening (50–74).** No primary DGS source was
  retrieved.
- **Vaccination packs for all regions** (CDC/ACIP, NHS, DGS PNV). The US
  adult schedule is contested, and the UK and PT parameters came from
  secondary sources.
- **USPSTF osteoporosis (postmenopausal women under 65 at increased risk) and
  other risk-based rows.** They need a risk assessment, which is out of scope.
- **Scotland, Wales and Northern Ireland programmes.** UK items are England
  only and say so.
- **EU Council Recommendation 2022** as a fallback for other EU countries.
- **Dental, vision and hearing recall as user-set "practice guidance"
  reminders** (NICE CG19 is link-only).

## Evidence-check library

The library is off by default (`preventive_care_setting.library_enabled`). It
is read-only and never becomes a reminder. Each entry has:

- a verdict;
- a GRADE-style certainty label, with "probably", "may" and "very uncertain"
  wording;
- harms and cautions where a primary source states them;
- primary sources: trials, systematic reviews, guidelines or consensus
  statements.

Entries contain no doses, and no influencer is named or cited as an
authority. Tests enforce both. Each source records its `verification`:

- `checked_on_retrieval`: compared with the source during authoring (USPSTF
  2022 supplements, Endocrine Society 2024).
- `from_research_brief`: taken from the repo's research brief. It shows "awaiting
  a maintainer check" in the UI until a maintainer confirms it.

## Data rights and logs

The tables are `preventive_care_setting`, `preventive_care_declaration` and
`preventive_care_item_state`. All are keyed by (organization, user) and
cascade from `member`. They are registered in data rights as `user` tables,
so export and delete cover the person's completions, dates, declarations and
decisions. Logs and delivery records hold item ids, criterion ids, changed
field names and counts. They never hold an answer, a date or a value.

## Hazard log (non-clinical, review each release)

| Hazard                                     | Control                                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Wrong age (birth year only)                | Age range with `age_edge`; nothing resolved or guessed                                     |
| Wrong sex match                            | Uses #98 sex with consent only; otherwise `needs_sex`                                      |
| Stale guidance                             | `reviewBy` ≤ 90 days; expired items suppressed with "being reviewed"; pinned statements    |
| False reassurance ("nothing applies")      | Hidden items listed under "Not shown for you"; framing says guidance may not apply         |
| Region mismatch (e.g. Scotland vs England) | Items name their scope; reminders only for the current region                              |
| Reminder channel failure / time zone       | #92 claim with retries; local delivery hour; reminders never replace programme invitations |
| Lock-screen disclosure                     | Generic push and email text only                                                           |
| AI hallucination                           | No AI in this path; the coach does not cite these items yet                                |
