import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@openvalens/ui/components/button";
import { Outlet, createFileRoute, redirect, useRouter } from "@tanstack/react-router";

import { AccessBanner } from "@/components/access-banner";
import { LocaleSync } from "@/components/locale-sync";
import { ErrorState, Page } from "@/components/page";
import { authClient } from "@/lib/auth-client";
import { BootstrapError, bootstrapSession } from "@/utils/session-bootstrap";

export const Route = createFileRoute("/_auth")({
  component: AuthLayout,
  errorComponent: AuthBootstrapError,
  beforeLoad: async () => {
    const initial = await authClient.getSession();
    if (!initial.data) {
      throw redirect({ to: "/login" });
    }

    // If the session already has an active organization, skip bootstrap and
    // preserve the user's explicit workspace selection.
    if (initial.data.session.activeOrganizationId) {
      return { session: initial.data };
    }

    try {
      const session = await bootstrapSession(authClient);
      return { session };
    } catch (error) {
      if (error instanceof BootstrapError && !error.retryable) {
        throw redirect({ to: "/login" });
      }
      throw error;
    }
  },
});

function AuthLayout() {
  return (
    <>
      <LocaleSync />
      <AccessBanner />
      <Outlet />
    </>
  );
}

function AuthBootstrapError({ error }: { error: unknown }) {
  const router = useRouter();
  const { t, i18n } = useLingui();
  const message =
    error instanceof BootstrapError
      ? i18n._(error.userMessage)
      : t`Could not prepare your workspace. Please try again.`;

  return (
    <Page width="narrow" className="pt-16">
      <ErrorState
        className="mx-auto w-full max-w-md"
        title={<Trans>Account setup failed</Trans>}
        description={message}
        action={
          <Button onClick={() => router.invalidate()}>
            <Trans>Retry</Trans>
          </Button>
        }
      />
    </Page>
  );
}
