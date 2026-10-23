import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@openvalens/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@openvalens/ui/components/card";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { oidcConnectErrorMessage, signInOptionsQueryOptions } from "@/utils/sign-in-options";

const ACCOUNTS_QUERY_KEY = ["auth", "accounts"] as const;

/**
 * Issue #65 — explicit OIDC binding from Settings.
 *
 * Signing in with the configured IdP never creates or links an account on its
 * own. A signed-in user connects their IdP identity here; the server binds it
 * by issuer + subject. Disconnecting is always safe: email-link sign-in
 * remains. Rendered only when the operator configured OIDC.
 */
export function OidcConnectSection() {
  const options = useQuery(signInOptionsQueryOptions());
  const oidc = options.data?.oidc ?? null;
  const queryClient = useQueryClient();
  const { t, i18n } = useLingui();

  const accounts = useQuery({
    queryKey: ACCOUNTS_QUERY_KEY,
    enabled: oidc !== null,
    queryFn: async () => {
      const { data, error } = await authClient.listAccounts();
      if (error) throw new Error("accounts unavailable");
      return data ?? [];
    },
  });

  // Error redirect from a failed "Connect": `/settings?oidc=error&error=<code>`.
  useEffect(() => {
    if (!oidc) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("oidc") !== "error") return;
    toast.error(
      i18n._(oidcConnectErrorMessage(params.get("error") ?? undefined, oidc.displayName)),
    );
    window.history.replaceState(null, "", window.location.pathname);
  }, [oidc, i18n]);

  const disconnect = useMutation({
    mutationFn: async (accountRowId: string) => {
      const { error } = await authClient.unlinkAccount({ accountId: accountRowId });
      if (error) throw new Error("unlink failed");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ACCOUNTS_QUERY_KEY }),
    onError: () => toast.error(t`Could not disconnect. Sign in again and retry.`),
  });

  if (!oidc) return null;

  const linked = (accounts.data ?? []).find((account) => account.providerId === oidc.providerId);

  const connect = async () => {
    const origin = window.location.origin;
    const { error } = await authClient.linkSocial({
      provider: oidc.providerId,
      callbackURL: `${origin}/settings`,
      errorCallbackURL: `${origin}/settings?oidc=error`,
    });
    if (error) toast.error(i18n._(oidcConnectErrorMessage(undefined, oidc.displayName)));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Sign-in methods</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-4">
        <div className="text-sm">
          <div className="font-medium">{oidc.displayName}</div>
          <div className="text-muted-foreground">
            {linked
              ? t`Connected. You can sign in with ${oidc.displayName}.`
              : t`Connect your ${oidc.displayName} account to sign in with it. Email links keep working.`}
          </div>
        </div>
        {linked ? (
          <Button
            variant="outline"
            disabled={disconnect.isPending}
            onClick={() => disconnect.mutate(linked.id)}
          >
            <Trans>Disconnect</Trans>
          </Button>
        ) : (
          <Button disabled={accounts.isPending} onClick={connect}>
            <Trans>Connect</Trans>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
