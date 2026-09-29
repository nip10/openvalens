import type { Action, Resource } from "../access/permissions";
import { isRole, ROLE_PERMISSION_PRESETS } from "../access/roles";
import type { AuthContext } from "./context";

export type DashboardRoutePolicy = {
  resource: Resource;
  action: Action;
};

/**
 * Route → permission policy map, mirrored from
 * `anchovy/apps/web/src/lib/authz/dashboard-policy.ts`.
 */
const DASHBOARD_ROUTE_POLICY_MAP = {
  "/": { resource: "records", action: "read" },
  "/blood": { resource: "blood", action: "read" },
  "/blood/[panelId]": { resource: "blood", action: "read" },
  "/body": { resource: "dexa", action: "read" },
  "/cardiac": { resource: "cardiac", action: "read" },
  "/sleep": { resource: "records", action: "read" },
  "/imaging": { resource: "imaging", action: "read" },
  "/supplements": { resource: "supplements", action: "read" },
  "/medications": { resource: "medications", action: "read" },
  "/goals": { resource: "goals", action: "read" },
  "/calendar": { resource: "records", action: "read" },
  "/family": { resource: "family", action: "read" },
  "/chat": { resource: "records", action: "read" },
  "/coach": { resource: "coach", action: "read" },
  "/ingest": { resource: "ingest", action: "approve" },
  "/reports/weekly": { resource: "records", action: "read" },
  "/records/clinical": { resource: "records", action: "read" },
  "/records/timeline": { resource: "records", action: "read" },
  "/records/audit": { resource: "records", action: "read" },
  "/settings": { resource: "records", action: "read" },
  "/integrations": { resource: "records", action: "read" },
  "/integrations/health-connect/audit": { resource: "records", action: "read" },
  "/v2": { resource: "records", action: "read" },
  "/v2/providers": { resource: "records", action: "read" },
  "/sharing": { resource: "records", action: "share" },
  "/workouts": { resource: "workout", action: "read" },
  "/entry/weight": { resource: "weight", action: "read" },
  "/entry/workout": { resource: "workout", action: "read" },
  "/entry/review": { resource: "records", action: "read" },
} as const satisfies Record<string, DashboardRoutePolicy>;

export type DashboardRouteKey = keyof typeof DASHBOARD_ROUTE_POLICY_MAP;

export const dashboardRoutePolicyMap: Readonly<Record<DashboardRouteKey, DashboardRoutePolicy>> =
  DASHBOARD_ROUTE_POLICY_MAP;

function normalizeDashboardPath(pathname: string): DashboardRouteKey | null {
  const trimmed = pathname.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const normalized = trimmed !== "/" && trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;

  if (Object.hasOwn(DASHBOARD_ROUTE_POLICY_MAP, normalized)) {
    return normalized as DashboardRouteKey;
  }

  if (/^\/blood\/[^/]+$/.test(normalized)) {
    return "/blood/[panelId]";
  }

  return null;
}

export function resolveDashboardRoutePolicy(pathname: string): DashboardRoutePolicy | null {
  const key = normalizeDashboardPath(pathname);
  if (!key) {
    return null;
  }

  return DASHBOARD_ROUTE_POLICY_MAP[key] ?? null;
}

/**
 * Pure permission check against a role preset. Unknown/absent roles are
 * denied by default.
 */
export function canSeeResource(
  role: string | null | undefined,
  resource: Resource,
  action: Action,
): boolean {
  if (!isRole(role)) {
    return false;
  }

  return ROLE_PERMISSION_PRESETS[role][resource][action];
}

export function canSeeBlood(role: string | null | undefined): boolean {
  return canSeeResource(role, "blood", "read");
}

export function canSeeCoach(role: string | null | undefined): boolean {
  return canSeeResource(role, "coach", "read");
}

export function canSeeSharing(role: string | null | undefined): boolean {
  return canSeeResource(role, "records", "share");
}

export function canApproveIngest(role: string | null | undefined): boolean {
  return canSeeResource(role, "ingest", "approve");
}

/** Resolves whether a role may open a given dashboard pathname. */
export function canSeeDashboardRoute(role: string | null | undefined, pathname: string): boolean {
  const policy = resolveDashboardRoutePolicy(pathname);
  if (!policy) {
    return false;
  }

  return canSeeResource(role, policy.resource, policy.action);
}

export function canAccessDashboardRoute(context: AuthContext, pathname: string): boolean {
  return canSeeDashboardRoute(context.role, pathname);
}
