import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync, gzipSync } from "node:zlib";

import {
  describeResult,
  inputFormat,
  openItems,
  parseArgs,
  withProgress,
} from "./food-catalog-import";

/** A zip whose first entry is `name` (deflated or stored); enough for the importer's reader. */
function syntheticZip(name: string, content: string, method: 0 | 8 = 8): Buffer {
  const data = Buffer.from(content);
  const body = method === 8 ? deflateRawSync(data) : data;
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(method, 8);
  header.writeUInt32LE(body.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(Buffer.byteLength(name), 26);
  // Trailing bytes stand in for the central directory, which the reader ignores.
  return Buffer.concat([header, Buffer.from(name), body, Buffer.from("PK\x01\x02 trailing")]);
}

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

  test("accepts only the supported input formats", () => {
    expect(inputFormat("/catalogs/openfoodfacts-products.jsonl.gz")).toBe("jsonl.gz");
    expect(inputFormat("x.JSONL")).toBe("jsonl");
    expect(inputFormat("FoodData_Central_foundation_food_json_2026-04-30.zip")).toBe("zip");
    expect(inputFormat("foundation.json")).toBe("json");
    expect(inputFormat("products.csv")).toBeNull();
    const args = [...base];
    args[args.indexOf("--file") + 1] = "./products.csv";
    expect(parseArgs(args).ok).toBe(false);
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

describe("food-catalog-import inputs", () => {
  const dir = mkdtempSync(join(tmpdir(), "ov-catalog-input-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const fdcDocument = '{"FoundationFoods": [\n{"fdcId":1,"n":[1]},\n{"fdcId":2}\n]}';

  const read = async (name: string, content: Buffer | string) => {
    const path = join(dir, name);
    writeFileSync(path, content);
    const items: unknown[] = [];
    for await (const item of await openItems(path, inputFormat(path)!)) items.push(item);
    return items;
  };

  test("streams JSON Lines, gzipped JSON Lines, FDC JSON and FDC zip downloads", async () => {
    expect(await read("a.jsonl", '{"code":"1"}\n{"code":"2"}\n')).toEqual([
      { code: "1" },
      { code: "2" },
    ]);
    expect(await read("b.jsonl.gz", gzipSync('{"code":"1"}\nbroken\n'))).toEqual([
      { code: "1" },
      null,
    ]);
    const fdc = [{ fdcId: 1, n: [1] }, { fdcId: 2 }];
    expect(await read("c.json", fdcDocument)).toEqual(fdc);
    expect(await read("d.zip", syntheticZip("foundation.json", fdcDocument))).toEqual(fdc);
    expect(await read("e.zip", syntheticZip("foundation.json", fdcDocument, 0))).toEqual(fdc);
  });

  test("rejects a zip that is not an FDC JSON download", async () => {
    await expect(read("f.zip", "not a zip at all, just text")).rejects.toThrow("not a zip");
    await expect(read("g.zip", syntheticZip("foundation.csv", "a,b"))).rejects.toThrow(".json");
  });

  test("reports progress as counts only", async () => {
    async function* items() {
      for (let i = 0; i < 5; i += 1) yield { secret: `item-${i}` };
    }
    const reports: number[] = [];
    const passed: unknown[] = [];
    for await (const item of withProgress(items(), 2, (count) => reports.push(count)))
      passed.push(item);
    expect(passed).toHaveLength(5);
    expect(reports).toEqual([2, 4]);
  });
});
