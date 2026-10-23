import { sql, type Database } from "@openvalens/db";
import { insightDelivery, insightPreference, pushDevice } from "@openvalens/db/schema/insights";
import {
  describeEmailDeliveryError,
  renderInsightsDigestEmail,
  type EmailService,
} from "@openvalens/email";
import type { Locale } from "@openvalens/i18n";
import type { StructuredLogger } from "@openvalens/observability";
import { describePushDeliveryError, type PushProvider } from "@openvalens/push";
import { and, eq, inArray, lt, or } from "drizzle-orm";

import type { InsightTopic } from "./insight-contract";
import { isoWeek, selectInsights } from "./insight-rules";
import { databaseMessageLocales, localeOrEnglish, serverI18n, type MessageLocales } from "./locale";
import {
  channelsFromDisabled,
  createInsightService,
  emailUnsubscribeToken,
  hashUnsubscribeToken,
  isValidTimeZone,
  type InsightScope,
} from "./insights";
import type { ProductDisplaySettings } from "./presenters/product-formatting";
import {
  INSIGHT_EMAIL_COPY,
  insightPushContent,
  insightView,
  type InsightPushContent,
} from "./presenters/insights";

/**
 * Issue #92 — deterministic delivery of insights by push and weekly email.
 *
 * The delivery rules (also the contract #97 preventive-care reminders reuse):
 *
 * - **Opt-in only.** A channel is used only when the person turned it on for
 *   that workspace (`insight_preference`), and only for the workspace owner —
 *   the person the record belongs to — who is a current, unbanned member.
 * - **Per-kind toggles** (`<kind>:<channel>`), dismissals and "not useful"
 *   mutes apply on every channel, from the next run.
 * - **Local delivery window.** Nothing goes out before the person's chosen
 *   local hour (`delivery_hour` in `time_zone`).
 * - **At most one push per local day** and **one email per ISO week**: each is
 *   a row in `insight_delivery` keyed by (organization, user, channel,
 *   period). Inserting that row is the claim, so concurrent or replayed runs
 *   cannot double-send; a failed send is retried on a later run (max 3).
 * - **Dedupe by (user, rule, window).** An insight id already delivered on a
 *   channel is never sent on it again.
 * - **Generic push.** A push carries fixed text ("You have a new insight", or
 *   the topic if the person allowed it) and an in-app path — never a value.
 * - **Sending nothing is normal.** No insight → no claim, no message.
 * - **Value-free records and logs.** Delivery rows hold channel, period,
 *   insight ids and `<rule>@<version>`; logs hold ids, counts and typed error
 *   categories only.
 */

export const MAX_DELIVERY_ATTEMPTS = 3;
/** A claim with no outcome after this long (a crashed run) may be retried. */
export const STALE_CLAIM_MS = 60 * 60 * 1000;
/** Change insights included in one weekly email. */
export const EMAIL_CHANGE_CAP = 4;

export type DeliveryChannel = "push" | "email";

export type LocalClock = { date: string; hour: number; week: string };

/** The person's local date, hour and ISO week. An invalid zone falls back to UTC. */
export function localClock(now: Date, timeZone: string): LocalClock {
  const zone = isValidTimeZone(timeZone) ? timeZone : "UTC";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "00";
  const date = `${part("year")}-${part("month")}-${part("day")}`;
  return { date, hour: Number(part("hour")), week: isoWeek(date) };
}

/**
 * Claims the (scope, channel, period) slot. Returns the delivery row id, or
 * null when another run already sent it, holds a fresh claim, or the retries
 * are used up.
 */
export async function claimDelivery(
  db: Database,
  input: InsightScope & {
    channel: DeliveryChannel;
    periodKey: string;
    /** Insights, or #97 reminders (`reminder:<item>:<date>`, rule `preventive.<item>`). */
    insights: readonly { id: string; ruleId: string; ruleVersion: string }[];
    now: Date;
  },
): Promise<number | null> {
  const values = {
    insightIds: input.insights.map((insight) => insight.id),
    ruleVersions: input.insights.map((insight) => `${insight.ruleId}@${insight.ruleVersion}`),
  };
  const [inserted] = await db
    .insert(insightDelivery)
    .values({
      organizationId: input.organizationId,
      userId: input.userId,
      channel: input.channel,
      periodKey: input.periodKey,
      ...values,
      status: "claimed",
      claimedAt: input.now,
    })
    .onConflictDoNothing()
    .returning({ id: insightDelivery.id });
  if (inserted) return inserted.id;

  const staleBefore = new Date(input.now.getTime() - STALE_CLAIM_MS);
  const reclaimed = await db
    .update(insightDelivery)
    .set({
      status: "claimed",
      attempts: sql`${insightDelivery.attempts} + 1`,
      claimedAt: input.now,
      ...values,
      errorCode: null,
    })
    .where(
      and(
        eq(insightDelivery.organizationId, input.organizationId),
        eq(insightDelivery.userId, input.userId),
        eq(insightDelivery.channel, input.channel),
        eq(insightDelivery.periodKey, input.periodKey),
        lt(insightDelivery.attempts, MAX_DELIVERY_ATTEMPTS),
        or(
          eq(insightDelivery.status, "failed"),
          and(eq(insightDelivery.status, "claimed"), lt(insightDelivery.claimedAt, staleBefore)),
        ),
      ),
    )
    .returning({ id: insightDelivery.id });
  return reclaimed[0]?.id ?? null;
}

export async function completeDelivery(
  db: Database,
  id: number,
  outcome: { status: "sent"; at: Date } | { status: "failed"; errorCode: string },
): Promise<void> {
  await db
    .update(insightDelivery)
    .set(
      outcome.status === "sent"
        ? { status: "sent", sentAt: outcome.at, errorCode: null }
        : { status: "failed", errorCode: outcome.errorCode.slice(0, 64) },
    )
    .where(eq(insightDelivery.id, id));
}

/** Insight ids already sent to this person on a channel (the dedupe set). */
export async function deliveredInsightIds(
  db: Database,
  scope: InsightScope,
  channel: DeliveryChannel,
): Promise<Set<string>> {
  const result = await db.execute<{ id: string }>(sql`
    select distinct unnest(insight_ids) as id
      from insight_delivery
     where organization_id = ${scope.organizationId}
       and user_id = ${scope.userId}
       and channel = ${channel}
       and status = 'sent'
  `);
  return new Set(result.rows.map((row) => row.id));
}

/**
 * Sends one generic push to every phone the person registered. Tokens the
 * provider reports as unregistered are removed. Returns `sent` when at least
 * one phone accepted it.
 */
export async function sendGenericPush(
  db: Database,
  push: PushProvider,
  input: {
    userId: string;
    topic: InsightTopic | null;
    showTopic: boolean;
    path: string;
    /** The recipient's language (#231). */
    locale: Locale;
    /** Fixed generic text from a reviewed template (#97 reminders); overrides the insight text. */
    content?: InsightPushContent;
  },
): Promise<{ status: "sent" } | { status: "failed"; errorCode: string } | { status: "no_device" }> {
  const devices = await db
    .select({ token: pushDevice.expoPushToken })
    .from(pushDevice)
    .where(eq(pushDevice.userId, input.userId));
  if (devices.length === 0) return { status: "no_device" };
  const content =
    input.content ?? insightPushContent(serverI18n(input.locale), input.topic, input.showTopic);
  const tickets = await push.send({
    to: devices.map((device) => device.token),
    title: content.title,
    body: content.body,
    path: input.path,
  });
  const gone = tickets.filter((ticket) => ticket.status === "unregistered").map((t) => t.token);
  if (gone.length > 0)
    await db
      .delete(pushDevice)
      .where(and(eq(pushDevice.userId, input.userId), inArray(pushDevice.expoPushToken, gone)));
  if (tickets.some((ticket) => ticket.status === "ok")) return { status: "sent" };
  const firstError = tickets.find((ticket) => ticket.status === "error");
  return {
    status: "failed",
    errorCode:
      firstError && firstError.status === "error" && firstError.errorName
        ? firstError.errorName
        : gone.length > 0
          ? "DeviceNotRegistered"
          : "PUSH_NOT_ACCEPTED",
  };
}

export type InsightDeliveryDeps = {
  db: Database;
  logger: StructuredLogger;
  correlationId: string;
  now: Date;
  push: PushProvider | null;
  email: EmailService | null;
  /** True only when email is actually delivered (not dry-run). */
  emailConfigured: boolean;
  /** Web app origin for links in the email; email is skipped without it. */
  webOrigin: string | undefined;
  /** Key for one-step unsubscribe tokens; email is skipped without it. */
  unsubscribeKey: Buffer | null;
  displaySettings?: ProductDisplaySettings | null;
  /**
   * Issue #231 — how to find each person's language. Defaults to their saved
   * preference in `db`; tests inject a fake.
   */
  locales?: Pick<MessageLocales, "forUser">;
};

/**
 * The person's language, read at most once per person and only when a
 * message is about to go out. English when unset or when the lookup fails.
 */
export function lazyRecipientLocale(
  deps: Pick<InsightDeliveryDeps, "db" | "locales">,
  userId: string,
): () => Promise<Locale> {
  const locales = deps.locales ?? databaseMessageLocales(deps.db);
  let pending: Promise<Locale> | null = null;
  return () => (pending ??= localeOrEnglish(locales.forUser(userId)));
}

export type InsightDeliveryResult = {
  candidates: number;
  pushSent: number;
  emailSent: number;
  /** Nothing to send, not yet in the window, or already sent this period. */
  skipped: number;
  failed: number;
};

type Candidate = {
  organization_id: string;
  user_id: string;
  email: string;
  push_enabled: boolean;
  push_show_topic: boolean;
  email_enabled: boolean;
  delivery_hour: number;
  time_zone: string;
  disabled_channels: string[];
};

/**
 * Worklist from the data: people with push or email on, who own the
 * workspace, are still a member (the FK cascades on removal) and are not
 * banned. Ordered for deterministic runs.
 */
async function listCandidates(db: Database): Promise<Candidate[]> {
  const result = await db.execute<Candidate>(sql`
    select p.organization_id, p.user_id, u.email, p.push_enabled, p.push_show_topic,
           p.email_enabled, p.delivery_hour, p.time_zone, p.disabled_channels
      from insight_preference p
      join member m on m.organization_id = p.organization_id and m.user_id = p.user_id
      join "user" u on u.id = p.user_id
     where (p.push_enabled or p.email_enabled)
       and m.role = 'owner'
       and coalesce(u.banned, false) = false
     order by p.organization_id, p.user_id
  `);
  return result.rows;
}

/** Runs one delivery pass over every opted-in person. Never throws for one person. */
export async function runInsightDelivery(
  deps: InsightDeliveryDeps,
): Promise<InsightDeliveryResult> {
  const { db, logger, correlationId, now } = deps;
  const service = createInsightService({ db, now: () => now });
  const result: InsightDeliveryResult = {
    candidates: 0,
    pushSent: 0,
    emailSent: 0,
    skipped: 0,
    failed: 0,
  };

  for (const candidate of await listCandidates(db)) {
    result.candidates += 1;
    const scope: InsightScope = {
      organizationId: candidate.organization_id,
      userId: candidate.user_id,
    };
    const log = { correlationId, organizationId: scope.organizationId, userId: scope.userId };
    const recipientLocale = lazyRecipientLocale(deps, scope.userId);
    try {
      const clock = localClock(now, candidate.time_zone);
      if (clock.hour < candidate.delivery_hour) {
        result.skipped += 1;
        continue;
      }
      const output = await service.compute(scope, { weight: true, goals: true });
      if (output === null) {
        result.skipped += 1;
        logger.info("insights.delivery.skipped", { ...log, reason: "adults_only" });
        continue;
      }
      const channels = channelsFromDisabled(candidate.disabled_channels);
      const feedback = await service.readFeedback(scope);

      // ── push: at most one per local day ──
      if (candidate.push_enabled && deps.push) {
        const sent = await deliveredInsightIds(db, scope, "push");
        const fresh = selectInsights(output.insights, {
          channel: "push",
          channels,
          feedback,
          now,
        }).insights.filter((insight) => !sent.has(insight.id));
        if (fresh.length === 0) {
          result.skipped += 1;
        } else {
          const claim = await claimDelivery(db, {
            ...scope,
            channel: "push",
            periodKey: clock.date,
            insights: fresh,
            now,
          });
          if (claim === null) {
            result.skipped += 1;
          } else {
            try {
              const outcome = await sendGenericPush(db, deps.push, {
                userId: scope.userId,
                topic: fresh[0]!.topic,
                showTopic: candidate.push_show_topic,
                path: "/",
                locale: await recipientLocale(),
              });
              if (outcome.status === "sent") {
                await completeDelivery(db, claim, { status: "sent", at: now });
                result.pushSent += 1;
                logger.info("insights.delivery.sent", {
                  ...log,
                  channel: "push",
                  insights: fresh.length,
                });
              } else {
                const errorCode = outcome.status === "no_device" ? "NO_DEVICE" : outcome.errorCode;
                await completeDelivery(db, claim, { status: "failed", errorCode });
                result.failed += 1;
                logger.warn("insights.delivery.failed", { ...log, channel: "push", errorCode });
              }
            } catch (error) {
              const summary = describePushDeliveryError(error);
              await completeDelivery(db, claim, { status: "failed", errorCode: summary.errorCode });
              result.failed += 1;
              logger.warn("insights.delivery.failed", { ...log, channel: "push", ...summary });
            }
          }
        }
      }

      // ── email: one weekly summary ──
      if (
        candidate.email_enabled &&
        candidate.email !== "" &&
        deps.email &&
        deps.emailConfigured &&
        deps.webOrigin &&
        deps.unsubscribeKey
      ) {
        const unsubscribeKey = deps.unsubscribeKey;
        const sent = await deliveredInsightIds(db, scope, "email");
        const fresh = selectInsights(output.insights, {
          channel: "email",
          channels,
          feedback,
          now,
          changeCap: EMAIL_CHANGE_CAP,
        }).insights.filter((insight) => !sent.has(insight.id));
        if (fresh.length === 0) {
          result.skipped += 1;
        } else {
          const claim = await claimDelivery(db, {
            ...scope,
            channel: "email",
            periodKey: clock.week,
            insights: fresh,
            now,
          });
          if (claim === null) {
            result.skipped += 1;
          } else {
            const token = emailUnsubscribeToken(unsubscribeKey, scope);
            await db
              .update(insightPreference)
              .set({ emailUnsubscribeTokenHash: hashUnsubscribeToken(token) })
              .where(
                and(
                  eq(insightPreference.organizationId, scope.organizationId),
                  eq(insightPreference.userId, scope.userId),
                ),
              );
            const unsubscribeUrl = `${deps.webOrigin}/unsubscribe?token=${token}`;
            const locale = await recipientLocale();
            const i18n = serverI18n(locale);
            const rendered = renderInsightsDigestEmail(
              {
                subject: i18n._(INSIGHT_EMAIL_COPY.subject),
                title: i18n._(INSIGHT_EMAIL_COPY.title),
                intro: i18n._(INSIGHT_EMAIL_COPY.intro),
                emptyText: i18n._(INSIGHT_EMAIL_COPY.none),
                items: fresh.map((insight) => {
                  const view = insightView(i18n, insight, deps.displaySettings);
                  return {
                    title: view.title,
                    lines: [
                      view.body,
                      view.certaintyText,
                      view.coverageText,
                      view.factorsText,
                    ].filter((line): line is string => line !== null),
                  };
                }),
                appUrl: `${deps.webOrigin}/dashboard`,
                appLabel: i18n._(INSIGHT_EMAIL_COPY.manage),
                unsubscribeUrl,
                unsubscribeLabel: i18n._(INSIGHT_EMAIL_COPY.unsubscribe),
                footer: i18n._(INSIGHT_EMAIL_COPY.footer),
              },
              { locale },
            );
            try {
              await deps.email.sendEmail(
                {
                  to: candidate.email,
                  subject: rendered.subject,
                  html: rendered.html,
                  text: rendered.text,
                  templateName: "insights-digest",
                  tags: ["insights-digest"],
                  headers: { "List-Unsubscribe": `<${unsubscribeUrl}>` },
                },
                { correlationId },
              );
              await completeDelivery(db, claim, { status: "sent", at: now });
              result.emailSent += 1;
              logger.info("insights.delivery.sent", {
                ...log,
                channel: "email",
                insights: fresh.length,
              });
            } catch (error) {
              const summary = describeEmailDeliveryError(error);
              await completeDelivery(db, claim, { status: "failed", errorCode: summary.errorCode });
              result.failed += 1;
              logger.warn("insights.delivery.failed", { ...log, channel: "email", ...summary });
            }
          }
        }
      }
    } catch (error) {
      // Per-person isolation: one failure never stops the others.
      result.failed += 1;
      logger.error("insights.delivery.person_failed", {
        ...log,
        category: error instanceof Error ? error.name : "Error",
      });
    }
  }

  logger.info("insights.delivery.completed", { correlationId, ...result });
  return result;
}
