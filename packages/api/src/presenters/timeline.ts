/**
 * Timeline presentation shared by web and mobile, so both render the same
 * groups, labels and tones. Pure TypeScript with no imports: safe for the
 * app bundle. Copy follows docs/mobile/tone-of-voice.md (sentence case,
 * ISO dates, 24-hour times).
 */
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

const DOMAIN_LABELS: Record<string, string> = {
  sleep: "Sleep",
  activity: "Activity",
  body: "Body",
  vitals: "Vitals",
  labs: "Labs",
  meds_supplements: "Meds and supplements",
  calendar: "Calendar",
  sync: "Sync",
  imaging: "Imaging",
  cardiac: "Cardiac",
};

export function domainLabel(domain: string): string {
  return DOMAIN_LABELS[domain] ?? "Other";
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
