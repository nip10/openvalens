import { useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { WhatsNewCardView } from "@/components/whats-new-card-view";
import { orpc } from "@/utils/orpc";

/**
 * Issue #446 — "What's new in X.Y" on Today: the Highlights of the version
 * this server runs, once per version per member. Dismissing records the
 * version; Settings › What's new turns the card off. Self-contained, so it
 * can sit beside the other cards on Today.
 */
export function WhatsNewCard() {
  const { i18n } = useLingui();
  const locale = i18n.locale === "pt-PT" ? "pt-PT" : "en";
  const queryClient = useQueryClient();
  const query = useQuery({
    ...orpc.whatsNew.get.queryOptions({ input: { locale } }),
    retry: 1,
  });
  const [failed, setFailed] = useState(false);
  const dismiss = useMutation(
    orpc.whatsNew.dismiss.mutationOptions({
      onSuccess: () => void queryClient.invalidateQueries({ queryKey: orpc.whatsNew.key() }),
      onError: () => setFailed(true),
    }),
  );
  const card = query.data?.card;
  if (!card || dismiss.isSuccess) return null;
  return (
    <WhatsNewCardView
      card={card}
      dismissing={dismiss.isPending}
      failed={failed}
      onDismiss={() => {
        setFailed(false);
        dismiss.mutate({ version: card.version });
      }}
    />
  );
}
