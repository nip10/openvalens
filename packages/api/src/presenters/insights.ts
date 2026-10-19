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
 * suggest that one measure explains another. `insights-copy.test.ts` renders
 * every rule and fails on banned wording.
 */

export const INSIGHT_COPY = {
  sectionTitle: "Insights",
  sectionIntro:
    "Short descriptions of what changed in your own records, compared with your own usual. They are calculated by fixed rules, not by AI.",
  empty: "Nothing stands out right now. On most days nothing does.",
  adultsOnly: "Insights are for adults 18 and over, based on your profile answer.",
  notReadyTitle: "Still learning your usual",
  hiddenSome: (count: number) =>
    `${count} insight${count === 1 ? " is" : "s are"} hidden by your dismissals or settings.`,
  suppressed: (count: number) =>
    `${count} more change${count === 1 ? "" : "s"} held back so only the clearest are shown.`,
  dismiss: "Dismiss",
  notUseful: "Not useful",
  notUsefulHint: "Hides this kind of insight for 30 days.",
  askCoach: "Ask the coach about this",
  limits:
    "Insights describe your records only. They are not medical advice and say nothing about your health.",
  method: "How insights work",
  methodText:
    "Each rule compares your last 7 days with your own usual (the median of the 28 days before). A change is only described when it is larger than both your usual day-to-day variation and a fixed minimum size, and when most recent days sit on the same side. A new device or app starts a new usual instead of being mixed with the old one.",
  summariesTitle: "How am I doing?",
  summariesLink: "See the full breakdown",
} as const;

export function nutritionObservationView(observation: InsightsResult["observations"][number]) {
  return {
    title: observation.title,
    body: observation.body,
    completeness: observation.completeness,
    period: `Period: ${observation.window.from} to ${observation.window.to} (${observation.window.days} days)`,
    accessibilityLabel: `${observation.title}. ${observation.body}. ${observation.completeness}`,
  };
}

/** Keep the explicit observation opt-in isolated from every delivery channel. */
export function observationPreferencePatch(inApp: boolean) {
  return { channels: { observation: { in_app: inApp } } } as const;
}

/** Fail closed while a revocation is pending or after it fails. */
export function shouldShowObservations(savedInApp: boolean | undefined, hideObservations: boolean) {
  return savedInApp === true && !hideObservations;
}

export const INSIGHT_METRIC_LABELS: Record<InsightMetric, string> = {
  sleep_duration: "Sleep",
  resting_heart_rate: "Resting heart rate",
  steps: "Steps",
  weight: "Weight",
};

const METRIC_PHRASE: Record<InsightMetric, string> = {
  sleep_duration: "sleep",
  resting_heart_rate: "resting heart rate",
  steps: "step count",
  weight: "weight",
};

export const INSIGHT_KIND_LABELS: Record<InsightKind, string> = {
  change: "Changes compared with your usual",
  goal_milestone: "Goal milestones",
  data_quality: "Data quality (gaps, new devices)",
  streak: "Recording streaks",
  reminder: "Preventive-care reminders (dates you set)",
  observation: "Nutrition observations",
};

export const INSIGHT_CHANNEL_LABELS: Record<InsightChannel, string> = {
  in_app: "In the app",
  push: "Push notification",
  email: "Weekly email",
};

export const INSIGHT_TOPIC_LABELS: Record<InsightTopic, string> = {
  sleep: "sleep",
  heart: "heart rate",
  activity: "activity",
  body: "body",
  goals: "goals",
};

export const INSIGHT_READINESS_LABELS: Record<InsightReadinessState, string> = {
  ready: "Ready",
  building_baseline: "Building your usual",
  rebuilding_after_source_change: "Rebuilding your usual after a new source",
  no_recent_data: "Not enough recent days",
  no_access: "Not available with your workspace role",
};

function thousands(value: number): string {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** "7h 05m" / "58 bpm" / "8,200 steps" / "80.1 kg". */
export function formatInsightValue(
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
  if (unit === "steps") return `${thousands(Math.abs(value))} steps`;
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

function factorText(factors: readonly InsightFactor[]): string | null {
  if (factors.length === 0) return null;
  const parts = factors.map(
    (factor) => `your ${METRIC_PHRASE[factor.metric]} was ${factor.direction} than usual`,
  );
  return `In the same period, ${parts.join(" and ")}. These changed at the same time; that does not mean one explains the other.`;
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

/** Renders one insight from its reviewed template. */
export function insightView(
  insight: Insight,
  settings?: ProductDisplaySettings | null,
): InsightView {
  const detail = insight.detail;
  let title: string;
  let body: string;
  let certaintyText: string | null = null;
  let coverageText: string | null = null;

  switch (detail.type) {
    case "change": {
      const label = INSIGHT_METRIC_LABELS[detail.metric];
      const recent = formatInsightValue(detail.recentValue, detail.unit, settings);
      const usual = formatInsightValue(detail.baselineValue, detail.unit, settings);
      const difference = formatInsightValue(detail.difference, detail.unit, settings);
      title = `${label} ${detail.direction} than your usual`;
      body = `Your 7-day average ${METRIC_PHRASE[detail.metric]} was ${recent}, ${difference} ${detail.direction} than your usual of ${usual}.`;
      certaintyText =
        detail.certainty === "clear"
          ? "This is clearly larger than your usual day-to-day variation."
          : "This is only a little larger than your usual day-to-day variation.";
      coverageText = `Based on ${detail.recentDays} of the last ${detail.recentWindowDays} days, compared with ${detail.baselineDays} days in the ${detail.baselineWindowDays} days before.`;
      break;
    }
    case "trend": {
      const change = formatInsightValue(detail.endValue - detail.startValue, detail.unit, settings);
      const direction = detail.direction === "higher" ? "up" : "down";
      title = `Weight trending ${direction}`;
      body = `Over the last ${Math.round(detail.windowDays / 7)} weeks your weight trend moved about ${change} ${direction}, from about ${formatInsightValue(detail.startValue, detail.unit, settings)} to ${formatInsightValue(detail.endValue, detail.unit, settings)}.`;
      certaintyText =
        detail.certainty === "clear"
          ? "The trend is clearly larger than your usual day-to-day ups and downs."
          : "The trend is only a little larger than your usual day-to-day ups and downs.";
      coverageText = `Based on ${detail.days} weigh-ins in the last ${detail.windowDays} days.`;
      break;
    }
    case "goal": {
      const progress =
        detail.progress === null ? null : `${Math.round(Math.min(1, detail.progress) * 100)}%`;
      if (detail.state === "reached") {
        title = `Target reached: ${detail.goalTitle}`;
        body = `Your latest check-in for “${detail.goalTitle}” reached the target you set.`;
      } else if (detail.state === "toward_target") {
        title = `Closer to your target: ${detail.goalTitle}`;
        body = `Your latest check-in for “${detail.goalTitle}” moved toward your target.${progress ? ` You are ${progress} of the way from your starting point.` : ""}`;
      } else {
        title = `Further from your target: ${detail.goalTitle}`;
        body = `Your latest check-in for “${detail.goalTitle}” moved away from your target.${progress ? ` You are ${progress} of the way from your starting point.` : ""}`;
      }
      break;
    }
    case "recording_gap": {
      const label = INSIGHT_METRIC_LABELS[detail.metric];
      title = `No ${METRIC_PHRASE[detail.metric]} recorded since ${formatInsightDate(detail.lastRecordedDate)}`;
      body = `${label} had been recorded on most days, but nothing has arrived for ${detail.daysWithout} days. Insights that use it pause until new data arrives.`;
      break;
    }
    case "source_change": {
      const label = INSIGHT_METRIC_LABELS[detail.metric];
      title = `New source for ${METRIC_PHRASE[detail.metric]}`;
      body = `${label} has been coming from a different device or app since ${formatInsightDate(detail.sinceDate)}. Different sources measure differently, so your usual is being rebuilt from the new source only (${detail.baselineDays} of ${detail.baselineMinDays} days so far). Change insights for it pause until then.`;
      break;
    }
    case "streak": {
      title = `${detail.days} days of ${METRIC_PHRASE[detail.metric]} recorded in a row`;
      body = `${INSIGHT_METRIC_LABELS[detail.metric]} has been recorded every day since ${formatInsightDate(detail.startDate)}.`;
      break;
    }
    case "meals_and_workouts": {
      title = "Meals and recorded workouts";
      body = `Logged meals and workouts occurred on ${detail.daysWithBoth} days in this ${detail.window.days}-day window. This describes co-occurrence in your records only and does not establish a relationship between them.`;
      coverageText = `Diary marked complete on ${detail.diaryCompleteDays} days; workouts were recorded on ${detail.workoutDays} days.`;
      break;
    }
    case "meals_near_sleep": {
      title = "Meals and recorded sleep timing";
      body = `Some logged meals were recorded within four hours before sleep starts in this ${detail.window.days}-day window. This describes timing in your records only and does not establish a relationship between meal timing and sleep.`;
      coverageText = `${detail.nearSleepEvenings} of ${detail.evenings} recorded evenings were within the timing window.`;
      break;
    }
    case "activity_energy_context": {
      title = "Recorded activity energy";
      body = `Estimated activity energy was recorded on ${detail.activityDays} days in this ${detail.window.days}-day window. It is shown separately from food intake.`;
      break;
    }
  }

  const factorsText = factorText(insight.factors);
  const kindLabel = INSIGHT_KIND_LABELS[insight.kind];
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
    ruleText: `Rule ${insight.ruleId} v${insight.ruleVersion}`,
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
  readiness: readonly InsightRuleReadiness[],
): InsightReadinessView[] {
  return readiness
    .filter((entry) => entry.state !== "ready")
    .map((entry) => {
      const label = INSIGHT_METRIC_LABELS[entry.metric];
      const stateLabel = INSIGHT_READINESS_LABELS[entry.state];
      const detail =
        entry.state === "no_access"
          ? "Ask the workspace owner if you need it."
          : entry.state === "no_recent_data"
            ? `Needs at least ${entry.recentMinDays} recent days with data; found ${entry.recentDays}.`
            : `${entry.baselineDays} of ${entry.baselineMinDays} days with data so far.`;
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
  result: InsightsResult,
  settings?: ProductDisplaySettings | null,
): InsightsListView {
  const withheld = result.status === "withheld" ? INSIGHT_COPY.adultsOnly : null;
  const insights = result.insights.map((insight) => insightView(insight, settings));
  const footnotes: string[] = [];
  if (result.budget.suppressedChanges > 0)
    footnotes.push(INSIGHT_COPY.suppressed(result.budget.suppressedChanges));
  if (result.hiddenCount > 0) footnotes.push(INSIGHT_COPY.hiddenSome(result.hiddenCount));
  return {
    withheld,
    insights,
    notReady: withheld ? [] : insightReadinessViews(result.readiness),
    footnotes,
    emptyText: withheld === null && insights.length === 0 ? INSIGHT_COPY.empty : null,
    versionText: `Rules ${result.engineVersion}, as of ${result.asOf}.`,
  };
}

// ─── delivery copy ─────────────────────────────────────────────

export const GENERIC_PUSH_TITLE = "OpenValens";
export const GENERIC_PUSH_BODY = "You have a new insight";

export type InsightPushContent = {
  title: string;
  body: string;
};

/**
 * The only text a push may carry. Generic by default; with `showTopic` it
 * names the coarse topic of the first insight ("sleep", "goals", …). It is
 * built from the topic alone, so no value, goal title or date can reach a
 * lock screen or a push provider.
 */
export function insightPushContent(
  topic: InsightTopic | null,
  showTopic: boolean,
): InsightPushContent {
  return {
    title: GENERIC_PUSH_TITLE,
    body:
      showTopic && topic
        ? `You have a new ${INSIGHT_TOPIC_LABELS[topic]} insight`
        : GENERIC_PUSH_BODY,
  };
}

export const INSIGHT_DELIVERY_COPY = {
  settingsTitle: "Insight notifications",
  settingsIntro:
    "Insights always appear in the app. Push and email are optional extra channels for the same insights and stay off until you turn them on.",
  ownerOnly:
    "Push and email can only be turned on by the owner of this workspace. You can still see insights in the app.",
  pushTitle: "Push notifications",
  pushDescription:
    "At most one a day, delivered quietly. The lock screen says only “You have a new insight” unless you choose to show the topic. Values never appear on the lock screen.",
  pushShowTopic: "Show the topic on the lock screen (for example “sleep”)",
  pushUnavailable: "Push notifications are not set up on this server.",
  pushNoDevice: "Turn on push from the mobile app to register this phone.",
  pushOfferTitle: "Get a quiet notification for new insights?",
  pushOfferBody:
    "At most one a day. The lock screen says only “You have a new insight”. You can change this any time in Settings.",
  pushOfferAccept: "Turn on",
  pushOfferDecline: "Not now",
  emailTitle: "Weekly email summary",
  emailDescription:
    "Once a week, a summary of your insights with their values. Service messages only, never promotion. Every email has a one-step unsubscribe link.",
  emailDisclosure:
    "This email will contain health values from your records. Email is not end-to-end private: it can be read by email providers along the way and can reach the wrong person if your address is mistyped or shared.",
  emailAcknowledge: "I understand that the email will contain my values and is not private",
  emailUnavailable: "Email is not set up on this server.",
  kindsTitle: "What to include",
  kindsIntro: "Choose which kinds of insight appear in each channel.",
  deliveryHour: "Earliest delivery time",
  timeZone: "Time zone",
} as const;

export const INSIGHT_EMAIL_COPY = {
  subject: "Your weekly insights summary",
  title: "Your weekly insights",
  intro:
    "These describe changes in your own records compared with your own usual. They are not medical advice and say nothing about your health.",
  none: "Nothing stood out this week.",
  footer:
    "You get this email because you turned on the weekly insights summary. It contains values from your health records.",
  unsubscribe: "Turn off this email",
  manage: "Notification settings",
} as const;
