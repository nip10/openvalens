import { Trans } from "@lingui/react/macro";
import { Button } from "@openvalens/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@openvalens/ui/components/dropdown-menu";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { Link, useNavigate } from "@tanstack/react-router";

import { authClient } from "@/lib/auth-client";
import { prepareOfflineSignOut } from "@/utils/sync-engine";

/** The first letter of the name (or the email), for the avatar circle. */
function initial(name: string | null | undefined, email: string | null | undefined): string {
  const source = (name ?? "").trim() || (email ?? "").trim();
  return (Array.from(source)[0] ?? "?").toLocaleUpperCase();
}

export default function UserMenu() {
  const navigate = useNavigate();
  const { data: session, isPending } = authClient.useSession();

  if (isPending) {
    return <Skeleton className="h-11 w-28 rounded-full" />;
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
          className="h-11 max-w-[10rem] justify-start gap-2.5 px-1.5 sm:max-w-[14rem] lg:w-full lg:max-w-none"
        >
          <span
            className="grid size-8 shrink-0 place-items-center rounded-full bg-sidebar-accent font-display text-sm font-semibold text-signal"
            aria-hidden="true"
          >
            {initial(session.user.name, session.user.email)}
          </span>
          <span className="truncate font-semibold text-ink">{session.user.name}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56 rounded-2xl bg-card">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            <Trans>My Account</Trans>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="max-w-[min(20rem,85vw)] text-ink-3">
            <span className="truncate">{session.user.email}</span>
          </DropdownMenuItem>
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
            <Trans>Sign Out</Trans>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
