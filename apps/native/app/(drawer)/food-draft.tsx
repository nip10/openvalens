import { router, useFocusEffect } from "expo-router";
import { useCallback } from "react";

/**
 * Legacy deep links (and "Describe a meal" in the drawer) enter the
 * diary-owned draft flow. The diary goes underneath first: closing the sheet
 * then lands on the diary. A plain redirect left this screen underneath, so
 * Cancel and Back came back here and opened the sheet again (#302).
 */
export default function FoodDraftRedirect() {
  useFocusEffect(
    useCallback(() => {
      router.replace("/(drawer)/(tabs)/nutrition");
      router.push({ pathname: "/log-food", params: { mode: "describe" } });
    }, []),
  );
  return null;
}
