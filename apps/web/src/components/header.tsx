import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import { useEffect, useRef, useState } from "react";

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
  { to: "/scores", label: "Scores" },
  { to: "/preventive-care", label: "Preventive care" },
  { to: "/coach", label: "Coach" },
  { to: "/body", label: "Body" },
  { to: "/private-measurements", label: "Private measurements" },
  { to: "/cycle", label: "Cycle" },
  { to: "/nutrition", label: "Meal diary" },
  { to: "/recipe-drafts", label: "Recipe draft" },
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
  const mobileNavRef = useRef<HTMLElement>(null);
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
    "text-foreground hover:text-foreground/80 whitespace-nowrap rounded-sm px-1 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:font-semibold";

  return (
    <header className="min-w-0 px-2 py-1">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="2xl:hidden"
                aria-label="Open navigation menu"
              >
                <Menu className="h-4 w-4" aria-hidden="true" />
                <span className="ml-2 hidden sm:inline">Menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent
              side="left"
              className="w-[min(20rem,85vw)]"
              onOpenAutoFocus={(event) => {
                // Land on the current page's link (or the first one) rather than
                // whichever control Radix finds first mid-animation.
                event.preventDefault();
                const nav = mobileNavRef.current;
                const target =
                  nav?.querySelector<HTMLElement>('a[aria-current="page"]') ??
                  nav?.querySelector<HTMLElement>("a");
                target?.focus();
              }}
            >
              <SheetHeader>
                <SheetTitle>Menu</SheetTitle>
                <SheetDescription className="sr-only">Navigate the app</SheetDescription>
              </SheetHeader>
              <nav
                ref={mobileNavRef}
                className="flex min-h-0 flex-col gap-1 overflow-y-auto px-4 pb-4"
                aria-label="Mobile navigation"
              >
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
            className="hidden min-w-0 items-center gap-x-3 text-sm 2xl:flex"
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
          <div className="hidden 2xl:block">
            <ModeToggle />
          </div>
          <UserMenu />
        </div>
      </div>
      <hr />
    </header>
  );
}
