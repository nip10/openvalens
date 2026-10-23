import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
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
  { to: "/", label: msg`Home` },
  { to: "/dashboard", label: msg`Dashboard` },
  { to: "/scores", label: msg`Scores` },
  { to: "/preventive-care", label: msg`Preventive care` },
  { to: "/coach", label: msg`Coach` },
  { to: "/body", label: msg`Body` },
  { to: "/body-map", label: msg`Body map` },
  { to: "/private-measurements", label: msg`Private measurements` },
  { to: "/cycle", label: msg`Cycle` },
  { to: "/nutrition", label: msg`Meal diary` },
  { to: "/micronutrients", label: msg`Micronutrients` },
  { to: "/recipe-drafts", label: msg`Recipe draft` },
  { to: "/food-draft", label: msg`Describe a meal` },
  { to: "/supplements", label: msg`Supplements` },
  { to: "/workouts", label: msg`Workouts` },
  { to: "/records/timeline", label: msg`Timeline` },
  { to: "/records/sleep", label: msg`Sleep` },
  { to: "/records/activity", label: msg`Activity` },
  { to: "/records/vitals", label: msg`Vitals` },
  { to: "/records/labs", label: msg`Labs` },
  { to: "/exports", label: msg`Clinical export` },
  { to: "/sharing", label: msg`Sharing` },
  { to: "/settings", label: msg`Settings` },
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
    ? [...BASE_LINKS, { to: "/admin/settings" as const, label: msg`Administration` }]
    : BASE_LINKS;

  const { _ } = useLingui();
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
                aria-label={_(msg`Open navigation menu`)}
              >
                <Menu className="h-4 w-4" aria-hidden="true" />
                <span className="ml-2 hidden sm:inline">
                  <Trans>Menu</Trans>
                </span>
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
                <SheetTitle>
                  <Trans>Menu</Trans>
                </SheetTitle>
                <SheetDescription className="sr-only">
                  <Trans>Navigate the app</Trans>
                </SheetDescription>
              </SheetHeader>
              <nav
                ref={mobileNavRef}
                className="flex min-h-0 flex-col gap-1 overflow-y-auto px-4 pb-4"
                aria-label={_(msg`Mobile navigation`)}
              >
                {links.map(({ to, label }) => (
                  <Link
                    key={to}
                    to={to}
                    className={linkClasses}
                    onClick={() => setMobileOpen(false)}
                  >
                    {_(label)}
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
            aria-label={_(msg`Main navigation`)}
          >
            {links.map(({ to, label }) => (
              <Link key={to} to={to} className={linkClasses}>
                {_(label)}
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
