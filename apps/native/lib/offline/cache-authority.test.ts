import { expect, test } from "bun:test";

import { runIsolatedHarness } from "../test-harness/run-isolated";

test("offline cache authority and SQLite sign-out race", async () => {
  const output = await runIsolatedHarness(`${import.meta.dir}/cache-authority.mts`);
  expect(output).toMatch(/2 pass\s+0 fail/);
});
