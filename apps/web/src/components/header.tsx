import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { authClient } from "@/lib/auth-client";
import { adminAccessQueryOptions } from "@/utils/admin-settings";

import { ModeToggle } from "./mode-toggle";
import UserMenu from "./user-menu";

const BASE_LINKS = [
  { to: "/", label: "Home" },
  { to: "/dashboard", label: "Dashboard" },
  { to: "/coach", label: "Coach" },
  { to: "/body", label: "Body" },
  { to: "/supplements", label: "Supplements" },
  { to: "/workouts", label: "Workouts" },
  { to: "/records/timeline", label: "Timeline" },
  { to: "/records/sleep", label: "Sleep" },
  { to: "/records/activity", label: "Activity" },
  { to: "/records/vitals", label: "Vitals" },
  { to: "/records/labs", label: "Labs" },
  { to: "/exports", label: "Clinical export" },
  { to: "/sharing", label: "Sharing" },
  { to: "/settings", label: "Settings" },
] as const;

export default function Header() {
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const userId = session?.user?.id;
  const hasUserId = !!userId;

  const access = useQuery({
    ...adminAccessQueryOptions(userId ?? ""),
    enabled: hasUserId,
  });

  const showAdministration =
    hasUserId &&
    !sessionPending &&
    !access.isPending &&
    !access.isFetching &&
    !access.isError &&
    access.data?.isInstanceAdmin === true;

  const links = showAdministration
    ? [...BASE_LINKS, { to: "/admin/settings" as const, label: "Administration" }]
    : BASE_LINKS;

  return (
    <div>
      <div className="flex flex-row items-center justify-between px-2 py-1">
        <nav className="flex gap-4 text-lg">
          {links.map(({ to, label }) => {
            return (
              <Link key={to} to={to}>
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-2">
          <ModeToggle />
          <UserMenu />
        </div>
      </div>
      <hr />
    </div>
  );
}
