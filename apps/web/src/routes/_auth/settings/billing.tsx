import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@openvalens/ui/components/button";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { z } from "zod";

import { BillingPlanView, type BillingPlan } from "@/components/billing-plan-view";
import { ErrorState, Page } from "@/components/page";
import { SettingsPageHeader } from "@/components/settings-back-link";
import { orpc } from "@/utils/orpc";
import { signUpOptionsQueryOptions } from "@/utils/sign-up";

/**
 * Issue #297 — Settings › Plan & billing. OpenValens Cloud only: on a
 * self-hosted server this route is a not-found page and the billing API
 * answers `NOT_FOUND`. Stripe Checkout and the Customer Portal are full-page
 * navigations; Checkout returns here with `?checkout=success|cancelled`.
 */
export const Route = createFileRoute("/_auth/settings/billing")({
  validateSearch: z.object({
    checkout: z.enum(["success", "cancelled"]).optional().catch(undefined),
  }),
  loader: async ({ context }) => {
    const options = await context.queryClient.ensureQueryData(signUpOptionsQueryOptions());
    if (options.mode !== "cloud") throw notFound();
  },
  component: BillingSettingsPage,
});

function BillingSettingsPage() {
  const { t, i18n } = useLingui();
  const { checkout } = Route.useSearch();
  const locale = i18n.locale === "pt-PT" ? "pt-PT" : "en";

  const status = useQuery({
    ...orpc.billing.status.queryOptions({ input: {} }),
    // Back from Checkout, Stripe's webhook may land a moment later.
    refetchInterval: (query) =>
      checkout === "success" && query.state.data?.canSubscribe ? 3000 : false,
  });

  const subscribe = useMutation(
    orpc.billing.checkout.mutationOptions({
      onSuccess: ({ url }) => window.location.assign(url),
      onError: (error) => {
        const code = (error as { code?: string }).code;
        if (code === "ACKNOWLEDGEMENT_STALE") {
          void status.refetch();
        }
      },
    }),
  );
  const manage = useMutation(
    orpc.billing.portal.mutationOptions({
      onSuccess: ({ url }) => window.location.assign(url),
    }),
  );

  const header = <SettingsPageHeader title={<Trans>Plan & billing</Trans>} />;

  if (status.isPending) {
    return (
      <Page width="narrow">
        {header}
        <Skeleton className="h-32 w-full rounded-3xl" />
      </Page>
    );
  }

  if (!status.data) {
    return (
      <Page width="narrow">
        {header}
        <ErrorState
          title={<Trans>Could not load your plan.</Trans>}
          action={
            <Button variant="outline" onClick={() => void status.refetch()}>
              <Trans>Retry</Trans>
            </Button>
          }
        />
      </Page>
    );
  }

  const busy: "monthly" | "annual" | "portal" | null = subscribe.isPending
    ? (subscribe.variables?.plan ?? null)
    : manage.isPending
      ? "portal"
      : null;
  const actionError = subscribe.isError
    ? (subscribe.error as { code?: string }).code === "ACKNOWLEDGEMENT_STALE"
      ? t`These terms have been updated. Review them and confirm again.`
      : t`Could not open Stripe Checkout. Try again.`
    : manage.isError
      ? t`Could not open the billing portal. Try again.`
      : null;

  return (
    <Page width="narrow">
      {header}
      <BillingPlanView
        status={status.data}
        checkout={checkout ?? null}
        busy={busy}
        actionError={actionError}
        onSubscribe={(plan: BillingPlan, acknowledgementVersion: string) => {
          manage.reset();
          subscribe.mutate({
            plan,
            locale,
            acceptedImmediateStart: true,
            acceptedWithdrawalAcknowledgement: true,
            acknowledgementVersion,
          });
        }}
        onManage={() => {
          subscribe.reset();
          manage.mutate({ locale });
        }}
      />
    </Page>
  );
}
