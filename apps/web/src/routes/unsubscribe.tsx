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
      <h1 className="text-2xl font-semibold">Weekly insights email</h1>
      {status === "unsubscribed" ? (
        <p role="status">The weekly insights email is off. You can turn it on again in Settings.</p>
      ) : status === "invalid" || !token ? (
        <p role="status">
          This link is not valid any more. Sign in and open Settings to change your notifications.
        </p>
      ) : (
        <>
          <p>Turn off the weekly insights email for this workspace?</p>
          <div>
            <Button disabled={unsubscribe.isPending} onClick={() => unsubscribe.mutate({ token })}>
              Turn off this email
            </Button>
          </div>
          {unsubscribe.isError ? (
            <p role="alert" className="text-sm">
              Something went wrong. Try again.
            </p>
          ) : null}
        </>
      )}
    </main>
  );
}
