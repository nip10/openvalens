import { expect, test } from "bun:test";

import { runIsolatedHarness } from "./test-harness/run-isolated";

test("coordinated Better Auth Expo storage scenarios", async () => {
  const output = await runIsolatedHarness(
    `${import.meta.dir}/test-harness/auth-session-storage.mts`,
  );
  expect(output).toMatch(/9 pass\s+0 fail/);
});
