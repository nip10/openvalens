import { expect, test } from "bun:test";

import { runIsolatedHarness } from "../test-harness/run-isolated";

test("server-leave safety counts durable offline data and blocks unsafe leaves", async () => {
  const output = await runIsolatedHarness(`${import.meta.dir}/server-leave-safety.harness.mts`);
  expect(output).toMatch(/17 pass\s+0 fail/);
});
