import { useLingui } from "@lingui/react/macro";
import {
  latestPhoneSync,
  MOBILE_SYNC_COPY,
  phoneSyncLine,
} from "@openvalens/api/presenters/mobile-sync";
import { useQuery } from "@tanstack/react-query";
import { Button } from "heroui-native";
import { Smartphone } from "lucide-react-native";
import { Text } from "react-native";

import { Section, Sheet } from "@/components/bloom";
import { orpc } from "@/utils/orpc";

export function PhoneSyncStatus() {
  const { i18n, t } = useLingui();
  const status = useQuery(orpc.mobile.syncStatus.queryOptions({ input: {} }));
  const devices = latestPhoneSync(status.data?.devices ?? []);
  return (
    <Section title={i18n._(MOBILE_SYNC_COPY.title)} icon={Smartphone} tone="signal">
      <Sheet className="gap-3 p-4">
        {status.isPending ? (
          <Text className="font-sans text-sm text-ink-2">{t`Loading…`}</Text>
        ) : status.isError ? (
          <>
            <Text className="font-sans text-sm text-ink-2">{i18n._(MOBILE_SYNC_COPY.error)}</Text>
            <Button variant="outline" size="sm" onPress={() => void status.refetch()}>
              <Button.Label>{t`Retry`}</Button.Label>
            </Button>
          </>
        ) : devices.length ? (
          devices.map((device) => (
            <Text key={device.provider} className="font-sans text-sm text-ink-2">
              {phoneSyncLine(device, i18n)}
            </Text>
          ))
        ) : (
          <Text className="font-sans text-sm text-ink-2">{i18n._(MOBILE_SYNC_COPY.empty)}</Text>
        )}
      </Sheet>
    </Section>
  );
}
