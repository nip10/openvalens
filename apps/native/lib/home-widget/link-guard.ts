/**
 * Who may make a widget link write (#505). `openvalens://quick-log?widget=…` is
 * a public deep link: any Android app can open it without a prompt, and a web
 * page can after one tap. So the link itself carries no authority, and it
 * only saves at once when all of these hold:
 *
 * - it follows a tap on the Android widget itself. The widget's receiver,
 *   which the app does not export (no other app can reach it), records the
 *   tap just before it opens the app (`modules/home-widget-tap`), and the app
 *   takes that record, once, when the link arrives. A link with no fresh tap
 *   behind it (every iOS link: the iOS widget is static, with no App Group)
 *   opens the picker with the action ready and one "Save" tap;
 * - the active workspace is the member's own (they are its owner), never one
 *   they look after for someone else. Otherwise: the picker, nothing written;
 * - the same kind was not written from the widget in the last
 *   `HOME_WIDGET_REPEAT_WINDOW_MS`. A repeat is ignored, with a toast.
 *
 * Pure, so `bun test` checks it.
 */
import type { DueSupplement } from "@openvalens/api/contracts/quick-log";

import type { HomeWidgetAction, HomeWidgetTapPlan } from "./model";

/** Repeated widget writes of one kind within this window are ignored. */
export const HOME_WIDGET_REPEAT_WINDOW_MS = 10_000;

/**
 * How long a recorded widget tap vouches for the link it opens. Generous: a
 * cold start can take some seconds before the screen asks.
 */
export const HOME_WIDGET_TAP_WINDOW_MS = 30_000;

type WriteAction = Exclude<HomeWidgetAction, "log">;

/**
 * Whether a link follows a tap on the widget itself. `ageMs` is how long ago
 * the widget's receiver recorded a tap on that button; `null` when there is
 * none to take (another app opened the link, or iOS).
 */
export function homeWidgetTapVerified(ageMs: number | null | undefined): boolean {
  return (
    typeof ageMs === "number" &&
    Number.isFinite(ageMs) &&
    ageMs >= 0 &&
    ageMs < HOME_WIDGET_TAP_WINDOW_MS
  );
}

/**
 * Asks the receiver's record once per link: taking a tap forgets it, so the
 * answer is kept until the link is gone (`reset`). "Log…" writes nothing and
 * takes nothing.
 */
export function createHomeWidgetLinkCheck(takeTap: (action: WriteAction) => number | null) {
  let current: { action: WriteAction; verified: boolean } | null = null;
  return {
    verified(action: WriteAction): boolean {
      if (current?.action !== action)
        current = { action, verified: homeWidgetTapVerified(takeTap(action)) };
      return current.verified;
    },
    /** The link was handled or left: the next one is asked afresh. */
    reset() {
      current = null;
    },
  };
}

export type GuardedHomeWidgetTap =
  | HomeWidgetTapPlan
  /** The active workspace is not the member's own: the picker, nothing written. */
  | { type: "not_own_record"; action: WriteAction }
  /** The link is not known to come from the widget: the action, ready to save with one tap. */
  | { type: "confirm_water" }
  | { type: "confirm_take"; item: DueSupplement }
  /** The same kind was written from the widget a moment ago: ignored, with a toast. */
  | { type: "repeat_ignored"; action: WriteAction };

/**
 * Applies the rules above to the plan `planHomeWidgetTap` made.
 * `ownRecord` and `verified` are `null` while still being found out.
 */
export function guardHomeWidgetTap(
  plan: HomeWidgetTapPlan,
  context: {
    ownRecord: boolean | null;
    verified: boolean | null;
    /** When this kind was last written from the widget (ms since the epoch). */
    lastWriteAt: number | undefined;
    now: number;
  },
): GuardedHomeWidgetTap {
  if (plan.type === "picker" || plan.type === "wait") return plan;
  if (context.ownRecord === null) return { type: "wait" };
  const action =
    plan.type === "off" ? plan.action : plan.type === "save_water" ? "water" : "supplement";
  if (!context.ownRecord) return { type: "not_own_record", action };
  // No write: the member saves (or not) themselves.
  if (plan.type === "off" || plan.type === "choose_supplement") return plan;
  if (context.verified === null) return { type: "wait" };
  if (!context.verified)
    return plan.type === "save_water"
      ? { type: "confirm_water" }
      : { type: "confirm_take", item: plan.item };
  if (
    context.lastWriteAt !== undefined &&
    context.now - context.lastWriteAt >= 0 &&
    context.now - context.lastWriteAt < HOME_WIDGET_REPEAT_WINDOW_MS
  )
    return { type: "repeat_ignored", action };
  return plan;
}

/** Whether the role in the active workspace makes it the member's own record. */
export function isOwnRecord(me: {
  isFetching: boolean;
  data: { role: string } | undefined;
}): boolean | null {
  // A cached answer may be from another workspace: wait for the fresh one.
  if (me.isFetching) return null;
  return me.data?.role === "owner";
}

/** When each kind was last written from the widget, in this app process. */
export function createHomeWidgetWriteLog() {
  const last = new Map<WriteAction, number>();
  return {
    lastWriteAt: (action: WriteAction) => last.get(action),
    record: (action: WriteAction, at: number) => {
      last.set(action, at);
    },
  };
}
