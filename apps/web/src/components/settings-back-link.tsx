import { Trans } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";

import { PageHeader } from "@/components/page";

/**
 * The way back from a settings sub-page: "< Settings" above the title on the
 * left, in the same place on every sub-page and every screen size.
 */
export function SettingsBackLink() {
  return (
    <Link
      to="/settings"
      className="inline-flex w-fit items-center gap-1 rounded-full px-1 text-sm font-medium text-ink-2 underline decoration-signal underline-offset-[0.15em] hover:text-ink hover:decoration-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:decoration-2"
    >
      <ChevronLeft className="size-4" aria-hidden="true" />
      <Trans>Settings</Trans>
    </Link>
  );
}

/** A settings sub-page's header: the back link, then the usual page header. */
export function SettingsPageHeader(props: {
  title: ReactNode;
  description?: ReactNode;
  info?: ReactNode;
  actions?: ReactNode;
  /** Hide the back link (for example while a first-run flow owns the page). */
  hideBack?: boolean;
}) {
  const { hideBack, ...header } = props;
  return (
    <div className="grid gap-2">
      {hideBack ? null : <SettingsBackLink />}
      <PageHeader {...header} />
    </div>
  );
}
