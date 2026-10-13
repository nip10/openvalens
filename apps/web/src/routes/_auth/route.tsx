import { Button } from "@openvalens/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@openvalens/ui/components/card";
import { Outlet, createFileRoute, redirect, useRouter } from "@tanstack/react-router";

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
  return <Outlet />;
}

function AuthBootstrapError({ error }: { error: unknown }) {
  const router = useRouter();
  const message =
    error instanceof BootstrapError
      ? error.message
      : "Could not prepare your workspace. Please try again.";

  return (
    <main className="container mx-auto max-w-3xl px-4 py-6">
      <Card className="mx-auto w-full max-w-md">
        <CardHeader>
          <CardTitle>Account setup failed</CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => router.invalidate()}>Retry</Button>
        </CardContent>
      </Card>
    </main>
  );
}
