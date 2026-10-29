import { sql } from "@openvalens/db";
import { insightPreference } from "@openvalens/db/schema/insights";
import { describeEmailDeliveryError, renderInsightsDigestEmail } from "@openvalens/email";
import { describePushDeliveryError } from "@openvalens/push";
import { and, eq } from "drizzle-orm";

import {
  claimDelivery,
  completeDelivery,
  deliveredInsightIds,
  lazyRecipientLocale,
  localClock,
  sendGenericPush,
  type InsightDeliveryDeps,
} from "./insight-delivery";
import { channelsFromDisabled, emailUnsubscribeToken, hashUnsubscribeToken } from "./insights";
import { bandForGrade, REMINDER_BANDS } from "./preventive-care-contract";
import { isBeingReviewed } from "./preventive-care-engine";
import { findPreventiveItem, PREVENTIVE_CARE_PACK } from "./preventive-care-pack";
import { serverI18n } from "./locale";
import { REMINDER_EMAIL_COPY, reminderPushContent } from "./presenters/preventive-care";
import { deriveWellnessProfileInputs } from "./wellness-profile-contract";
import { isModuleEnabled } from "./presenters/modules";
import { createWellnessProfileService } from "./wellness-profile";

/**
 * Issue #97 — preventive-care reminders through the #92 delivery contract.
 *
 * A reminder goes out only when every one of these holds:
 * - the person set a date on an item and turned "remind me" on (per item);
 * - they turned push and/or email on for the workspace (`insight_preference`)
 *   and did not switch off `reminder:<channel>`;
 * - they own the workspace, are still a member, are not banned, confirmed
 *   they are 18 or older, and the item belongs to their current region;
 * - the item is a date-carrying kind (recommended / programme) and is not
 *   past its review date;
 * - it is on or after their local delivery hour, and the date has arrived.
 *
 * It shares the #92 claim in `insight_delivery`: at most one push per local
 * day and one email per ISO week *in total* with insights. Each reminder id is
 * `reminder:<item id>:<date>`, so one date is never sent twice on a channel.
 * The push and the email are generic ("You have a reminder") — never the item,
 * a health topic, a date or a value. Logs hold ids and counts only.
 */

export type ReminderDeliveryResult = {
  candidates: number;
  pushSent: number;
  emailSent: number;
  skipped: number;
  failed: number;
};

type ReminderCandidate = {
  organization_id: string;
  user_id: string;
  email: string;
  push_enabled: boolean;
  email_enabled: boolean;
  delivery_hour: number;
  time_zone: string;
  disabled_channels: string[];
  items: string[];
};

/** People with at least one reminder on, a channel on, owner, member, not banned. */
async function listReminderCandidates(db: InsightDeliveryDeps["db"]): Promise<ReminderCandidate[]> {
  const result = await db.execute<ReminderCandidate>(sql`
    select s.organization_id, s.user_id, u.email, p.push_enabled, p.email_enabled,
           p.delivery_hour, p.time_zone, p.disabled_channels,
           array_agg(s.item_id || '|' || to_char(s.next_on, 'YYYY-MM-DD') order by s.item_id) as items
      from preventive_care_item_state s
      join insight_preference p on p.organization_id = s.organization_id and p.user_id = s.user_id
      join member m on m.organization_id = s.organization_id and m.user_id = s.user_id
      join "user" u on u.id = s.user_id
     where s.remind
       and s.next_on is not null
       and s.plan <> 'decided_no'
       and (p.push_enabled or p.email_enabled)
       and m.role = 'owner'
       and coalesce(u.banned, false) = false
     group by s.organization_id, s.user_id, u.email, p.push_enabled, p.email_enabled,
              p.delivery_hour, p.time_zone, p.disabled_channels
     order by s.organization_id, s.user_id
  `);
  return result.rows;
}

type DueReminder = { id: string; ruleId: string; ruleVersion: string };

/** Runs one reminder pass. Never throws for one person. */
export async function runPreventiveReminderDelivery(
  deps: InsightDeliveryDeps,
): Promise<ReminderDeliveryResult> {
  const { db, logger, correlationId, now } = deps;
  const result: ReminderDeliveryResult = {
    candidates: 0,
    pushSent: 0,
    emailSent: 0,
    skipped: 0,
    failed: 0,
  };
  const profiles = createWellnessProfileService({ db, now: () => now });

  for (const candidate of await listReminderCandidates(db)) {
    result.candidates += 1;
    const scope = { organizationId: candidate.organization_id, userId: candidate.user_id };
    const log = { correlationId, organizationId: scope.organizationId, userId: scope.userId };
    const recipientLocale = lazyRecipientLocale(deps, scope.userId);
    try {
      if (
        deps.canDeliverWorkspace &&
        !(await deps.canDeliverWorkspace({
          userId: scope.userId,
          organizationId: scope.organizationId,
        }))
      ) {
        result.skipped += 1;
        logger.info("preventive.reminders.skipped", { ...log, reason: "workspace_access_ended" });
        continue;
      }
      const clock = localClock(now, candidate.time_zone);
      if (clock.hour < candidate.delivery_hour) {
        result.skipped += 1;
        continue;
      }
      const profile = await profiles.read(scope.userId);
      // Onboarding stage 1: no preventive-care reminders while the module is hidden.
      if (!isModuleEnabled(profile, "care")) {
        result.skipped += 1;
        logger.info("preventive.reminders.skipped", { ...log, reason: "module_hidden" });
        continue;
      }
      const inputs = deriveWellnessProfileInputs(profile, now);
      if (!inputs.adultConfirmed || !inputs.region.available) {
        result.skipped += 1;
        logger.info("preventive.reminders.skipped", { ...log, reason: "profile" });
        continue;
      }
      const region = inputs.region.value;
      const due: DueReminder[] = [];
      for (const entry of candidate.items) {
        const [itemId, nextOn] = entry.split("|") as [string, string];
        const item = findPreventiveItem(itemId, PREVENTIVE_CARE_PACK);
        if (
          !item ||
          item.region !== region ||
          !REMINDER_BANDS.includes(bandForGrade(item.grade)) ||
          isBeingReviewed(item, clock.date) ||
          nextOn > clock.date
        )
          continue;
        due.push({
          id: `reminder:${item.id}:${nextOn}`,
          ruleId: `preventive.${item.id}`,
          ruleVersion: String(item.version),
        });
      }
      if (due.length === 0) {
        result.skipped += 1;
        continue;
      }
      const channels = channelsFromDisabled(candidate.disabled_channels).reminder;

      if (candidate.push_enabled && channels.push && deps.push) {
        const sent = await deliveredInsightIds(db, scope, "push");
        const fresh = due.filter((reminder) => !sent.has(reminder.id));
        const claim =
          fresh.length === 0
            ? null
            : await claimDelivery(db, {
                ...scope,
                channel: "push",
                periodKey: clock.date,
                insights: fresh,
                now,
              });
        if (claim === null) result.skipped += 1;
        else {
          try {
            const locale = await recipientLocale();
            const outcome = await sendGenericPush(db, deps.push, {
              userId: scope.userId,
              topic: null,
              showTopic: false,
              path: "/preventive-care",
              locale,
              content: reminderPushContent(serverI18n(locale)),
            });
            if (outcome.status === "sent") {
              await completeDelivery(db, claim, { status: "sent", at: now });
              result.pushSent += 1;
              logger.info("preventive.reminders.sent", {
                ...log,
                channel: "push",
                reminders: fresh.length,
              });
            } else {
              const errorCode = outcome.status === "no_device" ? "NO_DEVICE" : outcome.errorCode;
              await completeDelivery(db, claim, { status: "failed", errorCode });
              result.failed += 1;
              logger.warn("preventive.reminders.failed", { ...log, channel: "push", errorCode });
            }
          } catch (error) {
            const summary = describePushDeliveryError(error);
            await completeDelivery(db, claim, { status: "failed", errorCode: summary.errorCode });
            result.failed += 1;
            logger.warn("preventive.reminders.failed", { ...log, channel: "push", ...summary });
          }
        }
      }

      if (
        candidate.email_enabled &&
        channels.email &&
        candidate.email !== "" &&
        deps.email &&
        deps.emailConfigured &&
        deps.webOrigin &&
        deps.unsubscribeKey
      ) {
        const sent = await deliveredInsightIds(db, scope, "email");
        const fresh = due.filter((reminder) => !sent.has(reminder.id));
        const claim =
          fresh.length === 0
            ? null
            : await claimDelivery(db, {
                ...scope,
                channel: "email",
                periodKey: clock.week,
                insights: fresh,
                now,
              });
        if (claim === null) result.skipped += 1;
        else {
          const token = emailUnsubscribeToken(deps.unsubscribeKey, scope);
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
              subject: i18n._(REMINDER_EMAIL_COPY.subject),
              title: i18n._(REMINDER_EMAIL_COPY.title),
              intro: i18n._(REMINDER_EMAIL_COPY.intro),
              emptyText: i18n._(REMINDER_EMAIL_COPY.none),
              items: [
                {
                  title: i18n._(REMINDER_EMAIL_COPY.itemTitle),
                  lines: [i18n._(REMINDER_EMAIL_COPY.itemLine)],
                },
              ],
              appUrl: `${deps.webOrigin}/preventive-care`,
              appLabel: i18n._(REMINDER_EMAIL_COPY.manage),
              unsubscribeUrl,
              unsubscribeLabel: i18n._(REMINDER_EMAIL_COPY.unsubscribe),
              footer: i18n._(REMINDER_EMAIL_COPY.footer),
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
                templateName: "preventive-reminder",
                tags: ["preventive-reminder"],
                headers: { "List-Unsubscribe": `<${unsubscribeUrl}>` },
              },
              { correlationId },
            );
            await completeDelivery(db, claim, { status: "sent", at: now });
            result.emailSent += 1;
            logger.info("preventive.reminders.sent", {
              ...log,
              channel: "email",
              reminders: fresh.length,
            });
          } catch (error) {
            const summary = describeEmailDeliveryError(error);
            await completeDelivery(db, claim, { status: "failed", errorCode: summary.errorCode });
            result.failed += 1;
            logger.warn("preventive.reminders.failed", { ...log, channel: "email", ...summary });
          }
        }
      }
    } catch (error) {
      result.failed += 1;
      logger.error("preventive.reminders.person_failed", {
        ...log,
        category: error instanceof Error ? error.name : "Error",
      });
    }
  }

  logger.info("preventive.reminders.completed", { correlationId, ...result });
  return result;
}
