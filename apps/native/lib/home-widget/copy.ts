import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";

/**
 * The home-screen widget's words (#449). The Android widget draws them with
 * Lingui at runtime; the iOS widget and the Android widget picker read the
 * native string files generated from these (`bun run widget:strings`, checked
 * by `native-strings.test.ts`), so every label is still translated here.
 */
export const HOME_WIDGET_COPY = Object.freeze({
  name: msg({ message: "Quick log", comment: "Home-screen widget name in the widget gallery." }),
  description: msg({
    message: "Log a glass of water, take your next supplement or open the log in one tap.",
    comment: "Home-screen widget description in the widget gallery.",
  }),
  water: msg({ message: "Water", comment: "Home-screen widget button." }),
  waterAction: msg({
    message: "+1 glass",
    comment: "Home-screen widget: logs one glass of water (250 ml).",
  }),
  waterToday: msg({
    message: "{amount} today",
    comment: "Home-screen widget: today's plain water, e.g. “1,250 ml today”.",
  }),
  supplement: msg({ message: "Supplement", comment: "Home-screen widget button." }),
  supplementAction: msg({
    message: "Taken",
    context: "supplement",
    comment: "Home-screen widget: marks the next supplement that is due as taken.",
  }),
  log: msg({ message: "Log…", comment: "Home-screen widget button: opens the log picker." }),
  logAction: msg({
    message: "Everything else",
    comment: "Home-screen widget: under “Log…”, which opens the log picker.",
  }),
  signedOut: msg({
    message: "Sign in to OpenValens to log from here.",
    comment: "Home-screen widget when no one is signed in on this phone.",
  }),
} satisfies Record<string, MessageDescriptor>);

/** The labels the native widget files carry, by their key in those files. */
export const NATIVE_WIDGET_STRINGS = Object.freeze({
  widget_name: HOME_WIDGET_COPY.name,
  widget_description: HOME_WIDGET_COPY.description,
  water: HOME_WIDGET_COPY.water,
  water_action: HOME_WIDGET_COPY.waterAction,
  supplement: HOME_WIDGET_COPY.supplement,
  supplement_action: HOME_WIDGET_COPY.supplementAction,
  log: HOME_WIDGET_COPY.log,
  log_action: HOME_WIDGET_COPY.logAction,
} satisfies Record<string, MessageDescriptor>);
