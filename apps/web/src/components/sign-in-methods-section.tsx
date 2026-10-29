import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@openvalens/ui/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fingerprint, KeyRound, Mail, type LucideIcon } from "lucide-react";
import { useEffect } from "react";
import { toast } from "sonner";

import { ErrorState, Section, StatusPill } from "@/components/page";
import { SettingsGroup, SettingsRow } from "@/components/settings-rows";
import { authClient } from "@/lib/auth-client";
import {
  oidcConnectErrorMessage,
  signInOptionsQueryOptions,
  socialProviderName,
} from "@/utils/sign-in-options";

const ACCOUNTS_QUERY_KEY = ["auth", "accounts"] as const;

type Method = { providerId: string; displayName: string; icon: LucideIcon };

/**
 * Issue #65 / #296 — Settings › Sign-in methods: the configured OIDC
 * provider, Google and Apple.
 *
 * Signing in with any of them never links an account on its own. A signed-in
 * person connects one here; the server binds it by the provider's subject.
 * Email links always remain; when the server cannot send email, it refuses to
 * remove the last connected method, so nobody is left without a way in.
 * Rendered only when at least one provider is configured.
 */
export function SignInMethodsSection() {
  const options = useQuery(signInOptionsQueryOptions());
  const queryClient = useQueryClient();
  const { t, i18n } = useLingui();

  const methods: Method[] = [];
  const oidc = options.data?.oidc ?? null;
  if (options.data?.google) {
    methods.push({
      providerId: "google",
      displayName: socialProviderName("google"),
      icon: KeyRound,
    });
  }
  if (options.data?.apple) {
    methods.push({ providerId: "apple", displayName: socialProviderName("apple"), icon: KeyRound });
  }
  if (oidc) methods.push({ ...oidc, icon: Fingerprint });
  const enabled = methods.length > 0;

  const accounts = useQuery({
    queryKey: ACCOUNTS_QUERY_KEY,
    enabled,
    queryFn: async () => {
      const { data, error } = await authClient.listAccounts();
      if (error) throw new Error("accounts unavailable");
      return data ?? [];
    },
  });

  // Error redirect from a failed "Connect": `/settings?connect=<id>&error=<code>`.
  const methodKey = methods.map((method) => method.providerId).join(",");
  useEffect(() => {
    if (!methodKey) return;
    const params = new URLSearchParams(window.location.search);
    const providerId =
      params.get("connect") ?? (params.get("oidc") === "error" ? oidc?.providerId : null);
    if (!providerId) return;
    const method = methods.find((candidate) => candidate.providerId === providerId);
    if (!method) return;
    toast.error(
      i18n._(oidcConnectErrorMessage(params.get("error") ?? undefined, method.displayName)),
    );
    window.history.replaceState(null, "", window.location.pathname);
    // `methods` is rebuilt every render; `methodKey` is its stable identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [methodKey, i18n]);

  const disconnect = useMutation({
    mutationFn: async (accountRowId: string) => {
      const { error } = await authClient.unlinkAccount({ accountId: accountRowId });
      if (error) throw Object.assign(new Error("unlink failed"), { code: error.code });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ACCOUNTS_QUERY_KEY }),
    onError: (error: Error & { code?: string }) =>
      toast.error(
        error.code === "FAILED_TO_UNLINK_LAST_ACCOUNT"
          ? t`Keep at least one way to sign in: this server cannot send email links.`
          : t`Could not disconnect. Sign in again and retry.`,
      ),
  });

  if (!enabled) return null;

  const connect = async (method: Method) => {
    const origin = window.location.origin;
    const { error } = await authClient.linkSocial({
      provider: method.providerId,
      callbackURL: `${origin}/settings`,
      errorCallbackURL: `${origin}/settings?connect=${encodeURIComponent(method.providerId)}`,
    });
    if (error) toast.error(i18n._(oidcConnectErrorMessage(undefined, method.displayName)));
  };

  return (
    <Section title={<Trans>Sign-in methods</Trans>} icon={KeyRound} tone="signal">
      {accounts.isError ? (
        <ErrorState
          title={<Trans>Could not check your sign-in methods.</Trans>}
          action={
            <Button variant="outline" onClick={() => void accounts.refetch()}>
              <Trans>Retry</Trans>
            </Button>
          }
        />
      ) : (
        <SettingsGroup>
          <SettingsRow
            icon={Mail}
            label={<Trans>Email link</Trans>}
            description={<Trans>Sign in with a link sent to your account email.</Trans>}
          />
          {methods.map((method) => {
            const linked = (accounts.data ?? []).find(
              (account) => account.providerId === method.providerId,
            );
            const name = method.displayName;
            return (
              <SettingsRow
                key={method.providerId}
                icon={method.icon}
                label={name}
                description={
                  linked
                    ? t`Connected. You can sign in with ${name}.`
                    : t`Connect your ${name} account to sign in with it. Email links keep working.`
                }
              >
                {linked ? (
                  <>
                    <StatusPill tone="good">
                      <Trans>Connected</Trans>
                    </StatusPill>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={disconnect.isPending}
                      onClick={() => disconnect.mutate(linked.id)}
                    >
                      <Trans>Disconnect</Trans>
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={accounts.isPending}
                    onClick={() => void connect(method)}
                  >
                    <Trans>Connect</Trans>
                  </Button>
                )}
              </SettingsRow>
            );
          })}
        </SettingsGroup>
      )}
    </Section>
  );
}
