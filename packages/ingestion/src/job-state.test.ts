import { expect, test } from "bun:test";

import { transitionBatchState, transitionJobState, transitionJobStateFromInput } from "./job-state";

test("job state machine allows only forward transitions", () => {
  expect(transitionJobState("queued", "running")).toBe("running");
  expect(transitionJobState("running", "failed")).toBe("failed");
  expect(transitionJobState("succeeded", "succeeded")).toBe("succeeded");
  expect(() => transitionJobState("succeeded", "running")).toThrow();
  expect(() => transitionJobState("queued", "succeeded")).toThrow();
  expect(() => transitionJobStateFromInput("queued", "bogus")).toThrow();
});

test("batch state machine is terminal after completed/failed", () => {
  expect(transitionBatchState("processing", "completed")).toBe("completed");
  expect(() => transitionBatchState("failed", "processing")).toThrow();
});
