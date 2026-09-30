import {
  CANONICAL_TIMELINE_CONFIDENCES,
  CANONICAL_TIMELINE_DOMAINS,
  CANONICAL_TIMELINE_REVIEW_STATES,
  CANONICAL_TIMELINE_SEVERITIES,
  type TimelineEvent,
  type TimelineFilters,
} from "./types";

/**
 * Timeline merge + filter helpers (Issue #17, MVP).
 *
 * Pure — the repository calls these once it has collected rows from
 * each domain. The merge is deterministic: events first sort by
 * `at` desc (string compare), then by `id` asc (locale compare).
 *
 * Payloads may contain PHI and pass through without logging.
 */

export type TimelinePage = {
  items: TimelineEvent[];
  /** Stable, opaque cursor for the next page. `null` when exhausted. */
  nextCursor: string | null;
};

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Convert a `from` / `to` boundary string to ISO + ms for windowed
 * filtering. `from` expands to 00:00:00.000Z and `to` to
 * 23:59:59.999Z when the value is a date-only string. Mirrors the
 * anchor `normalizeCanonicalTimelineDateRange`.
 */
export function normalizeTimelineDateRange(filters?: Pick<TimelineFilters, "from" | "to">) {
  const from = filters?.from ? parseBoundary(filters.from, "from") : undefined;
  const to = filters?.to ? parseBoundary(filters.to, "to") : undefined;
  return {
    ...(from ? { fromIso: from.iso, fromMs: from.ms } : {}),
    ...(to ? { toIso: to.iso, toMs: to.ms } : {}),
  };
}

function parseBoundary(value: string, boundary: "from" | "to") {
  const normalized = DATE_ONLY_RE.test(value)
    ? `${value}T${boundary === "from" ? "00:00:00.000" : "23:59:59.999"}Z`
    : value;
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? { iso: new Date(ms).toISOString(), ms } : undefined;
}

/**
 * Build a filter pipeline. Returns a function that maps a flat
 * timeline event list down to the matching subset.
 */
export function buildTimelineFilter(filters?: TimelineFilters) {
  const dateRange = normalizeTimelineDateRange(filters);
  return (item: TimelineEvent): boolean => {
    if (filters?.domain && item.domain !== filters.domain) return false;
    if (filters?.severity && item.severity !== filters.severity) return false;
    if (filters?.confidence && item.confidence !== filters.confidence) return false;
    if (filters?.reviewState && item.reviewState !== filters.reviewState) return false;
    if (filters?.source) {
      const lowered = filters.source.toLowerCase();
      const matches = item.sourceRefs.some(
        (ref) =>
          ref.label.toLowerCase() === lowered ||
          (ref.id != null && String(ref.id).toLowerCase() === lowered),
      );
      if (!matches) return false;
    }
    const itemMs = Date.parse(item.at);
    if (dateRange.fromMs != null && itemMs < dateRange.fromMs) return false;
    if (dateRange.toMs != null && itemMs > dateRange.toMs) return false;
    return true;
  };
}

/**
 * Sort + filter + paginate. The cursor is a stable `at|id` token —
 * opaque to callers, so future iterations can swap the encoding
 * without breaking the public surface.
 */
export function buildTimelinePage(
  events: ReadonlyArray<TimelineEvent>,
  filters: TimelineFilters = {},
  pageSize = 50,
): TimelinePage {
  const filter = buildTimelineFilter(filters);
  const filtered = events.filter(filter);

  const sorted = [...filtered].sort((a, b) => {
    if (a.at === b.at) return a.id.localeCompare(b.id);
    return a.at > b.at ? -1 : 1;
  });

  const limit = Math.min(Math.max(filters.limit ?? pageSize, 1), 200);
  const cursor = filters.cursor ? decodeCursor(filters.cursor) : null;
  if (filters.cursor && !cursor) throw new Error("Invalid timeline cursor.");
  const candidates = cursor
    ? sorted.filter(
        (item) =>
          item.at < cursor.at || (item.at === cursor.at && item.id.localeCompare(cursor.id) > 0),
      )
    : sorted;
  const slice = candidates.slice(0, limit + 1);
  const hasMore = slice.length > limit;
  const items = hasMore ? slice.slice(0, limit) : slice;
  const lastItem = items[items.length - 1];
  const nextCursor = hasMore && lastItem ? encodeCursor(lastItem.at, lastItem.id) : null;

  return { items, nextCursor };
}

function encodeCursorInternal(at: string, id: string): string {
  return `${at}|${id}`;
}

export function encodeCursor(at: string, id: string): string {
  return encodeCursorInternal(at, id);
}

export function decodeCursor(cursor: string): { at: string; id: string } | null {
  const match = cursor.match(/^(.+)\|(.+)$/);
  if (
    !match ||
    !Number.isFinite(Date.parse(match[1] ?? "")) ||
    new Date(match[1] ?? "").toISOString() !== match[1] ||
    !/^(health_event|metric_sample):[1-9]\d*$/.test(match[2] ?? "")
  )
    return null;
  return { at: match[1] ?? "", id: match[2] ?? "" };
}

/**
 * Validate the input filter surface. Returns `null` when valid
 * (the API schema layer runs first via `validateInput`).
 */
export function validateTimelineFiltersShape(filters: TimelineFilters): string | null {
  if (filters.from !== undefined && !isAcceptableDateString(filters.from)) {
    return "from must be a YYYY-MM-DD date or full ISO timestamp.";
  }
  if (filters.to !== undefined && !isAcceptableDateString(filters.to)) {
    return "to must be a YYYY-MM-DD date or full ISO timestamp.";
  }
  const range = normalizeTimelineDateRange(filters);
  if (range.fromMs !== undefined && range.toMs !== undefined && range.fromMs > range.toMs)
    return "from must be before to.";
  if (filters.domain !== undefined && !isDomain(filters.domain)) {
    return `domain must be one of: ${CANONICAL_TIMELINE_DOMAINS.join(", ")}.`;
  }
  if (filters.severity !== undefined && !isSeverity(filters.severity)) {
    return `severity must be one of: ${CANONICAL_TIMELINE_SEVERITIES.join(", ")}.`;
  }
  if (filters.confidence !== undefined && !isConfidence(filters.confidence)) {
    return `confidence must be one of: ${CANONICAL_TIMELINE_CONFIDENCES.join(", ")}.`;
  }
  if (filters.reviewState !== undefined && !isReviewState(filters.reviewState)) {
    return `reviewState must be one of: ${CANONICAL_TIMELINE_REVIEW_STATES.join(", ")}.`;
  }
  if (filters.limit !== undefined && (filters.limit < 1 || filters.limit > 200)) {
    return "limit must be in [1, 200].";
  }
  return null;
}

function isAcceptableDateString(value: string): boolean {
  if (DATE_ONLY_RE.test(value))
    return (
      Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
    );
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    isAcceptableDateString(value.slice(0, 10)) &&
    Number.isFinite(Date.parse(value))
  );
}

function isDomain(value: string): boolean {
  return (CANONICAL_TIMELINE_DOMAINS as ReadonlyArray<string>).includes(value);
}

function isSeverity(value: string): boolean {
  return (CANONICAL_TIMELINE_SEVERITIES as ReadonlyArray<string>).includes(value);
}

function isConfidence(value: string): boolean {
  return (CANONICAL_TIMELINE_CONFIDENCES as ReadonlyArray<string>).includes(value);
}

function isReviewState(value: string): boolean {
  return (CANONICAL_TIMELINE_REVIEW_STATES as ReadonlyArray<string>).includes(value);
}
