import type { HomeWidgetSnapshot } from "./model";

/**
 * iOS and web (#449). The iOS widget (`targets/quick-log-widget`) is drawn by
 * WidgetKit from its own Swift code and is given nothing by the app: with no
 * App Group there is no storage the two share. So the app has nothing to send
 * it, and a tap on a kind turned off since is handled by the app. Android has
 * `platform.android.ts`.
 */
export const HOME_WIDGET_DRAWN_BY_APP = false;

export async function drawHomeWidget(_snapshot: HomeWidgetSnapshot | null): Promise<void> {}

export function registerHomeWidgetTask(): void {}

/**
 * The iOS widget's buttons are plain links: nothing records a tap, so no link
 * is known to be the widget's and every one waits for "Save" (#505).
 */
export function takeHomeWidgetTap(_action: "water" | "supplement"): number | null {
  return null;
}
