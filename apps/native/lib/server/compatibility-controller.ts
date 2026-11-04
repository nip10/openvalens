import type { ServerProblem } from "./server-meta";

export type CompatibilityState =
  | { status: "checking"; url: string; generation: number }
  | { status: "ready"; url: string; generation: number }
  | { status: "blocked"; url: string; generation: number; problem: ServerProblem };

export function compatibilityAllowsChildren(state: CompatibilityState, url: string): boolean {
  return state.status === "ready" && state.url === url;
}

/** Latest-generation-wins controller used by the startup gate. */
export function createCompatibilityController(
  probe: (url: string) => Promise<{ ok: true } | { ok: false; problem: ServerProblem }>,
  publish: (state: CompatibilityState) => void,
) {
  let generation = 0;
  let disposed = false;
  let currentUrl = "";

  const check = async (url: string): Promise<void> => {
    currentUrl = url;
    const requestGeneration = ++generation;
    publish({ status: "checking", url, generation: requestGeneration });
    const result = await probe(url).catch(() => ({
      ok: false as const,
      problem: { kind: "unreachable" as const },
    }));
    if (disposed || requestGeneration !== generation || currentUrl !== url) return;
    publish(
      result.ok
        ? { status: "ready", url, generation: requestGeneration }
        : { status: "blocked", url, generation: requestGeneration, problem: result.problem },
    );
  };

  return {
    check,
    dispose() {
      disposed = true;
      generation += 1;
    },
  };
}
