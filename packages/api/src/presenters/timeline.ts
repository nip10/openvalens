/**
 * Timeline presentation shared by web and mobile, so both render the same
 * groups, labels and tones. Pure TypeScript: safe for the app bundle. Copy
 * follows docs/mobile/tone-of-voice.md (sentence case, ISO dates, 24-hour
 * times). Labels are Lingui message descriptors (#67).
 */
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";

export type TimelineItemLike = {
  id: string;
  at: string;
  domain: string;
  title: string;
  summary: string;
  severity: string;
  sourceRefs: { type: string; label: string }[];
};

export type TimelineDayGroup<T extends TimelineItemLike> = {
  /** Local calendar day, `YYYY-MM-DD`. */
  day: string;
  items: (T & { time: string })[];
};

const DOMAIN_LABELS: Record<string, MessageDescriptor> = {
  sleep: msg`Sleep`,
  activity: msg`Activity`,
  body: msg`Body`,
  vitals: msg`Vitals`,
  labs: msg`Labs`,
  meds_supplements: msg`Meds and supplements`,
  calendar: msg`Calendar`,
  sync: msg`Sync`,
  imaging: msg`Imaging`,
  cardiac: msg`Cardiac`,
};

export function domainLabel(domain: string): MessageDescriptor {
  return DOMAIN_LABELS[domain] ?? msg`Other`;
}

/** Semantic color for a severity; `null` keeps neutral chrome (design-direction.md). */
export function severityTone(severity: string): "destructive" | "warning" | null {
  if (severity === "critical") return "destructive";
  if (severity === "warning") return "warning";
  return null;
}

export function sourceLabel(item: TimelineItemLike): string | null {
  return item.sourceRefs.find((ref) => ref.label)?.label ?? null;
}

function localParts(iso: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return {
    day: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
}

/** Groups newest-first items into local days, preserving the server's order. */
export function groupTimelineByDay<T extends TimelineItemLike>(
  items: readonly T[],
  timeZone: string,
): TimelineDayGroup<T>[] {
  const groups: TimelineDayGroup<T>[] = [];
  for (const item of items) {
    const { day, time } = localParts(item.at, timeZone);
    const last = groups.at(-1);
    if (last?.day === day) last.items.push({ ...item, time });
    else groups.push({ day, items: [{ ...item, time }] });
  }
  return groups;
}
