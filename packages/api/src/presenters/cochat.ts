/**
 * Coach chat presentation shared by web and mobile. Pure TypeScript; only
 * sibling presenter helpers are imported — safe for the app bundle.
 */
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
): string {
  if (!iso) return "—";
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "—";
  const diffMs = now.getTime() - then.getTime();
  if (diffMs < 0) return "just now";
  const sec = Math.round(diffMs / 1000);
  if (sec < 45) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  return formatProductDate(
    then,
    settings?.locale ?? "en-US",
    { month: "short", day: "numeric" },
    settings?.timeZone,
  );
}

/** Truncate long previews for the list row. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}
