// Anchor dashboard paths are contracts, not a promise that target UI routes exist.
type TimelineRef = {
  table?: string;
  id?: number | string;
  sourceTable?: string;
  sourceId?: number | string;
  type?: string;
  label?: string;
  relation?: string;
};
export type TimelineRefLinkContext = { domain?: string | null };
const HREF_BY_TABLE: Record<string, string> = {
  blood_marker: "/blood",
  dexa_scan: "/body",
  body_composition: "/body",
  weight: "/body",
  weight_entry: "/body",
  cardiac_exam: "/cardiac",
  imaging_study: "/imaging",
  weekly_review: "/reports/weekly",
  scheduled_event: "/calendar",
  daily_reminder: "/calendar",
  metric_sample: "/records/timeline",
  health_event: "/records/timeline",
};
function tableName(ref: TimelineRef): string | null {
  if (ref.table ?? ref.sourceTable) return ref.table ?? ref.sourceTable ?? null;
  if (ref.type === "source_record" && typeof ref.label === "string") {
    const [table] = ref.label.split(":");
    return table || null;
  }
  return null;
}
function refId(ref: TimelineRef): number | string | null {
  return ref.id ?? ref.sourceId ?? null;
}
export function resolveTimelineRefHref(
  ref: TimelineRef,
  context: TimelineRefLinkContext = {},
): string | null {
  const table = tableName(ref);
  void context;
  if (table === "blood_panel") {
    const id = refId(ref);
    return id == null ? "/blood" : `/blood/${id}`;
  }
  return table && Object.hasOwn(HREF_BY_TABLE, table) ? (HREF_BY_TABLE[table] ?? null) : null;
}
export function formatTimelineRefLabel(ref: TimelineRef): string {
  if (ref.label) return ref.label;
  const table = tableName(ref);
  const id = refId(ref);
  if (table && id != null) return `${table} #${id}`;
  return ref.type ?? "Unknown reference";
}
