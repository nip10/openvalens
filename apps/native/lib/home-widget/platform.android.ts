import type { I18n } from "@lingui/core";
import { deviceTimeZone, localDateIn } from "@openvalens/api/presenters/nutrition-diary";
import { createAppI18n, resolveLocale, type Locale } from "@openvalens/i18n";
import { TurboModuleRegistry } from "react-native";
import type { WidgetTaskHandler } from "react-native-android-widget";

import { homeWidgetView, type HomeWidgetSnapshot } from "./model";
import { readHomeWidgetSnapshot } from "./storage";
import { widgetLayouts } from "./widget-layout";

/**
 * The Android home-screen widget (#449), drawn with react-native-android-widget.
 * The widget runs inside the app: Android starts the app's JS as a headless
 * task to draw it, and the task reads the snapshot the app stored. The
 * receiver (`QuickLog`) is set up by the library's config plugin in app.json.
 */
export const HOME_WIDGET_DRAWN_BY_APP = true;

/** The widget's name in app.json (`react-native-android-widget`). */
const WIDGET_NAME = "QuickLog";

type Library = typeof import("react-native-android-widget");

/** The library, or `null` in a build without its native module (an older dev client). */
function library(): Library | null {
  if (!TurboModuleRegistry.get("AndroidWidget")) return null;
  return require("react-native-android-widget") as Library;
}

const i18ns = new Map<Locale, I18n>();
function i18nFor(locale: Locale): I18n {
  let i18n = i18ns.get(locale);
  if (!i18n) {
    i18n = createAppI18n(locale);
    i18ns.set(locale, i18n);
  }
  return i18n;
}

function deviceLocale(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return null;
  }
}

function render(lib: Library, snapshot: HomeWidgetSnapshot | null) {
  // Signed out there is no snapshot: the phone's language.
  const i18n = i18nFor(snapshot?.locale ?? resolveLocale([deviceLocale()]));
  const view = homeWidgetView(snapshot, i18n, localDateIn(deviceTimeZone(), new Date()));
  return widgetLayouts(lib, view);
}

/** Redraws every placed widget from `snapshot` (`null`: signed out). */
export async function drawHomeWidget(snapshot: HomeWidgetSnapshot | null): Promise<void> {
  const lib = library();
  if (!lib) return;
  await lib.requestWidgetUpdate({
    widgetName: WIDGET_NAME,
    renderWidget: () => render(lib, snapshot),
  });
}

/** Android asks for a drawing when a widget is placed, resized or due an update. */
const handleWidgetTask: WidgetTaskHandler = async ({ widgetAction, renderWidget }) => {
  const lib = library();
  // Taps open a deep link: they never reach here.
  if (!lib || widgetAction === "WIDGET_DELETED" || widgetAction === "WIDGET_CLICK") return;
  renderWidget(render(lib, await readHomeWidgetSnapshot()));
};

/** From the app entry (`index.ts`), so the headless task exists before any screen loads. */
export function registerHomeWidgetTask(): void {
  library()?.registerWidgetTaskHandler(handleWidgetTask);
}
