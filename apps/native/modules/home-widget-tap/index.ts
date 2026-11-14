/**
 * Recorded taps on the Android home-screen widget (#505). The widget's
 * receiver, which the app does not export, records a water or "Taken" tap
 * just before it opens the app; this takes it. Android only: the native
 * module loads lazily, and is absent on iOS and in older builds.
 */

type NativeHomeWidgetTapModule = {
  /** Milliseconds since that button's last tap not yet taken, or `null`. Forgets it. */
  takeTap(action: string): number | null;
};

function loadNativeModule(): NativeHomeWidgetTapModule | null {
  const expo = require("expo") as {
    requireOptionalNativeModule(name: string): NativeHomeWidgetTapModule | null;
  };
  return expo.requireOptionalNativeModule("HomeWidgetTap");
}

let native: NativeHomeWidgetTapModule | null | undefined;

/**
 * How long ago that button was tapped on the widget, in ms, and forgets the
 * tap; `null` when there is none to take or the module is absent.
 */
export function takeHomeWidgetTap(action: "water" | "supplement"): number | null {
  if (native === undefined) native = loadNativeModule();
  try {
    const age = native?.takeTap(action);
    return typeof age === "number" ? age : null;
  } catch {
    return null;
  }
}
