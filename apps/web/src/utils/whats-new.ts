import type { WhatsNewCard } from "@openvalens/api/whats-new";

/**
 * Whether to offer this release's dialog: it has headlines for the web, and
 * the account existed before the release (a new account has nothing to catch
 * up on).
 */
export function shouldOfferWhatsNew(
  card: Pick<WhatsNewCard, "date" | "headlines"> | null | undefined,
  accountCreatedAt: Date | string | null | undefined,
): boolean {
  if (!card || card.headlines.length === 0) return false;
  if (!accountCreatedAt) return true;
  const created = new Date(accountCreatedAt);
  if (Number.isNaN(created.getTime())) return true;
  return created.toISOString().slice(0, 10) < card.date;
}
