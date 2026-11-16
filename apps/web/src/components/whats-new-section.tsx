import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Megaphone } from "lucide-react";
import { useId } from "react";

import { SettingsGroup, SettingsRow } from "@/components/settings-rows";
import { orpc } from "@/utils/orpc";

/** Issue #446 — Settings › What's new: whether the app shows "What's new" after an update. */
export function WhatsNewSection() {
  const id = useId();
  const { t, i18n } = useLingui();
  const locale = i18n.locale === "pt-PT" ? "pt-PT" : "en";
  const queryClient = useQueryClient();
  const query = useQuery(orpc.whatsNew.get.queryOptions({ input: { locale, platform: "web" } }));
  const update = useMutation(
    orpc.whatsNew.setEnabled.mutationOptions({
      onSettled: () => void queryClient.invalidateQueries({ queryKey: orpc.whatsNew.key() }),
    }),
  );
  const enabled = update.isPending ? update.variables.enabled : query.data?.enabled;
  return (
    <SettingsGroup>
      <SettingsRow
        icon={Megaphone}
        label={<Trans>Show what's new after an update</Trans>}
        htmlFor={id}
        description={
          update.isError ? (
            <span role="alert" className="text-destructive">
              <Trans>Could not save your setting. Try again.</Trans>
            </span>
          ) : (
            <Trans>A short note with the highlights the first time you open a new version.</Trans>
          )
        }
      >
        <input
          id={id}
          aria-label={t`Show what's new after an update`}
          type="checkbox"
          className="size-5 shrink-0 accent-primary disabled:cursor-not-allowed disabled:opacity-55"
          checked={enabled ?? true}
          disabled={!query.data || update.isPending}
          onChange={(event) => update.mutate({ enabled: event.currentTarget.checked })}
        />
      </SettingsRow>
    </SettingsGroup>
  );
}
