import { Trans, useLingui } from "@lingui/react/macro";
import type { ChangelogEntry } from "@openvalens/api/whats-new";
import { Button } from "@openvalens/ui/components/button";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";

import { ErrorState, StatusPill } from "@/components/page";
import { orpc } from "@/utils/orpc";

/** "1 Nov 2026" in the app's language; release dates are calendar days. */
function releaseDate(locale: string, iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/**
 * Splits an item into its lead and the rest when it starts with a short
 * phrase ending in "." or ":" ("Custom trackers. Keep a record…"), so the lead
 * can be set in bold.
 */
export function splitLead(item: string): { lead: string | null; rest: string } {
  const match = /^(.{2,90}?[.:])\s+(.+)$/s.exec(item);
  if (!match) return { lead: null, rest: item };
  return { lead: match[1]!, rest: match[2]! };
}

/** Every release's highlights, newest first: Settings › What's new. */
export function ChangelogView({
  entries,
  currentVersion,
}: {
  entries: readonly ChangelogEntry[];
  currentVersion?: string;
}) {
  const { t, i18n } = useLingui();
  return (
    <ol className="grid gap-4" aria-label={t`Releases`}>
      {entries.map((entry) => (
        <li key={entry.version}>
          <article
            aria-labelledby={`release-${entry.version}`}
            className="sheet grid gap-3 p-5"
            lang={entry.locale}
          >
            <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 id={`release-${entry.version}`} className="text-xl leading-tight text-ink">
                {entry.version}
              </h2>
              <span className="text-sm text-ink-3">{releaseDate(i18n.locale, entry.date)}</span>
              {entry.version === currentVersion ? (
                <StatusPill tone="neutral">
                  <Trans>This version</Trans>
                </StatusPill>
              ) : null}
            </header>
            <div className="grid max-w-[70ch] gap-2 text-ink-2">
              {entry.highlights.map((block, index) =>
                block.kind === "paragraph" ? (
                  <p key={index}>{block.text}</p>
                ) : (
                  <ul key={index} className="grid list-disc gap-1.5 pl-5 marker:text-ink-3">
                    {block.items.map((item, itemIndex) => {
                      const { lead, rest } = splitLead(item);
                      return (
                        <li key={itemIndex}>
                          {lead ? <strong className="font-semibold text-ink">{lead}</strong> : null}
                          {lead ? " " : null}
                          {rest}
                        </li>
                      );
                    })}
                  </ul>
                ),
              )}
            </div>
          </article>
        </li>
      ))}
    </ol>
  );
}

/** The changelog with its loading and error states. */
export function WhatsNewChangelog() {
  const { i18n } = useLingui();
  const locale = i18n.locale === "pt-PT" ? "pt-PT" : "en";
  const changelog = useQuery(orpc.whatsNew.changelog.queryOptions({ input: { locale } }));
  if (changelog.isPending) {
    return (
      <div className="grid gap-4" aria-hidden="true">
        <Skeleton className="h-48 w-full rounded-3xl" />
        <Skeleton className="h-32 w-full rounded-3xl" />
      </div>
    );
  }
  if (changelog.isError || !changelog.data) {
    return (
      <ErrorState
        title={<Trans>Could not load the changelog.</Trans>}
        action={
          <Button variant="outline" size="sm" onClick={() => void changelog.refetch()}>
            <Trans>Retry</Trans>
          </Button>
        }
      />
    );
  }
  return (
    // The newest entry is the version this server runs.
    <ChangelogView
      entries={changelog.data.entries}
      currentVersion={changelog.data.entries[0]?.version}
    />
  );
}
