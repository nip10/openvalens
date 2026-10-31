import { expect, test } from "bun:test";

import { runIsolatedHarness } from "../test-harness/run-isolated";

test("runtime server store (#295)", async () => {
  const output = await runIsolatedHarness(`${import.meta.dir}/server-url-store.mts`);
  expect(output).toMatch(/4 pass\s+0 fail/);
});

test("local HTTP in a test build (#302)", async () => {
  const output = await runIsolatedHarness(`${import.meta.dir}/server-url-local-http.mts`);
  expect(output).toMatch(/1 pass\s+0 fail/);
});
