import { expect, test } from "bun:test";

import { runIsolatedHarness } from "../test-harness/run-isolated";

test("Add Food intents fence deferred writes and persist only through the real SQLite outbox", async () => {
  const output = await runIsolatedHarness(`${import.meta.dir}/save-intent.fixture.mts`);
  expect(output).toMatch(/6 pass\s+0 fail/);
});
