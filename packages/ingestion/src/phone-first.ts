import type { Database } from "@openvalens/db";
import { sql } from "drizzle-orm";

/**
 * Phone-first dedupe between phone and cloud wearable rows (Issue #60).
 *
 * Most wearables already write steps, weight, resting heart rate and sleep to
 * HealthKit / Health Connect, and the phone companion sends those. A cloud
 * adapter for the same vendor would then double count the day. The rule is
 * simple and symmetric:
 *
 * - **Metrics** (`steps`, `weight`, `body_fat`, `resting_heart_rate`): when a
 *   UTC day has an active phone row (`import_channel = 'mobile_ingest'`) for a
 *   metric, that day's active cloud rows (`import_channel = 'wearable_cloud'`)
 *   for the metric are hidden.
 * - **Sleep sessions**: a cloud session is hidden when an active phone session
 *   overlaps at least half of the shorter of the two.
 *
 * Hiding sets `superseded_at` (every read path already skips superseded rows)
 * and adds a `shadowed_by_phone_source` provenance link, so the rule can undo
 * itself: when the phone rows go away (deleted on the device), the shadowed
 * cloud rows come back. Cloud-only metrics (HRV, provider scores) are never
 * touched. Rows are never deleted.
 *
 * Callers pass the time window they touched; the statements are scoped to one
 * organization and only ever change cloud rows.
 */
export const PHONE_FIRST_METRIC_CODES = [
  "steps",
  "weight",
  "body_fat",
  "resting_heart_rate",
] as const;

export const PHONE_FIRST_RELATION = "shadowed_by_phone_source";
export const CLOUD_IMPORT_CHANNEL = "wearable_cloud";
export const PHONE_IMPORT_CHANNEL = "mobile_ingest";

type Tx = Pick<Database, "execute">;

export type PhoneFirstResult = { shadowed: number; restored: number };

/** `true` when the organization has any cloud wearable data source (cheap guard for the phone path). */
export async function hasCloudWearableSources(tx: Tx, organizationId: string): Promise<boolean> {
  const result = await tx.execute(sql`
    select 1 from data_source
    where organization_id = ${organizationId} and import_channel = ${CLOUD_IMPORT_CHANNEL}
    limit 1`);
  return result.rows.length > 0;
}

export async function reconcilePhoneFirst(
  tx: Tx,
  input: { organizationId: string; from: Date; to: Date; now: Date },
): Promise<PhoneFirstResult> {
  const org = input.organizationId;
  // Whole UTC days around the window, so a day's rows are judged together.
  const from = new Date(
    Date.UTC(input.from.getUTCFullYear(), input.from.getUTCMonth(), input.from.getUTCDate() - 1),
  );
  const to = new Date(
    Date.UTC(input.to.getUTCFullYear(), input.to.getUTCMonth(), input.to.getUTCDate() + 2),
  );
  const codes = sql.join(
    PHONE_FIRST_METRIC_CODES.map((code) => sql`${code}`),
    sql`, `,
  );
  const day = (alias: string) =>
    sql`((${sql.identifier(alias)}.sampled_at at time zone 'UTC')::date)`;
  const activePhoneMetric = sql`
    select p.id from metric_sample p
    join data_source pd on pd.id = p.data_source_id and pd.organization_id = p.organization_id
    where p.organization_id = ${org}
      and pd.import_channel = ${PHONE_IMPORT_CHANNEL}
      and p.superseded_at is null
      and p.metric_definition_id = c.metric_definition_id
      and ${day("p")} = ${day("c")}`;
  const cloudMetric = sql`
    from data_source cd, metric_definition md
    where cd.id = c.data_source_id and cd.organization_id = c.organization_id
      and cd.import_channel = ${CLOUD_IMPORT_CHANNEL}
      and md.id = c.metric_definition_id and md.organization_id = c.organization_id
      and md.code in (${codes})
      and c.organization_id = ${org}
      and c.sampled_at >= ${from} and c.sampled_at < ${to}`;

  const endOf = (alias: string) =>
    sql`coalesce((${sql.identifier(alias)}.payload_json->>'endAt')::timestamptz, ${sql.identifier(alias)}.event_at)`;
  const activePhoneSleep = sql`
    select p.id from health_event p
    join data_source pd on pd.id = p.data_source_id and pd.organization_id = p.organization_id
    where p.organization_id = ${org}
      and pd.import_channel = ${PHONE_IMPORT_CHANNEL}
      and p.event_type = 'sleep_session'
      and p.superseded_at is null
      and least(${endOf("p")}, ${endOf("c")}) - greatest(p.event_at, c.event_at)
        >= least(${endOf("p")} - p.event_at, ${endOf("c")} - c.event_at) / 2
      and least(${endOf("p")}, ${endOf("c")}) > greatest(p.event_at, c.event_at)`;
  const cloudSleep = sql`
    from data_source cd
    where cd.id = c.data_source_id and cd.organization_id = c.organization_id
      and cd.import_channel = ${CLOUD_IMPORT_CHANNEL}
      and c.event_type = 'sleep_session'
      and c.organization_id = ${org}
      and c.event_at >= ${from} and c.event_at < ${to}`;
  const shadowLink = (table: "metric_sample" | "health_event") => sql`
    exists (select 1 from provenance_link l
      where l.organization_id = c.organization_id and l.target_table = ${table}
        and l.target_id = c.id and l.relation = ${PHONE_FIRST_RELATION})`;

  let shadowed = 0;
  let restored = 0;
  for (const table of ["metric_sample", "health_event"] as const) {
    const t = sql.identifier(table);
    const scope = table === "metric_sample" ? cloudMetric : cloudSleep;
    const phone = table === "metric_sample" ? activePhoneMetric : activePhoneSleep;
    const touch = table === "health_event" ? sql`, updated_at = ${input.now}` : sql``;

    // Restore first, so a row whose phone counterpart is gone comes back.
    const back = await tx.execute(sql`
      update ${t} c set superseded_at = null ${touch}
      ${scope}
        and c.superseded_at is not null
        and ${shadowLink(table)}
        and not exists (${phone})
      returning c.id`);
    const restoredIds = (back.rows as { id: number }[]).map((row) => Number(row.id));
    if (restoredIds.length) {
      await tx.execute(sql`
        delete from provenance_link
        where organization_id = ${org} and target_table = ${table}
          and relation = ${PHONE_FIRST_RELATION}
          and target_id in (${sql.join(
            restoredIds.map((id) => sql`${id}`),
            sql`, `,
          )})`);
      restored += restoredIds.length;
    }

    const hidden = await tx.execute(sql`
      update ${t} c set superseded_at = ${input.now} ${touch}
      ${scope}
        and c.superseded_at is null
        and exists (${phone})
      returning c.id, (select min(sub.id) from (${phone}) sub) as phone_id`);
    const rows = hidden.rows as { id: number; phone_id: number }[];
    if (rows.length) {
      await tx.execute(sql`
        insert into provenance_link (organization_id, target_table, target_id, source_table, source_id, relation)
        values ${sql.join(
          rows.map(
            (row) =>
              sql`(${org}, ${table}, ${Number(row.id)}, ${table}, ${Number(row.phone_id)}, ${PHONE_FIRST_RELATION})`,
          ),
          sql`, `,
        )}
        on conflict do nothing`);
      shadowed += rows.length;
    }
  }
  return { shadowed, restored };
}
