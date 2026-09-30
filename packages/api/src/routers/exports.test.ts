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
const audit = mock(async (_input: unknown) => {});
// Eager complete snapshots and synchronous factories, following repaired timeline tests.
mock.module("@openhealth/clinical-export", () => ({
  ...actualExport,
  createClinicalExportRepository: () => ({ buildBundle: build }),
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
