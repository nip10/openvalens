import { Trans, useLingui } from "@lingui/react/macro";
import type { WhatsNewCard } from "@openvalens/api/whats-new";
import { Button } from "@openvalens/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@openvalens/ui/components/dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { Megaphone } from "lucide-react";
import { useState } from "react";

import { ToneIcon } from "@/components/page";
import { authClient } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";
import { shouldOfferWhatsNew } from "@/utils/whats-new";

/**
 * #dashboard-6 — once per release, the first time someone opens the app
 * after it: two or three headlines, "Read more" (Settings › What's new) and
 * "Got it". Either one records the version on the member's account, so it
 * does not come back on another device. Settings › What's new turns it off.
 */
export function WhatsNewDialog() {
  const { i18n } = useLingui();
  const locale = i18n.locale === "pt-PT" ? "pt-PT" : "en";
  const { data: session } = authClient.useSession();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const query = useQuery({
    ...orpc.whatsNew.get.queryOptions({ input: { locale, platform: "web" } }),
    enabled: !!session,
    retry: 1,
    staleTime: Number.POSITIVE_INFINITY,
  });
  // Closed at once on either button; the saved version keeps it closed.
  const [closedVersion, setClosedVersion] = useState<string | null>(null);
  const dismiss = useMutation(
    orpc.whatsNew.dismiss.mutationOptions({
      onSuccess: () => void queryClient.invalidateQueries({ queryKey: orpc.whatsNew.key() }),
    }),
  );
  const card = query.data?.card;
  const open =
    !!card &&
    closedVersion !== card.version &&
    pathname !== "/settings/whats-new" &&
    shouldOfferWhatsNew(card, session?.user?.createdAt);
  if (!card) return null;
  const close = () => {
    setClosedVersion(card.version);
    dismiss.mutate({ version: card.version });
  };
  return (
    <WhatsNewDialogView
      open={open}
      card={card}
      onGotIt={close}
      onReadMore={() => {
        close();
        void navigate({ to: "/settings/whats-new" });
      }}
    />
  );
}

export function WhatsNewDialogView({
  open,
  card,
  onGotIt,
  onReadMore,
}: {
  open: boolean;
  card: Pick<WhatsNewCard, "shortVersion" | "headlines" | "locale">;
  onGotIt: () => void;
  onReadMore: () => void;
}) {
  const { shortVersion } = card;
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onGotIt())}>
      <DialogContent
        showCloseButton={false}
        className="max-sm:top-auto max-sm:bottom-0 max-sm:max-w-full max-sm:translate-y-0 max-sm:rounded-b-none rounded-3xl bg-card"
      >
        <DialogHeader className="items-start text-left">
          <ToneIcon icon={Megaphone} tone="signal" />
          <DialogTitle className="font-display text-2xl font-medium text-ink">
            <Trans>What's new in {shortVersion}</Trans>
          </DialogTitle>
          <DialogDescription className="sr-only">
            <Trans>The highlights of this update.</Trans>
          </DialogDescription>
        </DialogHeader>
        <ul className="grid gap-2" lang={card.locale}>
          {card.headlines.map((headline) => (
            <li key={headline} className="flex items-start gap-2.5 text-ink-2">
              <span className="mt-2 size-1.5 shrink-0 rounded-full bg-signal" aria-hidden="true" />
              {headline}
            </li>
          ))}
        </ul>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onReadMore}>
            <Trans>Read more</Trans>
          </Button>
          <Button onClick={onGotIt}>
            <Trans>Got it</Trans>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
