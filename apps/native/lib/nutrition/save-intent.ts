import type { OfflineWriteTicket } from "@/lib/offline/sync";
import { useCallback, useLayoutEffect, useRef, useState } from "react";

export type AddFoodSaveIntent = {
  generation: number;
  contextKey: string;
  ticket: OfflineWriteTicket | null;
  foodFingerprint: string;
  createMutationId: string;
  diaryMutationId: string;
};

/** Small synchronous gate shared by the Add Food form and its async completion. */
export class AddFoodSaveController {
  private contextKey: string | null = null;
  private generation = 0;
  private pending = false;
  private active: AddFoodSaveIntent | null = null;
  private retry: Pick<
    AddFoodSaveIntent,
    "foodFingerprint" | "createMutationId" | "diaryMutationId"
  > | null = null;

  setContext(contextKey: string): void {
    if (this.contextKey === contextKey) return;
    this.invalidate();
    this.contextKey = contextKey;
  }

  isPending(): boolean {
    return this.pending;
  }

  begin(
    ticket: OfflineWriteTicket | null,
    fingerprint: string,
    newId: () => string,
    contextKey: string,
  ): AddFoodSaveIntent | null {
    if (this.pending || this.contextKey !== contextKey) return null;
    this.pending = true;
    if (!this.retry || this.retry.foodFingerprint !== fingerprint) {
      this.retry = {
        foodFingerprint: fingerprint,
        createMutationId: newId(),
        diaryMutationId: newId(),
      };
    }
    const intent = { generation: this.generation, contextKey, ticket, ...this.retry };
    this.active = intent;
    return intent;
  }

  isCurrent(intent: AddFoodSaveIntent): boolean {
    return (
      this.pending &&
      this.active === intent &&
      intent.generation === this.generation &&
      intent.contextKey === this.contextKey
    );
  }

  finish(intent: AddFoodSaveIntent): boolean {
    if (!this.isCurrent(intent)) return false;
    this.pending = false;
    this.active = null;
    this.retry = null;
    return true;
  }

  release(intent: AddFoodSaveIntent): boolean {
    if (!this.isCurrent(intent)) return false;
    this.pending = false;
    this.active = null;
    return true;
  }

  invalidate(): void {
    this.generation += 1;
    this.pending = false;
    this.active = null;
    this.retry = null;
  }
}

/** Lifecycle/input gate used by AddFood; context changes and unmount revoke synchronously at commit. */
export function useAddFoodSaveLifecycle(contextKey: string) {
  const controllerRef = useRef<AddFoodSaveController | null>(null);
  if (controllerRef.current === null) controllerRef.current = new AddFoodSaveController();
  const controller = controllerRef.current;
  const [pending, setPending] = useState(false);

  useLayoutEffect(() => {
    controller.setContext(contextKey);
    setPending(false);
    return () => controller.invalidate();
  }, [contextKey, controller]);

  const canMutate = useCallback(() => !controller.isPending(), [controller]);
  const bindMutation = useCallback(
    <TArgs extends unknown[]>(mutation: (...args: TArgs) => void) =>
      (...args: TArgs) => {
        if (controller.isPending()) return;
        mutation(...args);
      },
    [controller],
  );
  const begin = useCallback(
    (ticket: OfflineWriteTicket | null, fingerprint: string, newId: () => string) => {
      const intent = controller.begin(ticket, fingerprint, newId, contextKey);
      if (intent) setPending(true);
      return intent;
    },
    [contextKey, controller],
  );
  const finish = useCallback(
    (intent: AddFoodSaveIntent) => {
      if (!controller.finish(intent)) return false;
      setPending(false);
      return true;
    },
    [controller],
  );
  const release = useCallback(
    (intent: AddFoodSaveIntent) => {
      if (!controller.release(intent)) return false;
      setPending(false);
      return true;
    },
    [controller],
  );
  const invalidate = useCallback(() => {
    controller.invalidate();
    setPending(false);
  }, [controller]);

  return {
    controller,
    editable: !pending,
    canMutate,
    bindMutation,
    begin,
    finish,
    release,
    invalidate,
    contextKey,
  };
}

/** Production sequencing for the deferred create-food portion of Add Food. */
export async function completeAddFoodCreation<T>(options: {
  intent: AddFoodSaveIntent;
  isCurrent: () => boolean;
  create: (mutationId: string) => Promise<T>;
  enqueue: (created: T) => boolean;
  finish: (intent: AddFoodSaveIntent) => boolean;
  release: (intent: AddFoodSaveIntent) => boolean;
  onError: () => void;
  onStored: (created: T) => void;
}): Promise<boolean> {
  let created: T;
  try {
    created = await options.create(options.intent.createMutationId);
  } catch {
    if (options.isCurrent()) options.onError();
    options.release(options.intent);
    return false;
  }
  if (!options.isCurrent()) {
    options.release(options.intent);
    return false;
  }
  if (!options.enqueue(created)) {
    options.release(options.intent);
    return false;
  }
  if (!options.finish(options.intent)) return false;
  options.onStored(created);
  return true;
}
