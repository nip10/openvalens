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

export default function UserMenu() {
  const navigate = useNavigate();
  const { data: session, isPending } = authClient.useSession();

  if (isPending) {
    return <Skeleton className="h-9 w-24" />;
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
        <Button variant="outline" className="max-w-[10rem] sm:max-w-[14rem]">
          <span className="truncate">{session.user.name}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="bg-card">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            <Trans>My Account</Trans>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="max-w-[min(20rem,85vw)]">
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
