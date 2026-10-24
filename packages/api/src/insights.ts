import { createHash, createHmac } from "node:crypto";

import { listCanonicalDailyWeights } from "@openvalens/body";
import { sql, type Database } from "@openvalens/db";
import { insightFeedback, insightPreference, pushDevice } from "@openvalens/db/schema/insights";
import { createGoalRepository } from "@openvalens/plans";
import { listSleepDailySummaries } from "@openvalens/sleep";
import { and, count, eq } from "drizzle-orm";

import {
  EMAIL_DIGEST_ACKNOWLEDGEMENT_VERSION,
  INSIGHT_CHANNELS,
  INSIGHT_ENGINE_VERSION,
  INSIGHT_KINDS,
  INSIGHT_RULE_IDS,
  INSIGHT_RULE_VERSIONS,
  NOT_USEFUL_MUTE_DAYS,
  type InsightChannel,
  type InsightFeedbackAction,
  type InsightPreferences,
  type InsightPreferencesUpdate,
  type InsightRuleId,
  type InsightsResult,
  type KindChannels,
  type PushOfferState,
} from "./insight-contract";
import {
  CHANGE_INSIGHT_CAP,
  defaultKindChannels,
  runInsightRules,
  selectInsights,
  type InsightDay,
  type InsightEngineInput,
  type InsightEngineOutput,
  type InsightFeedbackRecord,
} from "./insight-rules";
import { computeGoalProgress, type GoalWithHistory } from "./score-goal-progress";
import { createWellnessProfileService } from "./wellness-profile";

/**
 * Issue #92 — insights service: loads the rule inputs from the existing
 * domain stores, runs the deterministic rules, and applies the person's
 * feedback and settings. It also owns the delivery preferences, push devices
 * and one-step email unsubscribe.
 *
 * Scoping: record reads are keyed by the active organization from the trusted
 * authz context; feedback and preferences by (organization, signed-in user);
 * push devices by user. No input value, insight value or token is logged or
 * returned in an error.
 */

/** Days of history loaded: baselines (28 + 7 + 2) and the longest streak milestone. */
export const INSIGHT_HISTORY_DAYS = 100;

/** What the viewer's workspace role may read beyond `records:read`. */
export type InsightAccess = { weight: boolean; goals: boolean };

export type InsightScope = { organizationId: string; userId: string };

export class InsightServiceError extends Error {
  readonly code: "INVALID_INPUT" | "DENIED";
  readonly reason: string;
  constructor(code: "INVALID_INPUT" | "DENIED", reason: string) {
    super(code);
    this.name = "InsightServiceError";
    this.code = code;
    this.reason = reason;
  }
}

// ─── loading ───────────────────────────────────────────────────

type SourceRow = {
  date: string;
  source_id: number | null;
  samples: number;
  avg_value: number | null;
  sum_value: number | null;
};

/**
 * One value per day for a metric code, from the day's dominant data source
 * (most samples; ties → lowest id). Taking one source per day keeps a phone
 * and a watch from being added together, and lets the rules key baselines by
 * source.
 */
export async function listDailyMetricBySource(
  db: Database,
  organizationId: string,
  code: "resting_heart_rate" | "steps",
  days: number,
): Promise<InsightDay[]> {
  const since = new Date(Date.now() - days * 86_400_000);
  const result = await db.execute<SourceRow>(sql`
    select to_char(date_trunc('day', ms.sampled_at), 'YYYY-MM-DD') as date,
           ms.data_source_id as source_id,
           count(*)::int as samples,
           avg(ms.numeric_value)::float8 as avg_value,
           sum(ms.numeric_value)::float8 as sum_value
    from metric_sample ms
    join metric_definition md
      on md.id = ms.metric_definition_id and md.organization_id = ms.organization_id
    where ms.organization_id = ${organizationId}
      and ms.superseded_at is null
      and ms.sampled_at >= ${since.toISOString()}
      and md.code = ${code}
    group by 1, 2
  `);
  const byDate = new Map<string, SourceRow>();
  for (const row of result.rows) {
    const current = byDate.get(row.date);
    const better =
      !current ||
      Number(row.samples) > Number(current.samples) ||
      (Number(row.samples) === Number(current.samples) &&
        (current.source_id === null ||
          (row.source_id !== null && row.source_id < current.source_id)));
    if (better) byDate.set(row.date, row);
  }
  return [...byDate.values()]
    .map((row) => ({
      date: row.date,
      value: code === "steps" ? row.sum_value : row.avg_value,
      source: row.source_id === null ? null : `ds:${row.source_id}`,
    }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

export async function loadInsightEngineInput(
  db: Database,
  scope: InsightScope,
  access: InsightAccess,
  asOf: string,
): Promise<InsightEngineInput> {
  const { organizationId, userId } = scope;
  const [sleep, rhr, steps, weights, goals] = await Promise.all([
    listSleepDailySummaries(db, organizationId, INSIGHT_HISTORY_DAYS),
    listDailyMetricBySource(db, organizationId, "resting_heart_rate", INSIGHT_HISTORY_DAYS),
    listDailyMetricBySource(db, organizationId, "steps", INSIGHT_HISTORY_DAYS),
    access.weight
      ? listCanonicalDailyWeights(db, organizationId, userId, INSIGHT_HISTORY_DAYS)
      : Promise.resolve(null),
    access.goals ? loadGoals(db, organizationId) : Promise.resolve(null),
  ]);
  return {
    asOf,
    series: {
      sleep_duration: sleep.map((day) => ({
        date: day.date,
        value: day.asleepMinutes,
        source: day.sourceSummary,
      })),
      resting_heart_rate: rhr,
      steps,
      // Canonical daily weight carries no device id, so weight baselines are not
      // segmented by source (documented in docs/insight-rules.md).
      ...(weights
        ? { weight: weights.map((row) => ({ date: row.date, value: row.weightKg, source: null })) }
        : {}),
    },
    goals,
  };
}

async function loadGoals(db: Database, organizationId: string) {
  const repository = createGoalRepository(db);
  const goals = await repository.listGoals(organizationId);
  const entries: GoalWithHistory[] = await Promise.all(
    goals.map(async (goal) => ({
      goal,
      checkins: await repository.listCheckins(organizationId, goal.id),
    })),
  );
  const latestCheckinDates: Record<number, string | null> = {};
  for (const entry of entries)
    latestCheckinDates[entry.goal.id] =
      entry.checkins.reduce<string | null>(
        (latest, checkin) => (latest === null || checkin.date > latest ? checkin.date : latest),
        null,
      ) ?? null;
  return { result: computeGoalProgress(entries), latestCheckinDates };
}

// ─── preferences ───────────────────────────────────────────────

type PreferenceRow = typeof insightPreference.$inferSelect;

export function channelsFromDisabled(disabled: readonly string[]): KindChannels {
  const channels = defaultKindChannels();
  // Observation toggles were added after the original preference row. A
  // dedicated marker distinguishes an explicit opt-in from legacy rows, whose
  // default remains off even when they have no disabled observation channels.
  if (disabled.includes("observation:enabled"))
    channels.observation = { in_app: true, push: true, email: true };
  for (const entry of disabled) {
    const [kind, channel] = entry.split(":") as [keyof KindChannels, InsightChannel];
    if (INSIGHT_KINDS.includes(kind) && INSIGHT_CHANNELS.includes(channel))
      channels[kind][channel] = false;
  }
  return channels;
}

export function disabledFromChannels(channels: KindChannels): string[] {
  const disabled: string[] = [];
  if (INSIGHT_CHANNELS.some((channel) => channels.observation[channel]))
    disabled.push("observation:enabled");
  for (const kind of INSIGHT_KINDS)
    for (const channel of INSIGHT_CHANNELS)
      if (!channels[kind][channel]) disabled.push(`${kind}:${channel}`);
  return disabled;
}

/** Defaults for a person who never changed anything: push and email off. */
export const DEFAULT_PREFERENCE = {
  pushEnabled: false,
  pushShowTopic: false,
  pushOfferState: "not_offered" as PushOfferState,
  emailEnabled: false,
  emailAcknowledgedVersion: null as string | null,
  dailyReminderEmail: false,
  deliveryHour: 9,
  timeZone: "UTC",
  disabledChannels: [] as string[],
};

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** One-step unsubscribe token: HMAC of the (workspace, person) pair. Stable, revocable by key. */
export function emailUnsubscribeToken(key: Buffer, scope: InsightScope): string {
  return createHmac("sha256", key)
    .update(`insight-email-unsubscribe:v1\n${scope.organizationId}\n${scope.userId}`)
    .digest("base64url");
}

export function hashUnsubscribeToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Derives the unsubscribe-token key from the server secret (never the secret itself). */
export function deriveInsightUnsubscribeKey(serverSecret: string): Buffer {
  if (serverSecret.length < 32) throw new TypeError("Insight unsubscribe secret is too short.");
  return createHmac("sha256", serverSecret).update("openvalens:insight-unsubscribe:v1").digest();
}

// ─── service ───────────────────────────────────────────────────

export type InsightDeliveryContext = {
  /** Workspace owner on a non-impersonated session. */
  canConfigureDelivery: boolean;
  pushAvailable: boolean;
  emailAvailable: boolean;
};

export type InsightService = {
  /** Rules output before feedback/settings, or null for a declared under-18. */
  compute(scope: InsightScope, access: InsightAccess): Promise<InsightEngineOutput | null>;
  list(
    scope: InsightScope,
    access: InsightAccess,
    delivery: InsightDeliveryContext,
  ): Promise<InsightsResult>;
  feedback(
    scope: InsightScope,
    insightId: string,
    action: InsightFeedbackAction,
  ): Promise<{ mutedUntil: Date | null }>;
  readFeedback(scope: InsightScope): Promise<InsightFeedbackRecord[]>;
  getPreferences(
    scope: InsightScope,
    delivery: InsightDeliveryContext,
  ): Promise<InsightPreferences>;
  updatePreferences(
    scope: InsightScope,
    delivery: InsightDeliveryContext,
    patch: InsightPreferencesUpdate,
  ): Promise<{ preferences: InsightPreferences; changed: string[] }>;
  registerPushDevice(userId: string, token: string, platform: "ios" | "android"): Promise<number>;
  unregisterPushDevice(userId: string, token: string): Promise<number>;
  unsubscribeEmail(token: string): Promise<"unsubscribed" | "invalid">;
};

export function parseInsightId(insightId: string): InsightRuleId | null {
  const separator = insightId.indexOf(":");
  if (separator <= 0) return null;
  const ruleId = insightId.slice(0, separator);
  return (INSIGHT_RULE_IDS as readonly string[]).includes(ruleId)
    ? (ruleId as InsightRuleId)
    : null;
}

export function createInsightService(deps: { db: Database; now?: () => Date }): InsightService {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());

  async function declaredUnder18(userId: string): Promise<boolean> {
    const profile = await createWellnessProfileService({ db }).read(userId);
    return profile.eligibility.state === "recorded" && profile.eligibility.value === "under_18";
  }

  async function readRow(scope: InsightScope): Promise<PreferenceRow | null> {
    const [row] = await db
      .select()
      .from(insightPreference)
      .where(
        and(
          eq(insightPreference.organizationId, scope.organizationId),
          eq(insightPreference.userId, scope.userId),
        ),
      );
    return row ?? null;
  }

  async function deviceCount(userId: string): Promise<number> {
    const [row] = await db
      .select({ n: count() })
      .from(pushDevice)
      .where(eq(pushDevice.userId, userId));
    return Number(row?.n ?? 0);
  }

  function toPreferences(
    row: PreferenceRow | null,
    delivery: InsightDeliveryContext,
    devices: number,
  ): InsightPreferences {
    const value = row ?? DEFAULT_PREFERENCE;
    return {
      canConfigureDelivery: delivery.canConfigureDelivery,
      pushAvailable: delivery.pushAvailable,
      emailAvailable: delivery.emailAvailable,
      push: {
        enabled: value.pushEnabled,
        showTopic: value.pushShowTopic,
        offerState: value.pushOfferState as PushOfferState,
        registeredDevices: devices,
      },
      email: {
        enabled: value.emailEnabled,
        acknowledgedVersion: value.emailAcknowledgedVersion,
      },
      dailyReminders: { email: value.dailyReminderEmail },
      deliveryHour: value.deliveryHour,
      timeZone: value.timeZone,
      channels: channelsFromDisabled(value.disabledChannels),
    };
  }

  async function readFeedback(scope: InsightScope): Promise<InsightFeedbackRecord[]> {
    const rows = await db
      .select({
        insightId: insightFeedback.insightId,
        ruleId: insightFeedback.ruleId,
        action: insightFeedback.action,
        mutedUntil: insightFeedback.mutedUntil,
      })
      .from(insightFeedback)
      .where(
        and(
          eq(insightFeedback.organizationId, scope.organizationId),
          eq(insightFeedback.userId, scope.userId),
        ),
      );
    return rows.map((row) => ({ ...row, action: row.action as InsightFeedbackAction }));
  }

  async function compute(
    scope: InsightScope,
    access: InsightAccess,
  ): Promise<InsightEngineOutput | null> {
    if (await declaredUnder18(scope.userId)) return null;
    const asOf = now().toISOString().slice(0, 10);
    return runInsightRules(await loadInsightEngineInput(db, scope, access, asOf));
  }

  return {
    compute,
    readFeedback,

    async list(scope, access, delivery) {
      const asOf = now().toISOString().slice(0, 10);
      const output = await compute(scope, access);
      if (output === null) {
        return {
          engineVersion: INSIGHT_ENGINE_VERSION,
          asOf,
          status: "withheld",
          withheldReason: "adults_only",
          insights: [],
          observations: [],
          readiness: [],
          hiddenCount: 0,
          budget: { changeCap: CHANGE_INSIGHT_CAP, suppressedChanges: 0 },
          offerPush: false,
        };
      }
      const [row, feedback] = await Promise.all([readRow(scope), readFeedback(scope)]);
      const preferences = toPreferences(row, delivery, 0);
      const selection = selectInsights(output.insights, {
        channel: "in_app",
        channels: preferences.channels,
        feedback,
        now: now(),
      });
      return {
        engineVersion: output.engineVersion,
        asOf: output.asOf,
        status: "available",
        withheldReason: null,
        insights: selection.insights,
        observations: [],
        readiness: output.readiness,
        hiddenCount: selection.hiddenCount,
        budget: { changeCap: CHANGE_INSIGHT_CAP, suppressedChanges: selection.suppressedChanges },
        // Offered in context only: after at least one insight is on screen,
        // never before, and never again once answered.
        offerPush:
          delivery.canConfigureDelivery &&
          delivery.pushAvailable &&
          !preferences.push.enabled &&
          preferences.push.offerState === "not_offered" &&
          selection.insights.length > 0,
      };
    },

    async feedback(scope, insightId, action) {
      const ruleId = parseInsightId(insightId);
      if (!ruleId) throw new InsightServiceError("INVALID_INPUT", "unknown_rule");
      const mutedUntil =
        action === "not_useful"
          ? new Date(now().getTime() + NOT_USEFUL_MUTE_DAYS * 86_400_000)
          : null;
      await db
        .insert(insightFeedback)
        .values({
          organizationId: scope.organizationId,
          userId: scope.userId,
          insightId,
          ruleId,
          ruleVersion: INSIGHT_RULE_VERSIONS[ruleId],
          action,
          mutedUntil,
          createdAt: now(),
        })
        .onConflictDoUpdate({
          target: [
            insightFeedback.organizationId,
            insightFeedback.userId,
            insightFeedback.insightId,
          ],
          set: { action, mutedUntil, ruleVersion: INSIGHT_RULE_VERSIONS[ruleId], createdAt: now() },
        });
      return { mutedUntil };
    },

    async getPreferences(scope, delivery) {
      const [row, devices] = await Promise.all([readRow(scope), deviceCount(scope.userId)]);
      return toPreferences(row, delivery, devices);
    },

    async updatePreferences(scope, delivery, patch) {
      const current = (await readRow(scope)) ?? null;
      const base = current ?? { ...DEFAULT_PREFERENCE };
      const next = {
        pushEnabled: base.pushEnabled,
        pushShowTopic: base.pushShowTopic,
        pushOfferState: base.pushOfferState as PushOfferState,
        emailEnabled: base.emailEnabled,
        emailAcknowledgedVersion: base.emailAcknowledgedVersion,
        emailAcknowledgedAt: current?.emailAcknowledgedAt ?? null,
        dailyReminderEmail: base.dailyReminderEmail,
        deliveryHour: base.deliveryHour,
        timeZone: base.timeZone,
        disabledChannels: [...base.disabledChannels],
      };
      const changed: string[] = [];

      const turnsOnDelivery =
        patch.push?.enabled === true ||
        patch.pushOffer === "accepted" ||
        patch.email?.enabled === true;
      if (turnsOnDelivery && !delivery.canConfigureDelivery)
        throw new InsightServiceError("DENIED", "owner_only");

      if (patch.pushOffer) {
        next.pushOfferState = patch.pushOffer;
        if (patch.pushOffer === "accepted") next.pushEnabled = true;
        changed.push("push.offer");
      }
      if (patch.push?.enabled !== undefined) {
        next.pushEnabled = patch.push.enabled;
        changed.push("push.enabled");
      }
      if (next.pushEnabled && !base.pushEnabled && !delivery.pushAvailable)
        throw new InsightServiceError("INVALID_INPUT", "push_unavailable");
      if (patch.push?.showTopic !== undefined) {
        next.pushShowTopic = patch.push.showTopic;
        changed.push("push.showTopic");
      }
      if (patch.email) {
        if (patch.email.enabled) {
          if (!delivery.emailAvailable)
            throw new InsightServiceError("INVALID_INPUT", "email_unavailable");
          const acknowledged =
            patch.email.acknowledgement === EMAIL_DIGEST_ACKNOWLEDGEMENT_VERSION ||
            next.emailAcknowledgedVersion === EMAIL_DIGEST_ACKNOWLEDGEMENT_VERSION;
          if (!acknowledged)
            throw new InsightServiceError("INVALID_INPUT", "acknowledgement_required");
          if (patch.email.acknowledgement === EMAIL_DIGEST_ACKNOWLEDGEMENT_VERSION) {
            next.emailAcknowledgedVersion = EMAIL_DIGEST_ACKNOWLEDGEMENT_VERSION;
            next.emailAcknowledgedAt = now();
          }
        }
        next.emailEnabled = patch.email.enabled;
        changed.push("email.enabled");
      }
      if (patch.dailyReminders) {
        // The member's own reminders: not owner-gated, but email must exist.
        if (patch.dailyReminders.email && !next.dailyReminderEmail && !delivery.emailAvailable)
          throw new InsightServiceError("INVALID_INPUT", "email_unavailable");
        next.dailyReminderEmail = patch.dailyReminders.email;
        changed.push("dailyReminders.email");
      }
      if (patch.deliveryHour !== undefined) {
        next.deliveryHour = patch.deliveryHour;
        changed.push("deliveryHour");
      }
      if (patch.timeZone !== undefined) {
        if (!isValidTimeZone(patch.timeZone))
          throw new InsightServiceError("INVALID_INPUT", "time_zone");
        next.timeZone = patch.timeZone;
        changed.push("timeZone");
      }
      if (patch.channels) {
        const channels = channelsFromDisabled(next.disabledChannels);
        for (const kind of INSIGHT_KINDS) {
          const kindPatch = patch.channels[kind];
          if (!kindPatch) continue;
          for (const channel of INSIGHT_CHANNELS) {
            const value = kindPatch[channel];
            if (value !== undefined) channels[kind][channel] = value;
          }
        }
        next.disabledChannels = disabledFromChannels(channels);
        changed.push("channels");
      }

      await db
        .insert(insightPreference)
        .values({
          organizationId: scope.organizationId,
          userId: scope.userId,
          ...next,
          updatedAt: now(),
        })
        .onConflictDoUpdate({
          target: [insightPreference.organizationId, insightPreference.userId],
          set: { ...next, updatedAt: now() },
        });
      const [row, devices] = await Promise.all([readRow(scope), deviceCount(scope.userId)]);
      return { preferences: toPreferences(row, delivery, devices), changed };
    },

    async registerPushDevice(userId, token, platform) {
      // A token belongs to one phone; if another account registered it before
      // (shared phone, re-login), it moves to the current account.
      await db
        .insert(pushDevice)
        .values({ userId, expoPushToken: token, platform, updatedAt: now() })
        .onConflictDoUpdate({
          target: pushDevice.expoPushToken,
          set: { userId, platform, updatedAt: now() },
        });
      return deviceCount(userId);
    },

    async unregisterPushDevice(userId, token) {
      await db
        .delete(pushDevice)
        .where(and(eq(pushDevice.userId, userId), eq(pushDevice.expoPushToken, token)));
      return deviceCount(userId);
    },

    async unsubscribeEmail(token) {
      const updated = await db
        .update(insightPreference)
        .set({ emailEnabled: false, updatedAt: now() })
        .where(eq(insightPreference.emailUnsubscribeTokenHash, hashUnsubscribeToken(token)))
        .returning({ userId: insightPreference.userId });
      return updated.length > 0 ? "unsubscribed" : "invalid";
    },
  };
}
