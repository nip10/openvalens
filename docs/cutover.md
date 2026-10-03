# Cutover runbook — Issue #37

Last updated: 2026-10-01

> This document is the single source of truth for the anchovy → OpenValens
> cutover. It assumes `apps/server` is deployed on Coolify/Hetzner (see
> [docs/deployment.md](deployment.md)) and that the `anchovy` Postgres still
> serves the old Next.js app until the moment of the switch.

## 1. Preconditions

Before the cutover window opens, every box must be true:

- [ ] `bun run db:migrate` has been run against the new OpenValens DB and the
      latest schema is live. Compare against the source list in
      `packages/db/src/migrations/`.
- [ ] The reverse proxy / DNS target points to a staging instance with
      `CSP_MODE=enforce` set and a clean readiness report for at least 24
      hours.
- [ ] The mobile app is on a build that uses `mobile.registerDevice` /
      `mobile.ingestBatch` (i.e. OpenValens, not anchovy). Confirm via the
      audit log: every mobile write should land in the new schema's
      `ingestion_batch` and `metric_sample` tables, not the legacy ones.
- [ ] `apps/server/src/index.ts` is configured for the production DATABASE_URL
      via Coolify secrets (not a `.env` baked into the image).
- [ ] A fresh `pg_dump` of the **anchovy** DB is stored outside the app
      container, with the timestamp captured in the cutover log.

## 2. Cutover sequence

Run these in order, top to bottom. Each step assumes the previous one
succeeded.

1. **Freeze writes on anchovy.** Disable the ingest cron, flip the anchovy
   webhook to a maintenance response, and pause any background workers.
   Confirm via the anchovy readiness probe that mutations have stopped.
2. **Final migration dry-run.** `ANCHOVY_DATABASE_URL=... OPENVALENS_DATABASE_URL=... bun run scripts/migrate-anchovy.ts --dry-run`. The script prints
   per-table row counts and exits. Confirm the totals match the expected
   volume (compare against the anchovy row counts in `pg_stat_user_tables`).
3. **Run the migration for real.** Same command without `--dry-run`. Watch
   the per-table lines: each table prints `<table> <count> rows <ms>`. Save
   the output — it is the cutover audit log.
4. **Smoke the OpenValens deployment.** Run every step in
   [docs/deployment.md §8](./deployment.md#8-smoke-checks). All four
   `curl` checks must return success, and the readiness probe must show
   `status: "ok"`.
5. **Flip DNS / proxy.** Update the platform's reverse-proxy target to the
   OpenValens deployment. Existing HTTPS certs continue to work because
   the domain is unchanged.
6. **Unfreeze writes on OpenValens.** Re-enable the cron endpoints and the
   webhook. Confirm by sending one synthetic `mobile.ingestBatch` request
   from a test device.
7. **Disable anchovy.** Take the old deployment off the load balancer. Keep
   the database and the image tags live for the rollback window.

## 3. Rollback

If any post-cutover smoke check fails, the fastest path is the image
rollback procedure in [docs/deployment.md §11](./deployment.md#11-rollback-runbook).
Keep these artefacts live for at least 14 days:

- The previous anchovy image tag (unaffected by OpenValens's deploy).
- The pre-cutover `pg_dump` of the anchovy DB.
- A copy of the OpenValens migration script output (the row counts
  applied).

Database rollback is only needed if the migration script introduced a
schema-level bug. Quarantine-over-DELETE keeps the source data intact, so
re-running the migration against a restored snapshot is the recovery path.

## 4. Decommissioning the anchovy deployment

After 14 days of clean operation on OpenValens:

- [ ] Take the anchovy deployment off the platform entirely.
- [ ] Remove DNS records that pointed only to anchovy.
- [ ] Drop the anchor DNS records from the registrar's control panel.
- [ ] Archive the anchovy Postgres volume to cold storage. Do not delete.
- [ ] Mark the OpenValens readiness probe's `mobilePairing` capability as
      `true` (or remove the `mobilePairing` field entirely if no longer
      relevant).

## 5. Acceptance

The cutover is considered accepted when:

- The new deployment has served production traffic for 14 consecutive days
  with `status: "ok"` on every readiness probe.
- The mobile ingest rate on OpenValens matches the legacy rate plus 10 %
  to absorb the late-joining devices.
- No rollback has been triggered in that window.
- The Issue #46 follow-up (legacy mobile tables) has landed — see
  `packages/db/src/migrations/*_retire_legacy_mobile_tables/` once it ships.

## 6. Post-cutover follow-ups

After acceptance:

- File Issue #46 to drop the legacy mobile tables now that production
  traffic is on OpenValens.
- Move the `apps/server/src/index.ts` env-key for the legacy database from
  the live env to a documented historical reference.
- Schedule a 30-day review to retire the anchovy Postgres volume entirely
  (after the audit retention window).
