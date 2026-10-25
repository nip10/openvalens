import { Trans } from "@lingui/react/macro";
import { buttonVariants } from "@openvalens/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";

import { Page } from "@/components/page";
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
    <Page width="narrow" className="content-center gap-12 py-16 lg:py-24">
      <div className="grid gap-5">
        <h1 className="text-[2.75rem] leading-[0.98] tracking-[-0.035em] md:text-[4rem]">
          OpenValens
        </h1>
        <p className="max-w-[40ch] text-xl leading-snug text-ink-2">
          <Trans>An open-source, private health record.</Trans>
        </p>
        <div className="flex flex-wrap items-center gap-3 pt-2">
          {session ? (
            <Link to="/dashboard" className={buttonVariants()}>
              <Trans>Open your dashboard</Trans>
            </Link>
          ) : (
            <>
              <Link to="/login" className={buttonVariants()}>
                <Trans>Sign in</Trans>
              </Link>
              <Link to="/join" className={buttonVariants({ variant: "outline" })}>
                <Trans>Redeem invitation</Trans>
              </Link>
            </>
          )}
        </div>
      </div>

      <dl className="grid max-w-sm grid-cols-[auto_1fr] items-baseline gap-x-6 border-t-2 border-rule-2 pt-3 text-sm">
        <dt className="font-medium text-ink-3">
          <Trans>API Status</Trans>
        </dt>
        <dd role="status" className={isConnected ? "text-success" : "text-ink-2"}>
          {readiness.isLoading ? (
            <Trans>Checking...</Trans>
          ) : isConnected ? (
            <Trans>Connected</Trans>
          ) : (
            <span className="text-destructive">
              <Trans>Disconnected</Trans>
            </span>
          )}
        </dd>
      </dl>
    </Page>
  );
}
