# Energy estimate and target proposals (Issue #76)

OpenValens can show an **experimental** estimate of the daily energy intake
that would keep a member's weight trend steady ("estimated maintenance
intake"), and can turn it into a **proposal** for their energy target that
they accept or dismiss. Nothing changes on its own.

| Piece           | Version                     | Code                                                        |
| --------------- | --------------------------- | ----------------------------------------------------------- |
| Estimate method | `energy_balance` v1         | `packages/nutrition/src/energy-estimate.ts` (pure)          |
| Proposal policy | `nutrition-safety/v1`       | `packages/nutrition/src/energy-proposal-policy.ts` (pure)   |
| Proposal store  | `nutrition_energy_proposal` | `packages/nutrition/src/energy-proposals.ts`                |
| Service         | —                           | `packages/api/src/energy-estimate.ts`                       |
| Wire contract   | —                           | `packages/api/src/contracts/energy-estimate.ts`             |
| Procedures      | —                           | `appRouter.nutritionEnergy` (`routers/nutrition-energy.ts`) |

**Status: experimental, unvalidated.** Every constant below is a documented
product choice (the evidence notes in
`docs/research/notes/Nutrition tracking evidence/energy_expenditure.md` supply
no validated minimum-data threshold or confidence level). The synthetic tests
check arithmetic and invariants only. Held-out validation on real logged data
must precede any accuracy claim, confidence label or general enablement.
Changing any constant bumps the method or policy version.

## What it does not claim

It is not a measurement of physiological energy expenditure, says nothing
about health status and is not advice. It is in the member's own logging
units: if some food is consistently not logged, the estimate moves by about
the same amount. Wearable or workout activity is **never** added — the
estimate already contains whatever the member did, so adding activity would
count it twice. Adults only (18+, self-declared in the wellness profile, #98):
for anyone else no record is read and no proposal is made.

## Estimate (`energy_balance` v1)

```
estimate = mean daily intake − (weight trend change ÷ days between trend values) × 7,700 kcal/kg
```

- **Window:** the 28 local dates ending on the requested date (`to`, the
  member's own local date; at most one day after the server's UTC date).
- **Intake** (daily totals with coverage, #79): a day is used only when the
  member marked it complete, it has at least one entry, and every entry has
  an energy (kcal) value. Unmarked days, days marked complete with nothing
  logged, and days where any food lacks energy are **missing** — left out,
  never counted as zero. A recorded 0 kcal is data. kJ values are not
  converted.
- **Weight** (provisional trailing-mean trend `trailing_mean` v1, #87): the
  change between the first and last trend values in the window. Days without
  a recorded weight are gaps, never interpolated.
- **Energy density:** 7,700 kcal per kg (the 3,500 kcal/lb approximation;
  Hall 2008, PMID 17848938; Heymsfield et al., PMC3810417). Early in a change,
  weight shifts are mostly water and glycogen, so the constant is least
  accurate in the first weeks. The citation and caveat are returned with
  every estimate.

### Readiness (no estimate rather than a forced number)

All unmet rules are returned together in `reasons`, each with neutral copy:

| Rule                                                                           | Reason                        |
| ------------------------------------------------------------------------------ | ----------------------------- |
| ≥ 14 usable intake days in the window                                          | `not_enough_complete_days`    |
| ≤ 3 of the last 7 days without usable intake                                   | `recent_days_incomplete`      |
| ≥ 8 recorded weight days in the window                                         | `not_enough_weight_days`      |
| a trend change exists (two trend values)                                       | `weight_trend_unavailable`    |
| trend change spans ≥ 14 days                                                   | `weight_change_too_short`     |
| no gap without a weight longer than 7 days                                     | `weight_gap_too_long`         |
| weight trend method is the one specified (v1)                                  | `weight_trend_method_changed` |
| result within 1,000–6,000 kcal/day (else likely unlogged food or fluid shifts) | `outside_plausible_range`     |

### Uncertainty

Arithmetic only, never labelled as a confidence level:

- intake: standard error of the mean of the used days (`sd / √n`);
- weight change: each trend end point's uncertainty is the spread of recorded
  weights around their trend values divided by `√(readings in its window)`;
  the two ends combine in quadrature, with a **0.5 kg floor** for fluid shifts;
  converted to kcal/day with the same 7,700 kcal/kg over the change's days;
- the two combine in quadrature; the shown range is the estimate ± 2 SD.

Estimates and ranges are rounded to 10 kcal. The response also returns every
input: per-day use and kcal, counts of each missing kind, the mean and SD of
intake, the weight change, rate per week, residual spread and the method.

## Proposals (`energy-proposal/v1`)

The estimate is information; a proposal is a separate, stored suggestion.

- Created only when the member asks (`nutritionEnergy.propose`); the server
  recomputes the estimate — clients never send numbers. A new proposal
  replaces (supersedes) any pending one; at most one is pending per member.
- The proposal kind and target follow the current nutrition safety policy
  (`nutrition-safety/v1`), including direction, exclusions, floors, caps, BMI
  gates and the bounded target step (at most the smaller of 200 kcal and 10%
  of the current target). A new proposal is withheld within 7 days of the last
  accepted change. Refusal copy never states a floor or body value.
- The historical estimate is computed from the requested window and retained
  as an immutable proposal snapshot. Under the shared per-user database lock,
  the server loads current profile, consent, nutrition settings, current target
  and latest accepted change, then plans and inserts/supersedes the proposal in
  that same transaction. A stale context cannot create a pending proposal.
  Safety-input writers participate in this same lock.
- A proposal is valid for 7 days. **Accept** (`acceptProposal`) re-checks it
  under a lock: still pending, not expired, member still qualifies under the
  current safety policy, and the stored target still matches the reviewed
  proposal. Only then is the
  `energy_kcal` goal written (`min = max = target`, archiving the previous
  one) and the proposal marked accepted with the goal id, atomically.
  **Dismiss** leaves the target unchanged.
- Decisions need the member's own, non-impersonated session.

### Visibility

When hide-numbers mode is on (or the member is not known to be eligible to see
the estimate), proposal metadata remains actionable, but kcal fields and the
entire nested estimate snapshot are withheld as `null`; values are never
replaced with zero. The estimate endpoint returns a neutral hidden status.
When energy suggestions are off, proposal lists are empty and refusals do not
echo a stored proposal. Dismissed and replayed decisions also use the same
visibility-aware mapper. This API redaction does not change the member's own
raw data-rights export.

## Data and privacy

`nutrition_energy_proposal` is organization- and member-scoped (composite
member FK), registered in the data-rights registry for export and deletion,
and stores the full historical estimate snapshot for transparency. Logs carry
statuses and reason codes only, never a value; writes are audited with the
proposal id.
