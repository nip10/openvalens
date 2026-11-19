import { authClient } from "@/lib/auth-client";
import { useLingui } from "@lingui/react/macro";
import {
  latestPhoneSync,
  MOBILE_SYNC_COPY,
  phoneSyncLine,
} from "@openvalens/api/presenters/mobile-sync";
import { Button } from "@openvalens/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { Smartphone } from "lucide-react";

import { Section } from "@/components/page";
import { orpc } from "@/utils/orpc";

export function PhoneSyncStatus() {
  const { i18n, t } = useLingui();
  const { data: session } = authClient.useSession();
  const userId = session?.user.id;
  const organizationId = session?.session.activeOrganizationId;
  const options = orpc.mobile.syncStatus.queryOptions({ input: {} });
  const status = useQuery({
    ...options,
    queryKey: [...options.queryKey, organizationId, userId],
    enabled: !!organizationId && !!userId,
  });
  const devices = latestPhoneSync(status.data?.devices ?? []);
  return (
    <Section title={i18n._(MOBILE_SYNC_COPY.title)} icon={Smartphone} tone="signal">
      <div className="sheet grid gap-3 p-4 text-sm text-ink-2" aria-live="polite">
        {status.isPending ? (
          <p>{t`Loading…`}</p>
        ) : status.isError ? (
          <>
            <p>{i18n._(MOBILE_SYNC_COPY.error)}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void status.refetch()}
            >{t`Retry`}</Button>
          </>
        ) : devices.length ? (
          devices.map((device) => <p key={device.provider}>{phoneSyncLine(device, i18n)}</p>)
        ) : (
          <p>{i18n._(MOBILE_SYNC_COPY.empty)}</p>
        )}
      </div>
    </Section>
  );
}
