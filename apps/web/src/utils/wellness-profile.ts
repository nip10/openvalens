import { wellnessProfileQueryKey } from "@openvalens/api/presenters/wellness-profile";
import type {
  WellnessProfileSnapshot,
  WellnessProfileUpdateInput,
} from "@openvalens/api/wellness-profile-contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { authClient } from "@/lib/auth-client";
import { client, orpc } from "@/utils/orpc";

/**
 * Issue #98 — the signed-in person's wellness profile. The query key carries
 * the user id so a cached profile can never render for another account, and
 * the profile is never written to the offline cache: saving needs a
 * connection, and success is only shown once the server confirms.
 */
export function wellnessProfileQueryOptions(userId: string) {
  return {
    ...orpc.profile.get.queryOptions({ input: {} }),
    queryKey: [...wellnessProfileQueryKey(userId)],
    staleTime: 30_000,
    retry: 1,
  };
}

export function useWellnessProfile() {
  const { data: session } = authClient.useSession();
  const userId = session?.user?.id ?? "";
  const query = useQuery({ ...wellnessProfileQueryOptions(userId), enabled: !!userId });
  return { ...query, userId };
}

/** Server-confirmed profile update; the cache is replaced with the server's snapshot. */
export function useUpdateWellnessProfile(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: WellnessProfileUpdateInput) => client.profile.update(input),
    onSuccess: (snapshot: WellnessProfileSnapshot) => {
      queryClient.setQueryData(wellnessProfileQueryKey(userId), snapshot);
    },
  });
}
