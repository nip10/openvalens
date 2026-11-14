import { Stack } from "expo-router";

/** Onboarding (#444) — the first run and the "Finish setting up" items, one screen each (see lib/onboarding/steps). */
export default function OnboardingLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
