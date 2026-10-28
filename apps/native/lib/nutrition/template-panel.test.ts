import { expect, test } from "bun:test";
import { runIsolatedHarness } from "../test-harness/run-isolated";

test("production template panel and recipe import ownership harness", async () => {
  const output = await runIsolatedHarness(`${import.meta.dir}/template-panel.fixture.mts`);
  expect(output).toMatch(/8 pass\s+0 fail/);
}, 30_000);
