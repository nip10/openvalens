import type {
  AdherenceSlice,
  GoalsSlice,
  SleepRecoverySlice,
  UpcomingEventsSlice,
  WeightSlice,
  WeeklyReport,
  WeeklySlices,
  WeekWindow,
} from "./types";

/**
 * Weekly report helpers (Issue #16). Pure — no DB calls.
 *
 * Mirrors `anchovy/.../lib/reports/weekly-report.ts` (pure portions):
 *
 * - `summarizeWeightProgress` — first/last/delta over the window.
 * - `summarizeGoalsProgression` — active goal count + latest check-in.
 * - `summarizeAdherence` — adherence / energy / sleep / notes.
 * - `summarizeSleepRecovery` — average + debt + status / confidence.
 * - `summarizeUpcomingEvents` — top-N (3) event lines.
 * - `withFallback` — fills empty sections with a "no data" line and
 *   reports which sections fell back so the caller can surface
 *   `hasPartialData` to clients.
 * - `buildWeekWindow` — deterministic Mon-Sun ISO window.
 * - `buildWeeklyMessageDraft` — final markdown draft.
 * - `generateWeeklyReport` — composes everything.
 */

const FALLBACK_LABELS: Record<keyof WeeklySlices, string> = {
  weightProgress: "Weight progress for the week",
  goalsProgression: "Goals progression",
  adherence: "Adherence to medication and supplements",
  sleepRecovery: "Sleep and recovery",
  upcomingEvents: "Upcoming calendar events",
  otherRelevant: "Any other relevant information",
};

function fallbackLine(label: string): string {
  return `${label}: No data logged this week.`;
}

function clip(text: string, max = 100): string {
  const clean = text.trim().replace(/\s+/g, " ");
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 3)}...`;
}

function formatKg(value: number): string {
  return `${value.toFixed(1)} kg`;
}

function asSigned(value: number): string {
  return value > 0 ? `+${value.toFixed(1)}` : value.toFixed(1);
}

export function summarizeWeightProgress(slice: WeightSlice): string {
  return `${formatKg(slice.startKg)} -> ${formatKg(slice.endKg)} (delta ${asSigned(slice.deltaKg)} kg).`;
}

export function summarizeGoalsProgression(slice: GoalsSlice): string {
  if (slice.activeGoalsCount === 0) {
    return "No active goals right now.";
  }
  const summary = `${slice.activeGoalsCount} active goal${slice.activeGoalsCount === 1 ? "" : "s"}.`;
  if (!slice.latestCheckinDate || !slice.latestCheckinSnippet) {
    return summary;
  }
  return `${summary} Latest check-in (${slice.latestCheckinDate}): ${clip(slice.latestCheckinSnippet, 80)}.`;
}

export function summarizeAdherence(slice: AdherenceSlice): string {
  const parts: string[] = [];
  if (slice.adherence != null) parts.push(`adherence ${slice.adherence}/10`);
  if (slice.energy != null) parts.push(`energy ${slice.energy}/10`);
  if (slice.sleep != null) parts.push(`sleep ${slice.sleep}/10`);
  const base = parts.length > 0 ? `${parts.join(", ")}.` : "";
  if (!slice.notesSnippet) return base;
  return `${base}${base ? " " : ""}Notes: ${clip(slice.notesSnippet, 90)}`;
}

export function summarizeSleepRecovery(slice: SleepRecoverySlice): string {
  if (slice.sevenDayAverageMinutes == null && slice.averageSleepDebtMinutes == null) {
    return "";
  }
  const avgHours = slice.sevenDayAverageMinutes == null ? null : slice.sevenDayAverageMinutes / 60;
  const debtMinutes = slice.averageSleepDebtMinutes ?? 0;
  return `${avgHours == null ? "0.0" : avgHours.toFixed(1)}h avg, ${debtMinutes} min/day debt, status ${slice.status ?? "unknown"}, confidence ${slice.confidence ?? "unknown"}.`;
}

export function summarizeUpcomingEvents(slice: UpcomingEventsSlice): string {
  if (slice.items.length === 0) return "";
  return slice.items
    .slice(0, 3)
    .map((item) => `${item.title} (${item.startDate}, ${item.frequency})`)
    .join("; ");
}

export function withFallback(slices: WeeklySlices): {
  sections: Record<keyof WeeklySlices, string>;
  fallbackSections: Array<keyof WeeklySlices>;
} {
  const fallbackSections: Array<keyof WeeklySlices> = [];
  const sections: Record<keyof WeeklySlices, string> = {
    weightProgress: "",
    goalsProgression: "",
    adherence: "",
    sleepRecovery: "",
    upcomingEvents: "",
    otherRelevant: "",
  };

  const resolved: Record<keyof WeeklySlices, string> = {
    weightProgress: slices.weightProgress ? summarizeWeightProgress(slices.weightProgress) : "",
    goalsProgression: slices.goalsProgression
      ? summarizeGoalsProgression(slices.goalsProgression)
      : "",
    adherence: slices.adherence ? summarizeAdherence(slices.adherence) : "",
    sleepRecovery: slices.sleepRecovery ? summarizeSleepRecovery(slices.sleepRecovery) : "",
    upcomingEvents: slices.upcomingEvents ? summarizeUpcomingEvents(slices.upcomingEvents) : "",
    otherRelevant: slices.otherRelevant ?? "",
  };

  for (const key of Object.keys(sections) as Array<keyof WeeklySlices>) {
    const value = resolved[key] ?? "";
    if (value.trim().length === 0) {
      sections[key] = fallbackLine(FALLBACK_LABELS[key]);
      fallbackSections.push(key);
    } else {
      sections[key] = value;
    }
  }

  return { sections, fallbackSections };
}

function parseIsoDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error(`Invalid ISO date: ${value}`);
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) {
    throw new Error(`Invalid ISO date: ${value}`);
  }
  return date;
}

function formatIsoDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/**
 * Build a Mon-Sun window. Mirrors the anchor's `buildWeekWindow` —
 * `weekStart` defaults to "this Monday UTC", end is six days later.
 */
export function buildWeekWindow(now: Date, weekStart?: string): WeekWindow {
  const startDate = weekStart ? parseIsoDate(weekStart) : currentWeekMondayUtc(now);
  const endDate = addUtcDays(startDate, 6);
  return {
    start: formatIsoDate(startDate),
    end: formatIsoDate(endDate),
  };
}

function currentWeekMondayUtc(now: Date): Date {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dayOfWeek = today.getUTCDay();
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  return addUtcDays(today, -daysSinceMonday);
}

function normalizeSectionValue(label: string, value: string): string {
  const prefix = `${label}: `;
  const stripped = value.startsWith(prefix) ? value.slice(prefix.length) : value;
  if (stripped.trim().length === 0) return "No data logged this week.";
  return stripped;
}

export function buildWeeklyMessageDraft(sections: Record<keyof WeeklySlices, string>): string {
  return [
    "Hi,",
    "",
    "Here is the weekly update:",
    "",
    `- Weight progress for the week: ${normalizeSectionValue("Weight progress for the week", sections.weightProgress)}`,
    `- Goals progression: ${normalizeSectionValue("Goals progression", sections.goalsProgression)}`,
    `- Adherence to medication and supplements: ${normalizeSectionValue("Adherence to medication and supplements", sections.adherence)}`,
    `- Sleep and recovery: ${normalizeSectionValue("Sleep and recovery", sections.sleepRecovery)}`,
    `- Upcoming calendar events: ${normalizeSectionValue("Upcoming calendar events", sections.upcomingEvents)}`,
    `- Any other relevant information: ${normalizeSectionValue("Any other relevant information", sections.otherRelevant)}`,
    "",
    "Let me know if anything needs adjustment.",
    "",
    "Thanks.",
  ].join("\n");
}

/**
 * Compose a full weekly report from sanitized weekly slices. Pure.
 * The caller owns the slices (typically composed from the per-domain
 * read APIs — `#21` body, `#22` plans, `#18` sleep, etc.).
 */
export function generateWeeklyReport(params: {
  now: Date;
  weekStart?: string;
  slices: WeeklySlices;
}): WeeklyReport {
  const weekRange = buildWeekWindow(params.now, params.weekStart);
  const { sections, fallbackSections } = withFallback(params.slices);
  return {
    weekRange,
    generatedAt: params.now.toISOString(),
    sections,
    meta: {
      hasPartialData: fallbackSections.length > 0,
      fallbackSections,
    },
    messageDraft: buildWeeklyMessageDraft(sections),
  };
}
