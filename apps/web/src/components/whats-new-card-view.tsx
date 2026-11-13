import { Trans } from "@lingui/react/macro";
import type { WhatsNewCard } from "@openvalens/api/whats-new";
import { Button } from "@openvalens/ui/components/button";
import { ExternalLink, Sparkles } from "lucide-react";

import { ToneIcon } from "@/components/page";

/** The "What's new in X.Y" card itself (#446), without its data: see `whats-new-card.tsx`. */
export function WhatsNewCardView({
  card,
  dismissing,
  failed,
  onDismiss,
}: {
  card: WhatsNewCard;
  dismissing: boolean;
  failed: boolean;
  onDismiss: () => void;
}) {
  const { shortVersion } = card;
  return (
    <section
      aria-labelledby="whats-new-title"
      className="sheet grid gap-4 p-6 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-start md:gap-x-6"
    >
      <ToneIcon icon={Sparkles} tone="signal" size="lg" />
      <div className="grid min-w-0 gap-2">
        <h2 id="whats-new-title" className="text-xl leading-tight text-ink">
          <Trans>What's new in {shortVersion}</Trans>
        </h2>
        <div className="grid max-w-[70ch] gap-2 text-sm text-ink-2" lang={card.locale}>
          {card.highlights.map((block, index) =>
            block.kind === "paragraph" ? (
              <p key={index}>{block.text}</p>
            ) : (
              <ul key={index} className="grid list-disc gap-1 pl-5">
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>{item}</li>
                ))}
              </ul>
            ),
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" asChild>
          <a href={card.changelogUrl} target="_blank" rel="noreferrer">
            <Trans>Full changelog</Trans>
            <ExternalLink aria-hidden="true" />
          </a>
        </Button>
        <Button variant="ghost" disabled={dismissing} onClick={onDismiss}>
          <Trans>Dismiss</Trans>
        </Button>
      </div>
      {failed ? (
        <p role="alert" className="text-sm text-destructive md:col-span-3">
          <Trans>Could not dismiss it. Try again.</Trans>
        </p>
      ) : null}
    </section>
  );
}
