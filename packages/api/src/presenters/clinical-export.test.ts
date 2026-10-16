import { describe, expect, test } from "bun:test";

import {
  decodeBase64,
  exportBundleArtifact,
  exportCsvArtifacts,
  exportPdfArtifact,
  formatBytes,
  formatExportDomainLabel,
  pickClinicalPdfDomains,
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

  test("artifact builders: shared filenames, mime types, and JSON body", () => {
    const bundle = exportBundleArtifact({
      generation: { generatedAt: "2026-03-08T10:00:00.000Z" },
    });
    expect(bundle.fileName).toBe("health-export-bundle-2026-03-08.json");
    expect(bundle.mime).toBe("application/json");
    expect(JSON.parse(bundle.content).generation.generatedAt).toBe("2026-03-08T10:00:00.000Z");

    expect(
      exportCsvArtifacts([{ fileName: "health-export-blood-2026-03-08.csv", content: "a,b\n" }]),
    ).toEqual([
      { fileName: "health-export-blood-2026-03-08.csv", content: "a,b\n", mime: "text/csv" },
    ]);

    expect(
      exportPdfArtifact({ fileName: "health-export-2026-03-08.html", content: "<html></html>" }),
    ).toEqual({
      fileName: "health-export-2026-03-08.html",
      content: "<html></html>",
      mime: "text/html",
    });
  });

  test("pickClinicalPdfDomains: PDF-eligible domains only, canonical defaults", () => {
    const options = pickClinicalPdfDomains();
    const domains = options.map((option) => option.domain);
    expect(domains).not.toContain("audit");
    expect(domains).not.toContain("insights");
    expect(domains).toContain("blood");
    expect(
      options.filter((option) => option.defaultSelected).map((option) => option.domain),
    ).toEqual(["blood", "body", "medications", "supplements"]);
  });

  test("decodeBase64: matches Buffer for every padding length; rejects malformed input", () => {
    for (const text of ["", "%", "%P", "%PD", "%PDF-1.3\n\u00e9\u00ff"]) {
      const encoded = Buffer.from(text, "latin1").toString("base64");
      expect(decodeBase64(encoded)).toEqual(new Uint8Array(Buffer.from(text, "latin1")));
    }
    expect(decodeBase64("not base64!")).toBeNull();
    expect(decodeBase64("A")).toBeNull();
  });
});
