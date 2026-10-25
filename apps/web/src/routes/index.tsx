import { Trans } from "@lingui/react/macro";
import { buttonVariants } from "@openvalens/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Apple, Footprints, HeartPulse, Moon, Scale } from "lucide-react";

import { Page, StatusPill, ToneIcon } from "@/components/page";
import { authClient } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/")({
  component: HomeComponent,
});

function HomeComponent() {
  const readiness = useQuery(orpc.health.readiness.queryOptions({ input: {} }));
  const isConnected = readiness.data?.status === "ok";
  const { data: session } = authClient.useSession();

  return (
    <Page
      width="narrow"
      className="min-h-[calc(100svh-3.5rem)] content-center justify-items-center gap-10 py-16 text-center lg:py-24"
    >
      <div className="grid justify-items-center gap-6">
        <div className="flex items-center gap-2" aria-hidden="true">
          <ToneIcon icon={Moon} tone="sleep" size="sm" />
          <ToneIcon icon={Footprints} tone="steps" size="sm" />
          <ToneIcon icon={HeartPulse} tone="heart" size="sm" />
          <ToneIcon icon={Scale} tone="weight" size="sm" />
          <ToneIcon icon={Apple} tone="food" size="sm" />
        </div>
        <h1 className="font-display text-[3rem] leading-[0.98] font-medium tracking-[-0.035em] text-ink md:text-[4.5rem]">
          OpenValens
        </h1>
        <p className="max-w-[34ch] text-xl leading-snug text-ink-2">
          <Trans>An open-source, private health record.</Trans>
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          {session ? (
            <Link to="/dashboard" className={buttonVariants({ size: "lg" })}>
              <Trans>Open your dashboard</Trans>
            </Link>
          ) : (
            <>
              <Link to="/login" className={buttonVariants({ size: "lg" })}>
                <Trans>Sign in</Trans>
              </Link>
              <Link to="/join" className={buttonVariants({ variant: "outline", size: "lg" })}>
                <Trans>Redeem invitation</Trans>
              </Link>
            </>
          )}
        </div>
      </div>

      <dl className="flex items-center gap-2 text-sm text-ink-3">
        <dt>
          <Trans>API Status</Trans>
        </dt>
        <dd role="status" className="m-0">
          {readiness.isLoading ? (
            <StatusPill tone="neutral">
              <Trans>Checking...</Trans>
            </StatusPill>
          ) : isConnected ? (
            <StatusPill tone="good">
              <Trans>Connected</Trans>
            </StatusPill>
          ) : (
            <StatusPill tone="bad">
              <Trans>Disconnected</Trans>
            </StatusPill>
          )}
        </dd>
      </dl>
    </Page>
  );
}
