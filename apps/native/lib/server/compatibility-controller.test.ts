import { describe, expect, test } from "bun:test";

import {
  compatibilityAllowsChildren,
  createCompatibilityController,
  type CompatibilityState,
} from "./compatibility-controller";

describe("startup compatibility controller", () => {
  test("an older saved server stays blocked; a compatible retry opens the gate", async () => {
    const states: CompatibilityState[] = [];
    let compatible = false;
    const controller = createCompatibilityController(
      async () =>
        compatible
          ? { ok: true }
          : { ok: false, problem: { kind: "server-too-old", serverVersion: "1.0.0" } },
      (state) => states.push(state),
    );
    await controller.check("https://saved.example");
    const blocked = states.at(-1);
    expect(blocked?.status).toBe("blocked");
    if (!blocked) throw new Error("Expected a blocked startup state");
    expect(compatibilityAllowsChildren(blocked, "https://saved.example")).toBe(false);
    compatible = true;
    await controller.check("https://saved.example");
    const ready = states.at(-1);
    expect(ready?.status).toBe("ready");
    if (!ready) throw new Error("Expected a ready startup state");
    expect(compatibilityAllowsChildren(ready, "https://saved.example")).toBe(true);
  });

  test("an incompatible result does not satisfy the actual gate-readiness predicate", async () => {
    const states: CompatibilityState[] = [];
    let routeMounts = 0;
    const controller = createCompatibilityController(
      async () => ({
        ok: false,
        problem: { kind: "server-too-old", serverVersion: "1.0.1" },
      }),
      (state) => states.push(state),
    );
    await controller.check("https://saved.example");
    const result = states[states.length - 1];
    if (result && compatibilityAllowsChildren(result, "https://saved.example")) routeMounts += 1;
    expect(routeMounts).toBe(0);
  });

  test("an older URL's late success cannot unblock a newer server", async () => {
    const states: CompatibilityState[] = [];
    let resolveOld:
      | ((result: { ok: true } | { ok: false; problem: { kind: "unreachable" } }) => void)
      | undefined;
    const controller = createCompatibilityController(
      (url) =>
        url.includes("old")
          ? new Promise((resolve) => {
              resolveOld = resolve;
            })
          : Promise.resolve({ ok: false, problem: { kind: "unreachable" } }),
      (state) => states.push(state),
    );
    const oldCheck = controller.check("https://old.example");
    await controller.check("https://new.example");
    resolveOld?.({ ok: true });
    await oldCheck;
    expect(states.at(-1)).toMatchObject({ status: "blocked", url: "https://new.example" });
  });

  test("a foreground recheck blocks again without any server cleanup", async () => {
    const states: CompatibilityState[] = [];
    let ok = true;
    const controller = createCompatibilityController(
      async () =>
        ok ? { ok: true } : { ok: false, problem: { kind: "server-too-old", serverVersion: "1" } },
      (state) => states.push(state),
    );
    await controller.check("https://saved.example");
    ok = false;
    await controller.check("https://saved.example");
    expect(states.at(-1)?.status).toBe("blocked");
  });

  test("a newer same-URL result wins over an older in-flight recheck", async () => {
    const states: CompatibilityState[] = [];
    const pending: Array<
      (result: { ok: true } | { ok: false; problem: { kind: "unreachable" } }) => void
    > = [];
    const controller = createCompatibilityController(
      () => new Promise((resolve) => pending.push(resolve)),
      (state) => states.push(state),
    );
    const outdated = controller.check("https://saved.example");
    const foreground = controller.check("https://saved.example");
    pending[1]?.({ ok: true });
    await foreground;
    pending[0]?.({ ok: false, problem: { kind: "unreachable" } });
    await outdated;
    expect(states.at(-1)).toMatchObject({ status: "ready", url: "https://saved.example" });
  });

  test("a disposed controller ignores its outstanding probe result", async () => {
    const states: CompatibilityState[] = [];
    let finish: ((result: { ok: true }) => void) | undefined;
    const controller = createCompatibilityController(
      () => new Promise((resolve) => (finish = resolve)),
      (state) => states.push(state),
    );
    const inFlight = controller.check("https://saved.example");
    controller.dispose();
    finish?.({ ok: true });
    await inFlight;
    expect(states).toHaveLength(1);
    expect(states[0]?.status).toBe("checking");
  });
});
