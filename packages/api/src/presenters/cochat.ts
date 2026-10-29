/**
 * Coach chat presentation shared by web and mobile. Only sibling presenter
 * helpers are imported — safe for the app bundle. Text is returned as message
 * descriptors the apps render with Lingui (#67); not reachable from server
 * code (see server-safe.test.ts).
 */
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";

import { formatProductDate, type ProductDisplaySettings } from "./product-formatting";

export type ChatThreadLike = {
  conversationId: string;
  lastMessageAt: string;
  lastMessagePreview: string;
  messageCount: number;
};

export type ChatMessageLike = {
  id: number;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
};

/** Short, single-line summary suitable for a thread list row. */
export function previewLine(thread: ChatThreadLike): string {
  return thread.lastMessagePreview.replace(/\s+/g, " ").trim();
}

/**
 * "just now" / "3m ago" / "2h ago" / "Mon" / "Sep 12". The month/day fallback
 * honors the optional settings locale (default en-US); the device-local
 * timezone is preserved unless an explicit `timeZone` is supplied.
 */
export function relativeTime(
  iso: string | null | undefined,
  now: Date = new Date(),
  settings?: ProductDisplaySettings | null,
): MessageDescriptor {
  if (!iso) return msg({ message: "—", comment: "No time to show" });
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return msg({ message: "—", comment: "No time to show" });
  const diffMs = now.getTime() - then.getTime();
  if (diffMs < 0) return msg`just now`;
  const sec = Math.round(diffMs / 1000);
  if (sec < 45) return msg`just now`;
  const min = Math.round(sec / 60);
  if (min < 60) return msg({ message: `${min}m ago`, comment: "Minutes ago, abbreviated" });
  const hr = Math.round(min / 60);
  if (hr < 24) return msg({ message: `${hr}h ago`, comment: "Hours ago, abbreviated" });
  const day = Math.round(hr / 24);
  if (day < 7) return msg({ message: `${day}d ago`, comment: "Days ago, abbreviated" });
  const date = formatProductDate(
    then,
    settings?.locale ?? "en-US",
    { month: "short", day: "numeric" },
    settings?.timeZone,
  );
  return msg({ message: `${date}`, comment: "A short month and day, already formatted" });
}

/** Truncate long previews for the list row. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Error code of a used-up monthly AI allowance (Issue #299). */
export const AI_USAGE_LIMIT_REACHED = "AI_USAGE_LIMIT_REACHED";

/**
 * Issue #299 — whether a failed coach call hit the monthly AI allowance, and
 * when it resets (`YYYY-MM-DD`, the first day of next month in UTC, or `null`
 * when the server did not say). `false` for every other error.
 */
export function aiUsageLimitOf(error: unknown): { resetsOn: string | null } | false {
  if (typeof error !== "object" || error === null) return false;
  const { code, data } = error as { code?: unknown; data?: unknown };
  if (code !== AI_USAGE_LIMIT_REACHED) return false;
  const resetsOn =
    typeof data === "object" && data !== null ? (data as { resetsOn?: unknown }).resetsOn : null;
  return {
    resetsOn:
      typeof resetsOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(resetsOn) ? resetsOn : null,
  };
}

/**
 * The neutral Coach message for a used-up monthly AI allowance, with the reset
 * date written out in `locale` (the person's language). The date is a UTC
 * calendar day, so it is formatted in UTC and never shifts by a time zone.
 */
export function aiUsageLimitMessage(resetsOn: string | null, locale: string): MessageDescriptor {
  if (!resetsOn) {
    return msg({
      message:
        "You have used this month's AI coach allowance. It resets at the start of next month.",
      comment: "Coach: the person's monthly AI allowance is used up; no reset date is known",
    });
  }
  let date: string;
  try {
    date = new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${resetsOn}T00:00:00.000Z`));
  } catch {
    date = resetsOn;
  }
  return msg({
    message: `You have used this month's AI coach allowance. It resets on ${date}.`,
    comment:
      "Coach: the person's monthly AI allowance is used up. The date is already written out in the person's language, for example 1 November 2026",
  });
}
