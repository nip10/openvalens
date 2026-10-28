import { expect, test } from "bun:test";

import { runIsolatedHarness } from "../test-harness/run-isolated";

test("offline cleanup removes nutrition receipts and advances write authority", async () => {
  const output = await runIsolatedHarness(`${import.meta.dir}/nutrition-receipt-cleanup.mts`);
  expect(output).toMatch(/4 pass\s+0 fail/);
});
