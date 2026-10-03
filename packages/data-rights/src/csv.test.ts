import { describe, expect, test } from "bun:test";

import { toCsv } from "./csv";

describe("toCsv", () => {
  test("header is the union of keys; nulls are empty", () => {
    expect(toCsv([{ a: 1 }, { a: null, b: "x" }])).toBe("a,b\r\n1,\r\n,x\r\n");
  });

  test("quotes commas, quotes and newlines", () => {
    expect(toCsv([{ note: 'said "hi", then\nleft' }])).toBe(
      'note\r\n"said ""hi"", then\nleft"\r\n',
    );
  });

  test("dates are ISO, objects are JSON", () => {
    const csv = toCsv([{ at: new Date("2026-10-01T07:00:00.000Z"), meta: { unit: "kg" } }]);
    expect(csv).toBe('at,meta\r\n2026-10-01T07:00:00.000Z,"{""unit"":""kg""}"\r\n');
  });

  test("text that a spreadsheet would run as a formula is neutralised; numbers are not", () => {
    expect(toCsv([{ v: "=HYPERLINK(1)" }, { v: "+1" }, { v: "@x" }, { v: -3 }])).toBe(
      "v\r\n'=HYPERLINK(1)\r\n'+1\r\n'@x\r\n-3\r\n",
    );
  });

  test("no rows gives an empty header line", () => {
    expect(toCsv([])).toBe("\r\n");
  });
});
