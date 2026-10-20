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

/** Bridges actual controller terminal actions to the exact form generation that submitted them. */
export function createPlainWaterFormLifecycle() {
  let active: { generation: number; operation: PlainWaterOperation } | null = null;
  let resolvedGeneration: number | null = null;
  const observe = (generation: number, state: PlainWaterControllerState) => {
    if (state.status === "complete") {
      active = null;
      resolvedGeneration = generation;
    } else if (state.status === "uncertain" || state.status === "conflict") {
      active = { generation, operation: state.operation };
    }
    return state;
  };
  return {
    get resolvedGeneration() {
      return resolvedGeneration;
    },
    async submit(controller: Controller, generation: number, intent: PlainWaterIntent) {
      // A fresh display draft cannot take ownership of an earlier uncertain or
      // conflicted operation. Its generation remains attached to the original.
      if (active || resolvedGeneration === generation) return controller.state;
      const state = await controller.submit(intent);
      return observe(generation, state);
    },
    async retry(controller: Controller) {
      if (!active) return controller.state;
      const generation = active.generation;
      const state = await controller.retry();
      if (state.status === "complete" && state.operation === active?.operation)
        return observe(generation, state);
      return state;
    },
    async rebase(controller: Controller) {
      if (!active) return controller.state;
      const generation = active.generation;
      const state = await controller.rebase();
      return observe(generation, state);
    },
    keepOther(controller: Controller) {
      if (!active || !controller.keepOther()) return false;
      resolvedGeneration = active.generation;
      active = null;
      return true;
    },
    /** Useful for wiring a subscription when completion arrives outside its original promise. */
    observeControllerState(state: PlainWaterControllerState) {
      if (!active || state.status !== "complete" || state.operation !== active.operation)
        return false;
      observe(active.generation, state);
      return true;
    },
  };
}
