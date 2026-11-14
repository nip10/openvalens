/**
 * The app entry. expo-router's own entry renders the app; the home-screen
 * widget's Android task (#449) is registered here too, so Android can draw the
 * widget while the app is closed.
 */
import "expo-router/entry";

import { registerHomeWidgetTask } from "./lib/home-widget/platform";

registerHomeWidgetTask();
