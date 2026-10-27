import { createFileRoute } from "@tanstack/react-router";

import { WelcomeFlow } from "@/components/onboarding/welcome-flow";

/** Onboarding stage 2 — the first-run flow (focused layout: the shell hides the sidebar here). */
export const Route = createFileRoute("/_auth/welcome")({
  component: WelcomeFlow,
});
