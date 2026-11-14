/**
 * The home-screen widget (#449), as plain data: which buttons it shows, the
 * deep link each opens, what the app does with a tap, and the snapshot the
 * Android widget draws. Pure, so `bun test` checks it.
 *
 * Design (#449, settled 2026-11-14): one widget, three buttons — water +1
 * glass, "Taken" for the next supplement that is due, and "Log…". A tap opens
 * the app through `openvalens://quick-log?widget=<action>`; the app saves at
 * once with the member's own session and offline queue and offers Undo. The
 * widget holds no credential. Values (today's water, supplements due) are an
 * opt-in on this phone, off by default; when off the widget is given no
 * health data at all.
 */
import type { I18n } from "@lingui/core";
import { msg, plural } from "@lingui/core/macro";
import type { DueSupplement } from "@openvalens/api/contracts/quick-log";
import type { LogKind } from "@openvalens/api/presenters/log-kinds";
import type { QuickLogWrite } from "@openvalens/api/presenters/quick-log";
import { isLocale, type Locale } from "@openvalens/i18n/locales";

import { dueWithQueuedIntakes } from "@/lib/quick-log/picker";

import { HOME_WIDGET_COPY } from "./copy";

export const HOME_WIDGET_ACTIONS = ["water", "supplement", "log"] as const;
export type HomeWidgetAction = (typeof HOME_WIDGET_ACTIONS)[number];

/** The app scheme (`app.json` `expo.scheme`). */
export const APP_SCHEME = "openvalens";

/** The deep link a widget button opens. The iOS widget's Swift has the same links. */
export function homeWidgetUrl(action: HomeWidgetAction): string {
  return `${APP_SCHEME}://quick-log?widget=${action}`;
}

/** The deep link a signed-out widget opens: the app's start. */
export const HOME_WIDGET_OPEN_APP_URL = `${APP_SCHEME}://`;

/** `?widget=` from the deep link: one of the actions, anything else is ignored. */
export function parseHomeWidgetAction(
  value: string | readonly string[] | undefined | null,
): HomeWidgetAction | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return null;
  return (HOME_WIDGET_ACTIONS as readonly string[]).includes(raw)
    ? (raw as HomeWidgetAction)
    : null;
}

/** Whether the member can log each button's kind now (modules, preferences, role). */
export type HomeWidgetAvailability = { water: boolean; supplement: boolean };

/** From the kinds the picker would offer (`availableLogKinds`). */
export function homeWidgetAvailability(
  kinds: readonly Pick<LogKind, "id">[],
): HomeWidgetAvailability {
  const has = (id: string) => kinds.some((kind) => kind.id === id);
  return { water: has("water"), supplement: has("supplement_intake") };
}

/** The buttons, in order. A turned-off kind has no button; "Log…" is always there. */
export function homeWidgetButtons(availability: HomeWidgetAvailability): HomeWidgetAction[] {
  return HOME_WIDGET_ACTIONS.filter((action) => action === "log" || availability[action]);
}

type DueAnswer = { localDate: string; items: readonly DueSupplement[] } | undefined;
type QueuedIntake = { supplementId: number; occurredAt: string };

/**
 * The supplement "Taken" logs: the first one due now (the server orders them
 * by time of day, then name), after intakes still waiting on this phone.
 * `null` when nothing is due today.
 */
export function nextDueSupplement(
  due: DueAnswer,
  queued: readonly QueuedIntake[],
  timeZone: string,
  now: Date = new Date(),
): DueSupplement | null {
  return dueWithQueuedIntakes(due, queued, timeZone, now)[0] ?? null;
}

/** Doses still due now, across supplements. */
export function supplementDosesDue(
  due: DueAnswer,
  queued: readonly QueuedIntake[],
  timeZone: string,
  now: Date = new Date(),
): number {
  return dueWithQueuedIntakes(due, queued, timeZone, now).reduce(
    (sum, item) => sum + item.pending,
    0,
  );
}

/**
 * One glass. The water domain has no stored serving yet, so a glass is
 * 250 ml for everyone; this is the one place to change it.
 */
export const WIDGET_GLASS_ML = 250;

export function glassOfWaterWrite(context: {
  timeZone: string;
  newId: () => string;
  now?: Date;
}): Extract<QuickLogWrite, { type: "water" }> {
  return {
    type: "water",
    input: {
      quantity: WIDGET_GLASS_ML,
      unit: "ml",
      observedAt: (context.now ?? new Date()).toISOString(),
      timeZone: context.timeZone,
      clientMutationId: context.newId(),
    },
  };
}

// ─── What the app does with a tap ────────────────────────────────

export type HomeWidgetTapPlan =
  /** Still finding out what the member can log; nothing is saved yet. */
  | { type: "wait" }
  | { type: "save_water" }
  | { type: "take"; item: DueSupplement }
  /** Nothing due, or the dose is not known: the supplement form, preset when there is one. */
  | { type: "choose_supplement"; supplementId: number | null }
  /** The kind is turned off (or the role cannot log it): say so, show the picker. */
  | { type: "off"; action: Exclude<HomeWidgetAction, "log"> }
  | { type: "picker" };

/**
 * `availability` is `null` until every answer that can take a kind away is
 * in; `next` is `undefined` while the supplements due are loading.
 */
export function planHomeWidgetTap(
  action: HomeWidgetAction,
  state: { availability: HomeWidgetAvailability | null; next: DueSupplement | null | undefined },
): HomeWidgetTapPlan {
  if (action === "log") return { type: "picker" };
  if (!state.availability) return { type: "wait" };
  if (!state.availability[action]) return { type: "off", action };
  if (action === "water") return { type: "save_water" };
  if (state.next === undefined) return { type: "wait" };
  if (state.next === null) return { type: "choose_supplement", supplementId: null };
  if (!state.next.dose) return { type: "choose_supplement", supplementId: state.next.supplementId };
  return { type: "take", item: state.next };
}

// ─── The snapshot the Android widget draws ───────────────────────

/** Opt-in values, for the member's local day they were read on. */
export type HomeWidgetValues = {
  localDate: string;
  /** Today's plain water, as the water screen shows it (`"1,250 ml"`, `"Hidden"`). */
  water: string | null;
  /** Supplement doses still due now. */
  supplementsDue: number | null;
};

/** Stored on this phone for the widget; health values only when the member turned them on. */
export type HomeWidgetSnapshot = {
  version: 1;
  locale: Locale;
  buttons: HomeWidgetAction[];
  values: HomeWidgetValues | null;
};

export function buildHomeWidgetSnapshot(input: {
  locale: Locale;
  availability: HomeWidgetAvailability;
  /** The Settings opt-in. Off: the snapshot carries no health data. */
  valuesEnabled: boolean;
  values: HomeWidgetValues | null;
}): HomeWidgetSnapshot {
  const buttons = homeWidgetButtons(input.availability);
  let values: HomeWidgetValues | null = null;
  if (input.valuesEnabled && input.values) {
    const water = input.availability.water ? input.values.water : null;
    const supplementsDue = input.availability.supplement ? input.values.supplementsDue : null;
    if (water !== null || supplementsDue !== null)
      values = { localDate: input.values.localDate, water, supplementsDue };
  }
  return { version: 1, locale: input.locale, buttons, values };
}

/** A stored snapshot, or `null` when there is none or it is not one this build understands. */
export function parseHomeWidgetSnapshot(raw: string | null | undefined): HomeWidgetSnapshot | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const snapshot = value as Partial<HomeWidgetSnapshot>;
  if (snapshot.version !== 1 || !isLocale(snapshot.locale) || !Array.isArray(snapshot.buttons))
    return null;
  const buttons = HOME_WIDGET_ACTIONS.filter((action) => snapshot.buttons!.includes(action));
  const values = snapshot.values;
  const validValues =
    values &&
    typeof values === "object" &&
    typeof values.localDate === "string" &&
    (values.water === null || typeof values.water === "string") &&
    (values.supplementsDue === null ||
      (Number.isInteger(values.supplementsDue) && values.supplementsDue >= 0))
      ? {
          localDate: values.localDate,
          water: values.water,
          supplementsDue: values.supplementsDue,
        }
      : null;
  return { version: 1, locale: snapshot.locale, buttons, values: validValues };
}

// ─── What the widget shows ───────────────────────────────────────

export type HomeWidgetButtonView = {
  action: HomeWidgetAction;
  label: string;
  /** The opt-in value when it is from today, else what the tap does. */
  detail: string;
  url: string;
};

export type HomeWidgetView =
  | { type: "signed_out"; text: string; url: string }
  | { type: "buttons"; buttons: HomeWidgetButtonView[] };

/**
 * No snapshot (nobody signed in, or signed out): one line that opens the app.
 * Values from another day are not shown: the phone may not have opened the
 * app since midnight.
 */
export function homeWidgetView(
  snapshot: HomeWidgetSnapshot | null,
  i18n: I18n,
  today: string,
): HomeWidgetView {
  if (!snapshot)
    return {
      type: "signed_out",
      text: i18n._(HOME_WIDGET_COPY.signedOut),
      url: HOME_WIDGET_OPEN_APP_URL,
    };
  const values = snapshot.values?.localDate === today ? snapshot.values : null;
  const buttons = snapshot.buttons.map((action): HomeWidgetButtonView => {
    const url = homeWidgetUrl(action);
    switch (action) {
      case "water":
        return {
          action,
          url,
          label: i18n._(HOME_WIDGET_COPY.water),
          detail:
            values?.water != null
              ? i18n._({ ...HOME_WIDGET_COPY.waterToday, values: { amount: values.water } })
              : i18n._(HOME_WIDGET_COPY.waterAction),
        };
      case "supplement": {
        const count = values?.supplementsDue;
        return {
          action,
          url,
          label: i18n._(HOME_WIDGET_COPY.supplement),
          detail:
            count != null
              ? i18n._(msg`${plural(count, { 0: "All taken", one: "# due", other: "# due" })}`)
              : i18n._(HOME_WIDGET_COPY.supplementAction),
        };
      }
      case "log":
        return {
          action,
          url,
          label: i18n._(HOME_WIDGET_COPY.log),
          detail: i18n._(HOME_WIDGET_COPY.logAction),
        };
    }
  });
  return { type: "buttons", buttons };
}
