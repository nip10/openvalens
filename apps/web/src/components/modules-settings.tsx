import type { MessageDescriptor } from "@lingui/core";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  MODULE_DESCRIPTIONS,
  MODULE_ICONS,
  MODULE_LABELS,
  MODULE_TONES,
  MODULES_KEEP_DATA_NOTE,
  isModuleEnabled,
  PERSON_MODULES,
  type PersonModule,
  toggleModule,
} from "@openvalens/api/presenters/modules";
import { describeProfileSaveError } from "@openvalens/api/presenters/wellness-profile";
import type { WellnessProfileSnapshot } from "@openvalens/api/wellness-profile-contract";
import { Button } from "@openvalens/ui/components/button";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { Switch } from "@openvalens/ui/components/switch";
import { useState } from "react";

import { MODULE_ICON_COMPONENTS } from "@/components/module-icons";
import { ErrorState, InfoTip, StatusPill, ToneIcon } from "@/components/page";
import { useUpdateWellnessProfile, useWellnessProfile } from "@/utils/wellness-profile";

/**
 * Settings › Modules: one card per module with a switch. Hiding a module
 * takes it out of the menu, the dashboard, insights and reminders; nothing
 * is deleted and its pages still open from a direct link.
 */
export function ModulesSettingsForm({
  snapshot,
  saving,
  message,
  onToggle,
}: {
  snapshot: Pick<WellnessProfileSnapshot, "enabledModules">;
  saving: PersonModule | null;
  message: MessageDescriptor | null;
  onToggle: (module: PersonModule, on: boolean) => void;
}) {
  const { t, i18n } = useLingui();
  return (
    <div className="grid gap-4">
      <p className="max-w-[65ch] text-sm text-ink-3">{i18n._(MODULES_KEEP_DATA_NOTE)}</p>
      {message ? (
        <p role="alert" className="text-sm text-destructive">
          {i18n._(message)}
        </p>
      ) : null}
      <ul className="grid gap-4 sm:grid-cols-2" aria-label={t`Modules`}>
        {PERSON_MODULES.map((module) => {
          const on = isModuleEnabled(snapshot, module);
          const id = `module-${module}`;
          const label = i18n._(MODULE_LABELS[module]);
          return (
            <li key={module} className="sheet flex min-w-0 items-center gap-4 p-5">
              <ToneIcon
                icon={MODULE_ICON_COMPONENTS[MODULE_ICONS[module]]}
                tone={MODULE_TONES[module]}
              />
              <div className="grid min-w-0 flex-1 gap-0.5">
                <span className="flex items-center gap-1">
                  <label htmlFor={id} className="font-medium text-ink">
                    {label}
                  </label>
                  {module === "coach" ? (
                    <InfoTip>
                      <Trans>
                        The coach also needs AI to be turned on for this server and your consent in
                        Settings.
                      </Trans>
                    </InfoTip>
                  ) : null}
                </span>
                <span className="text-sm text-ink-3">{i18n._(MODULE_DESCRIPTIONS[module])}</span>
              </div>
              <span className="flex shrink-0 items-center gap-2">
                <StatusPill tone={on ? "good" : "neutral"}>{on ? t`On` : t`Hidden`}</StatusPill>
                <Switch
                  id={id}
                  checked={on}
                  disabled={saving !== null}
                  onCheckedChange={(next) => onToggle(module, next)}
                />
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The connected form: reads the profile and saves each switch on its own. */
export function ModulesSettings() {
  const profile = useWellnessProfile();
  const update = useUpdateWellnessProfile(profile.userId);
  const [saving, setSaving] = useState<PersonModule | null>(null);
  const [message, setMessage] = useState<MessageDescriptor | null>(null);

  if (profile.isPending) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        {[0, 1, 2, 3].map((key) => (
          <Skeleton key={key} className="h-24 w-full rounded-3xl" />
        ))}
      </div>
    );
  }
  if (profile.isError || !profile.data) {
    return (
      <ErrorState
        title={<Trans>Could not load your modules.</Trans>}
        action={
          <Button variant="outline" onClick={() => void profile.refetch()}>
            <Trans>Retry</Trans>
          </Button>
        }
      />
    );
  }

  const snapshot = profile.data;
  const onToggle = async (module: PersonModule, on: boolean) => {
    setSaving(module);
    setMessage(null);
    try {
      await update.mutateAsync({
        expectedRevision: snapshot.revision,
        enabledModules: toggleModule(snapshot, module, on),
      });
    } catch (error) {
      const described = describeProfileSaveError(error);
      if (described.kind === "conflict") await profile.refetch();
      setMessage(described.message);
    } finally {
      setSaving(null);
    }
  };

  return (
    <ModulesSettingsForm
      snapshot={snapshot}
      saving={saving}
      message={message}
      onToggle={(module, on) => void onToggle(module, on)}
    />
  );
}
