import type {
  PlainWaterControllerState,
  PlainWaterIntent,
  PlainWaterOperation,
} from "./plain-water-controller";

let nextGeneration = 0;

/** Globally monotonic within this page module, including privacy-key remounts. */
export function newPlainWaterFormGeneration(): number {
  nextGeneration += 1;
  return nextGeneration;
}

/** The view retires only the exact submitted draft generation. */
export function isResolvedFormGeneration(active: number | null, resolved: number | null): boolean {
  return active !== null && resolved === active;
}

type Controller = {
  state: PlainWaterControllerState;
  submit(intent: PlainWaterIntent): Promise<PlainWaterControllerState>;
  retry(): Promise<PlainWaterControllerState>;
  rebase(): Promise<PlainWaterControllerState>;
  keepOther(): boolean;
};

/** Coordinates controller operations while resolving only the form generation that submitted them. */
export function createPlainWaterFormLifecycle() {
  let active: { generation: number | null; operation: PlainWaterOperation } | null = null;
  let resolvedGeneration: number | null = null;
  const observe = (state: PlainWaterControllerState) => {
    if (state.status === "complete" && active?.operation === state.operation) {
      if (active.generation !== null) resolvedGeneration = active.generation;
      active = null;
    }
    return state;
  };
  return {
    get resolvedGeneration() {
      return resolvedGeneration;
    },
    async submit(controller: Controller, generation: number | null, intent: PlainWaterIntent) {
      // A fresh display draft cannot take ownership of an earlier uncertain or
      // conflicted operation. Its generation remains attached to the original.
      if (
        active ||
        controller.state.status === "busy" ||
        controller.state.status === "uncertain" ||
        controller.state.status === "conflict" ||
        (generation !== null && resolvedGeneration === generation)
      )
        return { status: "idle" };
      const state = await controller.submit(intent);
      if (state.status === "complete") {
        if (generation !== null) resolvedGeneration = generation;
      } else if (state.status === "uncertain" || state.status === "conflict") {
        active = { generation, operation: state.operation };
      }
      return state;
    },
    async retry(controller: Controller) {
      if (!active) return controller.state;
      const state = await controller.retry();
      if (state.status === "complete" && state.operation === active?.operation)
        return observe(state);
      return state;
    },
    async rebase(controller: Controller) {
      if (!active) return controller.state;
      const generation = active.generation;
      const state = await controller.rebase();
      if (state.status === "complete") {
        if (generation !== null) resolvedGeneration = generation;
        active = null;
        return state;
      }
      if (state.status === "uncertain" || state.status === "conflict")
        active = { generation, operation: state.operation };
      return state;
    },
    keepOther(controller: Controller) {
      if (!active || !controller.keepOther()) return false;
      if (active.generation !== null) resolvedGeneration = active.generation;
      active = null;
      return true;
    },
    /** Useful for wiring a subscription when completion arrives outside its original promise. */
    observeControllerState(state: PlainWaterControllerState) {
      if (!active || state.status !== "complete" || state.operation !== active.operation)
        return false;
      observe(state);
      return true;
    },
  };
}
