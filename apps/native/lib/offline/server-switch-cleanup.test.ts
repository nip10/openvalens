import { expect, test } from "bun:test";

import { runIsolatedHarness } from "../test-harness/run-isolated";

test("server switch counts and wipes every offline lane (#295)", async () => {
  const output = await runIsolatedHarness(`${import.meta.dir}/server-switch-cleanup.mts`);
  expect(output).toMatch(/2 pass\s+0 fail/);
});
