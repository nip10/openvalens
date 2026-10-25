import { describe, expect, test } from "bun:test";

import { describeReport, parseArgs } from "./erasure-replay";

describe("scripts/erasure-replay.ts (Issue #64)", () => {
  test("accepts only --allow-remote", () => {
    expect(parseArgs([])).toEqual({ allowRemote: false });
    expect(parseArgs(["--allow-remote"])).toEqual({ allowRemote: true });
    expect(parseArgs(["--allow-remote", "user-1"])).toBeNull();
  });

  test("reports counts only", () => {
    expect(
      describeReport({
        subjects: 2,
        subjectsWithRows: 1,
        rowsRemoved: 97,
        objects: { deleted: 1, failed: 0 },
      }),
    ).toBe(
      "Erasure ledger replayed: 2 erased people, 1 brought back by the restore and erased again, 97 rows removed, 1 stored objects deleted, 0 objects not deleted.",
    );
  });

  test("refuses to run without an explicit database", () => {
    const result = Bun.spawnSync(["bun", "--no-env-file", `${import.meta.dir}/erasure-replay.ts`], {
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("An explicit DATABASE_URL or DATABASE_URL_FILE");
  });
});
