import { useLingui } from "@lingui/react/macro";
import { Eye, LayoutGrid } from "lucide-react-native";
import { useState } from "react";
import { Switch, Text } from "react-native";

import { Section } from "@/components/bloom";
import { SettingsGroup, SettingsRow } from "@/components/language-section";
import { HOME_WIDGET_DRAWN_BY_APP } from "@/lib/home-widget/platform";
import { setHomeWidgetValuesEnabled, useHomeWidgetValuesEnabled } from "@/lib/home-widget/storage";
import { useThemeColor } from "@/utils/theme";

/**
 * Issue #449 — Settings: the home-screen widget. On Android, the opt-in for
 * values on it (off by default, this phone only). The iOS widget cannot be
 * given any data (no App Group), so it has buttons only and no option.
 */
export function HomeWidgetSettings() {
  const { t } = useLingui();
  const signal = useThemeColor("signal");
  const stored = useHomeWidgetValuesEnabled();
  const [failed, setFailed] = useState(false);
  const label = t`Show values on the widget`;

  return (
    <Section title={t`Home-screen widget`} icon={LayoutGrid} tone="signal">
      <SettingsGroup>
        <SettingsRow
          icon={LayoutGrid}
          label={t`Quick log widget`}
          description={t`Add it from your home screen to log a glass of water, take your next supplement or open the log. A tap opens OpenValens, saves at once and offers Undo.`}
        />
        {HOME_WIDGET_DRAWN_BY_APP ? (
          <SettingsRow
            divider
            icon={Eye}
            label={label}
            description={
              failed ? (
                <Text accessibilityRole="alert" className="font-sans text-sm text-destructive">
                  {t`Could not save your setting. Try again.`}
                </Text>
              ) : (
                t`Off by default. Shows today's water and the supplement doses due on the widget, where anyone who sees your home screen can read them. Only on this phone.`
              )
            }
            trailing={
              <Switch
                testID="settings-home-widget-values"
                accessibilityLabel={label}
                value={stored === true}
                disabled={stored === null}
                onValueChange={(next) => {
                  setFailed(false);
                  setHomeWidgetValuesEnabled(next).catch(() => setFailed(true));
                }}
                trackColor={{ true: signal }}
              />
            }
          />
        ) : null}
      </SettingsGroup>
    </Section>
  );
}
