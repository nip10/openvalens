import { wellnessProfileQueryKey } from "@openvalens/api/presenters/wellness-profile";
import type {
  WellnessProfileSnapshot,
  WellnessProfileUpdateInput,
} from "@openvalens/api/wellness-profile-contract";
import type { QueryClient } from "@tanstack/react-query";

export type ProfilePatch = Omit<WellnessProfileUpdateInput, "expectedRevision">;

/**
 * Puts the snapshot a profile write returned into the cache. A read of the
 * profile still in flight may have started before the write (a screen that
 * mounts refetches it) and would land after it with the old revision; the
 * next save would then send that revision and be refused as a conflict
 * ("Your profile was changed somewhere else"). So that read is cancelled first.
 */
export async function storeSavedProfile(
  queryClient: QueryClient,
  userId: string,
  snapshot: WellnessProfileSnapshot,
): Promise<WellnessProfileSnapshot> {
  const queryKey = wellnessProfileQueryKey(userId);
  await queryClient.cancelQueries({ queryKey, exact: true });
  queryClient.setQueryData(queryKey, snapshot);
  return snapshot;
}

/**
 * The first run's profile writes, one at a time. Each one sends the revision
 * cached when it starts, so Continue waits for the write that marks the first
 * run as started instead of sending the revision that write replaces.
 */
export function createProfileWriter({
  queryClient,
  userId,
  update,
}: {
  queryClient: QueryClient;
  userId: string;
  update: (input: WellnessProfileUpdateInput) => Promise<WellnessProfileSnapshot>;
}) {
  let queue: Promise<unknown> = Promise.resolve();

  /** Writes the patch `patchFor` builds from the cached snapshot; `null` when it builds none. */
  const write = (
    patchFor: (snapshot: WellnessProfileSnapshot) => ProfilePatch | null,
  ): Promise<WellnessProfileSnapshot | null> => {
    const run = queue.then(async () => {
      const snapshot = queryClient.getQueryData<WellnessProfileSnapshot>(
        wellnessProfileQueryKey(userId),
      );
      const patch = snapshot ? patchFor(snapshot) : null;
      if (!snapshot || !patch) return null;
      const next = await update({ ...patch, expectedRevision: snapshot.revision });
      return storeSavedProfile(queryClient, userId, next);
    });
    queue = run.catch(() => undefined);
    return run;
  };

  return {
    /** Saves a patch (setup marked in progress on the first save); `null` without a profile. */
    save: (patch: ProfilePatch) =>
      write((snapshot) =>
        snapshot.setupStatus === null && patch.setupStatus === undefined
          ? { ...patch, setupStatus: "in_progress" }
          : patch,
      ),
    /** Marks the first run as seen, so it opens by itself only once; `null` when it already was. */
    markStarted: () =>
      write((snapshot) => (snapshot.setupStatus === null ? { setupStatus: "in_progress" } : null)),
  };
}

export type ProfileWriter = ReturnType<typeof createProfileWriter>;
