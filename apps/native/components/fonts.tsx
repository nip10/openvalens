import {
  Figtree_400Regular,
  Figtree_500Medium,
  Figtree_600SemiBold,
  Figtree_700Bold,
} from "@expo-google-fonts/figtree";
import {
  Fraunces_400Regular,
  Fraunces_500Medium,
  Fraunces_600SemiBold,
} from "@expo-google-fonts/fraunces";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import { type ReactNode, useEffect, useState } from "react";
import { Platform } from "react-native";

// Keep the splash up until Bloom's fonts are ready, so text never jumps from
// the system face to Figtree on first paint.
void SplashScreen.preventAutoHideAsync().catch(() => {});

/** Give up waiting after this long and render with the system font. */
const FONT_TIMEOUT_MS = 2500;

/**
 * Loads Figtree (text) and Fraunces (headlines, big figures). The names below
 * are what Android looks fonts up by (see global.css); iOS matches the family
 * name and weight. If loading fails or is slow, the app renders anyway with
 * the system font as the fallback.
 */
export function BloomFonts({ children }: { children: ReactNode }) {
  const [loaded, error] = useFonts({
    Figtree_400Regular,
    Figtree_500Medium,
    Figtree_600SemiBold,
    Figtree_700Bold,
    Fraunces_400Regular,
    Fraunces_500Medium,
    Fraunces_600SemiBold,
  });
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), FONT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, []);

  const ready = loaded || !!error || timedOut;

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return null;
  return <>{children}</>;
}

/**
 * Font family names for places that take a style, not a class (navigation
 * headers, tab labels, charts). Matches the `font-display` / `font-sans`
 * tokens in global.css.
 */
export const DISPLAY_FONT = Platform.select({ ios: "Fraunces", default: "Fraunces_500Medium" });
export const BODY_FONT = Platform.select({ ios: "Figtree", default: "Figtree_400Regular" });
export const BODY_FONT_MEDIUM = Platform.select({ ios: "Figtree", default: "Figtree_500Medium" });
