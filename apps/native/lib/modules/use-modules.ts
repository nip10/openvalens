import {
  enabledModuleSet,
  isModuleEnabled,
  type PersonModule,
} from "@openvalens/api/presenters/modules";
import { wellnessProfileQueryKey } from "@openvalens/api/presenters/wellness-profile";
import { useQuery } from "@tanstack/react-query";

import { authClient } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";

/**
 * Onboarding stage 1 — the signed-in person's modules, from the wellness
 * profile (same query key as the profile screen, so one fetch serves both).
 * While loading, on error, signed out or before a choice, every module is on:
 * nothing disappears because a request is slow.
 */
export function useModules() {
  const { data: session } = authClient.useSession();
  const userId = session?.user?.id ?? "";
  const profile = useQuery({
    ...orpc.profile.get.queryOptions({ input: {} }),
    queryKey: [...wellnessProfileQueryKey(userId)],
    enabled: !!userId,
    retry: 1,
  });
  const source = profile.data ?? null;
  return {
    profile,
    userId,
    enabled: enabledModuleSet(source),
    isEnabled: (id: PersonModule) => isModuleEnabled(source, id),
  };
}

/** Whether one module is on (true while loading, see {@link useModules}). */
export function useModuleEnabled(id: PersonModule): boolean {
  return useModules().isEnabled(id);
}
