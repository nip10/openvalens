import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  enabledModuleSet,
  MODULE_DESCRIPTIONS,
  MODULE_ICONS,
  MODULE_LABELS,
  MODULE_TONES,
  MODULES_KEEP_DATA_NOTE,
  normalizeModules,
  PERSON_MODULES,
  type PersonModule,
} from "@openvalens/api/presenters/modules";
import {
  answersEqual,
  DECLINE_LABEL,
  FOCUS_AREA_LABELS,
  WELLNESS_FIELD_COPY,
  type WellnessProfileSnapshot,
} from "@openvalens/api/wellness-profile-contract";
import {
  buildSectionPatch,
  draftFromSnapshot,
  isAdultConfirmed,
  parseBirthYearInput,
  rejectionMessage,
  type WellnessProfileDraft,
} from "@openvalens/api/presenters/wellness-profile";
import { INSIGHT_DELIVERY_COPY } from "@openvalens/api/presenters/insights";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { Button, cn } from "heroui-native";
import {
  Bell,
  Bluetooth,
  Check,
  CircleAlert,
  Info,
  Mail,
  Server,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Target,
  Watch,
  type LucideIcon,
} from "lucide-react-native";
import { type ReactNode, useEffect, useState } from "react";
import { Linking, Platform, Pressable, Switch, Text, TextInput, View } from "react-native";

import { AiSection } from "@/components/ai-section";
import { AnalyticsConsentSection } from "@/components/analytics-consent-section";
import {
  Icon,
  ListCard,
  Prose,
  Section,
  Sheet,
  StatusPill,
  ToneIcon,
  type Tone,
} from "@/components/bloom";
import { SettingsGroup, SettingsRow } from "@/components/language-section";
import {
  CheckboxToggle,
  Chips,
  ChoiceSelect,
  QuestionLabel,
} from "@/components/wellness-profile-fields";
import { needsHealthConsent } from "@/lib/health-consent";
import { getHealthAccess, rememberSyncModules, requestHealthAccess } from "@/lib/health-sync";
import { MODULE_ICON_COMPONENTS } from "@/lib/modules/icons";
import {
  healthPermissionOutcome,
  healthPermissionsForChoice,
  initialModuleChoice,
  modulesAfterFocusChange,
  type HealthPermissionOutcome,
} from "@/lib/onboarding/steps";
import { describePushRegistration, enablePushOnThisPhone } from "@/lib/push-notifications";
import { client, orpc } from "@/utils/orpc";
import { useThemeColor } from "@/utils/theme";
import { adminAccessQueryOptions } from "@/utils/admin-settings";

import {
  StepFrame,
  useHealthConsentStatus,
  type OnboardingProfileFlow,
  type StepNav,
} from "./flow";

/**
 * Onboarding (#444) — the screens behind the first run and the "Finish
 * setting up" items. Each is usable on its own: the first run strings
 * screen 1 (`StartStep`), the first log and `ConnectStep` together, and each
 * card item opens one with Save and Back.
 */
export type StepProps = {
  flow: OnboardingProfileFlow & { snapshot: WellnessProfileSnapshot };
  nav: StepNav;
};

/** A choice as a card: its icon in its tint, a label, one line, and a tick when on. */
function OptionCard({
  icon,
  tone,
  label,
  description,
  selected,
  onPress,
  role = "checkbox",
  testID,
}: {
  icon: LucideIcon;
  tone: Tone;
  label: string;
  description?: string;
  selected: boolean;
  onPress: () => void;
  role?: "checkbox" | "radio";
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={role}
      accessibilityState={{ checked: selected, selected }}
      accessibilityLabel={description ? `${label}, ${description}` : label}
      testID={testID}
      className="active:opacity-80"
    >
      <Sheet
        className={cn(
          "flex-row items-center gap-3 border p-4",
          selected ? "border-signal" : "border-transparent",
        )}
      >
        <ToneIcon icon={icon} tone={tone} />
        <View className="min-w-0 flex-1 gap-0.5">
          <Text className="font-sans text-base font-semibold text-ink">{label}</Text>
          {description ? <Text className="font-sans text-sm text-ink-3">{description}</Text> : null}
        </View>
        <View
          className={cn(
            "h-6 w-6 items-center justify-center rounded-full border",
            selected ? "border-primary bg-primary" : "border-rule-2 bg-paper",
          )}
        >
          {selected ? <Icon icon={Check} size={14} color="primary-foreground" /> : null}
        </View>
      </Sheet>
    </Pressable>
  );
}

function Note({ icon = Info, children }: { icon?: LucideIcon; children: ReactNode }) {
  return (
    <View className="flex-row items-start gap-3 rounded-2xl bg-paper-2 p-4">
      <Icon icon={icon} size={18} color="ink-2" />
      <Text className="flex-1 font-sans text-sm leading-relaxed text-ink-2">{children}</Text>
    </View>
  );
}

// ─── Server checklist (instance admins) ────────────────────────

export function ServerStep({ nav }: Pick<StepProps, "nav">) {
  const { t } = useLingui();
  const readiness = useQuery(orpc.health.readiness.queryOptions({ input: {} }));
  const checks = readiness.data?.checks;
  const pill = (ok: boolean | undefined) =>
    ok === undefined
      ? undefined
      : ok
        ? { label: t`Ready`, tone: "good" as const }
        : { label: t`Not set up`, tone: "warn" as const };
  const backupsOk = checks ? checks.backups === "ok" : undefined;

  return (
    <StepFrame
      step="server"
      title={<Trans>Your server checklist</Trans>}
      description={
        <Trans>You run this OpenValens server. A few things to check, then your own setup.</Trans>
      }
      onContinue={nav.onDone}
      continueLabel={t`Continue to my setup`}
    >
      <View className="gap-3">
        <ListCard
          icon={Mail}
          tone="water"
          title={t`Email delivery`}
          subtitle={t`Sign-in links, invitations and the weekly email`}
          status={pill(checks?.capabilities.resend)}
        />
        <ListCard
          icon={Server}
          tone="water"
          title={t`Backups`}
          subtitle={t`Copies of the database, checked every day`}
          status={pill(backupsOk)}
        />
        <ListCard
          icon={Sparkles}
          tone="signal"
          title={t`AI provider`}
          subtitle={t`Off unless you set one up. The coach needs it.`}
          status={
            checks
              ? checks.capabilities.anthropic
                ? { label: t`On`, tone: "good" }
                : { label: t`Off`, tone: "neutral" }
              : undefined
          }
        />
        <ListCard
          icon={Mail}
          tone="steps"
          title={t`Invite people`}
          subtitle={t`Invite people from the web app: Admin › Invitations.`}
        />
      </View>
      <Button
        variant="outline"
        className="self-start"
        onPress={() => router.push("/admin/settings")}
      >
        <Icon icon={ShieldCheck} size={16} color="ink-2" />
        <Button.Label>{t`Open instance configuration`}</Button.Label>
      </Button>
      <Prose className="text-sm text-ink-3">
        <Trans>
          Email, backups and the AI provider are set in the server's environment. The web app's
          admin pages show the details and how to change them.
        </Trans>
      </Prose>
    </StepFrame>
  );
}

/** Whether the signed-in person is an instance admin (false while loading or on error). */
export function useIsInstanceAdmin(userId: string): { loaded: boolean; isAdmin: boolean } {
  const access = useQuery({ ...adminAccessQueryOptions(userId), enabled: !!userId });
  return {
    loaded: !userId || access.isSuccess || access.isError,
    isAdmin: access.data?.isInstanceAdmin === true,
  };
}

// ─── 1. Before you start: age check and health-data consent ────

/**
 * Screen 1: the age check and, when this server asks for it, the
 * health-data consent. The only screen without Skip.
 */
export function StartStep({ flow, nav }: StepProps) {
  const { t } = useLingui();
  const queryClient = useQueryClient();
  const consent = useHealthConsentStatus(flow.userId);
  const [draft, setDraft] = useState<WellnessProfileDraft>(() => draftFromSnapshot(flow.snapshot));
  const [agreed, setAgreed] = useState(false);
  const [consentFailed, setConsentFailed] = useState(false);
  const answered = draft.answers.eligibility.state !== "unknown";
  const adult = isAdultConfirmed(draft.answers);
  const consentNeeded = needsHealthConsent(consent.data);
  const version = consent.data?.currentVersion ?? null;
  const privacyUrl = consent.data?.privacyUrl ?? null;
  useEffect(() => setAgreed(false), [version]);

  const accept = useMutation({
    mutationFn: (v: string) =>
      client.healthConsent.accept({ acceptedHealthDataConsent: true, version: v }),
    onSuccess: (next) => queryClient.setQueryData(consent.queryKey, next),
  });

  const next = async () => {
    setConsentFailed(false);
    if (consentNeeded && version) {
      try {
        await accept.mutateAsync(version);
      } catch {
        setAgreed(false);
        setConsentFailed(true);
        void queryClient.invalidateQueries({ queryKey: consent.queryKey });
        return;
      }
    }
    if (!answersEqual(draft.answers.eligibility, flow.snapshot.eligibility)) {
      if (!(await flow.save({ eligibility: draft.answers.eligibility }))) return;
    }
    nav.onDone();
  };

  return (
    <StepFrame
      step={nav.step}
      title={<Trans>Before you start</Trans>}
      description={
        <Trans>
          A quick check, then you're in. OpenValens is for personal record-keeping and general
          wellness.
        </Trans>
      }
      info={
        <>
          <Prose>{WELLNESS_FIELD_COPY.eligibility.purpose}</Prose>
          <Prose>{WELLNESS_FIELD_COPY.eligibility.limits}</Prose>
        </>
      }
      onContinue={() => void next()}
      continueDisabled={!answered || (consentNeeded && !agreed)}
      busy={flow.saving || accept.isPending}
      error={flow.error}
      onBack={nav.onBack}
    >
      <QuestionLabel>
        <Trans>Are you 18 or older?</Trans>
      </QuestionLabel>
      <Chips field="eligibility" draft={draft} onChange={setDraft} layout="rows" />
      {answered && !adult ? (
        <Note>
          <Trans>You can still keep a record, but personal guidance and references stay off.</Trans>
        </Note>
      ) : null}
      {consentNeeded && version ? (
        <Sheet className="gap-3 border border-signal/30 p-4">
          <View className="gap-1">
            <Text className="font-display text-lg font-semibold text-ink">
              {t`Health data consent`}
            </Text>
            <Text className="font-sans text-sm leading-relaxed text-ink-2">
              {t`I consent to OpenValens processing my health data to provide the service. This includes any birth year and sex I add to my profile, used to place me in a broad age band and to choose age- and sex-specific guidance and reference ranges.`}{" "}
              {privacyUrl ? (
                <Text
                  accessibilityRole="link"
                  className="font-semibold text-signal underline"
                  onPress={() => void Linking.openURL(privacyUrl)}
                >
                  {t`Read the privacy policy`}
                </Text>
              ) : null}
            </Text>
            <Text className="font-sans text-xs text-ink-3">{t`Consent version: ${version}`}</Text>
          </View>
          <CheckboxToggle
            label={t`I agree to this health data processing.`}
            checked={agreed}
            onPress={() => setAgreed((value) => !value)}
          />
          {consentFailed ? (
            <Text accessibilityLiveRegion="polite" className="font-sans text-sm text-destructive">
              {t`Consent could not be saved. The version may have changed; review it and try again.`}
            </Text>
          ) : null}
        </Sheet>
      ) : null}
    </StepFrame>
  );
}

// ─── 3. Connect: the phone's health app, then a watch or ring ──

const PHONE_PLATFORM =
  Platform.OS === "ios"
    ? ("ios" as const)
    : Platform.OS === "android"
      ? ("android" as const)
      : null;

const OUTCOME_COPY: Record<Exclude<HealthPermissionOutcome, "granted">, ReturnType<typeof msg>> = {
  nothing_to_ask: msg`None of your modules read from your phone's health app, so nothing was asked.`,
  denied: msg`No access was given. That's fine: you can connect later in Settings › Health data.`,
  unavailable: msg`Your phone's health app isn't available here. You can type things in, or connect later in Settings › Health data.`,
};

/**
 * Screen 3 on the phone (and the "Connect your data" item): ask Apple Health
 * or Health Connect for the modules' data types, read only, then "Connect a
 * watch or ring", which opens the device catalog (Settings › Devices):
 * Bluetooth devices and wearable accounts on one screen.
 */
export function ConnectStep({ flow, nav }: StepProps) {
  const { t, i18n } = useLingui();
  const queryClient = useQueryClient();
  const access = useQuery({ queryKey: ["health-sync", "access"], queryFn: getHealthAccess });
  const [outcome, setOutcome] = useState<HealthPermissionOutcome | null>(null);
  const sourceName = Platform.OS === "ios" ? "Apple Health" : "Health Connect";
  const on = [...enabledModuleSet(flow.snapshot)];
  const asked = PHONE_PLATFORM ? healthPermissionsForChoice(PHONE_PLATFORM, on) : [];
  const healthModules = on.filter(
    (module) => PHONE_PLATFORM && healthPermissionsForChoice(PHONE_PLATFORM, [module]).length > 0,
  );
  const granted = (access.data?.grantedTypes.length ?? 0) > 0;
  const unavailable = !PHONE_PLATFORM || access.data?.available === false;

  const ask = useMutation({
    // Only the modules' data types, read only (see lib/health-sync/permissions).
    mutationFn: () => requestHealthAccess(flow.snapshot),
    onSuccess: (result) => {
      queryClient.setQueryData(["health-sync", "access"], result);
      setOutcome(healthPermissionOutcome(asked, result));
    },
    onError: () => setOutcome("unavailable"),
  });

  return (
    <StepFrame
      step={nav.step}
      title={<Trans>Connect your data</Trans>}
      description={
        <Trans>Bring in what your phone and devices already record. You can do this later.</Trans>
      }
      continueLabel={nav.doneLabel ?? t`Done`}
      onContinue={nav.onDone}
      busy={flow.saving}
      error={flow.error}
      onBack={nav.onBack}
    >
      <Section icon={Smartphone} tone="water" title={sourceName}>
        <Sheet className="gap-3">
          {asked.length === 0 ? (
            <Text className="font-sans text-sm leading-relaxed text-ink-2">
              {i18n._(OUTCOME_COPY.nothing_to_ask)}
            </Text>
          ) : (
            <Text className="font-sans text-sm leading-relaxed text-ink-2">
              <Trans>
                We'll ask {sourceName} only for:{" "}
                {healthModules.map((module) => i18n._(MODULE_LABELS[module])).join(", ")}. Read
                only; OpenValens never writes to it.
              </Trans>
            </Text>
          )}
          {granted ? (
            <StatusPill tone="good">{t`Connected`}</StatusPill>
          ) : unavailable ? (
            <Note icon={CircleAlert}>{i18n._(OUTCOME_COPY.unavailable)}</Note>
          ) : asked.length > 0 ? (
            <Button
              variant="outline"
              className="self-start"
              onPress={() => ask.mutate()}
              isDisabled={ask.isPending}
              testID="onboarding-connect-health"
            >
              <Icon icon={ShieldCheck} size={16} color="ink-2" />
              <Button.Label>{t`Connect ${sourceName}`}</Button.Label>
            </Button>
          ) : null}
          {outcome && outcome !== "granted" && outcome !== "nothing_to_ask" ? (
            <Note icon={CircleAlert}>{i18n._(OUTCOME_COPY[outcome])}</Note>
          ) : null}
        </Sheet>
      </Section>
      <Section icon={Watch} tone="sleep" title={t`Connect a watch or ring`}>
        <ListCard
          icon={Bluetooth}
          tone="sleep"
          title={t`Choose your device`}
          subtitle={t`Nearby over Bluetooth, or a wearable account such as Oura, WHOOP, Polar or Withings.`}
          onPress={() => router.push("/settings/devices")}
          testID="onboarding-connect-device"
        />
      </Section>
    </StepFrame>
  );
}

// ─── "Finish setting up" items ─────────────────────────────────

/** Focus areas and the module cards; the cards follow the focus until touched. */
export function ModulesStep({ flow, nav }: StepProps) {
  const { t, i18n } = useLingui();
  const [draft, setDraft] = useState<WellnessProfileDraft>(() => draftFromSnapshot(flow.snapshot));
  const [modules, setModules] = useState<PersonModule[]>(() => initialModuleChoice(flow.snapshot));
  const [touched, setTouched] = useState(flow.snapshot.enabledModules !== null);

  const changeFocus = (next: WellnessProfileDraft) => {
    setDraft(next);
    setModules((current) => modulesAfterFocusChange(current, next.answers.focus, touched));
  };
  const toggle = (module: PersonModule) => {
    setTouched(true);
    setModules((current) =>
      normalizeModules(
        current.includes(module) ? current.filter((m) => m !== module) : [...current, module],
      ),
    );
  };

  const next = async () => {
    const focusChanged = !answersEqual(draft.answers.focus, flow.snapshot.focus);
    const saved = await flow.save({
      ...(focusChanged ? { focus: draft.answers.focus } : {}),
      enabledModules: modules,
    });
    if (!saved) return;
    void rememberSyncModules(saved.enabledModules);
    nav.onDone();
  };

  return (
    <StepFrame
      step={nav.step}
      title={<Trans>What brings you here?</Trans>}
      description={<Trans>Pick any. We'll switch on the matching parts of the app.</Trans>}
      continueLabel={nav.doneLabel ?? t`Save`}
      onContinue={() => void next()}
      busy={flow.saving}
      error={flow.error}
      onBack={nav.onBack}
    >
      <Chips field="focus" draft={draft} onChange={changeFocus} />
      <Section
        title={t`Your modules`}
        description={t`Fine-tune what appears. Hidden parts keep their data.`}
        info={<Prose>{i18n._(MODULES_KEEP_DATA_NOTE)}</Prose>}
      >
        <View className="gap-2.5">
          {PERSON_MODULES.map((module) => (
            <OptionCard
              key={module}
              icon={MODULE_ICON_COMPONENTS[MODULE_ICONS[module]]}
              tone={MODULE_TONES[module]}
              label={i18n._(MODULE_LABELS[module])}
              description={i18n._(MODULE_DESCRIPTIONS[module])}
              selected={modules.includes(module)}
              onPress={() => toggle(module)}
              testID={`onboarding-module-${module}`}
            />
          ))}
        </View>
      </Section>
    </StepFrame>
  );
}

/** Region, and birth year and sex for adults. */
export function BasicsStep({ flow, nav }: StepProps) {
  const { t, i18n } = useLingui();
  const [draft, setDraft] = useState<WellnessProfileDraft>(() => draftFromSnapshot(flow.snapshot));
  const [birthYearText, setBirthYearText] = useState(
    flow.snapshot.birthYear.state === "recorded" ? String(flow.snapshot.birthYear.value) : "",
  );
  const adult = isAdultConfirmed(draft.answers);
  const parsedYear = parseBirthYearInput(birthYearText, new Date());

  const next = async () => {
    const patch = {
      ...buildSectionPatch(flow.snapshot, draft, "region"),
      ...(adult ? buildSectionPatch(flow.snapshot, draft, "ageAndSex") : null),
    };
    const { expectedRevision: _revision, ...changes } = patch;
    if (Object.keys(changes).length > 0 && !(await flow.save(changes))) return;
    nav.onDone();
  };

  return (
    <StepFrame
      step={nav.step}
      title={<Trans>A few basics</Trans>}
      description={
        <Trans>
          Used for the published references the app compares against. Birth year and sex are
          optional.
        </Trans>
      }
      continueLabel={nav.doneLabel ?? t`Save`}
      onContinue={() => void next()}
      continueDisabled={!parsedYear.ok}
      busy={flow.saving}
      error={flow.error}
      onBack={nav.onBack}
    >
      <Sheet className="gap-3">
        <QuestionLabel
          info={
            <>
              <Prose>{WELLNESS_FIELD_COPY.region.purpose}</Prose>
              <Prose>{WELLNESS_FIELD_COPY.region.limits}</Prose>
            </>
          }
        >
          {WELLNESS_FIELD_COPY.region.question}
        </QuestionLabel>
        <ChoiceSelect
          field="region"
          draft={draft}
          onChange={setDraft}
          label={WELLNESS_FIELD_COPY.region.question}
        />
      </Sheet>

      {adult ? (
        <Sheet className="gap-4">
          <View className="gap-3">
            <QuestionLabel
              info={
                <>
                  <Prose>{WELLNESS_FIELD_COPY.birthYear.purpose}</Prose>
                  <Prose>{WELLNESS_FIELD_COPY.birthYear.limits}</Prose>
                </>
              }
            >
              {WELLNESS_FIELD_COPY.birthYear.question}
            </QuestionLabel>
            <TextInput
              value={birthYearText}
              editable={draft.answers.birthYear.state !== "declined"}
              keyboardType="number-pad"
              maxLength={4}
              accessibilityLabel={t`Birth year`}
              placeholder={t`Birth year`}
              onChangeText={(text) => {
                setBirthYearText(text);
                const parsed = parseBirthYearInput(text, new Date());
                if (parsed.ok) {
                  setDraft({
                    ...draft,
                    answers: {
                      ...draft.answers,
                      birthYear:
                        parsed.year === null
                          ? { state: "unknown" }
                          : { state: "recorded", value: parsed.year },
                    },
                  });
                }
              }}
              className="w-32 rounded-xl border border-rule bg-paper px-3 py-2.5 font-sans text-base text-ink"
              style={{ fontVariant: ["tabular-nums"] }}
            />
            {!parsedYear.ok ? (
              <Text className="font-sans text-sm text-destructive" accessibilityRole="alert">
                {i18n._(rejectionMessage(parsedYear.reason))}
              </Text>
            ) : null}
            <CheckboxToggle
              label={DECLINE_LABEL}
              checked={draft.answers.birthYear.state === "declined"}
              onPress={() => {
                setBirthYearText("");
                setDraft({
                  ...draft,
                  answers: {
                    ...draft.answers,
                    birthYear:
                      draft.answers.birthYear.state === "declined"
                        ? { state: "unknown" }
                        : { state: "declined" },
                  },
                });
              }}
            />
          </View>
          <View className="gap-3 border-t border-rule pt-4">
            <QuestionLabel
              info={
                <>
                  <Prose>{WELLNESS_FIELD_COPY.sex.purpose}</Prose>
                  <Prose>{WELLNESS_FIELD_COPY.sex.limits}</Prose>
                </>
              }
            >
              {WELLNESS_FIELD_COPY.sex.question}
            </QuestionLabel>
            <ChoiceSelect
              field="sex"
              draft={draft}
              onChange={setDraft}
              label={WELLNESS_FIELD_COPY.sex.question}
            />
          </View>
        </Sheet>
      ) : (
        <Note>
          <Trans>Age and sex are only used by adult features, so they are not asked here.</Trans>
        </Note>
      )}
      <Note icon={ShieldCheck}>
        <Trans>
          Birth year and sex are only used for age- and sex-specific guidance and reference ranges.
          Clear either answer at any time to delete it.
        </Trans>
      </Note>
    </StepFrame>
  );
}

const GOAL_SUGGESTIONS = [
  msg`Sleep 7–9 hours most nights`,
  msg`Walk 8,000 steps a day`,
  msg`Reach a weight`,
  msg`Log meals most days`,
];

/** One goal in the person's own words, saved to Goals. */
export function GoalStep({ flow, nav }: StepProps) {
  const { t, i18n } = useLingui();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const add = useMutation(
    orpc.plans.goals.upsertGoal.mutationOptions({
      onSuccess: () => void queryClient.invalidateQueries({ queryKey: orpc.plans.goals.key() }),
    }),
  );
  const focus = flow.snapshot.focus.state === "recorded" ? flow.snapshot.focus.value[0] : undefined;

  const next = async () => {
    const trimmed = title.trim();
    if (trimmed) {
      try {
        // The same Goals the profile and Workouts use; no target is set for you.
        await add.mutateAsync({
          title: trimmed,
          category: focus ? FOCUS_AREA_LABELS[focus] : "General",
          status: "not_started",
        });
      } catch {
        return;
      }
    }
    nav.onDone();
  };

  return (
    <StepFrame
      step={nav.step}
      title={<Trans>One goal</Trans>}
      description={<Trans>Something to work toward, in your own words.</Trans>}
      info={
        <Prose>
          <Trans>
            Add a goal in your own words if you have one. It is saved to your Goals, where you can
            set a target and date later. Nothing is suggested or worked out for you.
          </Trans>
        </Prose>
      }
      continueLabel={nav.doneLabel ?? t`Save`}
      onContinue={() => void next()}
      busy={add.isPending}
      error={add.isError ? msg`Could not save.` : null}
      onBack={nav.onBack}
    >
      <View className="gap-2.5">
        {GOAL_SUGGESTIONS.map((suggestion) => {
          const label = i18n._(suggestion);
          return (
            <OptionCard
              key={suggestion.id}
              icon={Target}
              tone="weight"
              role="radio"
              label={label}
              selected={title === label}
              onPress={() => setTitle(title === label ? "" : label)}
            />
          );
        })}
      </View>
      <TextInput
        value={title}
        onChangeText={setTitle}
        maxLength={200}
        accessibilityLabel={t`Goal`}
        placeholder={t`For example: walk most days`}
        className="rounded-xl border border-rule bg-paper px-3 py-2.5 font-sans text-base text-ink"
      />
      <Prose className="text-sm text-ink-3">
        <Trans>Saved to Goals, in the menu under Habits. You can change it there.</Trans>
      </Prose>
    </StepFrame>
  );
}

/** Reminders and notifications: the same switches and copy as Settings › Insight notifications. */
function ReminderChoices() {
  const { t, i18n } = useLingui();
  const queryClient = useQueryClient();
  const signal = useThemeColor("signal");
  const preferences = useQuery(orpc.insights.preferences.get.queryOptions({ input: {} }));
  const [message, setMessage] = useState<string | null>(null);
  const update = useMutation({
    mutationFn: (patch: Parameters<typeof client.insights.preferences.update>[0]) =>
      client.insights.preferences.update(patch),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: orpc.insights.key() }),
    onError: () => setMessage(t`Could not update notification settings.`),
  });
  const enablePush = useMutation({
    mutationFn: async () => {
      const registration = await enablePushOnThisPhone();
      await client.insights.preferences.update({ push: { enabled: true } });
      return i18n._(describePushRegistration(registration));
    },
    onSuccess: (text) => {
      setMessage(text);
      void queryClient.invalidateQueries({ queryKey: orpc.insights.key() });
    },
    onError: () => setMessage(t`Could not turn on notifications.`),
  });
  const prefs = preferences.data;
  const busy = update.isPending || enablePush.isPending;

  return (
    <Section title={i18n._(INSIGHT_DELIVERY_COPY.dailyRemindersTitle)} icon={Bell} tone="signal">
      <SettingsGroup>
        {!prefs ? (
          <Text className="py-4 font-sans text-sm text-ink-3">
            {preferences.isError ? t`Could not load notification settings.` : t`Loading…`}
          </Text>
        ) : (
          <>
            {prefs.pushAvailable ? (
              <SettingsRow
                icon={Smartphone}
                label={i18n._(INSIGHT_DELIVERY_COPY.pushTitle)}
                info={i18n._(INSIGHT_DELIVERY_COPY.pushDescription)}
                trailing={
                  <Switch
                    value={prefs.push.enabled}
                    disabled={busy || !prefs.canConfigureDelivery}
                    onValueChange={(enabled) =>
                      enabled ? enablePush.mutate() : update.mutate({ push: { enabled: false } })
                    }
                    accessibilityLabel={i18n._(INSIGHT_DELIVERY_COPY.pushTitle)}
                    trackColor={{ true: signal }}
                  />
                }
              />
            ) : null}
            {prefs.emailAvailable ? (
              <SettingsRow
                icon={Mail}
                label={i18n._(INSIGHT_DELIVERY_COPY.dailyRemindersEmail)}
                info={i18n._(INSIGHT_DELIVERY_COPY.dailyRemindersEmailNote)}
                divider={prefs.pushAvailable}
                trailing={
                  <Switch
                    value={prefs.dailyReminders.email}
                    disabled={busy}
                    onValueChange={(email) => update.mutate({ dailyReminders: { email } })}
                    accessibilityLabel={i18n._(INSIGHT_DELIVERY_COPY.dailyRemindersEmail)}
                    trackColor={{ true: signal }}
                  />
                }
              />
            ) : null}
            {!prefs.pushAvailable && !prefs.emailAvailable ? (
              <Text className="py-4 font-sans text-sm text-ink-2">
                {i18n._(INSIGHT_DELIVERY_COPY.pushUnavailable)}
              </Text>
            ) : null}
          </>
        )}
      </SettingsGroup>
      {message ? (
        <Text className="font-sans text-sm text-ink-2" accessibilityLiveRegion="polite">
          {message}
        </Text>
      ) : null}
      <Button
        variant="ghost"
        className="self-start"
        onPress={() => router.push("/insight-settings")}
      >
        <Button.Label>{t`More notification settings`}</Button.Label>
      </Button>
    </Section>
  );
}

/** AI, reminders and usage analytics: the existing switches, all off by default. */
export function PrivacyStep({ nav }: Pick<StepProps, "nav">) {
  const { t } = useLingui();
  return (
    <StepFrame
      step={nav.step}
      title={<Trans>Your privacy choices</Trans>}
      description={
        <Trans>All off unless you turn them on. Your records stay on your server either way.</Trans>
      }
      continueLabel={nav.doneLabel ?? t`Done`}
      onContinue={nav.onDone}
      onBack={nav.onBack}
    >
      <AiSection />
      <ReminderChoices />
      <AnalyticsConsentSection />
    </StepFrame>
  );
}
