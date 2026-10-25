import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";

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

type NavLink = { to: string; label: MessageDescriptor };
type NavGroup = { label: MessageDescriptor; links: readonly NavLink[] };

// Twenty-odd destinations read as one undifferentiated row; grouped by what
// someone came to do, each group stays short enough to scan.
const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: msg`Today`,
    links: [
      { to: "/dashboard", label: msg`Dashboard` },
      { to: "/scores", label: msg`Scores` },
      { to: "/coach", label: msg`Coach` },
      { to: "/preventive-care", label: msg`Preventive care` },
    ],
  },
  {
    label: msg`Records`,
    links: [
      { to: "/records/timeline", label: msg`Timeline` },
      { to: "/body", label: msg`Body` },
      { to: "/body-map", label: msg`Body map` },
      { to: "/private-measurements", label: msg`Private measurements` },
      { to: "/cycle", label: msg`Cycle` },
      { to: "/records/sleep", label: msg`Sleep` },
      { to: "/records/activity", label: msg`Activity` },
      { to: "/records/vitals", label: msg`Vitals` },
      { to: "/records/labs", label: msg`Labs` },
      { to: "/workouts", label: msg`Workouts` },
    ],
  },
  {
    label: msg`Food`,
    links: [
      { to: "/nutrition", label: msg`Meal diary` },
      { to: "/food-draft", label: msg`Describe a meal` },
      { to: "/recipe-drafts", label: msg`Recipe draft` },
      { to: "/micronutrients", label: msg`Micronutrients` },
      { to: "/supplements", label: msg`Supplements` },
    ],
  },
  {
    label: msg`Export and share`,
    links: [
      { to: "/exports", label: msg`Clinical export` },
      { to: "/sharing", label: msg`Sharing` },
    ],
  },
];

const ADMIN_LINK: NavLink = { to: "/admin/settings", label: msg`Administration` };
const SETTINGS_LINK: NavLink = { to: "/settings", label: msg`Settings` };

const linkClasses =
  "relative flex min-h-8 items-center rounded-sm px-3 py-1 font-display text-sm text-ink-2 whitespace-nowrap transition-colors duration-[var(--dur-short)] hover:bg-sidebar-accent hover:text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring aria-[current=page]:bg-sidebar-accent aria-[current=page]:text-ink aria-[current=page]:before:absolute aria-[current=page]:before:inset-y-1 aria-[current=page]:before:left-0 aria-[current=page]:before:w-0.5 aria-[current=page]:before:bg-signal";

function useNavGroups() {
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

  const account: NavGroup = {
    label: msg`Account`,
    links: showAdministration ? [SETTINGS_LINK, ADMIN_LINK] : [SETTINGS_LINK],
  };

  return { groups: [...NAV_GROUPS, account], signedIn: hasUserId, sessionPending };
}

function Wordmark() {
  const { _ } = useLingui();
  return (
    <Link
      to="/"
      aria-label={_(msg`OpenValens home`)}
      className="rounded-sm font-display text-lg font-semibold tracking-[-0.02em] text-ink no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      OpenValens
    </Link>
  );
}

function NavGroups({
  groups,
  label,
  navRef,
  onNavigate,
}: {
  groups: readonly NavGroup[];
  label: string;
  navRef?: RefObject<HTMLElement | null>;
  onNavigate?: () => void;
}) {
  const { _ } = useLingui();
  return (
    <nav ref={navRef} aria-label={label} className="grid gap-5">
      {groups.map((group) => (
        <div key={group.label.id} className="grid gap-0.5">
          <p
            id={`nav-${label.length}-${group.label.id}`}
            className="px-3 pb-1 font-body text-sm font-medium text-ink-3"
          >
            {_(group.label)}
          </p>
          <ul aria-labelledby={`nav-${label.length}-${group.label.id}`} className="grid gap-px">
            {group.links.map(({ to, label: linkLabel }) => (
              <li key={to}>
                <Link to={to} className={linkClasses} onClick={onNavigate}>
                  {_(linkLabel)}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/**
 * The app's frame. Signed in: a grouped sidebar from 60rem up, and a top bar
 * with a menu sheet below it. Signed out: a top bar with the wordmark only.
 */
export default function AppShell({ children }: { children: ReactNode }) {
  const { groups, signedIn, sessionPending } = useNavGroups();
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobileNavRef = useRef<HTMLElement>(null);
  const location = useLocation();
  const { _ } = useLingui();

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const skipLink = (
    <a
      href="#content"
      className="absolute -top-24 left-4 z-[var(--z-toast)] bg-ink px-3 py-2 font-display text-sm text-paper focus-visible:top-4"
    >
      <Trans>Skip to content</Trans>
    </a>
  );

  if (!signedIn) {
    return (
      <div className="grid min-h-svh grid-cols-[minmax(0,1fr)] grid-rows-[auto_1fr]">
        {skipLink}
        <header className="border-b border-rule">
          <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-4 md:px-8">
            <Wordmark />
            <div className="flex items-center gap-2">
              <ModeToggle />
              {sessionPending ? null : <UserMenu />}
            </div>
          </div>
        </header>
        <div id="content" className="min-w-0">
          {children}
        </div>
      </div>
    );
  }

  return (
    <div className="grid min-h-svh grid-cols-[minmax(0,1fr)] lg:grid-cols-[15rem_minmax(0,1fr)]">
      {skipLink}
      <aside className="sticky top-0 hidden h-svh flex-col border-r border-sidebar-border bg-sidebar lg:flex">
        <div className="flex h-14 shrink-0 items-center px-5">
          <Wordmark />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pt-2 pb-6">
          <NavGroups groups={groups} label={_(msg`Main navigation`)} />
        </div>
        <div className="flex shrink-0 items-center gap-2 border-t border-sidebar-border px-3 py-3">
          <div className="min-w-0 flex-1">
            <UserMenu />
          </div>
          <ModeToggle />
        </div>
      </aside>

      <div className="grid min-w-0 grid-rows-[auto_1fr] lg:grid-rows-[1fr]">
        <header className="sticky top-0 z-[var(--z-sticky-nav)] flex h-14 items-center justify-between gap-2 border-b border-rule bg-paper px-4 lg:hidden">
          <div className="flex min-w-0 items-center gap-3">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button variant="outline" size="sm" aria-label={_(msg`Open navigation menu`)}>
                  <Menu className="size-4" aria-hidden="true" />
                  <span className="hidden sm:inline">
                    <Trans>Menu</Trans>
                  </span>
                </Button>
              </SheetTrigger>
              <SheetContent
                side="left"
                className="w-[min(20rem,85vw)] bg-sidebar"
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
                <div className="min-h-0 overflow-y-auto px-2 pb-4">
                  <NavGroups
                    groups={groups}
                    label={_(msg`Mobile navigation`)}
                    navRef={mobileNavRef}
                    onNavigate={() => setMobileOpen(false)}
                  />
                  <div className="mt-5 border-t border-sidebar-border px-3 pt-4">
                    <ModeToggle />
                  </div>
                </div>
              </SheetContent>
            </Sheet>
            <Wordmark />
          </div>
          <UserMenu />
        </header>
        <div id="content" className="min-w-0">
          {children}
        </div>
      </div>
    </div>
  );
}
