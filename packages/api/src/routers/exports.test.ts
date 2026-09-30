import { afterAll, beforeEach, expect, mock, spyOn, test } from "bun:test";
import * as clinicalExport from "@openhealth/clinical-export";
import * as authzGuard from "@openhealth/auth/authz/guard";
import * as auditSecurity from "@openhealth/audit-security";
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
const build = mock(async (_org: string, _options: { limit: number }) => ({
  generation: {
    organizationId: "org-a",
    generatedAt: "2026-03-08T10:00:00.000Z",
    schemaVersion: "v2-clinical-export-v1",
    itemCount: 0,
  },
  items: [],
}));
const buildLegacy = mock(
  async (_db: unknown, domains: readonly unknown[], scope: { organizationId: string }) => ({
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
const audit = mock(async (_input: unknown) => {});
// Eager complete snapshots and synchronous factories, following repaired timeline tests.
mock.module("@openhealth/clinical-export", () => ({
  ...actualExport,
  createClinicalExportRepository: () => ({ buildBundle: build }),
  buildExportPayload: buildLegacy,
}));
mock.module("@openhealth/auth/authz/guard", () => ({
  ...actualGuard,
  AuthzHttpError,
  requirePermission,
}));
mock.module("@openhealth/audit-security", () => ({ ...actualAudit, writeAuditLog: audit }));
const { exportsRouter } = await import("./exports");
const { appRouter } = await import("./index");
afterAll(() => {
  mock.module("@openhealth/clinical-export", () => actualExport);
  mock.module("@openhealth/auth/authz/guard", () => actualGuard);
  mock.module("@openhealth/audit-security", () => actualAudit);
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
  audit.mockClear();
});
test("exports.clinicalBundle is mounted; records:read viewer gets active-tenant default envelope", async () => {
  expect(appRouter.exports.clinicalBundle).toBe(exportsRouter.clinicalBundle);
  const bundle = await exportsRouter.clinicalBundle.callable({ context: context() })({});
  expect(bundle.generation.organizationId).toBe("org-a");
  expect(bundle.items).toEqual([]);
  expect(build.mock.calls[0]).toEqual(["org-a", { limit: 200 }]);
  expect(requirePermission.mock.calls[0]?.[1]).toEqual({ resource: "records", action: "read" });
  await exportsRouter.clinicalBundle.callable({ context: context() })(undefined);
  expect(build.mock.calls.at(-1)).toEqual(["org-a", { limit: 200 }]);
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
  expect(buildLegacy.mock.calls.at(-1)?.[2]).toEqual({ organizationId: "org-a" });
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
