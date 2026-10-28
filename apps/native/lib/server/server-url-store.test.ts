import { expect, test } from "bun:test";

import { runIsolatedHarness } from "../test-harness/run-isolated";

test("runtime server store (#295)", async () => {
  const output = await runIsolatedHarness(`${import.meta.dir}/server-url-store.mts`);
  expect(output).toMatch(/3 pass\s+0 fail/);
});
