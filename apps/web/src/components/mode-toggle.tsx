import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@openvalens/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@openvalens/ui/components/dropdown-menu";
import { Moon, Sun } from "lucide-react";

import { useTheme } from "@/components/theme-provider";

export const THEME_CHOICES = ["light", "dark", "system"] as const;
export type ThemeChoice = (typeof THEME_CHOICES)[number];

const THEME_LABELS: Record<ThemeChoice, MessageDescriptor> = {
  light: msg`Light`,
  dark: msg`Dark`,
  system: msg`System`,
};

export function themeChoiceLabel(choice: ThemeChoice): MessageDescriptor {
  return THEME_LABELS[choice];
}

/**
 * The theme switch for signed-out screens; signed in, the theme lives in the
 * account menu and Settings › Appearance. The current choice carries a check.
 */
export function ModeToggle() {
  const { theme, setTheme } = useTheme();
  const { i18n } = useLingui();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon">
          <Sun className="h-[1.2rem] w-[1.2rem] scale-100 rotate-0 transition-transform duration-[var(--dur-short)] motion-reduce:transition-none dark:scale-0 dark:-rotate-90" />
          <Moon className="absolute h-[1.2rem] w-[1.2rem] scale-0 rotate-90 transition-transform duration-[var(--dur-short)] motion-reduce:transition-none dark:scale-100 dark:rotate-0" />
          <span className="sr-only">
            <Trans>Toggle theme</Trans>
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={theme ?? "system"}
          onValueChange={(value) => setTheme(value as ThemeChoice)}
        >
          {THEME_CHOICES.map((choice) => (
            <DropdownMenuRadioItem key={choice} value={choice}>
              {i18n._(THEME_LABELS[choice])}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
