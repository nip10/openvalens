import { expect, test } from "bun:test";
import { runIsolatedHarness } from "../test-harness/run-isolated";

test("production AddFood route component lifecycle and number masking", async () => {
  const output = await runIsolatedHarness(`${import.meta.dir}/logger-component.fixture.mts`);
  expect(output).toMatch(/18 pass\s+0 fail/);
}, 30_000);
