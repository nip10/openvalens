import type { Database } from "@openhealth/db";
import { telegramWebhookEvent } from "@openhealth/db/schema/integrations";
import { eq } from "drizzle-orm";

/**
 * Webhook update dedupe (Issue #14).
 *
 * Telegram retries webhook deliveries, so every update is claimed exactly once
 * via the unique index on `telegram_webhook_event.telegram_update_id`
 * (`telegram_webhook_event_telegram_update_id_key`). The index already exists in
 * the ported schema — no migration is required.
 */

/** An existing in-flight claim older than this is treated as stale. */
export const STALE_WEBHOOK_WINDOW_MS = 24 * 60 * 60 * 1000;

export type ClaimWebhookUpdateResult = {
  /** `true` when this call inserted the claim and owns processing. */
  claimed: boolean;
  /** `true` when an existing unprocessed claim is older than the stale window. */
  stale: boolean;
};

/**
 * Claims a Telegram update id.
 *
 * - First delivery inserts a `processing` row → `{ claimed: true, stale: false }`.
 * - A replay of a row already claimed → `{ claimed: false, stale: false }`.
 * - A replay whose existing claim is older than {@link STALE_WEBHOOK_WINDOW_MS}
 *   → `{ claimed: false, stale: true }` (the caller may choose to reprocess).
 */
export async function claimWebhookUpdate(
  db: Database,
  telegramUpdateId: number,
  _payload?: unknown,
): Promise<ClaimWebhookUpdateResult> {
  const now = new Date();

  const inserted = await db
    .insert(telegramWebhookEvent)
    .values({
      telegramUpdateId,
      status: "processing",
      claimedAt: now.toISOString(),
    })
    .onConflictDoNothing()
    .returning({ id: telegramWebhookEvent.id });

  if (inserted.length === 1) {
    return { claimed: true, stale: false };
  }

  const existing = await db
    .select({
      id: telegramWebhookEvent.id,
      status: telegramWebhookEvent.status,
      claimedAt: telegramWebhookEvent.claimedAt,
    })
    .from(telegramWebhookEvent)
    .where(eq(telegramWebhookEvent.telegramUpdateId, telegramUpdateId))
    .limit(1);

  const row = existing[0];
  if (!row) {
    // Lost the insert race and the row is already gone (e.g. released) — treat
    // as an idempotent replay rather than reprocessing.
    return { claimed: false, stale: false };
  }

  if (row.status === "processed") {
    return { claimed: false, stale: false };
  }

  const claimedAtMs = row.claimedAt ? Date.parse(row.claimedAt) : Number.NaN;
  if (Number.isNaN(claimedAtMs)) {
    return { claimed: false, stale: true };
  }

  return { claimed: false, stale: now.getTime() - claimedAtMs > STALE_WEBHOOK_WINDOW_MS };
}

/** Marks a claimed update as processed. */
export async function markWebhookUpdateProcessed(
  db: Database,
  telegramUpdateId: number,
): Promise<void> {
  await db
    .update(telegramWebhookEvent)
    .set({ status: "processed", processedAt: new Date().toISOString() })
    .where(eq(telegramWebhookEvent.telegramUpdateId, telegramUpdateId));
}

/**
 * Releases a claim so a failed processing attempt can be retried by Telegram.
 * Best-effort: a failure here is swallowed by the caller.
 */
export async function releaseWebhookUpdateClaim(
  db: Database,
  telegramUpdateId: number,
): Promise<void> {
  await db
    .delete(telegramWebhookEvent)
    .where(eq(telegramWebhookEvent.telegramUpdateId, telegramUpdateId));
}
