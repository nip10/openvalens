import { expect, test } from "bun:test";

import { runIsolatedHarness } from "./test-harness/run-isolated";

test("native magic-link security scenarios", async () => {
  const output = await runIsolatedHarness(`${import.meta.dir}/test-harness/magic-link.mts`);
  expect(output).toMatch(/38 pass\s+0 fail/);
});
