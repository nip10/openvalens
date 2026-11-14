/**
 * Who may make a widget link write (#505). `openvalens://quick-log?widget=…` is
 * a public deep link: any Android app can open it without a prompt, and a web
 * page can after one tap. So a link only saves at once when all of these hold:
 *
 * - it carries this install's nonce, which only the widget is given (Android:
 *   the widget is drawn by the app from its own storage). A link without it
 *   (every iOS link, as the iOS widget is static and has no App Group) opens
 *   the picker with the action ready and one "Save" tap;
 * - the active workspace is the member's own (they are its owner), never one
 *   they look after for someone else. Otherwise: the picker, nothing written;
 * - the same kind was not written from the widget in the last
 *   `HOME_WIDGET_REPEAT_WINDOW_MS`. A repeat is ignored, with a toast.
 *
 * Pure, so `bun test` checks it.
 */
import type { DueSupplement } from "@openvalens/api/contracts/quick-log";

import type { HomeWidgetAction, HomeWidgetTapPlan } from "./model";

/** The query parameter the widget's links carry the nonce in. */
export const HOME_WIDGET_NONCE_PARAM = "nonce";

/** Repeated widget writes of one kind within this window are ignored. */
export const HOME_WIDGET_REPEAT_WINDOW_MS = 10_000;

const NONCE_BYTES = 16;
const NONCE_PATTERN = /^[0-9a-f]{32}$/;

/** A fresh per-install nonce: 16 random bytes as lowercase hex. */
export function newHomeWidgetNonce(randomBytes: (count: number) => Uint8Array): string {
  const bytes = randomBytes(NONCE_BYTES);
  if (bytes.length !== NONCE_BYTES) throw new Error("home widget nonce: short random bytes");
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function isHomeWidgetNonce(value: unknown): value is string {
  return typeof value === "string" && NONCE_PATTERN.test(value);
}

/** Compares in time independent of where the strings first differ. */
function sameNonce(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Whether the link's `?nonce=` is this install's. `stored` is `undefined`
 * while it is being read (the answer is then `null`: wait), and `null` when
 * this install has none (no Android widget drawn yet, or iOS).
 */
export function homeWidgetLinkVerified(
  linkNonce: string | readonly string[] | undefined | null,
  stored: string | null | undefined,
): boolean | null {
  if (stored === undefined) return null;
  const raw = Array.isArray(linkNonce) ? linkNonce[0] : linkNonce;
  if (!isHomeWidgetNonce(stored) || !isHomeWidgetNonce(raw)) return false;
  return sameNonce(raw, stored);
}

export type GuardedHomeWidgetTap =
  | HomeWidgetTapPlan
  /** The active workspace is not the member's own: the picker, nothing written. */
  | { type: "not_own_record"; action: Exclude<HomeWidgetAction, "log"> }
  /** The link is not known to come from the widget: the action, ready to save with one tap. */
  | { type: "confirm_water" }
  | { type: "confirm_take"; item: DueSupplement }
  /** The same kind was written from the widget a moment ago: ignored, with a toast. */
  | { type: "repeat_ignored"; action: Exclude<HomeWidgetAction, "log"> };

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
  const last = new Map<Exclude<HomeWidgetAction, "log">, number>();
  return {
    lastWriteAt: (action: Exclude<HomeWidgetAction, "log">) => last.get(action),
    record: (action: Exclude<HomeWidgetAction, "log">, at: number) => {
      last.set(action, at);
    },
  };
}
