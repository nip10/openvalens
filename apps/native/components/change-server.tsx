import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useToast } from "heroui-native";
import { ArrowLeftRight, Server } from "lucide-react-native";
import { useRef } from "react";
import { Alert } from "react-native";

import { Icon, Section, Sheet } from "@/components/bloom";
import { ListRow } from "@/components/list-row";
import { serverLabel } from "@/lib/server/server-address";
import { isServerLocked, useServer } from "@/lib/server/server-url";
import { switchServer, unsyncedWriteCount } from "@/lib/server/switch-server";

/**
 * Issue #295 — "Change server": confirm (warning first when writes are still
 * queued for this server), then sign out, wipe this server's data from the
 * phone and return to the server choice.
 */
export function useChangeServer(): () => void {
  const { t } = useLingui();
  const { toast } = useToast();
  const server = useServer();
  const running = useRef(false);
  const host = server.status === "set" ? serverLabel(server.url) : "";

  const run = async () => {
    if (running.current) return;
    running.current = true;
    try {
      await switchServer(null);
    } catch {
      toast.show({
        variant: "danger",
        label: t`Could not change server. Your data on this phone was kept. Try again.`,
      });
    } finally {
      running.current = false;
    }
  };

  return () => {
    if (isServerLocked() || server.status !== "set") return;
    const pending = unsyncedWriteCount();
    const title = pending === 0 ? t`Change server?` : t`Changes not sent to ${host}`;
    const message =
      pending === 0
        ? t`You will be signed out, and everything this app saved from ${host} is removed from this phone.`
        : pending === null
          ? t`Some changes may not have reached ${host} yet. Changing server signs you out and deletes them from this phone.`
          : t`${plural(pending, {
              one: "# change has not reached",
              other: "# changes have not reached",
            })} ${host} yet. Changing server signs you out and deletes them from this phone.`;
    Alert.alert(title, message, [
      { text: t`Cancel`, style: "cancel" },
      {
        text: pending === 0 ? t`Change server` : t`Delete and change server`,
        style: "destructive",
        onPress: () => void run(),
      },
    ]);
  };
}

/** Settings: the server this phone talks to, and the way to change it. */
export function ServerSection() {
  const { t } = useLingui();
  const server = useServer();
  const changeServer = useChangeServer();
  if (server.status !== "set") return null;
  const host = serverLabel(server.url);

  return (
    <Section title={t`Server`} icon={Server} tone="signal">
      <Sheet className="overflow-hidden p-0 py-1">
        <ListRow
          icon={<Icon icon={Server} size={18} color="ink-2" />}
          title={host}
          subtitle={server.locked ? t`Set when this app was built` : t`Your account lives here`}
          showDivider={!server.locked}
        />
        {server.locked ? null : (
          <ListRow
            icon={<Icon icon={ArrowLeftRight} size={18} color="ink-2" />}
            title={t`Change server`}
            subtitle={t`Signs you out of ${host}`}
            onPress={changeServer}
            accessibilityHint={t`Signs you out and removes this server's data from this phone`}
          />
        )}
      </Sheet>
    </Section>
  );
}
