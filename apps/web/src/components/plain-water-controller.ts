import type { WaterUnit } from "@openvalens/api/presenters/plain-water";

export type WaterChangePatch = {
  quantity?: number;
  unit?: WaterUnit;
  observedAt?: string;
  timeZone?: string;
};

export type PlainWaterOperation =
  | {
      kind: "add";
      payload: {
        clientMutationId: string;
        quantity: number;
        unit: WaterUnit;
        observedAt: string;
        timeZone: string;
      };
    }
  | {
      kind: "change";
      payload: {
        clientMutationId: string;
        id: number;
        expectedRevision: number;
      } & WaterChangePatch;
    }
  | { kind: "delete"; payload: { clientMutationId: string; id: number; expectedRevision: number } };
export type PlainWaterIntent =
  | {
      kind: "add";
      payload: { quantity: number; unit: WaterUnit; observedAt: string; timeZone: string };
    }
  | { kind: "change"; payload: { id: number; expectedRevision: number } & WaterChangePatch }
  | { kind: "delete"; payload: { id: number; expectedRevision: number } };

export type PlainWaterConflict = { revision: number; quantityMl: number | null; deleted: boolean };
export type PlainWaterResult =
  | { outcome: "applied" | "replayed" }
  | { outcome: "conflict"; server: PlainWaterConflict };
export type PlainWaterControllerState =
  | { status: "idle" }
  | { status: "busy"; operation: PlainWaterOperation }
  | { status: "uncertain"; operation: PlainWaterOperation; error: unknown }
  | { status: "conflict"; operation: PlainWaterOperation; server: PlainWaterConflict }
  | { status: "complete"; operation: PlainWaterOperation; outcome: "applied" | "replayed" };

export type PlainWaterTransport = (operation: PlainWaterOperation) => Promise<PlainWaterResult>;

export type PlainWaterOwner = { scope: string | null; date: string; timeZone: string };

/** Query keys partition private reads by trusted owner; preference data is scope-specific. */
export function plainWaterDayKey(owner: PlainWaterOwner): readonly unknown[] {
  return ["plain-water", owner.scope, "day", owner.date, owner.timeZone] as const;
}

export function plainWaterPreferencesKey(owner: PlainWaterOwner): readonly unknown[] {
  return ["plain-water", owner.scope, "preferences"] as const;
}

/**
 * In-memory mutation coordinator. A lost acknowledgement keeps the identical
 * immutable operation for retry; it is intentionally not durable across reload/navigation.
 * Create a fresh controller on every effect setup: dispose is irreversible, which
 * makes StrictMode cleanup/setup safe and prevents stale generations reactivating.
 */
export function createPlainWaterController(options: {
  owner: PlainWaterOwner;
  send: PlainWaterTransport;
  createId: () => string;
  onState?: (state: PlainWaterControllerState) => void;
}) {
  let disposed = false;
  let state: PlainWaterControllerState = { status: "idle" };
  let active: PlainWaterOperation | null = null;
  const subscribers = new Set<(state: PlainWaterControllerState) => void>();

  const publish = (next: PlainWaterControllerState) => {
    if (disposed) return;
    state = next;
    options.onState?.(next);
    for (const subscriber of subscribers) subscriber(next);
  };
  const validOwner = () => options.owner.scope !== null && !disposed;
  const withId = (operation: PlainWaterIntent): PlainWaterOperation => {
    const payload = Object.freeze({ ...operation.payload, clientMutationId: options.createId() });
    return Object.freeze({ kind: operation.kind, payload }) as PlainWaterOperation;
  };

  const transmit = async (operation: PlainWaterOperation): Promise<PlainWaterControllerState> => {
    if (!validOwner()) return state;
    publish({ status: "busy", operation });
    try {
      const result = await options.send(operation);
      if (disposed) return state;
      if (result.outcome === "conflict") {
        const next = { status: "conflict", operation, server: result.server } as const;
        publish(next);
        return next;
      }
      active = null;
      const next = { status: "complete", operation, outcome: result.outcome } as const;
      publish(next);
      return next;
    } catch (error) {
      if (disposed) return state;
      const next = { status: "uncertain", operation, error } as const;
      publish(next);
      return next;
    }
  };

  return {
    get owner() {
      return options.owner;
    },
    get state() {
      return state;
    },
    subscribe(listener: (state: PlainWaterControllerState) => void) {
      if (disposed) return () => {};
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
    submit(operation: PlainWaterIntent): Promise<PlainWaterControllerState> {
      if (!validOwner()) return Promise.resolve(state);
      if (active) return Promise.resolve(state);
      active = withId(operation);
      return transmit(active);
    },
    retry(): Promise<PlainWaterControllerState> {
      if (!validOwner() || state.status !== "uncertain" || active !== state.operation)
        return Promise.resolve(state);
      return transmit(active);
    },
    /** Accept the authoritative server version and release only a confirmed conflict. */
    keepOther(): boolean {
      if (!validOwner() || state.status !== "conflict" || active !== state.operation) return false;
      active = null;
      publish({ status: "idle" });
      return true;
    },
    /** Explicitly reapply a conflict using its authoritative revision and a fresh ID. */
    rebase(): Promise<PlainWaterControllerState> {
      if (!validOwner() || state.status !== "conflict" || active !== state.operation)
        return Promise.resolve(state);
      const previous = active;
      const server = state.server;
      if (server.deleted || previous.kind === "add") return Promise.resolve(state);
      const { clientMutationId: _oldId, ...payload } = previous.payload;
      const operation = withId({
        kind: previous.kind,
        payload: { ...payload, expectedRevision: server.revision },
      } as PlainWaterIntent);
      active = operation;
      return transmit(operation);
    },
    dispose() {
      disposed = true;
      subscribers.clear();
    },
  };
}
