/**
 * Org-scoped RBAC vocabulary, mirrored from
 * `anchovy/apps/web/src/lib/access/permissions.ts`.
 *
 * 13 resources × 5 actions. The resource/action names are part of the
 * persisted contract (Better Auth `organization_role.permission` JSONB,
 * `access_request.target_domain`, audit-log `target_type`) — do not rename
 * without a migration.
 */
export const RESOURCES = [
  "workout",
  "weight",
  "dexa",
  "blood",
  "imaging",
  "cardiac",
  "supplements",
  "medications",
  "goals",
  "family",
  "records",
  "ingest",
  "coach",
] as const;

export const ACTIONS = ["read", "write", "share", "approve", "admin_access"] as const;

export type Resource = (typeof RESOURCES)[number];
export type Action = (typeof ACTIONS)[number];

export type ResourcePermissions = Record<Action, boolean>;
export type PermissionMatrix = Record<Resource, ResourcePermissions>;

export type PermissionOverrides = Partial<{
  [resource in Resource]: Partial<ResourcePermissions>;
}>;

// ─── anchovy-compatible aliases ───────────────────────────────
// Kept so ports of anchovy call sites (`ACCESS_RESOURCES`,
// `AccessAction`, …) typecheck without a rename pass.
export const ACCESS_RESOURCES = RESOURCES;
export const ACCESS_ACTIONS = ACTIONS;

export type AccessResource = Resource;
export type AccessAction = Action;
