import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@openvalens/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@openvalens/ui/components/dropdown-menu";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { cn } from "@openvalens/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { CreditCard, LogOut, Settings, UserRound } from "lucide-react";

import { THEME_CHOICES, themeChoiceLabel, type ThemeChoice } from "@/components/mode-toggle";
import { useTheme } from "@/components/theme-provider";
import { authClient } from "@/lib/auth-client";
import { signUpOptionsQueryOptions } from "@/utils/sign-up";
import { prepareOfflineSignOut } from "@/utils/sync-engine";

/** The first letter of the name (or the email), for the avatar circle. */
function initial(name: string | null | undefined, email: string | null | undefined): string {
  const source = (name ?? "").trim() || (email ?? "").trim();
  return (Array.from(source)[0] ?? "?").toLocaleUpperCase();
}

/**
 * The account menu (#app-shell-3): where most people look for their settings.
 * Settings, Profile, Plan & billing (OpenValens Cloud only), the theme with a
 * check on the current choice, and Sign out. `compact` shows the avatar only
 * (the phone's top bar).
 */
export default function UserMenu({ compact = false }: { compact?: boolean }) {
  const navigate = useNavigate();
  const { t, i18n } = useLingui();
  const { data: session, isPending } = authClient.useSession();
  const { theme, setTheme } = useTheme();
  const cloud = useQuery({ ...signUpOptionsQueryOptions(), enabled: !!session }).data?.mode;

  if (isPending) {
    return <Skeleton className={cn("h-11 rounded-full", compact ? "w-11" : "w-28")} />;
  }

  if (!session) {
    return (
      <Button variant="outline" asChild>
        <Link to="/login">
          <Trans>Sign In</Trans>
        </Link>
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          aria-label={compact ? t`Account menu` : undefined}
          className={cn(
            "h-11 justify-start gap-2.5 px-1.5",
            compact ? "w-11" : "max-w-[10rem] sm:max-w-[14rem] lg:w-full lg:max-w-none",
          )}
        >
          <span
            className="grid size-8 shrink-0 place-items-center rounded-full bg-sidebar-accent font-display text-sm font-semibold text-signal"
            aria-hidden="true"
          >
            {initial(session.user.name, session.user.email)}
          </span>
          {compact || !session.user.name?.trim() ? null : (
            <span className="truncate font-semibold text-ink">{session.user.name}</span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56 rounded-2xl bg-card">
        <DropdownMenuLabel className="grid max-w-[min(20rem,85vw)] gap-0.5">
          {session.user.name ? (
            <span className="truncate font-semibold text-ink">{session.user.name}</span>
          ) : null}
          <span className="truncate font-normal text-ink-3">{session.user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem asChild>
            <Link to="/settings">
              <Settings aria-hidden="true" />
              <Trans>Settings</Trans>
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to="/profile">
              <UserRound aria-hidden="true" />
              <Trans>Profile</Trans>
            </Link>
          </DropdownMenuItem>
          {cloud === "cloud" ? (
            <DropdownMenuItem asChild>
              <Link to="/settings/billing">
                <CreditCard aria-hidden="true" />
                <Trans>Plan & billing</Trans>
              </Link>
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-ink-3">
          <Trans>Theme</Trans>
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={theme ?? "system"}
          onValueChange={(value) => setTheme(value as ThemeChoice)}
        >
          {THEME_CHOICES.map((choice) => (
            <DropdownMenuRadioItem key={choice} value={choice}>
              {i18n._(themeChoiceLabel(choice))}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={async () => {
            await prepareOfflineSignOut();
            authClient.signOut({
              fetchOptions: {
                onSuccess: () => {
                  navigate({
                    to: "/",
                  });
                },
              },
            });
          }}
        >
          <LogOut aria-hidden="true" />
          <Trans>Sign Out</Trans>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
