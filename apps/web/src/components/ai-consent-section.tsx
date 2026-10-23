import { useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";

import { AiConsentCard } from "./ai-consent-card";

/**
 * Connected AI consent control (Issue #123): reads the caller's own consent
 * state and grants/revokes it. Revocation is behind a confirm dialog because it
 * stops AI features; granting is a single flip.
 */
export function AiConsentSection() {
  const queryClient = useQueryClient();
  const consent = useQuery(orpc.ai.consent.get.queryOptions({ input: {} }));
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { t } = useLingui();

  const invalidateConsent = () =>
    void queryClient.invalidateQueries({ queryKey: orpc.ai.consent.key() });

  const grant = useMutation(
    orpc.ai.consent.grant.mutationOptions({
      onSuccess: () => {
        invalidateConsent();
        toast.success(t({ message: "AI processing enabled", comment: "safety" }));
      },
      onError: () => toast.error(t`Could not update AI consent.`),
    }),
  );

  const revoke = useMutation(
    orpc.ai.consent.revoke.mutationOptions({
      onSuccess: () => {
        invalidateConsent();
        toast.success(t({ message: "AI processing disabled", comment: "safety" }));
      },
      onError: () => toast.error(t`Could not update AI consent.`),
    }),
  );

  return (
    <AiConsentCard
      status={consent.isPending ? "pending" : consent.isError ? "error" : "ready"}
      state={consent.data ?? null}
      isPending={grant.isPending || revoke.isPending}
      confirmOpen={confirmOpen}
      onConfirmOpenChange={setConfirmOpen}
      onRetry={() => void consent.refetch()}
      onGrant={() => grant.mutate({})}
      onRequestRevoke={() => setConfirmOpen(true)}
      onRevoke={() => {
        setConfirmOpen(false);
        revoke.mutate({});
      }}
    />
  );
}
