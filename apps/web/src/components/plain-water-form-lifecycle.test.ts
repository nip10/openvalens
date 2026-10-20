import { describe, expect, test } from "bun:test";

import { createPlainWaterController, type PlainWaterIntent } from "./plain-water-controller";
import {
  createPlainWaterFormLifecycle,
  isResolvedFormGeneration,
  newPlainWaterFormGeneration,
} from "./plain-water-form-lifecycle";

const owner = { scope: "org:user", date: "2026-07-01", timeZone: "UTC" };
const add: PlainWaterIntent = {
  kind: "add",
  payload: { quantity: 250, unit: "ml", observedAt: "2026-07-01T10:00:00Z", timeZone: "UTC" },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("controller-to-form lifecycle", () => {
  test("ack-loss retry completes same operation and retires only its submitted draft", async () => {
    const lifecycle = createPlainWaterFormLifecycle();
    const calls: string[] = [];
    let id = 0;
    const controller = createPlainWaterController({
      owner,
      createId: () => `id-${++id}`,
      send: async (operation) => {
        calls.push(operation.payload.clientMutationId);
        if (calls.length === 1) throw new Error("ack lost");
        return { outcome: "replayed" };
      },
    });
    const submitted = newPlainWaterFormGeneration();
    expect((await lifecycle.submit(controller, submitted, add)).status).toBe("uncertain");
    expect(lifecycle.resolvedGeneration).toBeNull();
    expect(isResolvedFormGeneration(submitted, lifecycle.resolvedGeneration)).toBe(false);
    // A privacy-keyed form can be replaced without disposing the controller;
    // a new draft generation is not mistaken for the held retry identity.
    const freshAfterPrivacyReset = newPlainWaterFormGeneration();
    expect(controller.state.status).toBe("uncertain");
    expect(isResolvedFormGeneration(freshAfterPrivacyReset, lifecycle.resolvedGeneration)).toBe(
      false,
    );
    expect(
      (
        await lifecycle.submit(controller, freshAfterPrivacyReset, {
          ...add,
          payload: { ...add.payload, quantity: 900 },
        })
      ).status,
    ).toBe("uncertain");
    expect(calls).toEqual(["id-1"]);
    expect((await lifecycle.retry(controller)).status).toBe("complete");
    expect(calls).toEqual(["id-1", "id-1"]);
    expect(isResolvedFormGeneration(submitted, lifecycle.resolvedGeneration)).toBe(true);
    expect(isResolvedFormGeneration(freshAfterPrivacyReset, lifecycle.resolvedGeneration)).toBe(
      false,
    );
    await lifecycle.submit(controller, submitted, add);
    expect(calls).toEqual(["id-1", "id-1"]);
    expect((await lifecycle.submit(controller, freshAfterPrivacyReset, add)).status).toBe(
      "complete",
    );
    expect(calls).toEqual(["id-1", "id-1", "id-2"]);
  });

  test("rebase success and Keep other resolve their original edit generation", async () => {
    for (const resolution of ["rebase", "keepOther"] as const) {
      const lifecycle = createPlainWaterFormLifecycle();
      let id = 0;
      const controller = createPlainWaterController({
        owner,
        createId: () => `id-${++id}`,
        send: async (operation) =>
          operation.payload.clientMutationId === "id-1"
            ? { outcome: "conflict", server: { revision: 9, quantityMl: 250, deleted: false } }
            : { outcome: "applied" },
      });
      const submitted = newPlainWaterFormGeneration();
      const edit: PlainWaterIntent = {
        kind: "change",
        payload: { id: 5, expectedRevision: 3, quantity: 400, unit: "ml" },
      };
      expect((await lifecycle.submit(controller, submitted, edit)).status).toBe("conflict");
      if (resolution === "rebase")
        expect((await lifecycle.rebase(controller)).status).toBe("complete");
      else expect(lifecycle.keepOther(controller)).toBe(true);
      expect(isResolvedFormGeneration(submitted, lifecycle.resolvedGeneration)).toBe(true);
      expect(
        isResolvedFormGeneration(newPlainWaterFormGeneration(), lifecycle.resolvedGeneration),
      ).toBe(false);
    }
  });

  test("a disposed old-scope completion cannot retire a form generation", async () => {
    const lifecycle = createPlainWaterFormLifecycle();
    const reply = deferred<{ outcome: "applied" }>();
    const controller = createPlainWaterController({
      owner,
      createId: () => "old-scope-id",
      send: () => reply.promise,
      onState: (state) => {
        lifecycle.observeControllerState(state);
      },
    });
    const generation = newPlainWaterFormGeneration();
    const pending = lifecycle.submit(controller, generation, add);
    controller.dispose();
    reply.resolve({ outcome: "applied" });
    await pending;
    expect(lifecycle.resolvedGeneration).toBeNull();
    expect(isResolvedFormGeneration(generation, lifecycle.resolvedGeneration)).toBe(false);
  });
});
