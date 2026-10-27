import type { QueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";

import { orpc } from "@/utils/orpc";
import { shouldRedirectToWelcome, type OnboardingExtras } from "@/utils/onboarding";
import { wellnessProfileQueryOptions } from "@/utils/wellness-profile";

/**
 * The answers outside the profile that count toward "N of 8": a goal exists,
 * the AI consent was answered, daily reminders are on. Each read is optional:
 * while loading or on error the step reads as not done.
 */
export function useOnboardingExtras(enabled = true): OnboardingExtras {
  const goals = useQuery({
    ...orpc.plans.goals.listGoals.queryOptions({ input: {} }),
    enabled,
    retry: 1,
  });
  const ai = useQuery({ ...orpc.ai.consent.get.queryOptions({ input: {} }), enabled, retry: 1 });
  const insights = useQuery({
    ...orpc.insights.preferences.get.queryOptions({ input: {} }),
    enabled,
    retry: 1,
  });
  return {
    goalCount: goals.data ? goals.data.length : null,
    aiConsentAnswered: ai.isSuccess ? ai.data !== null : null,
    remindersOn: insights.data ? insights.data.dailyReminders.email : null,
  };
}

/**
 * For a route's `beforeLoad`: whether this signed-in person should be sent to
 * `/welcome` (see {@link shouldRedirectToWelcome}). A failed profile read never
 * redirects, so the dashboard always stays reachable.
 */
export async function needsWelcomeRedirect(
  queryClient: QueryClient,
  userId: string | undefined,
): Promise<boolean> {
  if (!userId) return false;
  try {
    const profile = await queryClient.ensureQueryData(wellnessProfileQueryOptions(userId));
    return shouldRedirectToWelcome(profile);
  } catch {
    return false;
  }
}
