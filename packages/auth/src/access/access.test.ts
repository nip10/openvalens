import { describe, expect, test } from "bun:test";

import { ac, roles, statementsFor } from "./better-auth";
import { ACCESS_ACTIONS, ACCESS_RESOURCES } from "./permissions";
import { canReduce, getEffectivePermissions, roleStatementFor } from "./roles";

describe("access-control matrix", () => {
  test("defines 13 resources × 5 actions", () => {
    expect(ACCESS_RESOURCES).toHaveLength(13);
    expect(ACCESS_ACTIONS).toHaveLength(5);
  });

  test("owner has all 13×5 statements", () => {
    const permissions = getEffectivePermissions("owner");
    const statements = statementsFor("owner");

    for (const resource of ACCESS_RESOURCES) {
      expect(statements[resource]).toEqual([...ACCESS_ACTIONS]);

      for (const action of ACCESS_ACTIONS) {
        expect(permissions[resource][action]).toBe(true);
      }
    }

    expect(Object.keys(statements)).toHaveLength(13);
  });

  test("viewer has only read on all 13 resources", () => {
    const permissions = getEffectivePermissions("viewer");
    const statements = statementsFor("viewer");

    for (const resource of ACCESS_RESOURCES) {
      expect(statements[resource]).toEqual(["read"]);

      for (const action of ACCESS_ACTIONS) {
        expect(permissions[resource][action]).toBe(action === "read");
      }
    }
  });

  test("admin grants read/write/share everywhere plus ingest approve/admin_access", () => {
    const permissions = getEffectivePermissions("admin");

    for (const resource of ACCESS_RESOURCES) {
      for (const action of ACCESS_ACTIONS) {
        const isDefault = action === "read" || action === "write" || action === "share";
        const isIngestEscalation =
          resource === "ingest" && (action === "approve" || action === "admin_access");
        expect(permissions[resource][action]).toBe(isDefault || isIngestEscalation);
      }
    }
  });

  test("collaborator grants read/write/share everywhere plus ingest approve", () => {
    const permissions = getEffectivePermissions("collaborator");

    for (const resource of ACCESS_RESOURCES) {
      for (const action of ACCESS_ACTIONS) {
        const isDefault = action === "read" || action === "write" || action === "share";
        const isIngestApprove = resource === "ingest" && action === "approve";
        expect(permissions[resource][action]).toBe(isDefault || isIngestApprove);
      }
    }
  });
});

describe("role reduction constraint", () => {
  test("allows a reduction from collaborator to viewer", () => {
    expect(canReduce("viewer", "collaborator")).toBe(true);
  });

  test("rejects an expansion from viewer to collaborator", () => {
    expect(canReduce("collaborator", "viewer")).toBe(false);
  });

  test("allows every role to reduce to itself", () => {
    expect(canReduce("owner", "owner")).toBe(true);
    expect(canReduce("admin", "admin")).toBe(true);
    expect(canReduce("collaborator", "collaborator")).toBe(true);
    expect(canReduce("viewer", "viewer")).toBe(true);
  });

  test("overrides can only narrow, never elevate a denied base permission", () => {
    const elevatingOverrides = {
      blood: {
        write: true,
        share: true,
        approve: true,
        admin_access: true,
      },
    } as const;

    const permissions = getEffectivePermissions("viewer", elevatingOverrides);

    expect(permissions.blood.read).toBe(true);
    expect(permissions.blood.write).toBe(false);
    expect(permissions.blood.share).toBe(false);
    expect(permissions.blood.approve).toBe(false);
    expect(permissions.blood.admin_access).toBe(false);

    // Viewer narrowed by an "elevating" override is still a reduction of
    // collaborator, because the override cannot grant anything.
    expect(canReduce("viewer", "collaborator", elevatingOverrides)).toBe(true);
  });

  test("owner can reduce itself", () => {
    const reducingOverrides = {
      ingest: {
        approve: false,
        admin_access: false,
      },
    } as const;

    const permissions = getEffectivePermissions("owner", reducingOverrides);

    expect(permissions.ingest.read).toBe(true);
    expect(permissions.ingest.write).toBe(true);
    expect(permissions.ingest.share).toBe(true);
    expect(permissions.ingest.approve).toBe(false);
    expect(permissions.ingest.admin_access).toBe(false);

    expect(canReduce("owner", "owner", reducingOverrides)).toBe(true);
  });
});

describe("better-auth access control", () => {
  test("builds a role from the full statement map", () => {
    const ownerRole = ac.newRole(statementsFor("owner"));

    expect(ownerRole.authorize({ blood: ["read"] }).success).toBe(true);
    expect(ownerRole.authorize({ blood: ["admin_access"] }).success).toBe(true);
  });

  test("builds a role from a partial statement map and enforces it", () => {
    const readOnlyRole = ac.newRole({ blood: ["read"] });

    expect(readOnlyRole.authorize({ blood: ["read"] }).success).toBe(true);
    expect(readOnlyRole.authorize({ blood: ["write"] }).success).toBe(false);
  });

  test("exposes the four app roles plus Better Auth defaults", () => {
    expect(Object.keys(roles).sort()).toEqual([
      "admin",
      "collaborator",
      "member",
      "owner",
      "user",
      "viewer",
    ]);
    expect(roles.viewer.authorize({ blood: ["read"] }).success).toBe(true);
    expect(roles.viewer.authorize({ blood: ["write"] }).success).toBe(false);
    expect(roles.collaborator.authorize({ ingest: ["approve"] }).success).toBe(true);
    expect(roles.collaborator.authorize({ ingest: ["admin_access"] }).success).toBe(false);
    expect(roles.owner.authorize({ ingest: ["admin_access"] }).success).toBe(true);
  });

  test("roleStatementFor flattens presets to action lists", () => {
    expect(roleStatementFor("viewer").blood).toEqual(["read"]);
    expect(roleStatementFor("owner").coach).toEqual([...ACCESS_ACTIONS]);
  });
});
