# Confirmed goals schema contract

Migration `20261102090000_goals_foundation` is additive. Legacy `goal` and
`goal_checkin` rows retain IDs and values and have nullable `user_id`; readers
must exclude those rows unless an explicit, audited owner assignment has been
performed. New repositories must always write an authenticated owner.

Drizzle exports (via `schema/plans.ts`):

- `goal`: adds `userId`, `version`, `source`, `everHadEvidence`, `definition`,
  `timezone`, `startDate`, `cutoffTime`, `deletedAt`.
- `goalCheckin`: adds nullable legacy-compatible `userId`, `version`,
  `correctedFromId`, `deletedAt`. Existing textual `date`/`value` fields stay
  unchanged. Its owner/id unique constraint precedes its owner-preserving
  correction self-reference. New writes must set owner and use versioned
  correction/deletion.
- `goalDefinition`: revisioned JSON definition with `effectiveFrom` and
  `effectiveUntil` boundaries.
- `goalMilestone`: checkpoint `value`, `targetDate`, and `achievedAt`.
- `goalLifecycle`: lifecycle `event`, `occurredAt`, optional `effectiveDate`
  and `details` (including pause/resume history).
- `goalMutation`: per-owner `clientMutationId`, operation, fingerprint and
  result receipt for retry idempotency.
- `goalOwnershipAssignment`: explicit assignee, assigning user, reason and
  timestamp provenance for legacy goal authorization.
- `supplementIntake`: actual `occurredAt`, IANA `timezone`, `dose`, `version`,
  `correctedFromId` and `deletedAt`; this is distinct from schedules.
  Its owner/id tuple is a unique constraint created before the correction
  self-reference, preserving same-owner correction integrity.
- `goalWaterLink`: owner-scoped linked goal; partial unique index allows only
  one active link per owner.
- `goalWaterCutover`: durable per-owner marker; once present, do not fall back
  to the legacy water preference when a goal link ends.

Goal child relations use composite organization/user/goal foreign keys. Owner
and member constraints are nullable only on the retained legacy goal/check-in
rows. Database JSON columns intentionally have no dependency on `@openvalens/plans`;
the repository validates definition shape. Evidence source identifiers are
`manual`, `water`, `supplement`, `workout`, and `sleep`.

This migration is solely the goals foundation. The sleep lane must contribute
its distinct health-record migration separately; coordinate its timestamp and
global migration registration with the migration owner before integrating it.
