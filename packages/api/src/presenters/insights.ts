import type { I18n, MessageDescriptor } from "@lingui/core";
import { msg, plural, select } from "@lingui/core/macro";

import { INSIGHT_KINDS } from "../insight-contract";
import type {
  Insight,
  InsightChannel,
  InsightFactor,
  InsightKind,
  InsightMetric,
  InsightReadinessState,
  InsightRuleReadiness,
  InsightTopic,
  InsightUnit,
  InsightsResult,
} from "../insight-contract";
import { formatKg } from "./body";
import type { ProductDisplaySettings } from "./product-formatting";

/**
 * Issue #92 — the reviewed insight templates and view models, shared by web,
 * native, the email digest and push. Pure (type-only contract imports).
 *
 * Copy rules (CONTRIBUTING.md → health data rules, issue #92 "Insight voice"):
 * describe what changed, against which usual, how sure the rule is and what
 * else changed at the same time. Never advise, diagnose, predict, judge, or
 * suggest that one measure explains another. `insights.test.ts` renders
 * every rule and fails on banned wording.
 *
 * Translated (#231): copy constants are Lingui message descriptors, and the
 * view builders render through the `i18n` they are given (the viewer's in the
 * apps, the recipient's for email). Each template is one whole sentence; the
 * measure and the direction are ICU selects inside it, so a translation can
 * inflect them. Numbers and dates are formatted as before.
 */

export const INSIGHT_COPY = {
  sectionTitle: msg`Insights`,
  sectionIntro: msg`Short descriptions of what changed in your own records, compared with your own usual. They are calculated by fixed rules, not by AI.`,
  empty: msg`Nothing stands out right now. On most days nothing does.`,
  adultsOnly: msg`Insights are for adults 18 and over, based on your profile answer.`,
  notReadyTitle: msg`Still learning your usual`,
  hiddenSome: (count: number): MessageDescriptor =>
    msg`${plural(count, {
      one: "# insight is hidden by your dismissals or settings.",
      other: "# insights are hidden by your dismissals or settings.",
    })}`,
  suppressed: (count: number): MessageDescriptor =>
    msg`${plural(count, {
      one: "# more change held back so only the clearest are shown.",
      other: "# more changes held back so only the clearest are shown.",
    })}`,
  dismiss: msg`Dismiss`,
  /** Accessible name of the dismiss button for one insight. */
  dismissLabel: (title: string): MessageDescriptor => msg`Dismiss: ${title}`,
  notUseful: msg`Not useful`,
  notUsefulHint: msg`Hides this kind of insight for 30 days.`,
  /** Accessible name of the "Not useful" button for one insight. */
  notUsefulLabel: (title: string): MessageDescriptor =>
    msg`Not useful: ${title}. Hides this kind of insight for 30 days.`,
  askCoach: msg`Ask the coach about this`,
  limits: msg({
    message:
      "Insights describe your records only. They are not medical advice and say nothing about your health.",
    comment: "safety",
  }),
  method: msg`How insights work`,
  methodText: msg`Each rule compares your last 7 days with your own usual (the median of the 28 days before). A change is only described when it is larger than both your usual day-to-day variation and a fixed minimum size, and when most recent days sit on the same side. A new device or app starts a new usual instead of being mixed with the old one.`,
  summariesTitle: msg`How am I doing?`,
  summariesLink: msg`See the full breakdown`,
} as const;

export function nutritionObservationView(
  i18n: I18n,
  observation: InsightsResult["observations"][number],
) {
  const { from, to, days } = observation.window;
  return {
    title: observation.title,
    body: observation.body,
    completeness: observation.completeness,
    period: i18n._(
      msg`Period: ${from} to ${to} (${plural(days, { one: "# day", other: "# days" })})`,
    ),
    accessibilityLabel: `${observation.title}. ${observation.body}. ${observation.completeness}`,
  };
}

/** Keep the explicit observation opt-in isolated from every delivery channel. */
export function observationPreferencePatch(inApp: boolean) {
  return { channels: { observation: { in_app: inApp } } } as const;
}

/**
 * Kinds the generic delivery settings may offer per channel. Nutrition
 * observations are excluded on purpose: they are opted in only through the
 * dedicated observation card, and insight delivery never sends them, so a
 * push/email switch here would do nothing and could bypass that disclosure.
 * Every other kind (and any future one) is still listed.
 */
export const GENERIC_DELIVERY_KINDS: readonly InsightKind[] = INSIGHT_KINDS.filter(
  (kind) => kind !== "observation",
);

/** Fail closed while a revocation is pending or after it fails. */
export function shouldShowObservations(
  savedInApp: boolean | undefined,
  hideObservations: boolean,
  preferenceConfirmed = true,
  mutationFailed = false,
) {
  return savedInApp === true && !hideObservations && preferenceConfirmed && !mutationFailed;
}

/** Keep private query results isolated by authenticated member and workspace. */
export function privateInsightsQueryKey(
  queryKey: readonly unknown[],
  userId: string,
  organizationId: string | null,
) {
  return [...queryKey, { privateSubject: [userId, organizationId ?? "personal"] }] as const;
}

export function privateInsightsSubject(
  sessionPending: boolean,
  userId: string | null | undefined,
  organizationId: string | null,
) {
  return !sessionPending && userId ? { userId, organizationId } : null;
}

export const INSIGHT_METRIC_LABELS: Record<InsightMetric, MessageDescriptor> = {
  sleep_duration: msg`Sleep`,
  resting_heart_rate: msg`Resting heart rate`,
  steps: msg`Steps`,
  weight: msg`Weight`,
};

export const INSIGHT_KIND_LABELS: Record<InsightKind, MessageDescriptor> = {
  change: msg`Changes compared with your usual`,
  goal_milestone: msg`Goal milestones`,
  data_quality: msg`Data quality (gaps, new devices)`,
  streak: msg`Recording streaks`,
  reminder: msg`Preventive-care reminders (dates you set)`,
  observation: msg`Nutrition observations`,
};

export const INSIGHT_CHANNEL_LABELS: Record<InsightChannel, MessageDescriptor> = {
  in_app: msg`In the app`,
  push: msg`Push notification`,
  email: msg`Weekly email`,
};

export const INSIGHT_TOPIC_LABELS: Record<InsightTopic, MessageDescriptor> = {
  sleep: msg({ message: "sleep", context: "insight topic" }),
  heart: msg({ message: "heart rate", context: "insight topic" }),
  activity: msg({ message: "activity", context: "insight topic" }),
  body: msg({ message: "body", context: "insight topic" }),
  goals: msg({ message: "goals", context: "insight topic" }),
};

export const INSIGHT_READINESS_LABELS: Record<InsightReadinessState, MessageDescriptor> = {
  ready: msg`Ready`,
  building_baseline: msg`Building your usual`,
  rebuilding_after_source_change: msg`Rebuilding your usual after a new source`,
  no_recent_data: msg`Not enough recent days`,
  no_access: msg`Not available with your workspace role`,
};

function thousands(value: number): string {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** "7h 05m" / "58 bpm" / "8,200 steps" / "80.1 kg". */
export function formatInsightValue(
  i18n: I18n,
  value: number,
  unit: InsightUnit,
  settings?: ProductDisplaySettings | null,
): string {
  if (unit === "minutes") {
    const total = Math.round(Math.abs(value));
    const hours = Math.floor(total / 60);
    const minutes = total % 60;
    return hours > 0 ? `${hours}h ${String(minutes).padStart(2, "0")}m` : `${minutes} min`;
  }
  if (unit === "bpm") return `${Math.round(Math.abs(value))} bpm`;
  if (unit === "steps") {
    const amount = thousands(Math.abs(value));
    return i18n._(msg`${amount} steps`);
  }
  return formatKg(Math.abs(value), settings);
}

/** "12 Oct" from YYYY-MM-DD (UTC, locale-independent). */
export function formatInsightDate(date: string): string {
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const [, month, day] = date.split("-");
  return `${Number(day)} ${months[Number(month) - 1] ?? ""}`.trim();
}

/** "In the same period, …": one whole sentence for one or two factors. */
function factorText(i18n: I18n, factors: readonly InsightFactor[]): string | null {
  const [first, second] = factors;
  if (!first) return null;
  const metric = first.metric;
  const direction = first.direction;
  if (!second)
    return i18n._(
      msg({
        message: `In the same period, your ${select(metric, {
          sleep_duration: "sleep",
          resting_heart_rate: "resting heart rate",
          steps: "step count",
          other: "weight",
        })} was ${select(direction, { higher: "higher", other: "lower" })} than usual. These changed at the same time; that does not mean one explains the other.`,
        comment: "safety",
      }),
    );
  const otherMetric = second.metric;
  const otherDirection = second.direction;
  return i18n._(
    msg({
      message: `In the same period, your ${select(metric, {
        sleep_duration: "sleep",
        resting_heart_rate: "resting heart rate",
        steps: "step count",
        other: "weight",
      })} was ${select(direction, { higher: "higher", other: "lower" })} than usual and your ${select(
        otherMetric,
        {
          sleep_duration: "sleep",
          resting_heart_rate: "resting heart rate",
          steps: "step count",
          other: "weight",
        },
      )} was ${select(otherDirection, { higher: "higher", other: "lower" })} than usual. These changed at the same time; that does not mean one explains the other.`,
      comment: "safety",
    }),
  );
}

export type InsightView = {
  key: string;
  kind: InsightKind;
  kindLabel: string;
  title: string;
  body: string;
  certaintyText: string | null;
  coverageText: string | null;
  factorsText: string | null;
  accessibilityLabel: string;
  /** Rule id and version, shown small for explainability. */
  ruleText: string;
};

/** Renders one insight from its reviewed template, in the language of `i18n`. */
export function insightView(
  i18n: I18n,
  insight: Insight,
  settings?: ProductDisplaySettings | null,
): InsightView {
  const detail = insight.detail;
  const value = (amount: number, unit: InsightUnit) =>
    formatInsightValue(i18n, amount, unit, settings);
  let title: string;
  let body: string;
  let certaintyText: string | null = null;
  let coverageText: string | null = null;

  switch (detail.type) {
    case "change": {
      const { metric, direction, recentDays, recentWindowDays, baselineDays, baselineWindowDays } =
        detail;
      const recent = value(detail.recentValue, detail.unit);
      const usual = value(detail.baselineValue, detail.unit);
      const difference = value(detail.difference, detail.unit);
      title = i18n._(
        msg`${select(metric, {
          sleep_duration: "Sleep",
          resting_heart_rate: "Resting heart rate",
          steps: "Steps",
          other: "Weight",
        })} ${select(direction, { higher: "higher", other: "lower" })} than your usual`,
      );
      body = i18n._(
        msg`Your 7-day average ${select(metric, {
          sleep_duration: "sleep",
          resting_heart_rate: "resting heart rate",
          steps: "step count",
          other: "weight",
        })} was ${recent}, ${difference} ${select(direction, { higher: "higher", other: "lower" })} than your usual of ${usual}.`,
      );
      certaintyText =
        detail.certainty === "clear"
          ? i18n._(msg`This is clearly larger than your usual day-to-day variation.`)
          : i18n._(msg`This is only a little larger than your usual day-to-day variation.`);
      coverageText = i18n._(
        msg`Based on ${recentDays} of the last ${recentWindowDays} days, compared with ${plural(baselineDays, { one: "# day", other: "# days" })} in the ${baselineWindowDays} days before.`,
      );
      break;
    }
    case "trend": {
      const { direction, days, windowDays } = detail;
      const change = value(detail.endValue - detail.startValue, detail.unit);
      const start = value(detail.startValue, detail.unit);
      const end = value(detail.endValue, detail.unit);
      const weeks = Math.round(windowDays / 7);
      title = i18n._(
        msg`${select(direction, { higher: "Weight trending up", other: "Weight trending down" })}`,
      );
      body = i18n._(
        msg`Over the last ${plural(weeks, { one: "# week", other: "# weeks" })} your weight trend moved about ${change} ${select(direction, { higher: "up", other: "down" })}, from about ${start} to ${end}.`,
      );
      certaintyText =
        detail.certainty === "clear"
          ? i18n._(msg`The trend is clearly larger than your usual day-to-day ups and downs.`)
          : i18n._(
              msg`The trend is only a little larger than your usual day-to-day ups and downs.`,
            );
      coverageText = i18n._(
        msg`Based on ${plural(days, { one: "# weigh-in", other: "# weigh-ins" })} in the last ${windowDays} days.`,
      );
      break;
    }
    case "goal": {
      const goalTitle = detail.goalTitle;
      const progress =
        detail.progress === null ? null : `${Math.round(Math.min(1, detail.progress) * 100)}%`;
      const progressText = progress
        ? ` ${i18n._(msg`You are ${progress} of the way from your starting point.`)}`
        : "";
      if (detail.state === "reached") {
        title = i18n._(msg`Target reached: ${goalTitle}`);
        body = i18n._(msg`Your latest check-in for “${goalTitle}” reached the target you set.`);
      } else if (detail.state === "toward_target") {
        title = i18n._(msg`Closer to your target: ${goalTitle}`);
        body = `${i18n._(msg`Your latest check-in for “${goalTitle}” moved toward your target.`)}${progressText}`;
      } else {
        title = i18n._(msg`Further from your target: ${goalTitle}`);
        body = `${i18n._(msg`Your latest check-in for “${goalTitle}” moved away from your target.`)}${progressText}`;
      }
      break;
    }
    case "recording_gap": {
      const { metric, daysWithout } = detail;
      const date = formatInsightDate(detail.lastRecordedDate);
      title = i18n._(
        msg`No ${select(metric, {
          sleep_duration: "sleep",
          resting_heart_rate: "resting heart rate",
          steps: "step count",
          other: "weight",
        })} recorded since ${date}`,
      );
      body = i18n._(
        msg`${select(metric, {
          sleep_duration: "Sleep",
          resting_heart_rate: "Resting heart rate",
          steps: "Steps",
          other: "Weight",
        })} had been recorded on most days, but nothing has arrived for ${plural(daysWithout, { one: "# day", other: "# days" })}. Insights that use it pause until new data arrives.`,
      );
      break;
    }
    case "source_change": {
      const { metric, baselineDays, baselineMinDays } = detail;
      const date = formatInsightDate(detail.sinceDate);
      title = i18n._(
        msg`New source for ${select(metric, {
          sleep_duration: "sleep",
          resting_heart_rate: "resting heart rate",
          steps: "step count",
          other: "weight",
        })}`,
      );
      body = i18n._(
        msg`${select(metric, {
          sleep_duration: "Sleep",
          resting_heart_rate: "Resting heart rate",
          steps: "Steps",
          other: "Weight",
        })} has been coming from a different device or app since ${date}. Different sources measure differently, so your usual is being rebuilt from the new source only (${baselineDays} of ${baselineMinDays} days so far). Change insights for it pause until then.`,
      );
      break;
    }
    case "streak": {
      const { metric, days } = detail;
      const date = formatInsightDate(detail.startDate);
      title = i18n._(
        msg`${plural(days, { one: "# day", other: "# days" })} of ${select(metric, {
          sleep_duration: "sleep",
          resting_heart_rate: "resting heart rate",
          steps: "step count",
          other: "weight",
        })} recorded in a row`,
      );
      body = i18n._(
        msg`${select(metric, {
          sleep_duration: "Sleep",
          resting_heart_rate: "Resting heart rate",
          steps: "Steps",
          other: "Weight",
        })} has been recorded every day since ${date}.`,
      );
      break;
    }
    case "meals_and_workouts": {
      const { daysWithBoth, diaryCompleteDays, workoutDays } = detail;
      const windowDays = detail.window.days;
      title = i18n._(msg`Meals and recorded workouts`);
      body = i18n._(
        msg({
          message: `Logged meals and workouts occurred on ${plural(daysWithBoth, { one: "# day", other: "# days" })} in this ${windowDays}-day window. This describes co-occurrence in your records only and does not establish a relationship between them.`,
          comment: "safety",
        }),
      );
      coverageText = i18n._(
        msg`Diary marked complete on ${plural(diaryCompleteDays, { one: "# day", other: "# days" })}; workouts were recorded on ${plural(workoutDays, { one: "# day", other: "# days" })}.`,
      );
      break;
    }
    case "meals_near_sleep": {
      const { evenings, nearSleepEvenings } = detail;
      const windowDays = detail.window.days;
      title = i18n._(msg`Meals and recorded sleep timing`);
      body = i18n._(
        msg({
          message: `Some logged meals were recorded within four hours before sleep starts in this ${windowDays}-day window. This describes timing in your records only and does not establish a relationship between meal timing and sleep.`,
          comment: "safety",
        }),
      );
      coverageText = i18n._(
        msg`${nearSleepEvenings} of ${evenings} recorded evenings were within the timing window.`,
      );
      break;
    }
    case "activity_energy_context": {
      const { activityDays } = detail;
      const windowDays = detail.window.days;
      title = i18n._(msg`Recorded activity energy`);
      body = i18n._(
        msg`Estimated activity energy was recorded on ${plural(activityDays, { one: "# day", other: "# days" })} in this ${windowDays}-day window. It is shown separately from food intake.`,
      );
      break;
    }
  }

  const factorsText = factorText(i18n, insight.factors);
  const kindLabel = i18n._(INSIGHT_KIND_LABELS[insight.kind]);
  const ruleId = insight.ruleId;
  const ruleVersion = insight.ruleVersion;
  return {
    key: insight.id,
    kind: insight.kind,
    kindLabel,
    title,
    body,
    certaintyText,
    coverageText,
    factorsText,
    accessibilityLabel: [title, body, certaintyText, coverageText, factorsText]
      .filter((part): part is string => part !== null)
      .join(" "),
    ruleText: i18n._(msg`Rule ${ruleId} v${ruleVersion}`),
  };
}

export type InsightReadinessView = {
  key: string;
  label: string;
  stateLabel: string;
  detail: string;
};

/** "Not enough data yet" rows: never zero, never "normal". */
export function insightReadinessViews(
  i18n: I18n,
  readiness: readonly InsightRuleReadiness[],
): InsightReadinessView[] {
  return readiness
    .filter((entry) => entry.state !== "ready")
    .map((entry) => {
      const { recentMinDays, recentDays, baselineDays, baselineMinDays } = entry;
      const label = i18n._(INSIGHT_METRIC_LABELS[entry.metric]);
      const stateLabel = i18n._(INSIGHT_READINESS_LABELS[entry.state]);
      const detail =
        entry.state === "no_access"
          ? i18n._(msg`Ask the workspace owner if you need it.`)
          : entry.state === "no_recent_data"
            ? i18n._(
                msg`Needs at least ${recentMinDays} recent days with data; found ${recentDays}.`,
              )
            : i18n._(msg`${baselineDays} of ${baselineMinDays} days with data so far.`);
      return { key: entry.ruleId, label, stateLabel, detail };
    });
}

export type InsightsListView = {
  withheld: string | null;
  insights: InsightView[];
  notReady: InsightReadinessView[];
  footnotes: string[];
  emptyText: string | null;
  versionText: string;
};

export function insightsListView(
  i18n: I18n,
  result: InsightsResult,
  settings?: ProductDisplaySettings | null,
): InsightsListView {
  const withheld = result.status === "withheld" ? i18n._(INSIGHT_COPY.adultsOnly) : null;
  const insights = result.insights.map((insight) => insightView(i18n, insight, settings));
  const footnotes: string[] = [];
  if (result.budget.suppressedChanges > 0)
    footnotes.push(i18n._(INSIGHT_COPY.suppressed(result.budget.suppressedChanges)));
  if (result.hiddenCount > 0) footnotes.push(i18n._(INSIGHT_COPY.hiddenSome(result.hiddenCount)));
  const engineVersion = result.engineVersion;
  const asOf = result.asOf;
  return {
    withheld,
    insights,
    notReady: withheld ? [] : insightReadinessViews(i18n, result.readiness),
    footnotes,
    emptyText: withheld === null && insights.length === 0 ? i18n._(INSIGHT_COPY.empty) : null,
    versionText: i18n._(msg`Rules ${engineVersion}, as of ${asOf}.`),
  };
}

// ─── delivery copy ─────────────────────────────────────────────

/** The app name: a brand, never translated. */
export const GENERIC_PUSH_TITLE = "OpenValens";
export const GENERIC_PUSH_BODY = msg`You have a new insight`;

/**
 * Whole push sentences per topic (#231), so a translation never has to fit a
 * topic word into a fixed frame.
 */
export const INSIGHT_PUSH_TOPIC_BODIES: Record<InsightTopic, MessageDescriptor> = {
  sleep: msg`You have a new sleep insight`,
  heart: msg`You have a new heart rate insight`,
  activity: msg`You have a new activity insight`,
  body: msg`You have a new body insight`,
  goals: msg`You have a new goals insight`,
};

export type InsightPushContent = {
  title: string;
  body: string;
};

/**
 * The only text a push may carry, in the recipient's language. Generic by
 * default; with `showTopic` it names the coarse topic of the first insight
 * ("sleep", "goals", …). It is built from the topic alone, so no value, goal
 * title or date can reach a lock screen or a push provider.
 */
export function insightPushContent(
  i18n: I18n,
  topic: InsightTopic | null,
  showTopic: boolean,
): InsightPushContent {
  return {
    title: GENERIC_PUSH_TITLE,
    body: i18n._(showTopic && topic ? INSIGHT_PUSH_TOPIC_BODIES[topic] : GENERIC_PUSH_BODY),
  };
}

export const INSIGHT_DELIVERY_COPY = {
  settingsTitle: msg`Insight notifications`,
  settingsIntro: msg`Insights always appear in the app. Push and email are optional extra channels for the same insights and stay off until you turn them on.`,
  ownerOnly: msg`Push and email can only be turned on by the owner of this workspace. You can still see insights in the app.`,
  pushTitle: msg`Push notifications`,
  pushDescription: msg`At most one a day, delivered quietly. The lock screen says only “You have a new insight” unless you choose to show the topic. Values never appear on the lock screen.`,
  pushShowTopic: msg`Show the topic on the lock screen (for example “sleep”)`,
  pushUnavailable: msg`Push notifications are not set up on this server.`,
  pushNoDevice: msg`Turn on push from the mobile app to register this phone.`,
  pushOfferTitle: msg`Get a quiet notification for new insights?`,
  pushOfferBody: msg`At most one a day. The lock screen says only “You have a new insight”. You can change this any time in Settings.`,
  pushOfferAccept: msg`Turn on`,
  pushOfferDecline: msg`Not now`,
  emailTitle: msg`Weekly email summary`,
  emailDescription: msg`Once a week, a summary of your insights with their values. Service messages only, never promotion. Every email has a one-step unsubscribe link.`,
  emailDisclosure: msg({
    message:
      "This email will contain health values from your records. Email is not end-to-end private: it can be read by email providers along the way and can reach the wrong person if your address is mistyped or shared.",
    comment: "safety",
  }),
  emailAcknowledge: msg({
    message: "I understand that the email will contain my values and is not private",
    comment: "safety",
  }),
  emailUnavailable: msg`Email is not set up on this server.`,
  dailyRemindersTitle: msg`Daily reminders`,
  dailyRemindersEmail: msg`Daily reminders by email (supplements, medications, scheduled events)`,
  dailyRemindersEmailNote: msg({
    message:
      "Off unless you turn it on. One email a day names each supplement, medication or scheduled event due that day. Email is not end-to-end private.",
    comment: "safety",
  }),
  dailyRemindersTelegram: msg`If you connect Telegram in Settings, the same reminders are sent there instead.`,
  kindsTitle: msg`What to include`,
  kindsIntro: msg`Choose which kinds of insight appear in each channel.`,
  deliveryHour: msg`Earliest delivery time`,
  timeZone: msg`Time zone`,
} as const satisfies Record<string, MessageDescriptor>;

/** The weekly insights email (#92), rendered in the recipient's language (#231). */
export const INSIGHT_EMAIL_COPY = {
  subject: msg`Your weekly insights summary`,
  title: msg`Your weekly insights`,
  intro: msg({
    message:
      "These describe changes in your own records compared with your own usual. They are not medical advice and say nothing about your health.",
    comment: "safety",
  }),
  none: msg`Nothing stood out this week.`,
  footer: msg({
    message:
      "You get this email because you turned on the weekly insights summary. It contains values from your health records.",
    comment: "safety",
  }),
  unsubscribe: msg`Turn off this email`,
  manage: msg`Notification settings`,
} as const satisfies Record<string, MessageDescriptor>;
