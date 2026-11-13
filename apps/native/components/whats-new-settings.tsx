import { useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Megaphone, Sparkles } from "lucide-react-native";
import { Switch, Text } from "react-native";

import { Section } from "@/components/bloom";
import { SettingsGroup, SettingsRow } from "@/components/language-section";
import { orpc } from "@/utils/orpc";
import { useThemeColor } from "@/utils/theme";

/**
 * Issue #446 — Settings: whether the Cockpit shows "What's new" after an
 * update. Hidden on a server that has no `whatsNew` procedure yet.
 */
export function WhatsNewSettings() {
  const { t, i18n } = useLingui();
  const locale = i18n.locale === "pt-PT" ? "pt-PT" : "en";
  const signal = useThemeColor("signal");
  const queryClient = useQueryClient();
  const query = useQuery({
    ...orpc.whatsNew.get.queryOptions({ input: { locale } }),
    retry: false,
  });
  const update = useMutation(
    orpc.whatsNew.setEnabled.mutationOptions({
      onSettled: () => void queryClient.invalidateQueries({ queryKey: orpc.whatsNew.key() }),
    }),
  );
  if (!query.data) return null;
  const enabled = update.isPending ? update.variables.enabled : query.data.enabled;
  const label = t`Show what's new after an update`;

  return (
    <Section title={t`What's new`} icon={Megaphone} tone="signal">
      <SettingsGroup>
        <SettingsRow
          icon={Sparkles}
          label={label}
          description={
            update.isError ? (
              <Text accessibilityRole="alert" className="font-sans text-sm text-destructive">
                {t`Could not save your setting. Try again.`}
              </Text>
            ) : (
              t`A short card on the Cockpit with the highlights of the new version.`
            )
          }
          trailing={
            <Switch
              accessibilityLabel={label}
              value={enabled}
              disabled={update.isPending}
              onValueChange={(next) => update.mutate({ enabled: next })}
              trackColor={{ true: signal }}
            />
          }
        />
      </SettingsGroup>
    </Section>
  );
}
