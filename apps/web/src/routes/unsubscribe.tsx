import { Trans } from "@lingui/react/macro";
import { Button } from "@openvalens/ui/components/button";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { BellOff, MailCheck } from "lucide-react";
import { z } from "zod";

import { ErrorState, ToneIcon } from "@/components/page";
import { orpc } from "@/utils/orpc";

/**
 * Issue #92 — one-step unsubscribe from the weekly insights email. Public: no
 * sign-in. The token in the link only turns that email off; it grants nothing
 * else. One button, so a link scanner opening the page changes nothing.
 */
export const Route = createFileRoute("/unsubscribe")({
  validateSearch: z.object({ token: z.string().optional() }),
  component: UnsubscribePage,
});

function UnsubscribePage() {
  const { token } = Route.useSearch();
  const unsubscribe = useMutation(orpc.insights.unsubscribe.mutationOptions());
  const status = unsubscribe.data?.status;

  return (
    <main className="mx-auto grid w-full max-w-md content-start px-4 pt-16 pb-16">
      <div className="sheet grid justify-items-center gap-4 p-6 text-center sm:p-8">
        <ToneIcon icon={status === "unsubscribed" ? MailCheck : BellOff} tone="signal" size="lg" />
        <h1 className="text-3xl">
          <Trans>Weekly insights email</Trans>
        </h1>
        {status === "unsubscribed" ? (
          <p role="status" className="text-ink-2">
            <Trans>The weekly insights email is off. You can turn it on again in Settings.</Trans>
          </p>
        ) : status === "invalid" || !token ? (
          <p role="status" className="text-ink-2">
            <Trans>
              This link is not valid any more. Sign in and open Settings to change your
              notifications.
            </Trans>
          </p>
        ) : (
          <>
            <p className="text-ink-2">
              <Trans>Turn off the weekly insights email for this workspace?</Trans>
            </p>
            <Button
              size="lg"
              disabled={unsubscribe.isPending}
              onClick={() => unsubscribe.mutate({ token })}
            >
              <Trans>Turn off this email</Trans>
            </Button>
            {unsubscribe.isError ? (
              <ErrorState
                className="w-full text-left"
                title={<Trans>Something went wrong. Try again.</Trans>}
              />
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}
