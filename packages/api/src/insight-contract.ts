import { z } from "zod";

/**
 * Issue #92 — insights core. Wire contract only (pure: no DB, no domain
 * packages) so web and native import it safely.
 *
 * An insight is a short, deterministic description of something in the
 * person's own records: what changed, compared with what, how sure the rule
 * is, and which other measures changed at the same time. Insights are produced
 * by versioned rules (`insight-rules.ts`, documented in `docs/insight-rules.md`)
 * and rendered from reviewed templates (`presenters/insights.ts`). There is no
 * AI anywhere in the path. Insights never advise, diagnose or predict.
 *
 * Insights are not stored: every request recomputes them from the workspace's
 * current records. What is stored is the person's feedback (dismiss / "not
 * useful"), their delivery preferences and the delivery history, none of which
 * hold a health value.
 */

export const INSIGHT_ENGINE_VERSION = "insights-0.1.0";

/** The v1 kinds; each can be toggled per channel. */
export const INSIGHT_KINDS = [
  "change",
  "goal_milestone",
  "data_quality",
  "streak",
  // #97 preventive-care reminders: dates the person set themselves. Not an
  // insight rule; the kind exists so reminders share the opt-in channels,
  // per-kind toggles and the one-push-a-day claim.
  "reminder",
  // #84 optional descriptive cross-module nutrition observations: shown only
  // when the person opts the kind on. Off on every channel by default.
  "observation",
] as const;
export type InsightKind = (typeof INSIGHT_KINDS)[number];

/** Where an insight can appear. Push and email are off until the person opts in. */
export const INSIGHT_CHANNELS = ["in_app", "push", "email"] as const;
export type InsightChannel = (typeof INSIGHT_CHANNELS)[number];

/** Measures the rules read. */
export const INSIGHT_METRICS = ["sleep_duration", "resting_heart_rate", "steps", "weight"] as const;
export type InsightMetric = (typeof INSIGHT_METRICS)[number];

/** Coarse subject, the only thing a lock-screen notification may name (and only when allowed). */
export const INSIGHT_TOPICS = ["sleep", "heart", "activity", "body", "goals"] as const;
export type InsightTopic = (typeof INSIGHT_TOPICS)[number];

export const METRIC_TOPICS: Record<InsightMetric, InsightTopic> = {
  sleep_duration: "sleep",
  resting_heart_rate: "heart",
  steps: "activity",
  weight: "body",
};

export const INSIGHT_RULE_IDS = [
  "change.sleep_duration",
  "change.resting_heart_rate",
  "change.steps",
  "change.weight_trend",
  "goal.reached",
  "goal.toward_target",
  "goal.away_from_target",
  "data_quality.recording_gap",
  "data_quality.source_change",
  "streak.recording",
  // #84 descriptive cross-module nutrition observations (kind `observation`).
  "observation.meals_and_workouts",
  "observation.meals_near_sleep",
  "observation.activity_energy_context",
] as const;
export type InsightRuleId = (typeof INSIGHT_RULE_IDS)[number];

export const INSIGHT_RULE_KINDS: Record<InsightRuleId, InsightKind> = {
  "change.sleep_duration": "change",
  "change.resting_heart_rate": "change",
  "change.steps": "change",
  "change.weight_trend": "change",
  "goal.reached": "goal_milestone",
  "goal.toward_target": "goal_milestone",
  "goal.away_from_target": "goal_milestone",
  "data_quality.recording_gap": "data_quality",
  "data_quality.source_change": "data_quality",
  "streak.recording": "streak",
  "observation.meals_and_workouts": "observation",
  "observation.meals_near_sleep": "observation",
  "observation.activity_energy_context": "observation",
};

/** Rule versions; any parameter or template change bumps the rule's version. */
export const INSIGHT_RULE_VERSIONS: Record<InsightRuleId, string> = {
  "change.sleep_duration": "1",
  "change.resting_heart_rate": "1",
  "change.steps": "1",
  "change.weight_trend": "1",
  "goal.reached": "1",
  "goal.toward_target": "1",
  "goal.away_from_target": "1",
  "data_quality.recording_gap": "1",
  "data_quality.source_change": "1",
  "streak.recording": "1",
  "observation.meals_and_workouts": "1",
  "observation.meals_near_sleep": "1",
  "observation.activity_energy_context": "1",
};

export const INSIGHT_UNITS = ["minutes", "bpm", "steps", "kg"] as const;
export type InsightUnit = (typeof INSIGHT_UNITS)[number];

/** How far past the rule's threshold the change is (see `docs/insight-rules.md`). */
export const INSIGHT_CERTAINTIES = ["clear", "modest"] as const;
export type InsightCertainty = (typeof INSIGHT_CERTAINTIES)[number];

const metric = z.enum(INSIGHT_METRICS);

export const changeDetailSchema = z.object({
  type: z.literal("change"),
  metric,
  direction: z.enum(["higher", "lower"]),
  unit: z.enum(INSIGHT_UNITS),
  /** Mean of the recent window (days with data only). */
  recentValue: z.number(),
  recentDays: z.number().int(),
  recentWindowDays: z.number().int(),
  /** Median of the baseline window before it. */
  baselineValue: z.number(),
  baselineDays: z.number().int(),
  baselineWindowDays: z.number().int(),
  /** recent − baseline, in `unit`. */
  difference: z.number(),
  /** The smallest difference this rule reports today, in `unit`. */
  threshold: z.number(),
  certainty: z.enum(INSIGHT_CERTAINTIES),
});

export const trendDetailSchema = z.object({
  type: z.literal("trend"),
  metric,
  direction: z.enum(["higher", "lower"]),
  unit: z.enum(INSIGHT_UNITS),
  /** Fitted values at the start and end of the window. */
  startValue: z.number(),
  endValue: z.number(),
  windowDays: z.number().int(),
  days: z.number().int(),
  certainty: z.enum(INSIGHT_CERTAINTIES),
});

export const goalDetailSchema = z.object({
  type: z.literal("goal"),
  goalId: z.number().int(),
  goalTitle: z.string(),
  state: z.enum(["reached", "toward_target", "away_from_target"]),
  /** 0–1 share of the way from the start to the target. */
  progress: z.number().nullable(),
  currentValue: z.number().nullable(),
  targetValue: z.number().nullable(),
});

export const recordingGapDetailSchema = z.object({
  type: z.literal("recording_gap"),
  metric,
  lastRecordedDate: z.string(),
  daysWithout: z.number().int(),
});

export const sourceChangeDetailSchema = z.object({
  type: z.literal("source_change"),
  metric,
  sinceDate: z.string(),
  baselineDays: z.number().int(),
  baselineMinDays: z.number().int(),
});

export const streakDetailSchema = z.object({
  type: z.literal("streak"),
  metric,
  days: z.number().int(),
  startDate: z.string(),
});

/**
 * #84 — descriptive cross-module nutrition observations. Each names the window
 * it covers and the completeness of every input it used. They describe a
 * coincidence in the person's own records only; there is no value crossed
 * between modules and no cause. Values are `null` when numbers are hidden.
 */
export const observationWindowSchema = z.object({
  from: z.string(),
  to: z.string(),
  days: z.number().int(),
});

export const mealsAndWorkoutsDetailSchema = z.object({
  type: z.literal("meals_and_workouts"),
  window: observationWindowSchema,
  /** Days in the window the person marked their diary complete with entries. */
  diaryCompleteDays: z.number().int(),
  /** Days in the window with a recorded workout session. */
  workoutDays: z.number().int(),
  /** Days that were both a complete diary day and a workout day. */
  daysWithBoth: z.number().int(),
});

export const mealsNearSleepDetailSchema = z.object({
  type: z.literal("meals_near_sleep"),
  window: observationWindowSchema,
  /** Nights with a recorded sleep start and a logged meal before it. */
  evenings: z.number().int(),
  /** Evenings where that last meal was within `nearSleepWindowMinutes`. */
  nearSleepEvenings: z.number().int(),
  nearSleepWindowMinutes: z.number().int(),
  /** Median minutes between the last logged meal and recorded sleep start. */
  medianGapMinutes: z.number().nullable(),
});

export const activityEnergyContextDetailSchema = z.object({
  type: z.literal("activity_energy_context"),
  window: observationWindowSchema,
  /** Days in the window with estimated activity energy recorded. */
  activityDays: z.number().int(),
  /** Sum of estimated activity energy; separate from intake and never added to it. */
  activityEnergyKcal: z.number().nullable(),
});

export const insightDetailSchema = z.discriminatedUnion("type", [
  changeDetailSchema,
  trendDetailSchema,
  goalDetailSchema,
  recordingGapDetailSchema,
  sourceChangeDetailSchema,
  streakDetailSchema,
  mealsAndWorkoutsDetailSchema,
  mealsNearSleepDetailSchema,
  activityEnergyContextDetailSchema,
]);
export type InsightDetail = z.infer<typeof insightDetailSchema>;

/** Another of the person's measures that moved in the same window. Never a cause. */
export const insightFactorSchema = z.object({
  metric,
  direction: z.enum(["higher", "lower"]),
});
export type InsightFactor = z.infer<typeof insightFactorSchema>;

/** At most this many co-occurring factors are listed. */
export const MAX_INSIGHT_FACTORS = 2;

export const insightSchema = z.object({
  /** `${ruleId}:${windowKey}` — stable for one rule and window, the dedupe key. */
  id: z.string(),
  ruleId: z.enum(INSIGHT_RULE_IDS),
  ruleVersion: z.string(),
  kind: z.enum(INSIGHT_KINDS),
  topic: z.enum(INSIGHT_TOPICS),
  windowKey: z.string(),
  /** Last date (YYYY-MM-DD) the insight's data covers. */
  windowEnd: z.string(),
  detail: insightDetailSchema,
  factors: z.array(insightFactorSchema).max(MAX_INSIGHT_FACTORS),
});
export type Insight = z.infer<typeof insightSchema>;

/**
 * Per-rule readiness, so "not enough data yet" is explicit — never shown as
 * zero or as "no change":
 * - `ready`                          — the rule could run.
 * - `building_baseline`              — too few earlier days to know your usual.
 * - `rebuilding_after_source_change` — a new device or app; the usual restarts.
 * - `no_recent_data`                 — too few recent days to compare.
 * - `no_access`                      — your workspace role cannot read this measure.
 */
export const INSIGHT_READINESS_STATES = [
  "ready",
  "building_baseline",
  "rebuilding_after_source_change",
  "no_recent_data",
  "no_access",
] as const;
export type InsightReadinessState = (typeof INSIGHT_READINESS_STATES)[number];

export const insightRuleReadinessSchema = z.object({
  ruleId: z.enum(INSIGHT_RULE_IDS),
  metric,
  state: z.enum(INSIGHT_READINESS_STATES),
  baselineDays: z.number().int(),
  baselineMinDays: z.number().int(),
  recentDays: z.number().int(),
  recentMinDays: z.number().int(),
});
export type InsightRuleReadiness = z.infer<typeof insightRuleReadinessSchema>;

export const INSIGHTS_WITHHELD_REASONS = ["adults_only"] as const;

export const nutritionObservationSchema = z.object({
  ruleId: z.enum(["observation.meals_near_sleep", "observation.meals_and_workouts"]),
  window: observationWindowSchema,
  matchingEvents: z.number().int().nullable(),
  minimumMatchingEvents: z.number().int().nullable(),
  completeness: z.string(),
  title: z.string(),
  body: z.string(),
});

export const insightsResultSchema = z.object({
  engineVersion: z.string(),
  asOf: z.string(),
  status: z.enum(["available", "withheld"]),
  withheldReason: z.enum(INSIGHTS_WITHHELD_REASONS).nullable(),
  insights: z.array(insightSchema),
  /** Optional, per-member descriptive nutrition observations (#84). */
  observations: z.array(nutritionObservationSchema),
  readiness: z.array(insightRuleReadinessSchema),
  /** Insights hidden by your dismissals, "not useful" mutes or in-app settings. */
  hiddenCount: z.number().int(),
  budget: z.object({
    /** At most this many change insights are shown at once. */
    changeCap: z.number().int(),
    /** Change insights that passed their rule but were held back by the cap. */
    suppressedChanges: z.number().int(),
  }),
  /** True when the in-context push offer may be shown (never before a useful insight). */
  offerPush: z.boolean(),
});
export type InsightsResult = z.infer<typeof insightsResultSchema>;

export const insightsListInput = z.strictObject({});

// ─── feedback ──────────────────────────────────────────────────

/** "Not useful" mutes the whole rule for you for this many days. */
export const NOT_USEFUL_MUTE_DAYS = 30;

export const INSIGHT_FEEDBACK_ACTIONS = ["dismiss", "not_useful"] as const;
export type InsightFeedbackAction = (typeof INSIGHT_FEEDBACK_ACTIONS)[number];

export const insightFeedbackInput = z.strictObject({
  insightId: z.string().min(3).max(200),
  action: z.enum(INSIGHT_FEEDBACK_ACTIONS),
});

export const insightFeedbackOutput = z.object({
  insightId: z.string(),
  action: z.enum(INSIGHT_FEEDBACK_ACTIONS),
  mutedUntil: z.string().nullable(),
});

// ─── delivery preferences ──────────────────────────────────────

/**
 * Version of the email-digest disclosure (the digest contains your values and
 * email is not end-to-end private). Enabling the digest requires acknowledging
 * this exact version.
 */
export const EMAIL_DIGEST_ACKNOWLEDGEMENT_VERSION = "2026-10-16";

export const PUSH_OFFER_STATES = ["not_offered", "accepted", "declined"] as const;
export type PushOfferState = (typeof PUSH_OFFER_STATES)[number];

/** At most one push per person per local day. */
export const MAX_PUSHES_PER_DAY = 1;

export const kindChannelsSchema = z.object({
  change: z.object({ in_app: z.boolean(), push: z.boolean(), email: z.boolean() }),
  goal_milestone: z.object({ in_app: z.boolean(), push: z.boolean(), email: z.boolean() }),
  data_quality: z.object({ in_app: z.boolean(), push: z.boolean(), email: z.boolean() }),
  streak: z.object({ in_app: z.boolean(), push: z.boolean(), email: z.boolean() }),
  reminder: z.object({ in_app: z.boolean(), push: z.boolean(), email: z.boolean() }),
  /** #84: observational, so off on every channel until the person opts in. */
  observation: z.object({ in_app: z.boolean(), push: z.boolean(), email: z.boolean() }),
});
export type KindChannels = z.infer<typeof kindChannelsSchema>;

export const insightPreferencesSchema = z.object({
  /**
   * Push and email deliver this workspace's insights, so only the workspace
   * owner (the person the record belongs to) can turn them on. Other members
   * still see insights in the app.
   */
  canConfigureDelivery: z.boolean(),
  /** Whether the server has a push / email transport configured at all. */
  pushAvailable: z.boolean(),
  emailAvailable: z.boolean(),
  push: z.object({
    enabled: z.boolean(),
    /** Off: the lock screen says only "You have a new insight". On: it names the topic. */
    showTopic: z.boolean(),
    offerState: z.enum(PUSH_OFFER_STATES),
    registeredDevices: z.number().int(),
  }),
  email: z.object({
    enabled: z.boolean(),
    acknowledgedVersion: z.string().nullable(),
  }),
  /**
   * Daily supplement / medication / event reminders by email. Off until the
   * member turns it on; separate from the weekly email and from the
   * preventive-care `reminder` kind, because each email names the item.
   * These reminders are the member's own, so any member may turn this on.
   */
  dailyReminders: z.object({ email: z.boolean() }),
  /** Local hour (0–23) from which the day's push or the week's email may go out. */
  deliveryHour: z.number().int().min(0).max(23),
  /** IANA time zone used for the delivery hour and "one per day". */
  timeZone: z.string(),
  channels: kindChannelsSchema,
});
export type InsightPreferences = z.infer<typeof insightPreferencesSchema>;

const channelPatch = z.strictObject({
  in_app: z.boolean().optional(),
  push: z.boolean().optional(),
  email: z.boolean().optional(),
});

export const insightPreferencesUpdateInput = z.strictObject({
  push: z
    .strictObject({ enabled: z.boolean().optional(), showTopic: z.boolean().optional() })
    .optional(),
  /** Answer to the in-context offer. `accepted` also turns push on. */
  pushOffer: z.enum(["accepted", "declined"]).optional(),
  email: z
    .strictObject({
      enabled: z.boolean(),
      /** Required (equal to EMAIL_DIGEST_ACKNOWLEDGEMENT_VERSION) to turn the digest on. */
      acknowledgement: z.string().max(40).optional(),
    })
    .optional(),
  dailyReminders: z.strictObject({ email: z.boolean() }).optional(),
  deliveryHour: z.number().int().min(0).max(23).optional(),
  timeZone: z.string().min(1).max(64).optional(),
  channels: z
    .strictObject({
      change: channelPatch.optional(),
      goal_milestone: channelPatch.optional(),
      data_quality: channelPatch.optional(),
      streak: channelPatch.optional(),
      reminder: channelPatch.optional(),
      observation: channelPatch.optional(),
    })
    .optional(),
});
export type InsightPreferencesUpdate = z.infer<typeof insightPreferencesUpdateInput>;

export const insightPreferencesGetInput = z.strictObject({});

// ─── push devices ──────────────────────────────────────────────

/** Expo push tokens only: `ExponentPushToken[...]` (or the older `ExpoPushToken[...]`). */
export const EXPO_PUSH_TOKEN_PATTERN = /^Expo(?:nent)?PushToken\[[A-Za-z0-9_-]{8,128}\]$/;

export const pushDeviceRegisterInput = z.strictObject({
  token: z.string().regex(EXPO_PUSH_TOKEN_PATTERN),
  platform: z.enum(["ios", "android"]),
});

export const pushDeviceUnregisterInput = z.strictObject({
  token: z.string().regex(EXPO_PUSH_TOKEN_PATTERN),
});

export const pushDeviceOutput = z.object({ registeredDevices: z.number().int() });

// ─── one-step email unsubscribe ────────────────────────────────

export const emailUnsubscribeInput = z.strictObject({
  token: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/),
});

export const emailUnsubscribeOutput = z.object({
  status: z.enum(["unsubscribed", "invalid"]),
});
