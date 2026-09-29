/**
 * Dashboard navigation structure, mirrored from
 * `anchovy/apps/web/src/lib/authz/dashboard-nav.ts`.
 *
 * The nav itself is a static, role-agnostic list of groups + items. Role
 * filtering happens at render time via `filterDashboardNavByAllowedHrefs`,
 * where the caller supplies the set of hrefs the active role is permitted to
 * open (derived from `dashboard-policy.ts` + the role preset).
 */

export type DashboardNavItem = {
  title: string;
  href: string;
};

export type DashboardNavGroup = {
  label: string;
  items: DashboardNavItem[];
};

const dashboardShellActionHrefs = ["/entry/weight", "/entry/review"] as const;

export const dashboardNavGroups: DashboardNavGroup[] = [
  {
    label: "Review",
    items: [
      { title: "Today", href: "/" },
      { title: "Weekly Report", href: "/reports/weekly" },
      { title: "Calendar", href: "/calendar" },
    ],
  },
  {
    label: "Track",
    items: [
      { title: "Blood Work", href: "/blood" },
      { title: "Body Composition", href: "/body" },
      { title: "Sleep", href: "/sleep" },
      { title: "Workouts", href: "/workouts" },
      { title: "Supplements", href: "/supplements" },
      { title: "Medications", href: "/medications" },
      { title: "Goals", href: "/goals" },
      { title: "Cardiac", href: "/cardiac" },
      { title: "Imaging", href: "/imaging" },
      { title: "Family History", href: "/family" },
    ],
  },
  {
    label: "Analyze",
    items: [
      { title: "AI Chat", href: "/chat" },
      { title: "Ingest PDF", href: "/ingest" },
    ],
  },
  {
    label: "Share",
    items: [
      { title: "Sharing", href: "/sharing" },
      { title: "Clinical Record", href: "/records/clinical" },
      { title: "Canonical Timeline", href: "/records/timeline" },
      { title: "Audit Timeline", href: "/records/audit" },
    ],
  },
  {
    label: "Settings",
    items: [
      { title: "Settings", href: "/settings" },
      { title: "AI Coach", href: "/coach" },
      { title: "Integrations", href: "/integrations" },
      { title: "V2 Cockpit", href: "/v2" },
      { title: "V2 Providers", href: "/v2/providers" },
    ],
  },
];

export function getDashboardNavHrefs(
  groups: readonly DashboardNavGroup[] = dashboardNavGroups,
): string[] {
  return groups.flatMap((group) => group.items.map((item) => item.href));
}

export function getDashboardShellHrefs(
  groups: readonly DashboardNavGroup[] = dashboardNavGroups,
): string[] {
  return [...new Set([...getDashboardNavHrefs(groups), ...dashboardShellActionHrefs])];
}

export function filterDashboardNavByAllowedHrefs(
  groups: readonly DashboardNavGroup[],
  allowedHrefs: ReadonlySet<string>,
): DashboardNavGroup[] {
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => allowedHrefs.has(item.href)),
    }))
    .filter((group) => group.items.length > 0);
}
