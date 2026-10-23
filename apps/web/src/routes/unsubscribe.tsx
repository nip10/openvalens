import { Trans } from "@lingui/react/macro";
import { Button } from "@openvalens/ui/components/button";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

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
    <main className="container mx-auto grid max-w-md gap-4 px-4 py-10">
      <h1 className="text-2xl font-semibold">
        <Trans>Weekly insights email</Trans>
      </h1>
      {status === "unsubscribed" ? (
        <p role="status">
          <Trans>The weekly insights email is off. You can turn it on again in Settings.</Trans>
        </p>
      ) : status === "invalid" || !token ? (
        <p role="status">
          <Trans>
            This link is not valid any more. Sign in and open Settings to change your notifications.
          </Trans>
        </p>
      ) : (
        <>
          <p>
            <Trans>Turn off the weekly insights email for this workspace?</Trans>
          </p>
          <div>
            <Button disabled={unsubscribe.isPending} onClick={() => unsubscribe.mutate({ token })}>
              <Trans>Turn off this email</Trans>
            </Button>
          </div>
          {unsubscribe.isError ? (
            <p role="alert" className="text-sm">
              <Trans>Something went wrong. Try again.</Trans>
            </p>
          ) : null}
        </>
      )}
    </main>
  );
}
