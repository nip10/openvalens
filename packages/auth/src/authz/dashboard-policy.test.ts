import { describe, expect, test } from "bun:test";

import { ROLES } from "../access/roles";
import {
  canAccessDashboardRoute,
  canApproveIngest,
  canSeeBlood,
  canSeeCoach,
  canSeeDashboardRoute,
  canSeeResource,
  canSeeSharing,
  dashboardRoutePolicyMap,
  resolveDashboardRoutePolicy,
} from "./dashboard-policy";

describe("dashboard-policy · per-resource helpers", () => {
  test("viewer can read blood but cannot approve ingest", () => {
    expect(canSeeBlood("viewer")).toBe(true);
    expect(canApproveIngest("viewer")).toBe(false);
  });

  test("collaborator can approve ingest", () => {
    expect(canApproveIngest("collaborator")).toBe(true);
  });

  test("only roles with records:share can see Sharing nav", () => {
    expect(canSeeSharing("viewer")).toBe(false);
    expect(canSeeSharing("collaborator")).toBe(true);
    expect(canSeeSharing("admin")).toBe(true);
    expect(canSeeSharing("owner")).toBe(true);
  });

  test("coach is gated by coach:read, denied for unknown roles", () => {
    expect(canSeeCoach("viewer")).toBe(true);
    expect(canSeeCoach("unknown")).toBe(false);
    expect(canSeeCoach(null)).toBe(false);
  });

  test("canSeeResource denies unknown roles by default", () => {
    expect(canSeeResource("owner", "blood", "read")).toBe(true);
    expect(canSeeResource("viewer", "blood", "write")).toBe(false);
    expect(canSeeResource("hacker", "blood", "read")).toBe(false);
  });
});

describe("dashboard-policy · route policy map", () => {
  test("every role sees at least its own record-read dashboard root", () => {
    for (const role of ROLES) {
      expect(canSeeDashboardRoute(role, "/")).toBe(true);
    }
  });

  test("viewer can see blood, body, sleep, records/* but cannot see /sharing or /ingest", () => {
    expect(canSeeDashboardRoute("viewer", "/blood")).toBe(true);
    expect(canSeeDashboardRoute("viewer", "/body")).toBe(true);
    expect(canSeeDashboardRoute("viewer", "/sleep")).toBe(true);
    expect(canSeeDashboardRoute("viewer", "/records/clinical")).toBe(true);
    expect(canSeeDashboardRoute("viewer", "/sharing")).toBe(false);
    expect(canSeeDashboardRoute("viewer", "/ingest")).toBe(false);
  });

  test("collaborator can additionally see /ingest and /sharing", () => {
    expect(canSeeDashboardRoute("collaborator", "/ingest")).toBe(true);
    expect(canSeeDashboardRoute("collaborator", "/sharing")).toBe(true);
  });

  test("admin and owner can see every route in the policy map", () => {
    for (const role of ["admin", "owner"] as const) {
      for (const pathname of Object.keys(dashboardRoutePolicyMap)) {
        expect(canSeeDashboardRoute(role, pathname)).toBe(true);
      }
    }
  });

  test("dynamic blood panel route resolves to the same policy as /blood", () => {
    const panel = resolveDashboardRoutePolicy("/blood/panel-abc");
    const list = resolveDashboardRoutePolicy("/blood");

    expect(panel).toEqual(list);
    expect(panel).toEqual({ resource: "blood", action: "read" });
  });

  test("unknown paths and dynamic non-blood paths return null policy", () => {
    expect(resolveDashboardRoutePolicy("")).toBeNull();
    expect(resolveDashboardRoutePolicy("/nope")).toBeNull();
    expect(resolveDashboardRoutePolicy("/body/2026-09-01")).toBeNull();
  });

  test("trailing slashes are normalized", () => {
    expect(resolveDashboardRoutePolicy("/blood/")).toEqual({
      resource: "blood",
      action: "read",
    });
  });
});

describe("dashboard-policy · AuthContext adapter", () => {
  test("canAccessDashboardRoute forwards role from the AuthContext", () => {
    const baseContext = {
      user: null,
      session: null,
      activeOrganizationId: null,
      member: null,
      role: null,
    } as const;

    expect(canAccessDashboardRoute({ ...baseContext, role: "viewer" }, "/sharing")).toBe(false);
    expect(canAccessDashboardRoute({ ...baseContext, role: "owner" }, "/sharing")).toBe(true);
    expect(canAccessDashboardRoute({ ...baseContext, role: null }, "/")).toBe(false);
  });
});
