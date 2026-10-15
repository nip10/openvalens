import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@openvalens/ui/components/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@openvalens/ui/components/sheet";

import { authClient } from "@/lib/auth-client";
import { adminAccessQueryOptions } from "@/utils/admin-settings";

import { ModeToggle } from "./mode-toggle";
import UserMenu from "./user-menu";

const BASE_LINKS = [
  { to: "/", label: "Home" },
  { to: "/dashboard", label: "Dashboard" },
  { to: "/coach", label: "Coach" },
  { to: "/body", label: "Body" },
  { to: "/nutrition", label: "Meal diary" },
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
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

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

  const linkClasses =
    "text-foreground hover:text-foreground/80 whitespace-nowrap rounded-sm px-1 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <header className="min-w-0 px-2 py-1">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-center gap-2">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="xl:hidden"
                aria-label="Open navigation menu"
              >
                <Menu className="h-4 w-4" aria-hidden="true" />
                <span className="ml-2 hidden sm:inline">Menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[min(20rem,85vw)]">
              <SheetHeader>
                <SheetTitle>Menu</SheetTitle>
                <SheetDescription className="sr-only">Navigate the app</SheetDescription>
              </SheetHeader>
              <nav className="flex flex-col gap-1 px-4" aria-label="Mobile navigation">
                {links.map(({ to, label }) => (
                  <Link
                    key={to}
                    to={to}
                    className={linkClasses}
                    onClick={() => setMobileOpen(false)}
                  >
                    {label}
                  </Link>
                ))}
                <hr className="my-2" />
                <div className="py-1">
                  <ModeToggle />
                </div>
              </nav>
            </SheetContent>
          </Sheet>

          <nav
            className="hidden xl:flex flex-wrap items-center gap-x-4 gap-y-1 text-lg"
            aria-label="Main navigation"
          >
            {links.map(({ to, label }) => (
              <Link key={to} to={to} className={linkClasses}>
                {label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <div className="hidden xl:block">
            <ModeToggle />
          </div>
          <UserMenu />
        </div>
      </div>
      <hr />
    </header>
  );
}
