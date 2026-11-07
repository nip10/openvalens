# OpenValens

OpenValens is a personal health record platform where each person works inside
their own workspace. This glossary fixes the two authority concepts that the
global settings foundation depends on.

## Language

**Instance administrator**:
An operator with explicit authority over the whole OpenValens installation. The
authority is granted deliberately by a trusted operator and is never implied by
membership in, or ownership of, any single workspace.
_Avoid_: Global admin, superuser, system administrator

**Workspace owner**:
The person who owns a workspace and holds full authority within it. Workspace
ownership is scoped to that one workspace and never confers instance
administrator authority.
_Avoid_: Organization owner, account owner, org admin

**Food catalog**:
An instance-wide, read-only mirror of one public food database (USDA FoodData
Central or Open Food Facts), kept in its own table with its own license and
attribution. It holds no personal data and is never merged with another
catalog or with a person's custom foods; logging copies a catalog food into a
snapshot.
_Avoid_: Food database (ambiguous), canonical foods table

**Nutrient coverage**:
For one nutrient on one local day, how many of the day's logged entries
provided a value (`full`, `partial`, `none`, or `no_entries` when nothing was
logged). A daily total sums only provided values and is always shown with its
coverage; a value a food's source did not provide is unknown, never zero.
_Avoid_: Completeness (that is the explicit "day complete" marker), data quality

**Custom food**:
A food a member enters themselves ("My foods"), private to that member inside
their workspace. It is never shared with other members, never published to a
food catalog, and its provenance is always "entered by you". Editing creates a
new revision; archiving hides it from search and logging. Meals already logged
keep the snapshot taken at logging time, so neither changes them. Recipes are a
later phase and are not custom foods.
_Avoid_: Personal catalog, user food database

**Active minutes**:
Moderate minutes plus twice the vigorous minutes from a person's sessions over
the last 7 days, shown against the WHO adult range of 150–300 minutes a week.
Only sessions with a recorded intensity count; the rest are reported as
missing, never as zero (`docs/activity-load.md`).
_Avoid_: Activity score, PAI, cardio points

**Effort points**:
Session-RPE: a session's effort rating (0–10) times its minutes, summed per
day and over the last 7 days. Compared only with the person's own earlier
weeks, never with other people and never framed as a recovery or injury
signal.
_Avoid_: Strain, training load score, readiness

**Insight**:
A short, deterministic description of something in a person's own records
(a change against their own usual, a goal milestone, a data-quality note or a
recording streak), produced by a versioned rule and rendered from a reviewed
template. Never stored, never AI-written, never advice. Push and email are
optional, opt-in channels for the same insights.
_Avoid_: Alert, recommendation, AI insight

**Guideline item**:
One fact set published by a public-health authority for a region (population,
interval, the authority's own grade), stored as versioned repo data with its
source link, statement date, retrieval date, reviewer and expiry. Shown, never
computed; filtered only by region, the profile's age range and sex, and the
person's own declarations.
_Avoid_: Recommendation (the app does not recommend), screening rule, alert

**Self-declaration**:
An optional answer the person gives to a criterion a guideline item names
(for example "ever smoked"). Never inferred and never pre-selected; "prefer not
to say" is always allowed and clearing deletes it.
_Avoid_: Risk factor, eligibility check

**Reminder**:
A date the person set on a guideline item, delivered only through the push or
email channels they turned on for insights, with generic text. Not an insight
and never used for individual-decision or informational items.
_Avoid_: Due date, overdue notice

**Evidence check**:
The opt-in, read-only library rating popular longevity practices and tests
against primary evidence with a certainty label. No doses and never a
reminder.
_Avoid_: Longevity protocol, supplement plan

**Reference comparison**:
A person's own usual value (28-day median) shown next to a published,
cited reference: a guideline range (WHO activity, NSF sleep) or a coarse band
for their age group and sex (below, within or above the middle half of a
published reference group). Opt-in per metric, adults only, never a rank,
percentile or community aggregate (`docs/reference-comparisons.md`).
_Avoid_: Benchmark, percentile, ranking, "people like you" score

**Goal**:
A person's private, time-zoned definition of a desired outcome, with one
metric, one evidence source, and a rule for evaluating progress.
_Avoid_: Task, plan phase

**Evidence**:
A person-owned observation or explicit manual entry that can support a goal's
metric and rule. An absent or incomplete observation is unknown, never zero.
_Avoid_: Schedule, assumption

**Check-in**:
A manual, person-entered value or completion assertion for a goal day; it is
distinct from automatically collected source evidence.
_Avoid_: Reminder, scheduled completion

**Milestone**:
A dated checkpoint on the same metric and source as its goal. Passing its date
without reaching it means overdue, not failed.
_Avoid_: Phase, subgoal

**Recurrence**:
A rule for daily completion, selected weekdays, or any specified number of
distinct qualifying days in a Monday–Sunday week.
_Avoid_: Supplement schedule, reminder cadence

**Rule revision**:
A future-effective change to how a goal is evaluated. Past evidence remains
interpreted by the rule effective at its occurrence unless that evidence is
corrected.
_Avoid_: Retroactive edit

**Intake**:
An actual, timestamped supplement dose recorded by the person; a planned or
scheduled dose is not an intake.
_Avoid_: Supplement schedule, planned dose

**Achievement**:
A goal outcome supported by its qualifying evidence and rule; correcting or
removing supporting evidence can change that outcome.
_Avoid_: Completion assertion (a lifecycle action)

**Goal day**:
A calendar day in the goal's stable timezone, adjusted by its optional local
cutoff; sleep evidence is assigned to its local wake-up date.
_Avoid_: UTC day, device-local day
