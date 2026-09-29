import {
  ACTIONS,
  RESOURCES,
  type Action,
  type PermissionMatrix,
  type PermissionOverrides,
  type Resource,
  type ResourcePermissions,
} from "./permissions";

export const ROLES = ["owner", "admin", "collaborator", "viewer"] as const;

export type Role = (typeof ROLES)[number];

// anchovy-compatible alias.
export const ACCESS_ROLES = ROLES;
export type AccessRole = Role;

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

function buildResourcePermissions(enabledActions: readonly Action[]): ResourcePermissions {
  const result = {} as ResourcePermissions;

  for (const action of ACTIONS) {
    result[action] = enabledActions.includes(action);
  }

  return result;
}

function buildPermissionMatrix(
  permissionsByResource: Partial<Record<Resource, readonly Action[]>>,
): PermissionMatrix {
  const matrix = {} as PermissionMatrix;

  for (const resource of RESOURCES) {
    matrix[resource] = buildResourcePermissions(permissionsByResource[resource] ?? []);
  }

  return matrix;
}

function mapAllResources(actions: readonly Action[]): Record<Resource, readonly Action[]> {
  const result = {} as Record<Resource, readonly Action[]>;

  for (const resource of RESOURCES) {
    result[resource] = actions;
  }

  return result;
}

function freezePermissionMatrix(matrix: PermissionMatrix): PermissionMatrix {
  for (const resource of RESOURCES) {
    Object.freeze(matrix[resource]);
  }

  return Object.freeze(matrix);
}

/**
 * Role presets, mirrored from `anchovy/apps/web/src/lib/access/roles.ts`.
 *
 * - `owner`        — every action on every resource.
 * - `admin`        — read/write/share everywhere, plus approve/admin_access
 *                    on `ingest`.
 * - `collaborator` — read/write/share everywhere, plus approve on `ingest`.
 * - `viewer`       — read-only everywhere.
 */
export const ROLE_PERMISSION_PRESETS: Record<Role, PermissionMatrix> = Object.freeze({
  owner: freezePermissionMatrix(buildPermissionMatrix(mapAllResources(ACTIONS))),
  admin: freezePermissionMatrix(
    buildPermissionMatrix({
      workout: ["read", "write", "share"],
      weight: ["read", "write", "share"],
      dexa: ["read", "write", "share"],
      blood: ["read", "write", "share"],
      imaging: ["read", "write", "share"],
      cardiac: ["read", "write", "share"],
      supplements: ["read", "write", "share"],
      medications: ["read", "write", "share"],
      goals: ["read", "write", "share"],
      family: ["read", "write", "share"],
      records: ["read", "write", "share"],
      ingest: ["read", "write", "share", "approve", "admin_access"],
      coach: ["read", "write", "share"],
    }),
  ),
  collaborator: freezePermissionMatrix(
    buildPermissionMatrix({
      workout: ["read", "write", "share"],
      weight: ["read", "write", "share"],
      dexa: ["read", "write", "share"],
      blood: ["read", "write", "share"],
      imaging: ["read", "write", "share"],
      cardiac: ["read", "write", "share"],
      supplements: ["read", "write", "share"],
      medications: ["read", "write", "share"],
      goals: ["read", "write", "share"],
      family: ["read", "write", "share"],
      records: ["read", "write", "share"],
      ingest: ["read", "write", "share", "approve"],
      coach: ["read", "write", "share"],
    }),
  ),
  viewer: freezePermissionMatrix(buildPermissionMatrix(mapAllResources(["read"]))),
});

/**
 * Applies reducing overrides to a role preset. An override can only turn a
 * permission *off*: the result is always `base && override`, so a caller can
 * never elevate a permission the base role denies.
 */
export function getEffectivePermissions(
  role: Role,
  overrides?: PermissionOverrides,
): PermissionMatrix {
  const base = ROLE_PERMISSION_PRESETS[role];
  const merged = {} as PermissionMatrix;

  for (const resource of RESOURCES) {
    const resourcePermissions = {} as ResourcePermissions;

    for (const action of ACTIONS) {
      const override = overrides?.[resource]?.[action];
      resourcePermissions[action] = base[resource][action] && (override ?? true);
    }

    merged[resource] = resourcePermissions;
  }

  return merged;
}

/** Flattens a role's preset into `{ resource: [allowed actions] }`. */
export function roleStatementFor(role: Role): Record<Resource, Action[]> {
  const matrix = ROLE_PERMISSION_PRESETS[role];
  const statements = {} as Record<Resource, Action[]>;

  for (const resource of RESOURCES) {
    statements[resource] = ACTIONS.filter((action) => matrix[resource][action]);
  }

  return statements;
}

/**
 * Enforces the "role overrides can only reduce permissions" invariant.
 *
 * Returns `true` when the effective permissions of `reducedRole` (optionally
 * narrowed by `overrides`) are a subset of `sourceRole`'s permissions — i.e.
 * moving from `sourceRole` to `reducedRole` is a reduction, never an
 * expansion.
 *
 * @example
 * canReduce("viewer", "collaborator") // true  — viewer ⊆ collaborator
 * canReduce("collaborator", "viewer") // false — collaborator ⊄ viewer
 */
export function canReduce(
  reducedRole: Role,
  sourceRole: Role,
  overrides?: PermissionOverrides,
): boolean {
  const source = ROLE_PERMISSION_PRESETS[sourceRole];
  const effective = getEffectivePermissions(reducedRole, overrides);

  for (const resource of RESOURCES) {
    for (const action of ACTIONS) {
      if (effective[resource][action] && !source[resource][action]) {
        return false;
      }
    }
  }

  return true;
}
