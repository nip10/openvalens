import type { Database } from "@openvalens/db";
import { member, user } from "@openvalens/db/schema/auth";
import { insightPreference } from "@openvalens/db/schema/insights";
import {
  dailyReminder,
  dailyReminderEmailDigest,
  telegramAccount,
} from "@openvalens/db/schema/integrations";
import { organization } from "@openvalens/db/schema/auth";
import type { EmailService } from "@openvalens/email";
import { renderDailyReminderEmail } from "@openvalens/email/templates/daily-reminder";
import {
  databaseMessageLocales,
  localeOrEnglish,
  type MessageLocales,
} from "@openvalens/i18n/server";
import type { StructuredLogger } from "@openvalens/observability";
import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";

import type { TelegramClient } from "./client";
import {
  earliestDeliverableDate,
  reminderEmailOptedIn,
  usersWithModuleHidden,
} from "./reminder-materialization";
import { isReminderDeliverable, localClockIn } from "./reminder-schedule";

/**
 * Daily reminder delivery (Issues #14, #125).
 *
 * The rows are created first by `createDueDailyReminders`
 * (`reminder-materialization.ts`), which turns each opted-in member's due
 * supplements, medications and scheduled events into `daily_reminder` rows
 * for their local date once their local reminder hour has arrived. The
 * `remindersDailyRun` cron runs hourly and does both, per organization:
 * create, then deliver.
 *
 * For every `daily_reminder` row in {@link organizationId} that is still
 * `status = 'pending'`, has no recorded delivery (`telegram_message_id` is
 * `NULL`), is dated the member's current local date (time zone from
 * `insight_preference.time_zone`, UTC fallback) and whose local reminder hour
 * (`insight_preference.daily_reminder_hour`, default 8) has arrived, the
 * function delivers:
 *
 * - via Telegram to the user's active chat for {@link organizationId}, when
 *   a bot is configured and the user still has a chat, is a current member
 *   and is not banned; or
 * - else by email, only when the user turned on "Daily reminders by email"
 *   (`insight_preference.daily_reminder_email`, off by default) and has an
 *   email on file. Otherwise the reminder is skipped and stays pending.
 *
 * Stale policy: rows dated before the member's local today are never sent
 * (they stay `pending`, undelivered), so an outage or a long-unreachable
 * channel cannot produce a burst of days-old reminders. A failed send is
 * retried by the next hourly run, the same local day only.
 *
 * Recipient authorization (`is_member` + `not_banned`) and channel resolution
 * (`telegram_account.organization_id = ?` + email fallback) are tenant-safe
 * by construction: every query is bound to {@link organizationId}.
 *
 * The `daily_reminder.status` enum is owned by the reaction webhook
 * (✅ → `done`, ⏸/❌ → `skipped`). Delivery writes *only* to
 * `telegram_message_id` so the user's reaction state remains the source of
 * truth and downstream consumers (e.g. timeline adherence) do not observe a
 * delivered-but-unacted reminder as `done`.
 *
 * Idempotency is row-level: each reminder's delivery is wrapped in a
 * `BEGIN → SELECT … FOR UPDATE SKIP LOCKED (one row, re-checking the
 * pending+null predicate) → send → UPDATE telegram_message_id → COMMIT`
 * cycle. Concurrent crons cannot both claim the same row; replays of the
 * same cron skip rows whose `telegram_message_id` is already set. Crash
 * blast radius is therefore one row.
 */

/** Sentinel `telegram_message_id` marking an email-delivered reminder. */
export const EMAIL_DELIVERED_TELEGRAM_MESSAGE_ID = -2;

/** Issue #231 — rendered in the member's language. */

/** Diagnostic reasons recorded in log lines and counted in results. */
export type MaterializeSkipReason =
  | "telegram_client_unconfigured"
  | "no_telegram_chat_or_email"
  | "email_not_opted_in"
  | "recipient_not_member"
  | "recipient_banned";

export type MaterializeDailyRemindersDeps = {
  db: Database;
  client: TelegramClient | null;
  logger: StructuredLogger;
  correlationId: string;
  /**
   * Organization the run is bound to. `materializeDailyReminders` selects
   * reminders strictly within this organization; the cron iterates the
   * materializer once per active org to fan out across tenants.
   */
  organizationId: string;
  /** The run's clock (tests pin it); defaults to now. */
  now?: Date;
  /** Live delivery clock, independent of the shared cron scheduling timestamp. */
  attemptNow?: () => Date;
  /** Config-bound email transport; required. */
  email: EmailService;
  /**
   * Issue #231 — how to find the member's language for the email fallback.
   * Defaults to their saved preference in `db`; tests inject a fake.
   */
  locales?: Pick<MessageLocales, "forUser">;
};

export type MaterializeDailyRemindersResult = {
  organizationId: string;
  /** Reminders that received at least one external send (Telegram or email). */
  sent: number;
  /**
   * Recipient- or channel-side skips. Counted but not delivered: the row's
   * `status` is left untouched.
   */
  skipped: number;
  /** External sends that failed (provider exception or non-`ok` response). */
  failed: number;
};

function typedErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(code)) {
      return code;
    }
  }

  return "UNKNOWN_SEND";
}

function accountReminderIds(accounted: Set<number>, reminderIds: readonly number[]): number {
  let count = 0;
  for (const reminderId of reminderIds) {
    if (accounted.has(reminderId)) continue;
    accounted.add(reminderId);
    count += 1;
  }
  return count;
}

function groupReminderIdsByUser(rows: readonly PendingSelectionRow[]): Map<string, number[]> {
  const grouped = new Map<string, number[]>();
  for (const row of rows) {
    const ids = grouped.get(row.userId) ?? [];
    ids.push(row.id);
    grouped.set(row.userId, ids);
  }
  return grouped;
}

type PendingSelectionRow = {
  id: number;
  userId: string;
  date: string;
  label: string;
  sourceType: "supplement" | "medication" | "activity";
};

/**
 * Materializes and delivers one organization's pending reminders. Returns
 * delivery counts; never throws for a single failed reminder (counted in
 * `failed`) and never throws for a per-recipient skip.
 *
 * Concurrency-safe: every external send is wrapped in a per-row short
 * transaction guarded by `FOR UPDATE SKIP LOCKED`, so concurrent crons or
 * replayed runs cannot double-deliver the same slot.
 */
export async function materializeDailyReminders(
  deps: MaterializeDailyRemindersDeps,
): Promise<MaterializeDailyRemindersResult> {
  const { db, client, logger, correlationId, organizationId, email } = deps;
  const locales = deps.locales ?? databaseMessageLocales(db);
  const now = deps.now ?? new Date();
  const attemptNow = deps.attemptNow ?? (() => new Date());

  // Read-only prefetch. Every query is tenant-scoped to `organizationId`.
  // Rows older than any member's local today are stale and never read.
  const candidates = (await db
    .select({
      id: dailyReminder.id,
      userId: dailyReminder.userId,
      date: dailyReminder.date,
      label: dailyReminder.label,
      sourceType: dailyReminder.sourceType,
    })
    .from(dailyReminder)
    .where(
      and(
        eq(dailyReminder.organizationId, organizationId),
        eq(dailyReminder.status, "pending"),
        isNull(dailyReminder.telegramMessageId),
        gte(dailyReminder.date, earliestDeliverableDate(now)),
      ),
    )) as PendingSelectionRow[];

  // Only the member's local today, and only from their reminder hour.
  const candidateUserIds = [...new Set(candidates.map((row) => row.userId))];
  const schedulePrefs =
    candidateUserIds.length === 0
      ? []
      : await db
          .select({
            userId: insightPreference.userId,
            timeZone: insightPreference.timeZone,
            reminderHour: insightPreference.dailyReminderHour,
          })
          .from(insightPreference)
          .where(
            and(
              eq(insightPreference.organizationId, organizationId),
              inArray(insightPreference.userId, candidateUserIds),
            ),
          );
  const prefsByUser = new Map(schedulePrefs.map((row) => [row.userId, row]));
  // Onboarding stage 1: rows made before the member hid supplements stay
  // pending and unsent (nothing is deleted).
  const supplementsHidden = await usersWithModuleHidden(db, candidateUserIds, "supplements");
  const pending = candidates.filter((row) => {
    if (
      (row.sourceType === "supplement" || row.sourceType === "medication") &&
      supplementsHidden.has(row.userId)
    )
      return false;
    const prefs = prefsByUser.get(row.userId);
    return isReminderDeliverable(row.date, localClockIn(now, prefs?.timeZone), prefs?.reminderHour);
  });

  if (pending.length === 0) {
    const recovered = await runEmailDigests({
      db,
      email,
      locales,
      logger,
      correlationId,
      organizationId,
      now,
      attemptNow,
      candidateUsers: [],
      clientAvailable: client !== null,
      candidateReminderIdsByUser: new Map(),
      accountedReminderIds: new Set(),
    });
    logger.info("telegram.materialize.completed", {
      correlationId,
      organizationId,
      sent: recovered.sent,
      skipped: recovered.skipped,
      failed: recovered.failed,
    });

    return { organizationId, ...recovered };
  }

  const userIds = [...new Set(pending.map((row) => row.userId))];

  // Membership: derived from the same-org `member` rows, scoped to the
  // distinct user ids in the pending set. The FK to `member (organization_id,
  // user_id) ON DELETE RESTRICT` prevents the "removed member, live
  // reminder" state in practice; this is defense-in-depth for any legacy
  // rows written before that FK existed.
  const memberRows = await db
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), inArray(member.userId, userIds)));
  const memberUserIds = new Set(memberRows.map((row) => row.userId));

  // Telegram channel resolution: org-scoped, status active.
  const accounts = await db
    .select({ userId: telegramAccount.userId, chatId: telegramAccount.telegramChatId })
    .from(telegramAccount)
    .where(
      and(
        eq(telegramAccount.organizationId, organizationId),
        eq(telegramAccount.status, "active"),
        inArray(telegramAccount.userId, userIds),
      ),
    );
  const chatIdByUser = new Map(accounts.map((account) => [account.userId, account.chatId]));

  // Email is used only for members who turned on "Daily reminders by email"
  // (off by default): each email names the item.
  const emailOptInUserIds = new Set(
    (
      await db
        .select({ userId: insightPreference.userId })
        .from(insightPreference)
        .where(
          and(
            eq(insightPreference.organizationId, organizationId),
            inArray(insightPreference.userId, userIds),
            reminderEmailOptedIn(),
          ),
        )
    ).map((row) => row.userId),
  );

  // Recipient profile: the banned flag applies to every channel; the email
  // is only a fallback channel when one is on file.
  const userRows = await db
    .select({ id: user.id, email: user.email, banned: user.banned })
    .from(user)
    .where(inArray(user.id, userIds));
  const bannedUserIds = new Set(userRows.filter((row) => row.banned).map((row) => row.id));
  const emailByUser = new Map(
    userRows.filter((row) => row.email !== "").map((row) => [row.id, row.email]),
  );

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  const emailUsers = new Set<string>();
  const accountedReminderIds = new Set<number>();

  for (const reminder of pending) {
    // Per-recipient authorization — keep this strictly inside the per-org
    // scope. Skip without sending; do not mutate the reminder row.
    const skipReason: MaterializeSkipReason | null = !memberUserIds.has(reminder.userId)
      ? "recipient_not_member"
      : bannedUserIds.has(reminder.userId)
        ? "recipient_banned"
        : null;
    if (skipReason) {
      skipped += accountReminderIds(accountedReminderIds, [reminder.id]);
      logger.info("telegram.materialize.skipped", {
        correlationId,
        organizationId,
        date: reminder.date,
        reminderId: reminder.id,
        reason: skipReason,
      });
      continue;
    }

    // Telegram in this org first, else the email fallback.
    const chatId = chatIdByUser.get(reminder.userId);
    const recipientEmail = emailByUser.get(reminder.userId);
    let channel: "telegram";
    let send: () => Promise<number | null>;
    if (chatId && client) {
      channel = "telegram";
      send = async () => {
        const response = await client.sendMessage(chatId, reminder.label);
        return response.ok && response.result && typeof response.result.message_id === "number"
          ? response.result.message_id
          : null;
      };
    } else if (recipientEmail && emailOptInUserIds.has(reminder.userId)) {
      emailUsers.add(reminder.userId);
      continue;
    } else {
      skipped += accountReminderIds(accountedReminderIds, [reminder.id]);
      logger.warn("telegram.materialize.skipped", {
        correlationId,
        organizationId,
        date: reminder.date,
        reminderId: reminder.id,
        reason: chatId
          ? "telegram_client_unconfigured"
          : recipientEmail
            ? "email_not_opted_in"
            : "no_telegram_chat_or_email",
      });
      continue;
    }

    const result = await deliverOnce({ db, reminderId: reminder.id, organizationId, send });
    if (result.outcome === "sent") {
      sent += accountReminderIds(accountedReminderIds, [reminder.id]);
    } else if (result.outcome === "skipped") {
      // A sibling run holds or already delivered this slot; it owns delivery.
      skipped += accountReminderIds(accountedReminderIds, [reminder.id]);
    } else if (result.outcome === "reserved") {
      // A committed digest owns this reminder; its recovery pass counts it.
      continue;
    } else {
      failed += accountReminderIds(accountedReminderIds, [reminder.id]);
      logger.warn("telegram.materialize.delivery_failed", {
        correlationId,
        organizationId,
        date: reminder.date,
        reminderId: reminder.id,
        channel,
        errorCode: result.errorCode,
      });
    }
  }

  // Recovery is deliberately independent of current candidates: a digest is
  // committed before transport, and must be retried after a process crash.
  const emailResult = await runEmailDigests({
    db,
    email,
    locales,
    logger,
    correlationId,
    organizationId,
    now,
    attemptNow,
    candidateUsers: [...new Set([...emailUsers, ...userIds])],
    clientAvailable: client !== null,
    candidateReminderIdsByUser: groupReminderIdsByUser(pending),
    accountedReminderIds,
  });
  sent += emailResult.sent;
  skipped += emailResult.skipped;
  failed += emailResult.failed;

  logger.info("telegram.materialize.completed", {
    correlationId,
    organizationId,
    sent,
    skipped,
    failed,
  });

  return { organizationId, sent, skipped, failed };
}

type DeliverResult =
  | { outcome: "sent" }
  | { outcome: "skipped" }
  | { outcome: "reserved" }
  | { outcome: "failed"; errorCode: string };

/**
 * Deliver one reminder exactly once across concurrent runs: lock the row with
 * `FOR UPDATE SKIP LOCKED` (re-checking the pending + undelivered predicate),
 * send while holding the lock, then record the delivery id. A failed send
 * records nothing, so the row stays pending for the next run.
 */
async function deliverOnce(input: {
  db: Database;
  reminderId: number;
  organizationId: string;
  /** Returns the id to record in `telegram_message_id`, or `null` when not sent. */
  send: () => Promise<number | null>;
}): Promise<DeliverResult> {
  const { db, reminderId, organizationId, send } = input;

  return db.transaction(async (tx): Promise<DeliverResult> => {
    const [row] = await tx
      .select({ id: dailyReminder.id })
      .from(dailyReminder)
      .where(
        and(
          eq(dailyReminder.organizationId, organizationId),
          eq(dailyReminder.id, reminderId),
          eq(dailyReminder.status, "pending"),
          isNull(dailyReminder.telegramMessageId),
        ),
      )
      .for("update", { skipLocked: true })
      .limit(1);

    if (!row) return { outcome: "skipped" };

    // The row lock alone does not serialize with digest preparation: email
    // reserves by locking the same candidate rows and committing a snapshot.
    // This fresh query runs after the lock and observes any committed claim.
    const [reservation] = await tx
      .select({ id: dailyReminderEmailDigest.id })
      .from(dailyReminderEmailDigest)
      .where(sql`${dailyReminderEmailDigest.organizationId} = ${organizationId}
        and ${dailyReminderEmailDigest.userId} = (select user_id from daily_reminder where id = ${reminderId})
        and ${dailyReminderEmailDigest.date} = (select date from daily_reminder where id = ${reminderId})
        and ${reminderId} = any(${dailyReminderEmailDigest.reminderIds})`)
      .limit(1);
    if (reservation) return { outcome: "reserved" };

    let telegramMessageId: number | null;
    try {
      telegramMessageId = await send();
    } catch (error) {
      return { outcome: "failed", errorCode: typedErrorCode(error) };
    }
    if (telegramMessageId === null) return { outcome: "failed", errorCode: "NOT_OK" };

    await tx
      .update(dailyReminder)
      .set({ telegramMessageId })
      .where(
        and(eq(dailyReminder.organizationId, organizationId), eq(dailyReminder.id, reminderId)),
      );

    return { outcome: "sent" };
  });
}

async function runEmailDigests(input: {
  db: Database;
  email: EmailService;
  locales: Pick<MessageLocales, "forUser">;
  logger: StructuredLogger;
  correlationId: string;
  organizationId: string;
  now: Date;
  attemptNow: () => Date;
  candidateUsers: string[];
  clientAvailable: boolean;
  candidateReminderIdsByUser: Map<string, number[]>;
  accountedReminderIds: Set<number>;
}): Promise<{ sent: number; skipped: number; failed: number }> {
  const {
    db,
    email,
    locales,
    logger,
    correlationId,
    organizationId,
    attemptNow,
    clientAvailable,
    accountedReminderIds,
  } = input;
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  const datesUsers = new Set(input.candidateUsers);

  // Candidate preparation is serialized by a stable, namespace-prefixed,
  // unambiguous key. Existing snapshots are never re-rendered.
  for (const userId of datesUsers) {
    let failureReminderIds = input.candidateReminderIdsByUser.get(userId) ?? [];
    try {
      await db.transaction(async (tx) => {
        const [profile] = await tx
          .select({
            email: user.email,
            banned: user.banned,
            orgName: organization.name,
            timeZone: insightPreference.timeZone,
            reminderHour: insightPreference.dailyReminderHour,
            optedIn: insightPreference.dailyReminderEmail,
          })
          .from(user)
          .innerJoin(member, eq(member.userId, user.id))
          .innerJoin(organization, eq(organization.id, member.organizationId))
          .leftJoin(
            insightPreference,
            and(
              eq(insightPreference.userId, user.id),
              eq(insightPreference.organizationId, organizationId),
            ),
          )
          .where(and(eq(member.organizationId, organizationId), eq(user.id, userId)))
          .limit(1);
        if (!profile || profile.banned || !profile.optedIn || !profile.email) return;
        const preparedAt = attemptNow();
        const clock = localClockIn(preparedAt, profile.timeZone);
        if (clock.hour < (profile.reminderHour ?? 8)) return;
        const date = clock.date;
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(
          ${`daily_reminder_email_digest|${organizationId.length}:${organizationId}|${userId.length}:${userId}|${date}`}, 0))`);
        const [existing] = await tx
          .select({ id: dailyReminderEmailDigest.id })
          .from(dailyReminderEmailDigest)
          .where(
            and(
              eq(dailyReminderEmailDigest.organizationId, organizationId),
              eq(dailyReminderEmailDigest.userId, userId),
              eq(dailyReminderEmailDigest.date, date),
            ),
          )
          .limit(1);
        if (existing) return;
        if (clientAvailable) {
          const [active] = await tx
            .select({ id: telegramAccount.id })
            .from(telegramAccount)
            .where(
              and(
                eq(telegramAccount.organizationId, organizationId),
                eq(telegramAccount.userId, userId),
                eq(telegramAccount.status, "active"),
              ),
            )
            .limit(1);
          if (active) return;
        }
        const [legacyEmail] = await tx
          .select({ id: dailyReminder.id })
          .from(dailyReminder)
          .where(
            and(
              eq(dailyReminder.organizationId, organizationId),
              eq(dailyReminder.userId, userId),
              eq(dailyReminder.date, date),
              eq(dailyReminder.telegramMessageId, EMAIL_DELIVERED_TELEGRAM_MESSAGE_ID),
            ),
          )
          .limit(1);
        if (legacyEmail) return;
        const rows = await tx
          .select({
            id: dailyReminder.id,
            label: dailyReminder.label,
            sourceType: dailyReminder.sourceType,
          })
          .from(dailyReminder)
          .where(
            and(
              eq(dailyReminder.organizationId, organizationId),
              eq(dailyReminder.userId, userId),
              eq(dailyReminder.date, date),
              eq(dailyReminder.status, "pending"),
              isNull(dailyReminder.telegramMessageId),
            ),
          )
          .orderBy(dailyReminder.id)
          .for("update");
        if (rows.length === 0) return;
        const hidden = await usersWithModuleHidden(tx, [userId], "supplements");
        const hiddenActivity = await usersWithModuleHidden(tx, [userId], "activity");
        const eligible = rows.filter(
          (row) =>
            !(
              hidden.has(userId) &&
              (row.sourceType === "supplement" || row.sourceType === "medication")
            ) && !(hiddenActivity.has(userId) && row.sourceType === "activity"),
        );
        if (eligible.length === 0) return;
        failureReminderIds = eligible.map((row) => row.id);
        const locale = await localeOrEnglish(locales.forUser(userId));
        const rendered = await renderDailyReminderEmail(
          {
            date,
            reminders: eligible.map(({ label, sourceType }) => ({ label, sourceType })),
          },
          { locale, organizationName: profile.orgName },
        );
        const prepared = email.prepareEmail({
          to: profile.email,
          ...rendered,
          templateName: "daily-reminder",
        });
        const createdAt = attemptNow();
        const finalPreparationClock = localClockIn(createdAt, profile.timeZone);
        if (
          finalPreparationClock.date !== date ||
          finalPreparationClock.hour < (profile.reminderHour ?? 8)
        ) {
          return;
        }
        await tx.insert(dailyReminderEmailDigest).values({
          organizationId,
          userId,
          date,
          reminderIds: failureReminderIds,
          renderedEmail: prepared,
          createdAt: createdAt.toISOString(),
        });
      });
    } catch (error) {
      failed += accountReminderIds(accountedReminderIds, failureReminderIds);
      logger.warn("telegram.materialize.preparation_failed", {
        correlationId,
        organizationId,
        errorCode: typedErrorCode(error),
        count: failureReminderIds.length,
      });
    }
  }

  // Snapshot discovery is independent of current reminder candidates, so a
  // committed payload always gets another chance after a worker crash.
  const discoveryNow = attemptNow();
  const snapshots = await db
    .select({ id: dailyReminderEmailDigest.id, reminderIds: dailyReminderEmailDigest.reminderIds })
    .from(dailyReminderEmailDigest)
    .where(
      and(
        eq(dailyReminderEmailDigest.organizationId, organizationId),
        isNull(dailyReminderEmailDigest.deliveredAt),
        gte(dailyReminderEmailDigest.date, earliestDeliverableDate(discoveryNow)),
      ),
    );
  for (const { id, reminderIds } of snapshots) {
    try {
      const result = await db.transaction(async (tx) => {
        const [digest] = await tx
          .select()
          .from(dailyReminderEmailDigest)
          .where(
            and(
              eq(dailyReminderEmailDigest.id, id),
              eq(dailyReminderEmailDigest.organizationId, organizationId),
            ),
          )
          .for("update", { skipLocked: true })
          .limit(1);
        if (!digest || digest.deliveredAt)
          return { state: "skip" as const, reminderIds: [] as number[] };

        const [profile] = await tx
          .select({
            email: user.email,
            banned: user.banned,
            optedIn: insightPreference.dailyReminderEmail,
            timeZone: insightPreference.timeZone,
            reminderHour: insightPreference.dailyReminderHour,
          })
          .from(user)
          .innerJoin(member, eq(member.userId, user.id))
          .leftJoin(
            insightPreference,
            and(
              eq(insightPreference.userId, user.id),
              eq(insightPreference.organizationId, organizationId),
            ),
          )
          .where(and(eq(member.organizationId, organizationId), eq(user.id, digest.userId)))
          .limit(1);
        if (
          !profile ||
          profile.banned ||
          !profile.optedIn ||
          profile.email !==
            (Array.isArray(digest.renderedEmail.to)
              ? digest.renderedEmail.to[0]
              : digest.renderedEmail.to)
        ) {
          return { state: "skip" as const, reminderIds: digest.reminderIds };
        }
        if (clientAvailable) {
          const [active] = await tx
            .select({ id: telegramAccount.id })
            .from(telegramAccount)
            .where(
              and(
                eq(telegramAccount.organizationId, organizationId),
                eq(telegramAccount.userId, digest.userId),
                eq(telegramAccount.status, "active"),
              ),
            )
            .limit(1);
          if (active) return { state: "skip" as const, reminderIds: digest.reminderIds };
        }
        const rows = await tx
          .select({
            id: dailyReminder.id,
            sourceType: dailyReminder.sourceType,
            status: dailyReminder.status,
            telegramMessageId: dailyReminder.telegramMessageId,
          })
          .from(dailyReminder)
          .where(
            and(
              eq(dailyReminder.organizationId, organizationId),
              eq(dailyReminder.userId, digest.userId),
              eq(dailyReminder.date, digest.date),
              inArray(dailyReminder.id, digest.reminderIds),
            ),
          );
        const hidden = await usersWithModuleHidden(tx, [digest.userId], "supplements");
        const hiddenActivity = await usersWithModuleHidden(tx, [digest.userId], "activity");
        if (
          rows.length !== digest.reminderIds.length ||
          rows.some(
            (row) =>
              row.status !== "pending" ||
              row.telegramMessageId !== null ||
              (hidden.has(digest.userId) &&
                (row.sourceType === "supplement" || row.sourceType === "medication")) ||
              (hiddenActivity.has(digest.userId) && row.sourceType === "activity"),
          )
        ) {
          return { state: "skip" as const, reminderIds: digest.reminderIds };
        }

        // Recheck wall-clock policy after all awaited policy queries, immediately
        // before handing the persisted payload to the provider.
        const attemptAt = attemptNow();
        const attemptClock = localClockIn(attemptAt, profile.timeZone);
        if (
          new Date(digest.createdAt).getTime() + 23 * 60 * 60_000 <= attemptAt.getTime() ||
          attemptClock.date !== digest.date ||
          attemptClock.hour < (profile.reminderHour ?? 8)
        ) {
          return { state: "skip" as const, reminderIds: digest.reminderIds };
        }
        const sentResult = await email.sendEmail(
          {
            ...digest.renderedEmail,
            idempotencyKey: `daily-reminder-digest/${digest.id}`,
          },
          { correlationId },
        );
        if (sentResult.dryRun) return { state: "dry" as const, reminderIds: digest.reminderIds };
        await tx
          .update(dailyReminderEmailDigest)
          .set({ deliveredAt: attemptAt.toISOString(), providerMessageId: sentResult.id })
          .where(
            and(
              eq(dailyReminderEmailDigest.id, digest.id),
              isNull(dailyReminderEmailDigest.deliveredAt),
            ),
          );
        await tx
          .update(dailyReminder)
          .set({ telegramMessageId: EMAIL_DELIVERED_TELEGRAM_MESSAGE_ID })
          .where(
            and(
              eq(dailyReminder.organizationId, organizationId),
              inArray(dailyReminder.id, digest.reminderIds),
              eq(dailyReminder.status, "pending"),
              isNull(dailyReminder.telegramMessageId),
            ),
          );
        return { state: "sent" as const, reminderIds: digest.reminderIds };
      });
      if (result.state === "skip" || result.state === "dry") {
        skipped += accountReminderIds(accountedReminderIds, result.reminderIds);
      }
      if (result.state === "sent") {
        sent += accountReminderIds(accountedReminderIds, result.reminderIds);
      }
    } catch (error) {
      failed += accountReminderIds(accountedReminderIds, reminderIds);
      logger.warn("telegram.materialize.delivery_failed", {
        correlationId,
        organizationId,
        digestId: id,
        channel: "email",
        errorCode: typedErrorCode(error),
        count: reminderIds.length,
      });
    }
  }
  return { sent, skipped, failed };
}
