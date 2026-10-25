import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@openvalens/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@openvalens/ui/components/card";
import { Outlet, createFileRoute, redirect, useRouter } from "@tanstack/react-router";

import { LocaleSync } from "@/components/locale-sync";
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
    <main className="mx-auto grid w-full max-w-3xl gap-4 px-4 pt-16 pb-16">
      <Card className="mx-auto w-full max-w-md">
        <CardHeader>
          <CardTitle>
            <Trans>Account setup failed</Trans>
          </CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => router.invalidate()}>
            <Trans>Retry</Trans>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
