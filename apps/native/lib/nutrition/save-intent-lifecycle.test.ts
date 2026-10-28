import { expect, test } from "bun:test";

import { runIsolatedHarness } from "../test-harness/run-isolated";

test("mounted Add Food lifecycle gates and stale completion races", async () => {
  const output = await runIsolatedHarness(`${import.meta.dir}/save-intent-lifecycle.fixture.mts`);
  expect(output).toMatch(/6 pass\s+0 fail/);
});
