import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "@tanstack/react-router";
import { ChevronLeft, Menu, Plus, Settings } from "lucide-react";
import { type ReactNode, type RefObject, useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@openvalens/ui/components/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@openvalens/ui/components/sheet";
import { cn } from "@openvalens/ui/lib/utils";

import { authClient } from "@/lib/auth-client";
import { adminAccessQueryOptions } from "@/utils/admin-settings";
import { filterNavByModules, useEnabledModules } from "@/utils/modules";

import { ModeToggle } from "./mode-toggle";
import {
  ADMIN_LINK,
  filterChildren,
  flattenGroups,
  isInSection,
  isWithin,
  NAV_GROUPS,
  type NavGroup,
  screenLabel,
  SETTINGS_LINK,
} from "./nav-links";
import {
  LogFab,
  LogLauncherProvider,
  type PaletteRenderProps,
  useLogLauncher,
} from "./quick-log/log-launcher";
import { QuickLogPalette, useQuickLogHotkey } from "./quick-log/quick-log-palette";
import UserMenu from "./user-menu";
import { WhatsNewDialog } from "./whats-new-dialog";

const linkClasses =
  "flex items-center gap-3 rounded-2xl px-3 font-body font-medium text-ink-2 whitespace-nowrap transition-colors duration-[var(--dur-short)] hover:bg-muted hover:text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring active:bg-paper-2 aria-[current]:bg-sidebar-accent aria-[current]:font-semibold aria-[current]:text-sidebar-accent-foreground [&>svg]:shrink-0 [&>svg]:text-ink-3 aria-[current]:[&>svg]:text-signal";

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

  const all = showAdministration
    ? NAV_GROUPS.map((group, index) =>
        index === NAV_GROUPS.length - 1 ? { ...group, links: [...group.links, ADMIN_LINK] } : group,
      )
    : NAV_GROUPS;

  // Onboarding stage 1: links of hidden modules leave the menu (every link
  // shows while the profile loads or fails, or before the person chooses).
  const { isEnabled } = useEnabledModules();
  const groups = filterChildren(filterNavByModules(all, isEnabled), isEnabled);

  return { groups, signedIn: hasUserId, sessionPending };
}

/** The round mark alone: the phone's top bar spends its width on where you are. */
function LogoMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "size-7 shrink-0 rounded-[10px] bg-[radial-gradient(circle_at_35%_35%,var(--tone-steps-soft),var(--signal))]",
        className,
      )}
      aria-hidden="true"
    />
  );
}

function Wordmark() {
  const { _ } = useLingui();
  return (
    <Link
      to="/"
      aria-label={_(msg`OpenValens home`)}
      className="flex items-center gap-2 rounded-full font-display text-xl font-semibold tracking-[-0.01em] text-ink no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <LogoMark />
      OpenValens
    </Link>
  );
}

/**
 * Opens the full quick log palette (#440); the log "+" opens the screen's
 * subject instead. The shortcut is shown to sighted keyboard users; screen
 * readers get it from `aria-keyshortcuts`.
 */
function LogButton({ onOpen, className }: { onOpen: () => void; className?: string }) {
  const { _ } = useLingui();
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <Button
      variant="outline"
      size="sm"
      className={className}
      onClick={onOpen}
      aria-keyshortcuts={mac ? "Meta+K" : "Control+K"}
      aria-haspopup="dialog"
    >
      <Plus className="size-4" aria-hidden="true" />
      {_(msg({ message: "Log…", comment: "Opens the quick log palette." }))}
      <kbd className="ml-auto hidden font-body text-xs text-ink-3 sm:inline" aria-hidden="true">
        {mac ? "⌘K" : "Ctrl K"}
      </kbd>
    </Button>
  );
}

function NavGroups({
  groups,
  label,
  navRef,
  dense = false,
  onNavigate,
}: {
  groups: readonly NavGroup[];
  label: string;
  navRef?: RefObject<HTMLElement | null>;
  /** The desktop sidebar: shorter rows so the whole list fits on screen. */
  dense?: boolean;
  onNavigate?: () => void;
}) {
  const { _ } = useLingui();
  const { pathname } = useLocation();
  const row = dense
    ? "min-h-8 py-1.5 text-sm [&>svg]:size-[18px]"
    : "min-h-10 py-2 text-[0.9375rem] [&>svg]:size-[19px]";
  return (
    <nav ref={navRef} aria-label={label} className={dense ? "grid gap-3" : "grid gap-5"}>
      {groups.map((group) => (
        <div key={group.label.id} className="grid gap-0.5">
          <p
            id={`nav-${label.length}-${group.label.id}`}
            className="px-3 pb-0.5 text-[0.8125rem] font-semibold text-ink-3"
          >
            {_(group.label)}
          </p>
          <ul aria-labelledby={`nav-${label.length}-${group.label.id}`} className="grid gap-px">
            {group.links.map((link) => {
              const { to, label: linkLabel, icon: Icon } = link;
              // #app-shell-2: sub-screens are tabs on the page; the parent
              // stays marked while one of them is open.
              const inSubScreen = !isWithin(pathname, to) && isInSection(pathname, link);
              return (
                <li key={to}>
                  <Link
                    to={to}
                    className={cn(linkClasses, row)}
                    aria-current={inSubScreen ? "true" : undefined}
                    onClick={onNavigate}
                  >
                    <Icon aria-hidden="true" />
                    {_(linkLabel)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/**
 * The desktop list: scrolls on its own when the window is short, with a soft
 * fade at the bottom as the hint, and brings the current page into view.
 */
function SidebarNav({ groups }: { groups: readonly NavGroup[] }) {
  const { _ } = useLingui();
  const navRef = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  useEffect(() => {
    const current = navRef.current?.querySelector<HTMLElement>("a[aria-current]");
    current?.scrollIntoView?.({ block: "nearest" });
  }, [pathname]);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-2 pt-1">
      <NavGroups groups={groups} label={_(msg`Main navigation`)} navRef={navRef} dense />
      <div
        className="pointer-events-none sticky bottom-0 h-6 bg-linear-to-t from-sidebar to-transparent"
        aria-hidden="true"
      />
    </div>
  );
}

/** Settings, one tap from anywhere, next to the account it belongs to. */
function SettingsButton() {
  const { _ } = useLingui();
  const label = _(msg`Settings`);
  return (
    <Button variant="ghost" size="icon" asChild>
      <Link
        to="/settings"
        aria-label={label}
        title={label}
        className="text-ink-3 aria-[current=page]:bg-sidebar-accent aria-[current=page]:text-signal"
      >
        <Settings className="size-[1.2rem]" aria-hidden="true" />
      </Link>
    </Button>
  );
}

/**
 * The phone's top bar, after the menu button: on a settings sub-page a way
 * back to Settings, elsewhere the name of the screen.
 */
function MobilePlace() {
  const { _ } = useLingui();
  const { pathname } = useLocation();
  if (pathname.startsWith("/settings/")) {
    return (
      <Link
        to="/settings"
        className="inline-flex min-h-11 min-w-0 items-center gap-1 rounded-full pr-2 font-display font-medium text-ink no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <ChevronLeft className="size-5 shrink-0 text-ink-3" aria-hidden="true" />
        <span className="truncate">{_(msg`Settings`)}</span>
      </Link>
    );
  }
  const place = screenLabel(pathname);
  return place ? (
    <p className="truncate font-display text-lg font-medium text-ink">{_(place)}</p>
  ) : null;
}

/**
 * The app's frame inside the log launcher, which holds the quick log palette
 * and what each page registered for the log "+" (DESIGN.md "Forms and logging").
 */
export default function AppShell({ children }: { children: ReactNode }) {
  const location = useLocation();
  return (
    <LogLauncherProvider pathname={location.pathname} Palette={ShellPalette}>
      <AppFrame>{children}</AppFrame>
    </LogLauncherProvider>
  );
}

/** The palette, on signed-in screens only (not the first-run flow). */
function ShellPalette(props: PaletteRenderProps) {
  const { groups, signedIn } = useNavGroups();
  const location = useLocation();
  if (!signedIn || location.pathname === "/welcome") return null;
  return <QuickLogPalette {...props} navGroups={flattenGroups(groups)} />;
}

/**
 * The app's frame. Signed in: a grouped sidebar from 60rem up, a top bar with
 * a menu sheet below it, and the log "+". Signed out: a top bar with the
 * wordmark only.
 */
function AppFrame({ children }: { children: ReactNode }) {
  const { groups, signedIn, sessionPending } = useNavGroups();
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobileNavRef = useRef<HTMLElement>(null);
  const location = useLocation();
  const { _ } = useLingui();
  const { openPalette: openAt, togglePalette } = useLogLauncher();
  const openPalette = useCallback(() => openAt(null), [openAt]);
  // A conversation's composer holds the bottom of the screen, so the log "+" steps aside there.
  const showLogFab = !location.pathname.startsWith("/coach/");

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

  // The first-run flow gets a focused frame: no sidebar to wander off into.
  const focused = location.pathname === "/welcome";
  useQuickLogHotkey(togglePalette, signedIn && !focused);

  if (!signedIn || focused) {
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
      <div className="hidden border-r border-sidebar-border bg-sidebar/80 backdrop-blur-sm lg:block">
        <aside className="sticky top-0 flex h-svh flex-col">
          <div className="flex h-14 shrink-0 items-center px-5">
            <Wordmark />
          </div>
          <div className="px-3 pb-2">
            <LogButton onOpen={openPalette} className="w-full justify-start" />
          </div>
          <SidebarNav groups={groups} />
          <div className="flex shrink-0 items-center gap-1 border-t border-sidebar-border px-3 py-2">
            <div className="min-w-0 flex-1">
              <UserMenu />
            </div>
            <SettingsButton />
          </div>
        </aside>
      </div>

      <div className="grid min-w-0 grid-rows-[auto_1fr] lg:grid-rows-[1fr]">
        <header className="sticky top-0 z-[var(--z-sticky-nav)] flex h-14 items-center justify-between gap-2 border-b border-rule bg-paper px-4 lg:hidden">
          <div className="flex min-w-0 items-center gap-2">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={_(msg`Open navigation menu`)}>
                  <Menu className="size-5" aria-hidden="true" />
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
                    nav?.querySelector<HTMLElement>("a[aria-current]") ??
                    nav?.querySelector<HTMLElement>("a");
                  target?.focus();
                }}
              >
                <SheetHeader>
                  <SheetTitle className="flex items-center gap-2">
                    <LogoMark />
                    OpenValens
                  </SheetTitle>
                  <SheetDescription className="sr-only">
                    <Trans>Navigate the app</Trans>
                  </SheetDescription>
                </SheetHeader>
                <div className="min-h-0 overflow-y-auto px-2 pb-4">
                  <NavGroups
                    groups={[...groups, { label: msg`Account`, links: [SETTINGS_LINK] }]}
                    label={_(msg`Mobile navigation`)}
                    navRef={mobileNavRef}
                    onNavigate={() => setMobileOpen(false)}
                  />
                </div>
              </SheetContent>
            </Sheet>
            <Link
              to="/"
              aria-label={_(msg`OpenValens home`)}
              className="grid size-9 shrink-0 place-items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <LogoMark />
            </Link>
            <MobilePlace />
          </div>
          <div className="flex shrink-0 items-center">
            <UserMenu compact />
          </div>
        </header>
        {/* Room under the last card for the log "+". */}
        <div id="content" className={showLogFab ? "min-w-0 pb-14" : "min-w-0"}>
          {children}
        </div>
      </div>
      {showLogFab ? <LogFab /> : null}
      <WhatsNewDialog />
    </div>
  );
}
