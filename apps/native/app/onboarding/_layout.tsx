import { Stack } from "expo-router";

/** Onboarding stage 3 — the first-run flow, one step per screen (see lib/onboarding/steps). */
export default function OnboardingLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
