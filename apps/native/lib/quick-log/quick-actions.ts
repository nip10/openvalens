/**
 * App-icon quick actions (#440): long-press the app icon for the member's
 * three most-used log kinds, then "Log…". Each opens the log picker at
 * `/quick-log?kind=<id>`, which opens that kind's form, or at `/quick-log`.
 * Pure, so `bun test` checks which actions appear and in which order; the
 * app hands them to `expo-quick-actions` (components/quick-log/quick-actions-sync).
 */
import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { LogKind, LogKindIconKey } from "@openvalens/api/presenters/log-kinds";

/** How many log kinds the quick actions offer, before "Log…" (iOS shows at most 4). */
export const QUICK_ACTION_KIND_COUNT = 3;

/** The picker's route; a quick action carries it as `params.href`. */
export const QUICK_LOG_PATH = "/quick-log";

/**
 * With fewer than three kinds logged yet, these fill the rest, in this
 * order: the kinds most people log by hand.
 */
export const DEFAULT_QUICK_ACTION_KINDS = Object.freeze([
  "water",
  "weight",
  "food",
  "supplement_intake",
  "blood_pressure",
  "sleep",
  "workout",
]);

/**
 * Kinds that never become a quick action. The home screen is seen by anyone
 * next to the member, so private measurements stay inside the app.
 */
const NEVER_QUICK_ACTION = new Set(["private_measurement"]);

export const QUICK_ACTION_COPY = Object.freeze({
  log: msg({ message: "Log…", comment: "Opens the quick log palette." }),
});

export type QuickActionPlatform = "ios" | "android";

/** The shape `expo-quick-actions` takes (its `Action`), with the route in `params.href`. */
export type QuickActionItem = {
  id: string;
  title: string;
  icon: string | null;
  params: { href: string };
};

/** SF Symbols (iOS 16.4+) for each log kind icon; any other gets the plain one. */
const IOS_SYMBOLS: Partial<Record<LogKindIconKey, string>> = {
  scale: "scalemass",
  gauge: "gauge.with.dots.needle.33percent",
  "heart-pulse": "waveform.path.ecg",
  heart: "heart",
  footprints: "figure.walk",
  flame: "flame",
  route: "map",
  moon: "moon.zzz",
  flask: "testtube.2",
  ruler: "ruler",
  utensils: "fork.knife",
  droplet: "drop",
  dumbbell: "dumbbell",
  pill: "pills",
  target: "target",
  "person-standing": "figure.stand",
  "cup-soda": "cup.and.saucer",
};

/** Android has no symbol set: the shortcuts carry the app's launcher icon. */
const ANDROID_ICON = "ic_launcher";

function iconFor(kind: LogKind | null, platform: QuickActionPlatform): string {
  if (platform === "android") return ANDROID_ICON;
  if (!kind) return "symbol:plus.circle";
  return `symbol:${IOS_SYMBOLS[kind.icon] ?? "plus.circle"}`;
}

/**
 * The kinds the quick actions offer, most-logged first. Only kinds the
 * member can log now count (`kinds` is already filtered by modules,
 * preferences and role), so a turned-off feature never appears. Ties keep the
 * shared list's order. Fewer than three logged kinds are topped up from
 * {@link DEFAULT_QUICK_ACTION_KINDS}.
 */
export function quickActionKinds(
  kinds: readonly LogKind[],
  kindCounts: Readonly<Record<string, number>> | undefined,
): LogKind[] {
  const offered = kinds.filter((kind) => !NEVER_QUICK_ACTION.has(kind.id));
  const order = new Map(offered.map((kind, index) => [kind.id, index]));
  const counts = kindCounts ?? {};
  const used = offered
    .filter((kind) => (counts[kind.id] ?? 0) > 0)
    .sort(
      (a, b) => (counts[b.id] ?? 0) - (counts[a.id] ?? 0) || order.get(a.id)! - order.get(b.id)!,
    );
  const chosen = used.slice(0, QUICK_ACTION_KIND_COUNT);
  for (const id of DEFAULT_QUICK_ACTION_KINDS) {
    if (chosen.length >= QUICK_ACTION_KIND_COUNT) break;
    const kind = offered.find((item) => item.id === id);
    if (kind && !chosen.includes(kind)) chosen.push(kind);
  }
  return chosen;
}

/** The picker route that opens one kind's form. */
export function quickLogHref(kindId: string): string {
  return `${QUICK_LOG_PATH}?kind=${encodeURIComponent(kindId)}`;
}

/**
 * The quick actions, in order: up to three kinds ({@link quickActionKinds}),
 * then "Log…", which opens the whole picker. Titles are in the member's
 * language (`i18n`).
 */
export function buildQuickActions(
  input: {
    kinds: readonly LogKind[];
    kindCounts: Readonly<Record<string, number>> | undefined;
    platform: QuickActionPlatform;
  },
  i18n: I18n,
): QuickActionItem[] {
  return [
    ...quickActionKinds(input.kinds, input.kindCounts).map((kind): QuickActionItem => ({
      id: `log:${kind.id}`,
      title: i18n._(kind.label),
      icon: iconFor(kind, input.platform),
      params: { href: quickLogHref(kind.id) },
    })),
    {
      id: "log",
      title: i18n._(QUICK_ACTION_COPY.log),
      icon: input.platform === "ios" ? "add" : ANDROID_ICON,
      params: { href: QUICK_LOG_PATH },
    },
  ];
}

/**
 * The route a triggered quick action opens, or null when it is not one of
 * ours (a stale or foreign shortcut opens nothing).
 */
export function quickActionHref(
  action: { params?: Record<string, unknown> | null } | null | undefined,
): string | null {
  const href = action?.params?.href;
  if (typeof href !== "string") return null;
  if (href === QUICK_LOG_PATH) return href;
  const prefix = `${QUICK_LOG_PATH}?kind=`;
  if (!href.startsWith(prefix)) return null;
  const kind = href.slice(prefix.length);
  return /^[A-Za-z0-9_:%.-]+$/.test(kind) ? href : null;
}
