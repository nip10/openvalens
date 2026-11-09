import type { Database } from "@openvalens/db";
import { sql } from "drizzle-orm";

/** Provenance owned exclusively by the direct-steps publication policy. */
export const DIRECT_STEPS_POLICY_RELATION = "shadowed_by_direct_steps_policy";
export const DIRECT_STEPS_POLICY = "phone_cloud_first_utc_day" as const;

type Tx = Pick<Database, "execute">;

/**
 * One serialization point for publication changes. Every caller holds this
 * transaction-scoped lock before mutating canonical rows or reconciling them.
 */
export async function lockActivityPublication(tx: Tx, organizationId: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${organizationId} || ':activity-publication', 0))`,
  );
}

/** Reconcile whole UTC days containing rows changed by the caller. */
export async function reconcileDirectStepsFallback(
  tx: Tx,
  input: { organizationId: string; from: Date; to: Date; now: Date },
): Promise<{ shadowed: number; restored: number }> {
  await lockActivityPublication(tx, input.organizationId);
  const from = new Date(
    Date.UTC(input.from.getUTCFullYear(), input.from.getUTCMonth(), input.from.getUTCDate()),
  );
  const to = new Date(
    Date.UTC(input.to.getUTCFullYear(), input.to.getUTCMonth(), input.to.getUTCDate() + 1),
  );
  const org = input.organizationId;
  const result = await tx.execute(sql`
    with candidates as (
      select m.id, m.data_source_id, ds.provider_connection_id,
        (m.sampled_at at time zone 'UTC')::date as utc_day,
        row_number() over (partition by (m.sampled_at at time zone 'UTC')::date
          order by ds.provider_connection_id asc, m.id asc) as binding_rank
      from metric_sample m
      join data_source ds on ds.id = m.data_source_id and ds.organization_id = m.organization_id
      join metric_definition md on md.id = m.metric_definition_id and md.organization_id = m.organization_id
      join provider_connection pc on pc.id = ds.provider_connection_id and pc.organization_id = m.organization_id
      where m.organization_id = ${org} and ds.import_channel = 'direct_device'
        and md.code = 'steps' and pc.status = 'active' and pc.user_id is not null
        and (m.superseded_at is null or exists (
          select 1 from provenance_link own
          where own.organization_id=m.organization_id and own.target_table='metric_sample'
            and own.target_id=m.id and own.relation=${DIRECT_STEPS_POLICY_RELATION}
            and own.created_at=m.superseded_at))
        and m.sampled_at >= ${from} and m.sampled_at < ${to}
    ), winners as (
      select distinct on (utc_day) utc_day, provider_connection_id
      from candidates order by utc_day, provider_connection_id asc
    ), eligibility as (
      select w.utc_day,
        exists (select 1 from metric_sample p join data_source pd on pd.id=p.data_source_id
          join metric_definition pmd on pmd.id=p.metric_definition_id
          where p.organization_id=${org} and p.superseded_at is null
            and pmd.code='steps' and pd.import_channel='mobile_ingest'
            and (p.sampled_at at time zone 'UTC')::date=w.utc_day) as has_phone,
        exists (select 1 from metric_sample c join data_source cd on cd.id=c.data_source_id
          join metric_definition cmd on cmd.id=c.metric_definition_id
          where c.organization_id=${org} and c.superseded_at is null
            and cmd.code='steps' and cd.import_channel='wearable_cloud'
            and (c.sampled_at at time zone 'UTC')::date=w.utc_day) as has_cloud
      from winners w
    ), restored as (
      update metric_sample m set superseded_at=null
      from data_source ds, provenance_link l
      where ds.id=m.data_source_id and ds.organization_id=m.organization_id
        and l.organization_id=m.organization_id and l.target_table='metric_sample'
        and l.target_id=m.id and l.relation=${DIRECT_STEPS_POLICY_RELATION}
        and l.created_at=m.superseded_at
        and m.organization_id=${org} and ds.import_channel='direct_device'
        and m.superseded_at is not null and m.sampled_at >= ${from} and m.sampled_at < ${to}
        and exists (select 1 from provider_connection pc
          where pc.id=ds.provider_connection_id and pc.organization_id=m.organization_id
            and pc.status='active' and pc.user_id is not null)
        and exists (select 1 from winners w
          where w.utc_day=(m.sampled_at at time zone 'UTC')::date
            and w.provider_connection_id=ds.provider_connection_id)
        and not exists (select 1 from eligibility e where e.utc_day=(m.sampled_at at time zone 'UTC')::date
          and (e.has_phone or e.has_cloud))
      returning m.id
    ), remove_links as (
      delete from provenance_link where organization_id=${org} and target_table='metric_sample'
        and relation=${DIRECT_STEPS_POLICY_RELATION} and target_id in (select id from restored)
      returning target_id
    ), shadowed as (
      update metric_sample m set superseded_at=${input.now}
      from data_source ds, eligibility e, winners w
      where ds.id=m.data_source_id and ds.organization_id=m.organization_id
        and e.utc_day=(m.sampled_at at time zone 'UTC')::date and w.utc_day=e.utc_day
        and m.organization_id=${org} and ds.import_channel='direct_device'
        and m.superseded_at is null and m.sampled_at >= ${from} and m.sampled_at < ${to}
        and (e.has_phone or e.has_cloud or ds.provider_connection_id <> w.provider_connection_id)
      returning m.id, m.data_source_id
    ), add_links as (
     insert into provenance_link(organization_id,target_table,target_id,source_table,source_id,relation,created_at)
       select ${org},'metric_sample',s.id,'data_source',s.data_source_id,${DIRECT_STEPS_POLICY_RELATION},${input.now} from shadowed s
      on conflict do nothing returning target_id
    )
    select (select count(*)::int from shadowed) as shadowed,
      (select count(*)::int from remove_links) as restored`);
  const row = result.rows[0] as { shadowed?: number; restored?: number } | undefined;
  return { shadowed: Number(row?.shadowed ?? 0), restored: Number(row?.restored ?? 0) };
}
