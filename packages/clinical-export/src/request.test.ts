import { expect, test } from "bun:test";
import { parseExportRequest } from "./request";

test("parses valid csv and pdf requests", () => {
  const csvResult = parseExportRequest({ format: "csv", domains: ["blood", "supplements"] });
  const pdfResult = parseExportRequest({ format: "pdf", domains: ["body"] });

  expect(csvResult.ok).toBe(true);
  expect(pdfResult.ok).toBe(true);
  if (csvResult.ok) {
    expect(csvResult.data).toEqual({ format: "csv", domains: ["blood", "supplements"] });
  }
  if (pdfResult.ok) {
    expect(pdfResult.data).toEqual({ format: "pdf", domains: ["body"] });
  }
});

test("rejects unknown domains without echoing raw values", () => {
  const result = parseExportRequest({ format: "csv", domains: ["blood", "unknown"] });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe("invalid_domain");
    expect(JSON.stringify(result.error).includes("unknown")).toBe(false);
  }
});

test("rejects invalid formats without echoing raw values", () => {
  const result = parseExportRequest({ format: "xls", domains: ["blood"] });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe("invalid_format");
    expect(JSON.stringify(result.error).includes("xls")).toBe(false);
  }
});

test("rejects empty domain lists", () => {
  const result = parseExportRequest({ format: "csv", domains: [] });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe("empty_domains");
  }
});

test("rejects extra unknown keys without echoing raw values", () => {
  const result = parseExportRequest({ format: "csv", domains: ["blood"], secret: "raw" });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe("invalid_payload");
    expect(JSON.stringify(result.error).includes("raw")).toBe(false);
  }
});

test("dedupes domains and returns canonical ordering", () => {
  const result = parseExportRequest({
    format: "csv",
    domains: ["workouts", "blood", "supplements", "blood", "workouts"],
  });

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.data.domains).toEqual(["blood", "supplements", "workouts"]);
  }
});

test("rejects non-object bodies without echoing content", () => {
  for (const body of ["string", 42, true, null]) {
    const result = parseExportRequest(body);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("invalid_json");
      expect(JSON.stringify(result.error).includes(String(body))).toBe(false);
    }
  }
});

test("rejects domains array of wrong shape", () => {
  const result = parseExportRequest({ format: "csv", domains: "blood" });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe("invalid_domains");
  }
});
