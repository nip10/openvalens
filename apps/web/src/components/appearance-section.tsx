import { Trans, useLingui } from "@lingui/react/macro";
import { cn } from "@openvalens/ui/lib/utils";
import { Monitor, Moon, Palette, Sun, SunMoon } from "lucide-react";
import { useId } from "react";

import { THEME_CHOICES, themeChoiceLabel } from "@/components/mode-toggle";
import { Section } from "@/components/page";
import { SettingsGroup, SettingsRow } from "@/components/settings-rows";
import { useTheme } from "@/components/theme-provider";

const ICONS = { light: Sun, dark: Moon, system: Monitor } as const;

/**
 * Settings › Appearance (#app-shell-5): Light, Dark or System as one
 * segmented control. The account menu offers the same choice.
 */
export function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  const { i18n } = useLingui();
  const labelId = useId();
  const current = theme ?? "system";
  return (
    <Section title={<Trans>Appearance</Trans>} icon={Palette} tone="signal">
      <SettingsGroup>
        <SettingsRow icon={SunMoon} label={<Trans>Theme</Trans>} labelId={labelId}>
          <div
            role="radiogroup"
            aria-labelledby={labelId}
            className="inline-flex rounded-full bg-paper-2 p-1"
          >
            {THEME_CHOICES.map((choice) => {
              const Icon = ICONS[choice];
              const checked = current === choice;
              return (
                <button
                  key={choice}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  onClick={() => setTheme(choice)}
                  className={cn(
                    "inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-ink-2 transition-colors duration-[var(--dur-short)] hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                    checked && "bg-card text-ink shadow-sm",
                  )}
                >
                  <Icon className="size-4" aria-hidden="true" />
                  {i18n._(themeChoiceLabel(choice))}
                </button>
              );
            })}
          </div>
        </SettingsRow>
      </SettingsGroup>
    </Section>
  );
}
