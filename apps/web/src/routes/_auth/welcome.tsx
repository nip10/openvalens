import { createFileRoute } from "@tanstack/react-router";

import { WelcomeFlow } from "@/components/onboarding/welcome-flow";

/** Onboarding (#444) — the three-screen first run (focused layout: the shell hides the sidebar here). */
export const Route = createFileRoute("/_auth/welcome")({
  component: WelcomeFlow,
});
