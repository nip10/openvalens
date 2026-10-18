# Nutrition targets, safety policy and hide-numbers mode (Issue #80)

Nutrition targets are **owned by the member**. Nothing sets, lowers or raises
a target on its own: a target is either entered by the member or accepted by
them from a proposal (#76). Logging works with no targets at all, and in
hide-numbers mode.

This is general wellness, not therapeutic diet planning. No clinician reviews
the policy and it is **not clinically validated**; the values come from
published guidelines and trials plus a few documented product choices.

| Piece                       | Code                                                                     |
| --------------------------- | ------------------------------------------------------------------------ |
| Safety policy (pure config) | `packages/nutrition/src/nutrition-safety.ts` (`NUTRITION_SAFETY_POLICY`) |
| Proposal planner            | `packages/nutrition/src/energy-proposal-policy.ts`                       |
| Targets and settings store  | `packages/nutrition/src/targets.ts`                                      |
| Service                     | `packages/api/src/nutrition-targets.ts`                                  |
| Wire contract               | `packages/api/src/contracts/nutrition-targets.ts`                        |
| Presenter (web + native)    | `packages/api/src/presenters/nutrition-targets.ts`                       |
| Procedures                  | `appRouter.nutritionTargets` (`routers/nutrition-targets.ts`)            |

## Targets

- One active target per nutrient (`nutrition_goal`), with a `min`, a `max` or
  both. Each target records its **source** — `entered` (typed by the member)
  or `proposal` (accepted from a #76 proposal) — and the local date it is
  **effective from**. Replacing or clearing a target stamps `effective_to`,
  so the target that applied on any past day can be shown for that day.
- Targets are shown **separately from observed totals** and only when set.
  Totals and targets are never compared: no "over"/"under", no colours, no
  verdicts. A day with missing or partial logging is shown as such, never as
  being below a target.
- New members have no targets and the default direction is **maintain**.
  There is no automated deficit.
- After an eating-disorder declaration, energy targets are hidden and cannot
  be set (they are not deleted), and every energy suggestion is off.

## Hide-numbers mode

A per-member setting (`nutrition_target_settings.hide_numbers`). When on, web
and native hide every numeric intake value and every target: day totals,
per-entry energy, the portion preview before saving, and the targets card.
Coverage ("from 3 entries") and logging stay. Streak surfaces (#90) are
hidden too. Turning it on or off never changes stored data.

## Safety policy `nutrition-safety/v1`

| Parameter         | Value                                                                                     | Basis                                                  |
| ----------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Calorie floor     | max(1,200, sex floor, estimated resting expenditure)                                      | AHA/ACC/TOS 2013; resting part is a product choice     |
| Sex floor         | 1,200 female · 1,500 male · 1,500 not declared                                            | AHA/ACC/TOS 2013; undeclared = higher (product choice) |
| Resting estimate  | Mifflin–St Jeor; needs weight, height and age; undeclared sex and age ranges conservative | Mifflin 1990                                           |
| Never propose     | < 1,200 kcal/d under any setting                                                          | NICE NG246                                             |
| Default deficit   | min(500 kcal/d, 20% of estimate, 0.7% body weight/week)                                   | AHA; Garthe 2011                                       |
| Hard deficit cap  | min(750 kcal/d, 25% of estimate); loss ≤ 1.0% body weight/week (0.5% at 65+)              | AHA; Helms 2014                                        |
| Gain              | +10% default, at most +20% of estimate; ≤ 0.5% body weight/week                           | Decision 15; Iraki 2019                                |
| Weekly step       | each change ≤ min(200 kcal, 10% of current); one accepted change per 7 days               | Decision 15 [PRODUCT CHOICE]                           |
| BMI gate          | no reduction if current BMI < 18.5; no undefined projected-horizon test                   | Decision 16; WHO                                       |
| Protein reference | 0.8 g/kg; 1.2–1.6 g/kg only if opted in as active; ≥ 1.0 g/kg at 65+; ≤ 0.8 g/kg with CKD | NASEM/EFSA; PROT-AGE 2013; KDIGO 2024 3.3.1.1          |

Rules the planner adds:

- Reductions are proposed only when the member chose **lose**, is a confirmed
  adult, declared no exclusion, and has a recent weight trend and a
  self-declared height (for the BMI gate). Otherwise the refusal says what the
  app won't do, never a floor, BMI or weight.
- Rounding always moves towards the estimate, so it never enlarges a deficit
  or surplus.
- Protein minimums are rounded up and maximums down to preserve their bounds;
  the CKD cap is rounded down. A single unconstrained reference value is
  rounded to the nearest configured precision.
- A returned target must satisfy the floors, expenditure-relative deficit or
  surplus limits, exclusions and weekly step regardless of its direction
  label. If the step-limited target is unsafe, the proposal is withheld rather
  than jumping to a larger target. This includes cases where the floor and step
  limit cannot both be satisfied.
- BMI eligibility uses current BMI only. The earlier fixed 12-week projection
  was not supported by the recorded decision and is not applied; no projection
  horizon is defined for an accepted target.
- Accepting re-checks everything: a newly declared exclusion blocks a pending
  reduction, and a reduction under a soft gate needs an explicit confirmation.

Property tests (`nutrition-safety.test.ts`) generate 20,000 synthetic inputs
and check that no proposal violates the floor, caps, step size or BMI gate.

## Self-declared exclusions

Yes/no only; never inferred, never diagnosed, no details asked. Any of these
turns off reduction proposals (logging stays):

- under 18 (from the wellness profile, #98; AAP 2016)
- pregnant or breastfeeding (breastfeeding is precautionary)
- current or past eating disorder — also turns off energy targets, all energy
  suggestions and streaks (#90)
- taking insulin, sulfonylureas or meglitinides (ADA Standards of Care)
- chronic kidney disease (also caps the protein reference)
- active cancer treatment, past bariatric surgery, history of refeeding
  syndrome (precautionary)

Soft gates (reductions stay available but need an extra confirmation): age
65+ (also 0.5%/week loss cap and ≥ 1.0 g/kg protein) and GLP-1/GIP
medication. Any exclusion also hides streaks (#90).

After an eating-disorder declaration the member sees the agreed message and
the helplines for their profile region. Removing that answer later needs a
deliberate, separate confirmation and is never prompted.

## Helplines (`helplines/v1`)

Stored in `NUTRITION_HELPLINES` with a `verifiedAt` date per number, re-checked
every 6 months. Only verified numbers are shown; the
[Find A Helpline](https://findahelpline.com) directory is always listed and is
the only entry for other regions.

| Region | Line                                             | Verified   |
| ------ | ------------------------------------------------ | ---------- |
| UK     | Beat: England, Scotland, Wales, Northern Ireland | 2026-10-16 |
| US     | National Alliance for Eating Disorders; ANAD     | 2026-10-16 |
| PT     | SNS 24 808 24 24 24 (option 4)                   | not yet    |
| Other  | findahelpline.com                                | 2026-10-16 |

The SNS 24 option-4 number is held back until a person confirms it on the
service's own page.

## Changelog

Changing any value is a reviewed config change: bump the version in
`NUTRITION_SAFETY_POLICY`, add a `changelog` entry there and a row here.

| Version               | Date       | Change                                                                                                                                                    |
| --------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nutrition-safety/v1` | 2026-10-16 | First version: floors, deficit and gain caps, weekly step, BMI gate, self-declared exclusions and protein reference. Replaces `energy-proposal/v1` (#76). |

## Data and privacy

`nutrition_target_settings` (hide-numbers, direction, active opt-in, height,
declarations) is user-owned. Reads and writes require the member's own
non-impersonated session; workspace owners do not receive another member's
settings through export or deletion. Logs and audit entries carry generic
processing outcomes and nutrient keys only, never a value, reason or
declaration.
