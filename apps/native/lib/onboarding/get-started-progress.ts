import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

/**
 * The "Get started" card's state on this phone, per account: whether it was
 * dismissed, and the items once seen done. Item ids only, never data.
 */
type GetStartedProgress = { dismissed: boolean; done: string[] };

const EMPTY: GetStartedProgress = { dismissed: false, done: [] };

const storageKey = (userId: string) => `openvalens.get-started.${userId}`;
const queryKey = (userId: string) => ["get-started-local", userId] as const;

async function read(userId: string): Promise<GetStartedProgress> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(userId));
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<GetStartedProgress>;
    return {
      dismissed: parsed.dismissed === true,
      done: Array.isArray(parsed.done) ? parsed.done.filter((v) => typeof v === "string") : [],
    };
  } catch {
    return EMPTY;
  }
}

export function useGetStartedProgress(userId: string) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKey(userId),
    queryFn: () => read(userId),
    enabled: !!userId,
    staleTime: Infinity,
  });

  const write = useCallback(
    async (change: (current: GetStartedProgress) => GetStartedProgress) => {
      const next = change(await read(userId));
      queryClient.setQueryData(queryKey(userId), next);
      await AsyncStorage.setItem(storageKey(userId), JSON.stringify(next)).catch(() => undefined);
    },
    [queryClient, userId],
  );

  const markDone = useCallback(
    (ids: readonly string[]) =>
      write((current) => {
        const added = ids.filter((id) => !current.done.includes(id));
        return added.length === 0 ? current : { ...current, done: [...current.done, ...added] };
      }),
    [write],
  );
  const dismiss = useCallback(() => write((current) => ({ ...current, dismissed: true })), [write]);

  return {
    loaded: query.isSuccess,
    dismissed: query.data?.dismissed ?? false,
    done: new Set(query.data?.done ?? []),
    markDone,
    dismiss,
  };
}
