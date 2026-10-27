import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

/**
 * Onboarding progress kept on this phone, per account: the steps passed that
 * store nothing on the server (goal, privacy, or a skipped step) and whether
 * the flow already opened by itself once. Step ids only, never answers.
 */
type LocalProgress = { visited: string[]; autoOpened: boolean };

const EMPTY: LocalProgress = { visited: [], autoOpened: false };

const storageKey = (userId: string) => `openvalens.onboarding.${userId}`;
export const localProgressQueryKey = (userId: string) => ["onboarding-local", userId] as const;

async function read(userId: string): Promise<LocalProgress> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(userId));
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<LocalProgress>;
    return {
      visited: Array.isArray(parsed.visited)
        ? parsed.visited.filter((v) => typeof v === "string")
        : [],
      autoOpened: parsed.autoOpened === true,
    };
  } catch {
    return EMPTY;
  }
}

export function useLocalOnboardingProgress(userId: string) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: localProgressQueryKey(userId),
    queryFn: () => read(userId),
    enabled: !!userId,
    staleTime: Infinity,
  });

  const write = useCallback(
    async (change: (current: LocalProgress) => LocalProgress) => {
      const next = change(await read(userId));
      queryClient.setQueryData(localProgressQueryKey(userId), next);
      await AsyncStorage.setItem(storageKey(userId), JSON.stringify(next)).catch(() => undefined);
    },
    [queryClient, userId],
  );

  const markVisited = useCallback(
    (step: string) =>
      write((current) =>
        current.visited.includes(step)
          ? current
          : { ...current, visited: [...current.visited, step] },
      ),
    [write],
  );
  const markAutoOpened = useCallback(
    () => write((current) => ({ ...current, autoOpened: true })),
    [write],
  );

  return {
    loaded: query.isSuccess,
    visited: new Set(query.data?.visited ?? []),
    autoOpened: query.data?.autoOpened ?? false,
    markVisited,
    markAutoOpened,
  };
}
