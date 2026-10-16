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

**Reference comparison**:
A person's own usual value (28-day median) shown next to a published,
cited reference: a guideline range (WHO activity, NSF sleep) or a coarse band
for their age group and sex (below, within or above the middle half of a
published reference group). Opt-in per metric, adults only, never a rank,
percentile or community aggregate (`docs/reference-comparisons.md`).
_Avoid_: Benchmark, percentile, ranking, "people like you" score
