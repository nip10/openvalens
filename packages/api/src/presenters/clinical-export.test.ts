import { describe, expect, test } from "bun:test";

import {
  formatBytes,
  formatExportDomainLabel,
  pickExportDomains,
  utf8ByteLength,
} from "./clinical-export";

describe("clinical export presenter", () => {
  test("formatExportDomainLabel: sentence-case labels for the closed enum", () => {
    expect(formatExportDomainLabel("blood")).toBe("Blood");
    expect(formatExportDomainLabel("familyHistory")).toBe("Family history");
    expect(formatExportDomainLabel("dexa")).toBe("DEXA");
    expect(formatExportDomainLabel("audit")).toBe("Audit");
  });

  test("formatBytes: base-1024 sizes and '—' for invalid input", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe("—");
    expect(formatBytes(Number.NaN)).toBe("—");
    expect(formatBytes(-1)).toBe("—");
  });

  test("utf8ByteLength: counts UTF-8 bytes across code points", () => {
    expect(utf8ByteLength("abc")).toBe(3);
    expect(utf8ByteLength("é")).toBe(2);
    expect(utf8ByteLength("😀")).toBe(4);
  });

  test("pickExportDomains: closed ordered list with canonical defaults", () => {
    const options = pickExportDomains();
    expect(options).toHaveLength(14);
    expect(options.map((option) => option.domain)).toEqual([
      "blood",
      "body",
      "medications",
      "supplements",
      "workouts",
      "goals",
      "familyHistory",
      "calendar",
      "insights",
      "imaging",
      "cardiac",
      "dexa",
      "weight",
      "audit",
    ]);
    expect(options.find((option) => option.domain === "blood")?.defaultSelected).toBe(true);
    expect(options.find((option) => option.domain === "audit")?.defaultSelected).toBe(false);
    expect(options.every((option) => option.label.length > 0)).toBe(true);
  });
});
