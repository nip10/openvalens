import type { MessageDescriptor } from "@lingui/core";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  MODULE_DESCRIPTIONS,
  MODULE_ICONS,
  MODULE_LABELS,
  MODULE_TONES,
  MODULES_KEEP_DATA_NOTE,
  defaultModulesForFocus,
  isModuleEnabled,
  type PersonModule,
  toggleModule,
} from "@openvalens/api/presenters/modules";
import { describeProfileSaveError } from "@openvalens/api/presenters/wellness-profile";
import type {
  FocusAnswer,
  WellnessProfileSnapshot,
} from "@openvalens/api/wellness-profile-contract";
import { Button } from "@openvalens/ui/components/button";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { Switch } from "@openvalens/ui/components/switch";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { MODULE_ICON_COMPONENTS } from "@/components/module-icons";
import { ErrorState, InfoTip, StatusPill, ToneIcon } from "@/components/page";
import { modulesByNavGroup } from "@/utils/module-nav";
import { useAiState } from "@/utils/ai-state";
import { useUpdateWellnessProfile, useWellnessProfile } from "@/utils/wellness-profile";

const TEXT_LINK = "font-medium text-ink underline decoration-signal underline-offset-2";

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
  coachAiOff = null,
}: {
  snapshot: Pick<WellnessProfileSnapshot, "enabledModules"> & {
    /** "What brings you here": its modules are marked as recommended. */
    focus?: FocusAnswer;
  };
  saving: PersonModule | null;
  message: MessageDescriptor | null;
  onToggle: (module: PersonModule, on: boolean) => void;
  /**
   * #settings-modules-2 — why the coach can't answer even while its module is
   * on: AI is off for this workspace, or this person hasn't agreed to AI.
   */
  coachAiOff?: "workspace" | "personal" | null;
}) {
  const { t, i18n } = useLingui();
  // #settings-modules-4 — the modules the profile's focus answer picks.
  const recommended = new Set(defaultModulesForFocus(snapshot.focus));
  const hidesLine = (labels: readonly MessageDescriptor[]) => {
    const pages = new Intl.ListFormat(i18n.locale, { type: "conjunction" }).format(
      labels.map((label) => i18n._(label)),
    );
    return t`Hides ${pages}`;
  };
  return (
    <div className="grid gap-8">
      <div className="grid gap-2">
        <p className="max-w-[65ch] text-sm text-ink-3">{i18n._(MODULES_KEEP_DATA_NOTE)}</p>
        <p className="max-w-[65ch] text-sm text-ink-3">
          {recommended.size > 0 ? (
            <Trans>
              Recommended modules match what you told us in{" "}
              <Link to="/profile" search={{ section: "focus" }} className={TEXT_LINK}>
                What brings you here
              </Link>
              .
            </Trans>
          ) : (
            <Trans>
              Tell us{" "}
              <Link to="/profile" search={{ section: "focus" }} className={TEXT_LINK}>
                what brings you here
              </Link>{" "}
              and we'll mark the modules that fit.
            </Trans>
          )}
        </p>
      </div>
      {message ? (
        <p role="alert" className="text-sm text-destructive">
          {i18n._(message)}
        </p>
      ) : null}
      {/* #settings-modules-3 — under the sidebar's headings, each saying what it hides. */}
      {modulesByNavGroup().map((group, index) => {
        const headingId = `modules-group-${index}`;
        return (
          <section key={headingId} className="grid gap-3" aria-labelledby={headingId}>
            <h2 id={headingId} className="text-base leading-tight font-semibold text-ink-2">
              {i18n._(group.label)}
            </h2>
            <ul className="grid gap-4 sm:grid-cols-2">
              {group.modules.map(({ module, hides }) => {
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
                      <span className="flex flex-wrap items-center gap-x-1 gap-y-1">
                        <label htmlFor={id} className="font-medium text-ink">
                          {label}
                        </label>
                        {module === "coach" ? (
                          <InfoTip>
                            <Trans>
                              The coach also needs AI to be turned on for this server and your
                              consent in Settings.
                            </Trans>
                          </InfoTip>
                        ) : null}
                        {recommended.has(module) ? (
                          <StatusPill tone="good" className="ml-1">
                            <Trans>Recommended</Trans>
                          </StatusPill>
                        ) : null}
                      </span>
                      <span className="text-sm text-ink-3">
                        {i18n._(MODULE_DESCRIPTIONS[module])}
                      </span>
                      {hides.length > 0 ? (
                        <span className="text-xs text-ink-3" data-testid={`${id}-menu`}>
                          {hidesLine(hides)}
                        </span>
                      ) : null}
                      {module === "coach" && on && coachAiOff ? (
                        <span className="text-sm text-ink-2">
                          {coachAiOff === "workspace" ? (
                            <Trans>AI is off for this workspace.</Trans>
                          ) : (
                            <Trans>AI processing is off for you.</Trans>
                          )}{" "}
                          <Link to="/settings" hash="ai" className={TEXT_LINK}>
                            <Trans>AI settings</Trans>
                          </Link>
                        </span>
                      ) : null}
                    </div>
                    {/* #settings-modules-1 — the switch alone shows the state. */}
                    <Switch
                      id={id}
                      className="shrink-0"
                      checked={on}
                      disabled={saving !== null}
                      onCheckedChange={(next) => onToggle(module, next)}
                    />
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/** The connected form: reads the profile and saves each switch on its own. */
export function ModulesSettings() {
  const profile = useWellnessProfile();
  const update = useUpdateWellnessProfile(profile.userId);
  const [saving, setSaving] = useState<PersonModule | null>(null);
  const [message, setMessage] = useState<MessageDescriptor | null>(null);
  const coachAiOff = useAiState().reason;

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
      coachAiOff={coachAiOff}
      onToggle={(module, on) => void onToggle(module, on)}
    />
  );
}
