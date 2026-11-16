import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";

import type { StatusTone } from "@/components/page";

/** Local calendar date as YYYY-MM-DD. */
function isoDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * A record's date as a person says it: "Today", "Yesterday", or "8 Oct" in the
 * reader's locale (with the year only when it is not this year). The ISO date
 * stays available in tables and exports.
 */
export function friendlyDate(i18n: I18n, iso: string, now: Date = new Date()): string {
  const day = iso.slice(0, 10);
  if (day === isoDay(now)) return i18n._(msg`Today`);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (day === isoDay(yesterday)) return i18n._(msg`Yesterday`);
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const date = new Date(y, m - 1, d);
  return new Intl.DateTimeFormat(i18n.locale, {
    day: "numeric",
    month: "short",
    ...(y === now.getFullYear() ? {} : { year: "numeric" }),
  }).format(date);
}

/**
 * A night as the two days it spans, from its wake-up date: "Sun 15 → Mon 16"
 * in the reader's locale.
 */
export function nightSpan(i18n: I18n, wakeIso: string): string {
  const [y, m, d] = wakeIso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return wakeIso;
  const format = new Intl.DateTimeFormat(i18n.locale, { weekday: "short", day: "numeric" });
  return `${format.format(new Date(y, m - 1, d - 1))} → ${format.format(new Date(y, m - 1, d))}`;
}

/** Local calendar date as YYYY-MM-DD, `days` from `now` (negative for the past). */
export function localIsoDay(now: Date = new Date(), days = 0): string {
  const date = new Date(now);
  date.setDate(date.getDate() + days);
  return isoDay(date);
}

/** A presenter's tone ("success" / "warning" / "destructive" / null) as a pill tone. */
export function pillTone(
  tone: "success" | "warning" | "destructive" | null | undefined,
): StatusTone {
  if (tone === "success") return "good";
  if (tone === "warning") return "warn";
  if (tone === "destructive") return "bad";
  return "neutral";
}
