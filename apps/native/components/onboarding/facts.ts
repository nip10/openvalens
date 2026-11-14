import type { OnboardingFacts } from "@openvalens/api/presenters/onboarding";
import { useQuery } from "@tanstack/react-query";

import { getHealthAccess } from "@/lib/health-sync";
import { needsHealthConsent } from "@/lib/health-consent";
import { orpc } from "@/utils/orpc";

import { useHealthConsentStatus } from "./flow";

/**
 * The answers outside the profile that the "Finish setting up" card reads
 * (#444), the same as on the web: an entry exists, something is connected
 * (this phone's health app, a phone syncing, or a wearable account), a goal
 * exists, the AI consent was answered, daily reminders are on; plus whether
 * the health-data consent is still waiting. While loading or on error an
 * item reads as not done.
 */
export function useOnboardingFacts(userId: string, enabled = true): OnboardingFacts {
  const options = { enabled: enabled && !!userId, retry: 1 } as const;
  const consent = useHealthConsentStatus(userId);
  const recents = useQuery({ ...orpc.quickLog.recents.queryOptions({ input: {} }), ...options });
  const phones = useQuery({ ...orpc.mobile.syncStatus.queryOptions({ input: {} }), ...options });
  const wearables = useQuery({ ...orpc.wearables.list.queryOptions({ input: {} }), ...options });
  const goals = useQuery({ ...orpc.plans.goals.listGoals.queryOptions({ input: {} }), ...options });
  const ai = useQuery({ ...orpc.ai.consent.get.queryOptions({ input: {} }), ...options });
  const insights = useQuery({
    ...orpc.insights.preferences.get.queryOptions({ input: {} }),
    ...options,
  });
  // The same key Settings › Health data and the connect screen keep current.
  const access = useQuery({
    queryKey: ["health-sync", "access"],
    queryFn: getHealthAccess,
    enabled: options.enabled,
  });

  const phoneGranted = (access.data?.grantedTypes.length ?? 0) > 0;
  const connected =
    phoneGranted ||
    (phones.data?.devices.length ?? 0) > 0 ||
    (wearables.data?.providers ?? []).some((row) => row.status !== "not_connected")
      ? true
      : phones.data || wearables.data || access.data
        ? false
        : null;
  return {
    consentNeeded: consent.data ? needsHealthConsent(consent.data) : null,
    hasEntries: recents.data ? recents.data.entries.length > 0 : null,
    connected,
    goalCount: goals.data ? goals.data.length : null,
    aiConsentAnswered: ai.isSuccess ? ai.data !== null : null,
    remindersOn: insights.data ? insights.data.dailyReminders.email : null,
  };
}
