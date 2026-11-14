import { sql, type Database } from "@openvalens/db";
import { MANUAL_SLEEP_ENTRY_MODE } from "@openvalens/sleep";

import {
  presentOnboardingTotals,
  type OnboardingCounts,
  type OnboardingTotals,
  type OnboardingWindowDays,
} from "./contracts/onboarding-measurement";

/**
 * Issue #444 — the onboarding totals query. What counts as a cohort, an entry
 * and a figure, and the small-group rule, are described in
 * `./contracts/onboarding-measurement`.
 */

const DAY_MS = 24 * 60 * 60_000;

/** The placeholder account the baseline migration creates on every install; not a person. */
const MIGRATION_OWNER_ID = "__migration_owner__";

type CountsRow = {
  sign_ups: number;
  eligible_10m: number;
  reached_10m: number;
  eligible_1d: number;
  reached_1d: number;
  eligible_7d: number;
  reached_7d: number;
  reached_days_2_7: number;
};

/**
 * Reads the counts for the accounts created in `(from, to]`. One query; it
 * returns a single row of counts and nothing per person.
 */
export async function readOnboardingCounts(
  db: Database,
  window: { from: Date; to: Date },
): Promise<OnboardingCounts> {
  const from = window.from.toISOString();
  const to = window.to.toISOString();
  const result = await db.execute<CountsRow>(sql`
    with cohort as (
      select u."id", u."created_at"
      from "user" u
      where u."created_at" > ${from}::timestamptz
        and u."created_at" <= ${to}::timestamptz
        and u."id" <> ${MIGRATION_OWNER_ID}
    ),
    entries as (
      select ms."metadata_json"->>'ingestedByUserId' as user_id, ms."created_at"
        from "metric_sample" ms
        where ms."data_source_id" is null
          and ms."superseded_at" is null
          and ms."metadata_json"->>'ingestedByUserId' in (select "id" from cohort)
      union all
      select "user_id", "created_at" from "plain_water_entry"
        where "deleted_at" is null and "user_id" in (select "id" from cohort)
      union all
      select "user_id", "created_at" from "nutrition_meal_entry"
        where "deleted_at" is null and "user_id" in (select "id" from cohort)
      union all
      select "user_id", "created_at" from "supplement_intake"
        where "deleted_at" is null and "user_id" in (select "id" from cohort)
      union all
      select "user_id", "created_at" from "health_event"
        where "event_type" = 'sleep_session'
          and "data_source_id" is null
          and "superseded_at" is null
          and "payload_json"->>'entryMode' = ${MANUAL_SLEEP_ENTRY_MODE}
          and "user_id" in (select "id" from cohort)
      union all
      select "user_id", "created_at"::timestamptz from "workout"
        where "user_id" in (select "id" from cohort)
      union all
      select "user_id", "created_at" from "pain_entry"
        where "user_id" in (select "id" from cohort)
      union all
      select "user_id", "created_at" from "cycle_period"
        where "source" = 'manual' and "user_id" in (select "id" from cohort)
      union all
      select "user_id", "created_at" from "private_body_measurement"
        where "user_id" in (select "id" from cohort)
    ),
    per_account as (
      select
        c."created_at" as signed_up_at,
        min(e."created_at") as first_entry_at,
        coalesce(
          bool_or(
            e."created_at" >= c."created_at" + interval '1 day'
            and e."created_at" < c."created_at" + interval '7 days'
          ),
          false
        ) as active_days_2_7
      from cohort c
      left join entries e on e.user_id = c."id"
      group by c."id", c."created_at"
    )
    select
      count(*)::int as sign_ups,
      count(*) filter (where signed_up_at <= ${to}::timestamptz - interval '10 minutes')::int
        as eligible_10m,
      count(*) filter (
        where signed_up_at <= ${to}::timestamptz - interval '10 minutes'
          and first_entry_at <= signed_up_at + interval '10 minutes'
      )::int as reached_10m,
      count(*) filter (where signed_up_at <= ${to}::timestamptz - interval '1 day')::int
        as eligible_1d,
      count(*) filter (
        where signed_up_at <= ${to}::timestamptz - interval '1 day'
          and first_entry_at <= signed_up_at + interval '1 day'
      )::int as reached_1d,
      count(*) filter (where signed_up_at <= ${to}::timestamptz - interval '7 days')::int
        as eligible_7d,
      count(*) filter (
        where signed_up_at <= ${to}::timestamptz - interval '7 days'
          and first_entry_at <= signed_up_at + interval '7 days'
      )::int as reached_7d,
      count(*) filter (
        where signed_up_at <= ${to}::timestamptz - interval '7 days' and active_days_2_7
      )::int as reached_days_2_7
    from per_account
  `);
  const row = result.rows[0];
  const n = (value: unknown) => Number(value ?? 0);
  return {
    signUps: n(row?.sign_ups),
    first_entry_10m: { eligible: n(row?.eligible_10m), reached: n(row?.reached_10m) },
    first_entry_1d: { eligible: n(row?.eligible_1d), reached: n(row?.reached_1d) },
    first_entry_7d: { eligible: n(row?.eligible_7d), reached: n(row?.reached_7d) },
    active_days_2_7: { eligible: n(row?.eligible_7d), reached: n(row?.reached_days_2_7) },
  };
}

/** The onboarding totals for sign-ups in the last `windowDays` days, ending `now`. */
export async function readOnboardingTotals(
  db: Database,
  windowDays: OnboardingWindowDays,
  now = new Date(),
): Promise<OnboardingTotals> {
  const from = new Date(now.getTime() - windowDays * DAY_MS);
  const counts = await readOnboardingCounts(db, { from, to: now });
  return presentOnboardingTotals(counts, { windowDays, from, to: now });
}
