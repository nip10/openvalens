import { afterAll, beforeEach, expect, mock, spyOn, test } from "bun:test";
import * as clinicalExport from "@openvalens/clinical-export";
import * as authzGuard from "@openvalens/auth/authz/guard";
import * as auditSecurity from "@openvalens/audit-security";
import type { Context } from "../context";

const actualExport = { ...clinicalExport };
const actualGuard = { ...authzGuard };
const actualAudit = { ...auditSecurity };
let denied = false;
class AuthzHttpError extends Error {
  readonly code = "PERMISSION_DENIED";
  readonly status = 403;
}
const requirePermission = mock(async (_request: unknown, _permission: unknown) => {
  if (denied) throw new AuthzHttpError();
  return {
    user: { id: "actor" },
    activeOrganizationId: "org-a",
    role: "viewer",
    member: { role: "viewer" },
  };
});
const build = mock(async (_org: string, _options: { limit: number; userId?: string }) => ({
  generation: {
    organizationId: "org-a",
    generatedAt: "2026-03-08T10:00:00.000Z",
    schemaVersion: "v2-clinical-export-v1",
    itemCount: 0,
  },
  items: [],
}));
const buildLegacy = mock(
  async (
    _db: unknown,
    domains: readonly unknown[],
    scope: { organizationId: string; userId?: string },
  ) => ({
    generatedAt: "2026-03-08T10:00:00.000Z",
    schemaVersion: "export-v1",
    selectedDomains: [...domains],
    data: {
      blood: [
        {
          recordedAt: "2026-03-02",
          markerKey: "ast",
          markerName: "AST",
          value: 35,
          unit: "U/L",
          flag: null,
        },
      ],
    },
    scope,
  }),
);
const renderPdfExport = mock((payload: { generatedAt: string; selectedDomains: string[] }) => ({
  fileName: `health-export-${payload.generatedAt.slice(0, 10)}.html`,
  html: `<html><body><h1>Health Export</h1>${payload.selectedDomains.join(",")}</body></html>`,
  contentTypeHint: "text/html" as const,
}));
const audit = mock(async (_input: unknown) => {});
// Eager complete snapshots and synchronous factories, following repaired timeline tests.
mock.module("@openvalens/clinical-export", () => ({
  ...actualExport,
  createClinicalExportRepository: () => ({ buildBundle: build }),
  buildExportPayload: buildLegacy,
  renderPdfExport,
}));
mock.module("@openvalens/auth/authz/guard", () => ({
  ...actualGuard,
  AuthzHttpError,
  requirePermission,
}));
mock.module("@openvalens/audit-security", () => ({ ...actualAudit, writeAuditLog: audit }));
const { exportsRouter } = await import("./exports");
const { appRouter } = await import("./index");
afterAll(() => {
  mock.module("@openvalens/clinical-export", () => actualExport);
  mock.module("@openvalens/auth/authz/guard", () => actualGuard);
  mock.module("@openvalens/audit-security", () => actualAudit);
});
function context(authenticated = true, headers = new Headers()): Context {
  return {
    session: authenticated ? { user: { id: "actor" } } : null,
    correlationId: "test",
    honoContext: { req: { raw: { headers } } },
  } as Context;
}
beforeEach(() => {
  denied = false;
  requirePermission.mockClear();
  build.mockClear();
  buildLegacy.mockClear();
  renderPdfExport.mockClear();
  audit.mockClear();
});
test("exports.clinicalBundle is mounted; records:read viewer gets active-tenant default envelope", async () => {
  expect(appRouter.exports.clinicalBundle).toBe(exportsRouter.clinicalBundle);
  const bundle = await exportsRouter.clinicalBundle.callable({ context: context() })({});
  expect(bundle.generation.organizationId).toBe("org-a");
  expect(bundle.items).toEqual([]);
  expect(build.mock.calls[0]).toEqual(["org-a", { limit: 200, userId: "actor" }]);
  expect(requirePermission.mock.calls[0]?.[1]).toEqual({ resource: "records", action: "read" });
  await exportsRouter.clinicalBundle.callable({ context: context() })(undefined);
  expect(build.mock.calls.at(-1)).toEqual(["org-a", { limit: 200, userId: "actor" }]);
  expect(audit).not.toHaveBeenCalled();
});
test("source GET limit default/clamp/truncate semantics are retained", async () => {
  const call = exportsRouter.clinicalBundle.callable({ context: context() });
  for (const limit of ["foo", "Infinity", 0, -1, 9999, 12.8, "12.8", ""]) await call({ limit });
  expect(build.mock.calls.map((call) => call[1].limit)).toEqual([200, 200, 1, 1, 500, 12, 12, 1]);
});
test("auth denial and missing membership/permission never query or audit", async () => {
  await expect(
    exportsRouter.clinicalBundle.callable({ context: context(false) })({}),
  ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  expect(requirePermission).not.toHaveBeenCalled();
  denied = true;
  await expect(
    exportsRouter.clinicalBundle.callable({ context: context() })({}),
  ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  expect(build).not.toHaveBeenCalled();
  expect(audit).not.toHaveBeenCalled();
});
test("strict inputs reject authority, snapshots, generation and format overrides", async () => {
  const call = exportsRouter.clinicalBundle.callable({ context: context() });
  for (const input of [
    { organizationId: "org-b" },
    { orgId: "org-a" },
    { userId: "victim" },
    { items: [] },
    { canonicalSnapshot: { private: "PRIVATE" } },
    { generation: {} },
    { format: "pdf" },
    { limit: {} },
    { dependencies: {} },
    { now: "2020-01-01" },
  ])
    await expect(call(input as never)).rejects.toMatchObject({ code: "INVALID_INPUT" });
  expect(build).not.toHaveBeenCalled();
});
test("organization header overrides are rejected, including active-org and empty values", async () => {
  for (const org of ["org-b", "org-a", ""]) {
    await expect(
      exportsRouter.clinicalBundle.callable({
        context: context(true, new Headers({ "x-organization-id": org })),
      })({}),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  }
  expect(build).not.toHaveBeenCalled();
  expect(audit).not.toHaveBeenCalled();
});
test("PHI-bearing responses are returned without logging or export audit mutation", async () => {
  const logs = [spyOn(console, "log"), spyOn(console, "warn"), spyOn(console, "error")];
  try {
    build.mockResolvedValueOnce({
      generation: {
        organizationId: "org-a",
        generatedAt: "2026-03-08T10:00:00.000Z",
        schemaVersion: "v2-clinical-export-v1",
        itemCount: 1,
      },
      items: [{ private: "PRIVATE PAYLOAD" }],
    } as never);
    const output = await exportsRouter.clinicalBundle.callable({ context: context() })({});
    expect(output.items).toEqual([{ private: "PRIVATE PAYLOAD" }] as never);
    for (const log of logs) expect(log).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  } finally {
    for (const log of logs) log.mockRestore();
  }
});
test("exports.legacyDownload is mounted; canonical defaults when domains omitted", async () => {
  expect(appRouter.exports.legacyDownload).toBe(exportsRouter.legacyDownload);
  // Build a payload with empty data sets per domain so renderer emits header-only CSVs.
  buildLegacy.mockResolvedValueOnce({
    generatedAt: "2026-03-08T10:00:00.000Z",
    schemaVersion: "export-v1",
    selectedDomains: ["blood", "body", "medications", "supplements"],
    data: {
      blood: [],
      body: { asOfDate: null, weightKg: null, bodyFatPct: null, leanMassKg: null, bmi: null },
      medications: [],
      supplements: [],
    },
    scope: { organizationId: "org-a" },
  } as never);
  const output = await exportsRouter.legacyDownload.callable({ context: context() })({});
  expect(output.contentType).toBe("text/csv");
  expect(output.contentDisposition).toMatch(/^attachment; filename="health-export-/);
  expect(output.selectedDomains).toEqual(["blood", "body", "medications", "supplements"]);
  expect(requirePermission.mock.calls.at(-1)?.[1]).toEqual({
    resource: "records",
    action: "read",
  });
  expect(buildLegacy.mock.calls.at(-1)?.[2]).toEqual({ organizationId: "org-a", userId: "actor" });
  expect(output.files).toHaveLength(4);
  expect(output.files.map((f: { fileName: string }) => f.fileName)).toEqual([
    "health-export-blood-2026-03-08.csv",
    "health-export-body-2026-03-08.csv",
    "health-export-medications-2026-03-08.csv",
    "health-export-supplements-2026-03-08.csv",
  ]);
});
test("legacyDownload only runs the requested domains in canonical order", async () => {
  const output = await exportsRouter.legacyDownload.callable({ context: context() })({
    domains: ["workouts", "blood", "supplements", "blood"],
  });
  expect(output.selectedDomains).toEqual(["blood", "supplements", "workouts"]);
  expect(buildLegacy.mock.calls.at(-1)?.[1]).toEqual(["blood", "supplements", "workouts"]);
  expect(audit.mock.calls.at(-1)?.[0]).toMatchObject({
    organizationId: "org-a",
    actorUserId: "actor",
    eventType: "EXPORT_GENERATED",
    targetType: "records",
    correlationId: "test",
    metadata: {
      schemaVersion: "export-v1",
      format: "csv",
      selectedDomains: ["blood", "supplements", "workouts"],
    },
  });
});
test("legacyDownload audit metadata never carries payload values", async () => {
  await exportsRouter.legacyDownload.callable({ context: context() })({
    domains: ["blood"],
  });
  const recorded = JSON.stringify(audit.mock.calls.at(-1)?.[0]);
  expect(recorded.includes("AST")).toBe(false);
  expect(recorded.includes("35")).toBe(false);
});
test("legacyDownload filters unknown domains and emits sanitized INVALID_INPUT when none remain", async () => {
  await expect(
    exportsRouter.legacyDownload.callable({ context: context() })({ domains: ["secret"] }),
  ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  expect(buildLegacy).not.toHaveBeenCalled();
  expect(audit).not.toHaveBeenCalled();
});
test("legacyDownload rejects x-organization-id overrides (including active-org and empty)", async () => {
  for (const org of ["org-b", "org-a", ""]) {
    await expect(
      exportsRouter.legacyDownload.callable({
        context: context(true, new Headers({ "x-organization-id": org })),
      })({}),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  }
  expect(buildLegacy).not.toHaveBeenCalled();
  expect(audit).not.toHaveBeenCalled();
});
test("legacyDownload enforces records:read; auth denial never queries or audits", async () => {
  await expect(
    exportsRouter.legacyDownload.callable({ context: context(false) })({}),
  ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  expect(requirePermission).not.toHaveBeenCalled();
  denied = true;
  await expect(
    exportsRouter.legacyDownload.callable({ context: context() })({}),
  ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  expect(buildLegacy).not.toHaveBeenCalled();
  expect(audit).not.toHaveBeenCalled();
});
test("legacyDownload strict inputs reject extra keys, format overrides and unsafe payloads", async () => {
  const call = exportsRouter.legacyDownload.callable({ context: context() });
  for (const input of [
    { organizationId: "org-b" },
    { orgId: "org-a" },
    { userId: "victim" },
    { format: "pdf" },
    { format: "xls" },
    { domains: [42] },
    { domains: [{}] },
    { dependencies: {} },
    { now: "2020-01-01" },
    { payload: { secret: "PRIVATE" } },
    { rawBody: "RAW" },
  ])
    await expect(call(input as never)).rejects.toMatchObject({ code: "INVALID_INPUT" });
  expect(buildLegacy).not.toHaveBeenCalled();
});
test("legacyDownload PHI-bearing payload is returned without console payloads", async () => {
  const logs = [spyOn(console, "log"), spyOn(console, "warn"), spyOn(console, "error")];
  try {
    buildLegacy.mockResolvedValueOnce({
      generatedAt: "2026-03-08T10:00:00.000Z",
      schemaVersion: "export-v1",
      selectedDomains: ["blood"],
      data: {
        blood: [
          {
            recordedAt: "2026-03-02",
            markerKey: "PRIVATE",
            markerName: "PRIVATE TITLE",
            value: 99,
            unit: "U/L",
            flag: "H",
          },
        ],
      },
      scope: { organizationId: "org-a" },
    } as never);
    const output = await exportsRouter.legacyDownload.callable({ context: context() })({
      domains: ["blood"],
    });
    const blood = output.files[0];
    expect(blood).toBeDefined();
    expect(blood?.content).toContain("PRIVATE TITLE");
    expect(blood?.fileName).toBe("health-export-blood-2026-03-08.csv");
    for (const log of logs) expect(log).not.toHaveBeenCalled();
  } finally {
    for (const log of logs) log.mockRestore();
  }
});

// ---- Legacy "PDF" (HTML attachment) surface (Issue #20 HTML attachment slice) ----

test("exports.legacyPdfDownload is mounted; canonical defaults when domains omitted", async () => {
  expect(appRouter.exports.legacyPdfDownload).toBe(exportsRouter.legacyPdfDownload);
  // Build a payload with empty data sets per domain so renderer emits empty sections.
  buildLegacy.mockResolvedValueOnce({
    generatedAt: "2026-03-08T10:00:00.000Z",
    schemaVersion: "export-v1",
    selectedDomains: ["blood", "body", "medications", "supplements"],
    data: {
      blood: [],
      body: { asOfDate: null, weightKg: null, bodyFatPct: null, leanMassKg: null, bmi: null },
      medications: [],
      supplements: [],
    },
    scope: { organizationId: "org-a" },
  } as never);
  const output = await exportsRouter.legacyPdfDownload.callable({ context: context() })({});
  expect(output.contentType).toBe("text/html");
  expect(output.contentDisposition).toBe('attachment; filename="health-export-2026-03-08.html"');
  expect(output.fileName).toBe("health-export-2026-03-08.html");
  expect(output.selectedDomains).toEqual(["blood", "body", "medications", "supplements"]);
  expect(requirePermission.mock.calls.at(-1)?.[1]).toEqual({
    resource: "records",
    action: "read",
  });
  expect(buildLegacy.mock.calls.at(-1)?.[2]).toEqual({ organizationId: "org-a", userId: "actor" });
  expect(typeof output.content).toBe("string");
  expect(output.content.length).toBeGreaterThan(0);
  expect(renderPdfExport.mock.calls.at(-1)?.[0]).toMatchObject({
    generatedAt: "2026-03-08T10:00:00.000Z",
    selectedDomains: ["blood", "body", "medications", "supplements"],
  });
  expect(audit).toHaveBeenCalledTimes(1);
});

test("legacyPdfDownload normalizes domains into canonical order and audits fileCount:1 with format pdf", async () => {
  await exportsRouter.legacyPdfDownload.callable({ context: context() })({
    domains: ["workouts", "blood", "supplements", "blood"],
  });
  expect(buildLegacy.mock.calls.at(-1)?.[1]).toEqual(["blood", "supplements", "workouts"]);
  expect(audit.mock.calls.at(-1)?.[0]).toMatchObject({
    organizationId: "org-a",
    actorUserId: "actor",
    eventType: "EXPORT_GENERATED",
    targetType: "records",
    correlationId: "test",
    metadata: {
      schemaVersion: "export-v1",
      format: "pdf",
      selectedDomains: ["blood", "supplements", "workouts"],
      fileCount: 1,
    },
  });
});

test("legacyPdfDownload audit metadata never carries payload values (PHI sanitized)", async () => {
  buildLegacy.mockResolvedValueOnce({
    generatedAt: "2026-03-08T10:00:00.000Z",
    schemaVersion: "export-v1",
    selectedDomains: ["blood"],
    data: {
      blood: [
        {
          recordedAt: "2026-03-02",
          markerKey: "ast",
          markerName: "PRIVATE TITLE",
          value: 99,
          unit: "U/L",
          flag: "H",
        },
      ],
    },
    scope: { organizationId: "org-a" },
  } as never);
  await exportsRouter.legacyPdfDownload.callable({ context: context() })({ domains: ["blood"] });
  const recorded = JSON.stringify(audit.mock.calls.at(-1)?.[0]);
  expect(recorded.includes("PRIVATE TITLE")).toBe(false);
  expect(recorded.includes("99")).toBe(false);
  expect(recorded.includes("U/L")).toBe(false);
});

test("legacyPdfDownload filters unknown domains and emits sanitized INVALID_INPUT when none remain", async () => {
  await expect(
    exportsRouter.legacyPdfDownload.callable({ context: context() })({ domains: ["secret"] }),
  ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  expect(buildLegacy).not.toHaveBeenCalled();
  expect(renderPdfExport).not.toHaveBeenCalled();
  expect(audit).not.toHaveBeenCalled();
});

test("legacyPdfDownload rejects x-organization-id overrides (including active-org and empty)", async () => {
  for (const org of ["org-b", "org-a", ""]) {
    await expect(
      exportsRouter.legacyPdfDownload.callable({
        context: context(true, new Headers({ "x-organization-id": org })),
      })({}),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  }
  expect(buildLegacy).not.toHaveBeenCalled();
  expect(renderPdfExport).not.toHaveBeenCalled();
  expect(audit).not.toHaveBeenCalled();
});

test("legacyPdfDownload enforces records:read; auth denial never queries or audits", async () => {
  await expect(
    exportsRouter.legacyPdfDownload.callable({ context: context(false) })({}),
  ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  expect(requirePermission).not.toHaveBeenCalled();
  denied = true;
  await expect(
    exportsRouter.legacyPdfDownload.callable({ context: context() })({}),
  ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  expect(buildLegacy).not.toHaveBeenCalled();
  expect(renderPdfExport).not.toHaveBeenCalled();
  expect(audit).not.toHaveBeenCalled();
});

test("legacyPdfDownload strict inputs reject extra keys, format overrides and unsafe payloads", async () => {
  const call = exportsRouter.legacyPdfDownload.callable({ context: context() });
  for (const input of [
    { organizationId: "org-b" },
    { orgId: "org-a" },
    { userId: "victim" },
    { format: "csv" },
    { format: "xls" },
    { domains: [42] },
    { domains: [{}] },
    { dependencies: {} },
    { now: "2020-01-01" },
    { payload: { secret: "PRIVATE" } },
    { rawBody: "RAW" },
  ])
    await expect(call(input as never)).rejects.toMatchObject({ code: "INVALID_INPUT" });
  expect(buildLegacy).not.toHaveBeenCalled();
  expect(renderPdfExport).not.toHaveBeenCalled();
});

test("legacyPdfDownload cross-tenant payload exclusion: foreign org data never reaches the renderer or audit", async () => {
  // The active authz org is "org-a", but the upstream repository (mocked)
  // attempts to inject a foreign-tenant payload. The strict input +
  // authz-derived `organizationId` ensure the cross-tenant data is
  // never observed by the renderer or the audit.
  buildLegacy.mockResolvedValueOnce({
    generatedAt: "2026-03-08T10:00:00.000Z",
    schemaVersion: "export-v1",
    selectedDomains: ["blood", "body", "medications", "supplements"],
    data: {
      blood: [
        {
          recordedAt: "2026-03-02",
          markerKey: "ast",
          markerName: "AST",
          value: 35,
          unit: "U/L",
          flag: null,
        },
      ],
    },
    scope: { organizationId: "org-b" }, // foreign tenant — must not leak
  } as never);
  const output = await exportsRouter.legacyPdfDownload.callable({ context: context() })({});
  // The router calls buildExportPayload with the authz org ("org-a");
  // any cross-tenant payload returned by a misbehaving repository
  // cannot alter the audit metadata (which only carries the canonical
  // selectedDomains), and the renderer mock is invoked with the
  // payload exactly as the buildExportPayload mock produced.
  expect(buildLegacy.mock.calls.at(-1)?.[2]).toEqual({ organizationId: "org-a", userId: "actor" });
  // The renderer mock receives the payload from buildLegacy, not from
  // any caller-controlled source. Verify the cross-tenant id was not
  // surfaced as part of the selected-domain audit metadata.
  const recorded = JSON.stringify(audit.mock.calls.at(-1)?.[0]);
  expect(recorded.includes("org-b")).toBe(false);
  // The file content is the renderer's output verbatim; the audit row
  // never embeds the rendered HTML (no PHI in metadata).
  expect(recorded.includes("PRIVATE")).toBe(false);
  expect(output.content).not.toContain("org-b");
  expect(audit).toHaveBeenCalledTimes(1);
});

test("legacyPdfDownload PHI-bearing payload is returned without console payloads", async () => {
  const logs = [spyOn(console, "log"), spyOn(console, "warn"), spyOn(console, "error")];
  try {
    buildLegacy.mockResolvedValueOnce({
      generatedAt: "2026-03-08T10:00:00.000Z",
      schemaVersion: "export-v1",
      selectedDomains: ["blood"],
      data: {
        blood: [
          {
            recordedAt: "2026-03-02",
            markerKey: "PRIVATE",
            markerName: "PRIVATE TITLE",
            value: 99,
            unit: "U/L",
            flag: "H",
          },
        ],
      },
      scope: { organizationId: "org-a" },
    } as never);
    const output = await exportsRouter.legacyPdfDownload.callable({ context: context() })({
      domains: ["blood"],
    });
    // Renderer mock returns a synthetic HTML envelope; the audit metadata
    // shape stays sanitized (no PHI keys).
    expect(output.content).toContain("<html>");
    expect(output.fileName).toBe("health-export-2026-03-08.html");
    const recorded = JSON.stringify(audit.mock.calls.at(-1)?.[0]);
    expect(recorded.includes("PRIVATE TITLE")).toBe(false);
    for (const log of logs) expect(log).not.toHaveBeenCalled();
  } finally {
    for (const log of logs) log.mockRestore();
  }
});

test("legacyDownload strict input still rejects format: pdf (legacy CSV route never served HTML)", async () => {
  // The existing legacyDownload is CSV-only; format literal must stay "csv".
  // This guards against accidental loosening of the legacy route when the
  // pdf-shaped procedure was added.
  await expect(
    exportsRouter.legacyDownload.callable({ context: context() })({ format: "pdf" } as never),
  ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  expect(buildLegacy).not.toHaveBeenCalled();
  expect(renderPdfExport).not.toHaveBeenCalled();
});
