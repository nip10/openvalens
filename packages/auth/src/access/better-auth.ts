import { createAccessControl } from "better-auth/plugins/access";
import {
  adminAc as betterAuthAdminAc,
  defaultStatements as adminDefaultStatements,
  userAc,
} from "better-auth/plugins/admin/access";
import {
  adminAc as organizationAdminAc,
  defaultStatements as organizationDefaultStatements,
  memberAc,
  ownerAc,
} from "better-auth/plugins/organization/access";

import { ACTIONS, RESOURCES, type Action, type Resource } from "./permissions";
import { ROLE_PERMISSION_PRESETS, type Role } from "./roles";

type DomainStatement = Record<Resource, readonly Action[]>;

/**
 * The 13 domain resources all expose the full 5-action vocabulary in the
 * access-control statement, so `hasPermission` can request any
 * resource/action pair. Per-role grants are narrowed by `roles` below.
 */
const domainStatements = {
  workout: ACTIONS,
  weight: ACTIONS,
  dexa: ACTIONS,
  blood: ACTIONS,
  imaging: ACTIONS,
  cardiac: ACTIONS,
  supplements: ACTIONS,
  medications: ACTIONS,
  goals: ACTIONS,
  family: ACTIONS,
  records: ACTIONS,
  ingest: ACTIONS,
  coach: ACTIONS,
} as const satisfies DomainStatement;

/**
 * Combined statement = Better Auth organization defaults (organization,
 * member, invitation, team, ac) + admin defaults (user, session) + our 13
 * domain resources. Mirrors `anchovy/apps/web/src/lib/access/better-auth.ts`.
 */
const statement = {
  ...organizationDefaultStatements,
  ...adminDefaultStatements,
  ...domainStatements,
} as const;

export const ac = createAccessControl(statement);

/** Flattens a role's preset into the domain-only statement shape. */
export function statementsFor(role: Role): Record<Resource, Action[]> {
  const matrix = ROLE_PERMISSION_PRESETS[role];
  const statements = {} as Record<Resource, Action[]>;

  for (const resource of RESOURCES) {
    statements[resource] = ACTIONS.filter((action) => matrix[resource][action]);
  }

  return statements;
}

/**
 * Role set handed to the Better Auth `organization` and `admin` plugins.
 *
 * `member`/`user` are kept because Better Auth's defaults reference them
 * (organization creator default role is `owner`, default member role is
 * `member`; admin default user role is `user`). `member` maps to our `viewer`
 * domain grants, exactly as in anchovy.
 */
export const roles = {
  owner: ac.newRole({
    ...ownerAc.statements,
    ...statementsFor("owner"),
  }),
  admin: ac.newRole({
    ...organizationAdminAc.statements,
    ...betterAuthAdminAc.statements,
    ...statementsFor("admin"),
  }),
  member: ac.newRole({
    ...memberAc.statements,
    ...statementsFor("viewer"),
  }),
  collaborator: ac.newRole({
    ...memberAc.statements,
    ...statementsFor("collaborator"),
  }),
  viewer: ac.newRole({
    ...statementsFor("viewer"),
  }),
  user: ac.newRole({
    ...userAc.statements,
    ...statementsFor("viewer"),
  }),
};

export type AuthRoles = typeof roles;
