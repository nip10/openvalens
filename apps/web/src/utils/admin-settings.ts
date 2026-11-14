import type { OnboardingWindowDays } from "@openvalens/api/contracts/onboarding-measurement";

import { orpc } from "./orpc";

export type {
  AdminAccessOutput,
  AdminAiUsageOutput,
  AdminBackupStatusOutput,
  AdminConfigurationEntry,
  AdminConfigurationOutput,
  AdminOnboardingTotalsOutput,
} from "./admin-settings-keys";

import {
  adminAccessQueryKey,
  adminAiUsageQueryKey,
  adminBackupStatusQueryKey,
  adminConfigurationQueryKey,
  adminOnboardingTotalsQueryKey,
} from "./admin-settings-keys";

export function adminAccessQueryOptions(userId: string) {
  return {
    ...orpc.adminSettings.access.queryOptions({ input: {} }),
    queryKey: [...adminAccessQueryKey(userId)],
    staleTime: 0,
    retry: 1,
  };
}

export function adminConfigurationQueryOptions(userId: string) {
  return {
    ...orpc.adminSettings.configuration.queryOptions({ input: {} }),
    queryKey: [...adminConfigurationQueryKey(userId)],
    staleTime: 0,
    retry: 1,
  };
}

/** Issue #299 — this month's AI usage for the admin panel; refreshed every minute. */
export function adminAiUsageQueryOptions(userId: string) {
  return {
    ...orpc.adminSettings.aiUsage.queryOptions({ input: {} }),
    queryKey: [...adminAiUsageQueryKey(userId)],
    staleTime: 0,
    refetchInterval: 60_000,
    retry: 1,
  };
}

/** Issue #64 — backup status for the admin panel; refreshed every minute. */
export function adminBackupStatusQueryOptions(userId: string) {
  return {
    ...orpc.adminSettings.backupStatus.queryOptions({ input: {} }),
    queryKey: [...adminBackupStatusQueryKey(userId)],
    staleTime: 0,
    refetchInterval: 60_000,
    retry: 1,
  };
}

/** Issue #444 — onboarding totals for sign-ups in the last `windowDays` days. */
export function adminOnboardingTotalsQueryOptions(
  userId: string,
  windowDays: OnboardingWindowDays,
) {
  return {
    ...orpc.adminSettings.onboardingTotals.queryOptions({ input: { windowDays } }),
    queryKey: [...adminOnboardingTotalsQueryKey(userId, windowDays)],
    staleTime: 60_000,
    retry: 1,
  };
}
