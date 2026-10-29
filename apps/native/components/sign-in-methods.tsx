import { useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, useToast } from "heroui-native";
import { Fingerprint, KeyRound, Mail } from "lucide-react-native";
import { Platform, View } from "react-native";

import { ErrorState, Icon, Section, Sheet, StatusPill } from "@/components/bloom";
import { ListRow } from "@/components/list-row";
import { authClient } from "@/lib/auth-client";
import { linkAppleWithSheet, linkInBrowser } from "@/lib/social-sign-in";
import { appleFlow, type SocialOutcome } from "@/lib/social-sign-in-outcome";
import { orpc } from "@/utils/orpc";

const ACCOUNTS_QUERY_KEY = ["auth", "accounts"] as const;

type Method = { providerId: string; name: string; kind: "google" | "apple" | "oidc" };

/**
 * Issue #296 — Settings › Account › Sign-in methods on the phone: list the
 * connected Google, Apple and OIDC sign-ins, connect and disconnect them.
 * Connecting is the only way an identity is bound to this account (never by
 * matching email). Email links always remain; when the server cannot send
 * email it refuses to remove the last connected method.
 */
export function SignInMethodsSection() {
  const { t } = useLingui();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const options = useQuery(orpc.signIn.options.queryOptions({ input: {} }));

  const methods: Method[] = [];
  if (options.data?.google) methods.push({ providerId: "google", name: "Google", kind: "google" });
  if (options.data?.apple) methods.push({ providerId: "apple", name: "Apple", kind: "apple" });
  const oidc = options.data?.oidc;
  if (oidc) methods.push({ providerId: oidc.providerId, name: oidc.displayName, kind: "oidc" });
  const appleNative = options.data?.appleNative === true;

  const accounts = useQuery({
    queryKey: ACCOUNTS_QUERY_KEY,
    enabled: methods.length > 0,
    queryFn: async () => {
      const { data, error } = await authClient.listAccounts();
      if (error) throw new Error("accounts unavailable");
      return data ?? [];
    },
  });

  const report = (outcome: SocialOutcome, name: string) => {
    switch (outcome.kind) {
      case "ok":
      case "canceled":
      case "incomplete":
        return;
      case "email-mismatch":
        toast.show({
          variant: "danger",
          label: t`Your ${name} account uses a different email address than this account.`,
        });
        return;
      case "already-linked":
        toast.show({
          variant: "danger",
          label: t`That ${name} account is already connected to another user.`,
        });
        return;
      default:
        toast.show({ variant: "danger", label: t`Could not connect ${name}. Please try again.` });
    }
  };

  const connect = useMutation({
    mutationFn: async (method: Method) => {
      const outcome =
        method.kind === "apple" && appleFlow(Platform.OS, appleNative) === "native"
          ? await linkAppleWithSheet()
          : await linkInBrowser(method.providerId);
      report(outcome, method.name);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ACCOUNTS_QUERY_KEY }),
  });

  const disconnect = useMutation({
    mutationFn: async (accountRowId: string) => {
      const { error } = await authClient.unlinkAccount({ accountId: accountRowId });
      if (error) throw Object.assign(new Error("unlink failed"), { code: error.code });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ACCOUNTS_QUERY_KEY }),
    onError: (error: Error & { code?: string }) =>
      toast.show({
        variant: "danger",
        label:
          error.code === "FAILED_TO_UNLINK_LAST_ACCOUNT"
            ? t`Keep at least one way to sign in: this server cannot send email links.`
            : t`Could not disconnect. Sign in again and retry.`,
      }),
  });

  if (methods.length === 0) return null;

  return (
    <Section title={t`Sign-in methods`} icon={KeyRound} tone="signal">
      {accounts.isError ? (
        <ErrorState
          title={t`Could not check your sign-in methods.`}
          action={
            <Button variant="outline" size="sm" onPress={() => void accounts.refetch()}>
              <Button.Label>{t`Retry`}</Button.Label>
            </Button>
          }
        />
      ) : (
        <Sheet className="overflow-hidden p-0 py-1">
          <ListRow
            icon={<Icon icon={Mail} size={18} color="ink-2" />}
            title={t`Email link`}
            subtitle={t`Sign in with a link sent to your account email.`}
            showDivider
          />
          {methods.map((method, index) => {
            const linked = (accounts.data ?? []).find(
              (account) => account.providerId === method.providerId,
            );
            const name = method.name;
            return (
              <ListRow
                key={method.providerId}
                icon={
                  <Icon
                    icon={method.kind === "oidc" ? Fingerprint : KeyRound}
                    size={18}
                    color="ink-2"
                  />
                }
                title={name}
                subtitle={linked ? t`Connected` : t`Not connected`}
                showDivider={index < methods.length - 1}
                trailing={
                  <View className="flex-row items-center gap-2">
                    {linked ? <StatusPill tone="good">{t`Connected`}</StatusPill> : null}
                    <Button
                      testID={`sign-in-method-${method.providerId}`}
                      variant="outline"
                      size="sm"
                      isDisabled={accounts.isPending || connect.isPending || disconnect.isPending}
                      onPress={() =>
                        linked ? disconnect.mutate(linked.id) : connect.mutate(method)
                      }
                    >
                      <Button.Label>{linked ? t`Disconnect` : t`Connect`}</Button.Label>
                    </Button>
                  </View>
                }
              />
            );
          })}
        </Sheet>
      )}
    </Section>
  );
}
