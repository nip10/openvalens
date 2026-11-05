# Personal Goals deployment and migration

Goals and their evidence are private to the authenticated person in the active
workspace. This note describes the additive rollout and migration safety
requirements. The migration sequence was rehearsed on a disposable database,
including repeat application and interruption rollback/retry; this does not
mean a production backup was restored or production was migrated.

## Current implementation map

- Domain model and evaluation: [`goal-model.ts`](../packages/plans/src/goal-model.ts),
  [`goal-evaluation.ts`](../packages/plans/src/goal-evaluation.ts), and the
  owner-scoped repository [`personal-goals.ts`](../packages/plans/src/personal-goals.ts).
- Goals API: [`goals.ts`](../packages/api/src/routers/goals.ts). Actual
  supplement intake repository and API: [`supplement-intake.ts`](../packages/plans/src/supplement-intake.ts)
  and [`supplement-intake.ts`](../packages/api/src/routers/supplement-intake.ts).
- Water-goal target bridge: [`plain-water-goal.ts`](../packages/nutrition/src/plain-water-goal.ts)
  and [`plain-water.ts`](../packages/nutrition/src/plain-water.ts).
- Person-attributed sleep evidence: [`queries.ts`](../packages/sleep/src/queries.ts)
  and [`health-record.ts`](../packages/db/src/schema/health-record.ts).
- Additive migrations: [`20261102090000_goals_foundation`](../packages/db/src/migrations/20261102090000_goals_foundation/migration.sql)
  and [`20261102120000_personal_sleep_ownership`](../packages/db/src/migrations/20261102120000_personal_sleep_ownership/migration.sql).

Migrations use timestamped directories containing `migration.sql` under
`packages/db/src/migrations/` (Drizzle V3 folder format); there is no
`_journal.json` registration to edit. Apply them through the normal migration
deployment process, in timestamp order. The sleep migration is a distinct
sleep-lane contribution; coordinate release and migration ownership rather
than combining it with unrelated health-record changes.

## Domain and data behavior

Goals support target, recurring, rolling-average, and consecutive-streak rules.
Targets may be minimums, maximums, or ranges. Missing or incomplete evidence is
unknown, not zero; averages require daily coverage and aggregate daily values
before averaging. Recurrence supports daily, selected ISO weekdays, or any N
distinct days Monday through Sunday.

Milestones are dated checkpoints on the goal's same metric and source, not
phases; passing a checkpoint date does not mark it failed. Rule revisions take
effect in the future (weekly cadence edits start the next full week); evidence
correction is evaluated against the rule effective at the evidence occurrence.
The goal timezone is stable, with an optional local-day cutoff. Sleep evidence
uses its local wake-up date. Pause suspends tracking and does not bridge a
streak; resume begins a fresh window. Explicit lifecycle completion is distinct
from an achievement computed from evidence. Manual check-in and intake
corrections retain prior versions/rows and make the replacement current.
Once evidence exists, the source and
metric are immutable; create a replacement goal to change them. Corrections
can change evidence and therefore historical evaluation. Actual supplement
intake is evidence; a schedule is not. Multiple doses are retained, while a
supplement goal receives at most one qualifying daily credit.

Automatic sleep evidence requires person attribution and deduplicated,
reconciled ingestion; ambiguous historical rows are excluded. Workout evidence
requires an owned workout and an explicit stable exercise-catalog mapping.
Source records remain independent of goal deletion.

## Operational rollout

1. **Prepare the exact target.** Take a backup of the exact production database
   before any migration. The disposable PostgreSQL rehearsal covered both
   timestamped migrations, repeat application, interruption rollback, and
   retry. It is not a production backup or production migration.
2. **Apply the additive schema first.** Apply the reviewed migration artifact
   once, and verify its ledger, before allowing API v2 endpoints or owner-aware
   app/ingestion workers to receive traffic. The ordinary post-deploy migration
   hook must be a no-op after this pre-application. Keep existing goal/check-in and
   health-event rows intact. Their new ownership is nullable by design; null
   means legacy/unassigned, not workspace-wide evidence.
3. **Deploy owner-safe services.** Roll out API readers/writers and ingestion
   workers that derive organization and user from trusted authentication or
   source attribution. Drain older workers before enabling new evidence paths.
   Every reader—including indirect insights, AI, exports, and data-rights
   paths—must enforce the same organization-and-user scope.
4. **Assign legacy ownership only by explicit authorization.** Assignment must
   record who assigned the owner, who was assigned, when, and why. Keep it a
   separate, audited operation. Do not infer an owner from organization,
   creator, device, or current membership; do not confuse ownership assignment
   with unit/configuration normalization.
5. **Cut over water per person, deliberately.** Confirm the person's timezone
   and intended daily target before linking a compatible daily water goal.
   The per-owner cutover marker is durable: ending or deleting the linked goal
   removes the goal target and must never restore the old preference as a
   fallback. After cutover, legacy target writes from older clients return
   `409`; upgrade/drain those clients rather than clearing the marker. Never
   perform a workspace-wide implicit cutover.
6. **Hold production for the native-first API v2 rollout.** There is no
   dedicated Goals feature flag. Keep production API/web on the current API v1
   release while native 1.1.0 store candidates are being reviewed. Stage and
   verify API v2 only on an isolated review server. Make the API v2 production
   endpoint available only after the native 1.1.0 app is approved and available
   to users. Native 1.1.0 supports API v2 only; API v1-only native clients are
   unsupported and require an update. New connection checks block unsupported
   versions, but already-authenticated old binaries may still attempt calls
   and fail until updated. Native 1.1.0 cannot use an API v1 server. Communicate
   the required app update before server cutover.
7. **Rollback compatibly.** Roll back application images/flags only to a
   server version that safely ignores additive columns and never restores
   organization-wide readers. Keep ownership columns, intake rows, correction
   history, source records, and cutover markers. Do not drop columns/tables,
   unassign owners, or resurrect legacy water targets as a rollback shortcut.

Before enabling production writes, verify same-workspace cross-user reads and
mutations are denied and that historical artifacts remain unchanged unless an
explicit authorized assignment/correction occurred. Do not describe these
checks or the disposable-database rehearsal as complete until they have been
run and recorded in the final verification evidence.

## Non-goals

This release does not add notifications, sharing, task management, cross-
workspace portability, or goal phases. Readiness behavior remains unchanged.
