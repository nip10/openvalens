import { describe, expect, test } from "bun:test";

import { describeResult, parseArgs } from "./food-catalog-import";

const base = [
  "--source",
  "off",
  "--file",
  "./synthetic.jsonl",
  "--dataset",
  "products",
  "--version",
  "2026-10-14",
  "--source-url",
  "https://example.test/synthetic.jsonl",
];

describe("food-catalog-import CLI", () => {
  test("parses a complete command", () => {
    expect(parseArgs(base)).toEqual({
      ok: true,
      command: {
        file: "./synthetic.jsonl",
        allowRemote: false,
        manifest: {
          source: "off",
          dataset: "products",
          version: "2026-10-14",
          sourceUrl: "https://example.test/synthetic.jsonl",
        },
      },
    });
    expect(parseArgs([...base, "--allow-remote"])).toMatchObject({
      ok: true,
      command: { allowRemote: true },
    });
  });

  test("rejects unknown sources, insecure URLs, missing and repeated flags", () => {
    const replaced = (flag: string, value: string) => {
      const args = [...base];
      args[args.indexOf(flag) + 1] = value;
      return args;
    };
    expect(parseArgs(replaced("--source", "insa")).ok).toBe(false);
    expect(parseArgs(replaced("--source-url", "http://example.test/x")).ok).toBe(false);
    expect(parseArgs(base.slice(2)).ok).toBe(false);
    expect(parseArgs([...base, "--dataset", "again"]).ok).toBe(false);
    expect(parseArgs([...base, "--unknown"]).ok).toBe(false);
  });

  test("failure messages never echo argument values", () => {
    const result = parseArgs([...base.slice(0, -1), "http://secret.example/token"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).not.toContain("secret");
  });

  test("reports counts only", () => {
    expect(
      describeResult({ releaseId: 3, imported: true, recordCount: 10, rejectedCount: 2 }),
    ).toBe("Imported release 3: 10 records, 2 rejected.");
    expect(
      describeResult({ releaseId: 3, imported: false, recordCount: 10, rejectedCount: 2 }),
    ).toContain("already imported");
  });
});
