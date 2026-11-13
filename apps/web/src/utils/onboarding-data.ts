import { needsFirstRun, type OnboardingFacts } from "@openvalens/api/presenters/onboarding";
import type { QueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";

import { needsHealthConsent } from "@/utils/health-consent";
import { client, orpc } from "@/utils/orpc";
import { wellnessProfileQueryOptions } from "@/utils/wellness-profile";

/** The health-data consent status, shared by the banner, the first run and the redirect. */
export function healthConsentStatusQueryOptions(userId: string | null | undefined) {
  return {
    queryKey: ["healthConsent", "status", userId ?? null] as const,
    queryFn: () => client.healthConsent.status({}),
    staleTime: 60_000,
  };
}

/**
 * The answers outside the profile that the "Finish setting up" card reads
 * (#444): an entry exists, a phone or wearable is connected, a goal exists,
 * the AI consent was answered, daily reminders are on. Each read is optional:
 * while loading or on error the item reads as not done.
 */
export function useOnboardingFacts(enabled = true): OnboardingFacts {
  const options = { enabled, retry: 1 } as const;
  const recents = useQuery({ ...orpc.quickLog.recents.queryOptions({ input: {} }), ...options });
  const phones = useQuery({ ...orpc.mobile.syncStatus.queryOptions({ input: {} }), ...options });
  const wearables = useQuery({ ...orpc.wearables.list.queryOptions({ input: {} }), ...options });
  const goals = useQuery({ ...orpc.plans.goals.listGoals.queryOptions({ input: {} }), ...options });
  const ai = useQuery({ ...orpc.ai.consent.get.queryOptions({ input: {} }), ...options });
  const insights = useQuery({
    ...orpc.insights.preferences.get.queryOptions({ input: {} }),
    ...options,
  });
  const connected =
    phones.data || wearables.data
      ? (phones.data?.devices.length ?? 0) > 0 ||
        (wearables.data?.providers ?? []).some((row) => row.status !== "not_connected")
      : null;
  return {
    hasEntries: recents.data ? recents.data.entries.length > 0 : null,
    connected,
    goalCount: goals.data ? goals.data.length : null,
    aiConsentAnswered: ai.isSuccess ? ai.data !== null : null,
    remindersOn: insights.data ? insights.data.dailyReminders.email : null,
  };
}

/**
 * For a route's `beforeLoad`: whether this signed-in person is sent to
 * `/welcome` (see `needsFirstRun`). A failed read never redirects, so Today
 * always stays reachable.
 */
export async function needsWelcomeRedirect(
  queryClient: QueryClient,
  userId: string | undefined,
): Promise<boolean> {
  if (!userId) return false;
  try {
    const profile = await queryClient.ensureQueryData(wellnessProfileQueryOptions(userId));
    // The consent only matters for someone part-way; skip the read otherwise.
    if (profile.setupStatus !== "in_progress") return needsFirstRun(profile);
    const consent = await queryClient
      .ensureQueryData(healthConsentStatusQueryOptions(userId))
      .catch(() => null);
    return needsFirstRun(profile, { consentNeeded: consent ? needsHealthConsent(consent) : null });
  } catch {
    return false;
  }
}
