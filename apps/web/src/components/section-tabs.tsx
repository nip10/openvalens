import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Link } from "@tanstack/react-router";

import { cn } from "@openvalens/ui/lib/utils";

import { moduleForPath, useEnabledModules } from "@/utils/modules";

import { type NavLink, type SectionParent, sectionTabs } from "./nav-links";

const TAB =
  "inline-flex min-h-9 shrink-0 items-center gap-2 rounded-full border border-input bg-card px-3.5 text-sm font-medium whitespace-nowrap text-ink-2 no-underline transition-colors duration-[var(--dur-short)] hover:bg-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:bg-paper-3 [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-ink-3 aria-[current=page]:border-transparent aria-[current=page]:bg-sidebar-accent aria-[current=page]:font-semibold aria-[current=page]:text-signal aria-[current=page]:hover:bg-sidebar-accent aria-[current=page]:[&>svg]:text-signal";

/**
 * The tabs that move between the visible ones of `links`. Hidden modules'
 * screens drop out the way they do in the sidebar; with fewer than two left
 * there is nothing to switch between, so nothing renders.
 */
export function SectionTabsView({
  links,
  enabled,
}: {
  links: readonly NavLink[];
  enabled: (module: NonNullable<ReturnType<typeof moduleForPath>>) => boolean;
}) {
  const { _ } = useLingui();
  const visible = links.filter((link) => {
    const module = moduleForPath(link.to);
    return module === null || enabled(module);
  });
  if (visible.length < 2) return null;
  return (
    <nav
      aria-label={_(msg`Sections`)}
      className="-mx-4 min-w-0 overflow-x-auto px-4 [contain:inline-size] md:mx-0 md:px-0"
    >
      <ul className="flex w-max gap-2 md:w-auto md:flex-wrap">
        {visible.map(({ to, label, icon: Icon }) => (
          <li key={to}>
            {/* The router marks the open screen with aria-current="page". */}
            <Link to={to} className={cn(TAB)} activeOptions={{ includeSearch: false }}>
              <Icon aria-hidden="true" />
              {_(label)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * #app-shell-2 — a screen's sub-screens as tabs at the top of the parent and
 * of each sub-screen (Body, Body map, Private measurements; Meal diary and
 * its food screens; Activity and Workouts). Put it first inside `<Page>`.
 */
export function SectionTabs({ parent }: { parent: SectionParent }) {
  const { isEnabled } = useEnabledModules();
  return <SectionTabsView links={sectionTabs(parent)} enabled={isEnabled} />;
}
