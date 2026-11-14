import { Redirect } from "expo-router";

/**
 * The "+" tab (#440). Pressing it opens the log picker over the current tab
 * (see the tab layout), so this screen only shows when `/log` is opened from
 * a link: it hands over to the picker.
 */
export default function LogTab() {
  return <Redirect href="/quick-log" />;
}
