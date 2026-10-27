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
  CONSENT_COPY,
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
  Check,
  CircleAlert,
  Info,
  Mail,
  PenLine,
  Server,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Target,
  Watch,
  type LucideIcon,
} from "lucide-react-native";
import { type ReactNode, useState } from "react";
import { Platform, Pressable, Switch, Text, TextInput, View } from "react-native";

import { AiSection } from "@/components/ai-section";
import { AnalyticsConsentSection } from "@/components/analytics-consent-section";
import {
  BloomMark,
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
import { Chips, ConsentToggle, QuestionLabel } from "@/components/wellness-profile-fields";
import { requestHealthAccess, rememberSyncModules } from "@/lib/health-sync";
import { MODULE_ICON_COMPONENTS } from "@/lib/modules/icons";
import {
  DATA_SOURCES,
  healthPermissionOutcome,
  healthPermissionsForChoice,
  initialModuleChoice,
  inputMethodForSources,
  modulesAfterFocusChange,
  sourcesForInputMethod,
  type DataSource,
  type HealthPermissionOutcome,
  type OnboardingRoute,
} from "@/lib/onboarding/steps";
import { describePushRegistration, enablePushOnThisPhone } from "@/lib/push-notifications";
import { toggleConsent } from "@/utils/wellness-profile-choices";
import { client, orpc } from "@/utils/orpc";
import { useThemeColor } from "@/utils/theme";
import { adminAccessQueryOptions } from "@/utils/admin-settings";

import { leaveOnboarding, StepFrame, useOnboardingFlow } from "./flow";

type Flow = ReturnType<typeof useOnboardingFlow>;
type StepProps = { flow: Flow & { snapshot: WellnessProfileSnapshot } };

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

export function ServerStep({ flow }: StepProps) {
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
      onContinue={flow.goNext}
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

// ─── 1. Welcome ────────────────────────────────────────────────

export function WelcomeStep({ flow }: StepProps) {
  const { t } = useLingui();
  const start = async () => {
    if (flow.snapshot.setupStatus === null && !(await flow.save({ setupStatus: "in_progress" })))
      return;
    flow.goNext();
  };
  const notNow = async () => {
    if (await flow.save({ setupStatus: "skipped" })) leaveOnboarding();
  };
  return (
    <StepFrame
      step="welcome"
      title={<Trans>Welcome to OpenValens</Trans>}
      onContinue={() => void start()}
      continueLabel={t`Let's start`}
      busy={flow.saving}
      error={flow.error}
      extraActions={
        <Button variant="ghost" onPress={() => void notNow()} isDisabled={flow.saving}>
          <Button.Label>{t`Not now`}</Button.Label>
        </Button>
      }
    >
      <View className="items-start gap-4">
        <BloomMark size={52} />
        <Prose>
          <Trans>
            Your private health record. A few quick questions so the app shows what matters to you.
            It takes about 2 minutes, and you can change everything later.
          </Trans>
        </Prose>
      </View>
    </StepFrame>
  );
}

// ─── 2. Age check (required) ───────────────────────────────────

export function AgeStep({ flow }: StepProps) {
  const [draft, setDraft] = useState<WellnessProfileDraft>(() => draftFromSnapshot(flow.snapshot));
  const answered = draft.answers.eligibility.state !== "unknown";
  const adult = isAdultConfirmed(draft.answers);

  const next = async () => {
    if (!answersEqual(draft.answers.eligibility, flow.snapshot.eligibility)) {
      if (!(await flow.save({ eligibility: draft.answers.eligibility }))) return;
    }
    flow.goNext();
  };

  return (
    <StepFrame
      step="age"
      title={<Trans>Are you 18 or older?</Trans>}
      description={
        <Trans>
          OpenValens personalisation is for adults. This is the only question you can't skip.
        </Trans>
      }
      info={
        <>
          <Prose>{WELLNESS_FIELD_COPY.eligibility.purpose}</Prose>
          <Prose>{WELLNESS_FIELD_COPY.eligibility.limits}</Prose>
        </>
      }
      onContinue={() => void next()}
      continueDisabled={!answered}
      busy={flow.saving}
      error={flow.error}
      onBack={flow.goBack}
    >
      <Chips field="eligibility" draft={draft} onChange={setDraft} />
      {answered && !adult ? (
        <Note>
          <Trans>You can still keep a record, but personal guidance and references stay off.</Trans>
        </Note>
      ) : null}
    </StepFrame>
  );
}

// ─── 3. Pick your modules ──────────────────────────────────────

export function ModulesStep({ flow }: StepProps) {
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
    flow.goNext();
  };

  return (
    <StepFrame
      step="modules"
      title={<Trans>What brings you here?</Trans>}
      description={<Trans>Pick any. We'll switch on the matching parts of the app.</Trans>}
      onContinue={() => void next()}
      busy={flow.saving}
      error={flow.error}
      onSkip={flow.goNext}
      onBack={flow.goBack}
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

// ─── 4. How data arrives ───────────────────────────────────────

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

export function DataStep({ flow }: StepProps) {
  const { t, i18n } = useLingui();
  const queryClient = useQueryClient();
  const [sources, setSources] = useState<Set<DataSource>>(() =>
    sourcesForInputMethod(flow.snapshot.inputMethod),
  );
  const [outcome, setOutcome] = useState<HealthPermissionOutcome | null>(null);
  const [asking, setAsking] = useState(false);
  const sourceName = Platform.OS === "ios" ? "Apple Health" : "Health Connect";
  const on = [...enabledModuleSet(flow.snapshot)];
  const healthModules = on.filter(
    (module) => PHONE_PLATFORM && healthPermissionsForChoice(PHONE_PLATFORM, [module]).length > 0,
  );
  const options = DATA_SOURCES.filter((source) => source !== "phone" || PHONE_PLATFORM);

  const toggle = (source: DataSource) => {
    setOutcome(null);
    setSources((current) => {
      const next = new Set(current);
      if (next.has(source)) next.delete(source);
      else next.add(source);
      return next;
    });
  };

  const askHealth = async (): Promise<HealthPermissionOutcome> => {
    if (!PHONE_PLATFORM) return "unavailable";
    const asked = healthPermissionsForChoice(PHONE_PLATFORM, on);
    if (asked.length === 0) return "nothing_to_ask";
    setAsking(true);
    try {
      // Only the chosen modules' data types (see lib/health-sync/permissions).
      const access = await requestHealthAccess(flow.snapshot);
      queryClient.setQueryData(["health-sync", "access"], access);
      return healthPermissionOutcome(asked, access);
    } catch {
      return "unavailable";
    } finally {
      setAsking(false);
    }
  };

  const next = async () => {
    const method = inputMethodForSources(sources);
    if (method && !answersEqual({ state: "recorded", value: method }, flow.snapshot.inputMethod)) {
      if (!(await flow.save({ inputMethod: { state: "recorded", value: method } }))) return;
    }
    // Ask once; after a refusal the note explains and Continue moves on.
    if (sources.has("phone") && outcome === null) {
      const result = await askHealth();
      setOutcome(result);
      if (result !== "granted") return;
    }
    flow.goNext();
  };

  return (
    <StepFrame
      step="data"
      title={<Trans>How will your data arrive?</Trans>}
      description={<Trans>Pick all that apply.</Trans>}
      info={
        <>
          <Prose>{WELLNESS_FIELD_COPY.inputMethod.purpose}</Prose>
          <Prose>{WELLNESS_FIELD_COPY.inputMethod.limits}</Prose>
        </>
      }
      onContinue={() => void next()}
      busy={flow.saving || asking}
      error={flow.error}
      onSkip={flow.goNext}
      onBack={flow.goBack}
    >
      <View className="gap-2.5">
        {options.map((source) => {
          const copy = {
            phone: {
              icon: Smartphone,
              tone: "water" as const,
              label: t`My phone's health app`,
              description: sourceName,
            },
            wearable: {
              icon: Watch,
              tone: "sleep" as const,
              label: t`A wearable account`,
              description: t`Oura, WHOOP, Polar, Withings`,
            },
            manual: {
              icon: PenLine,
              tone: "steps" as const,
              label: t`I'll type things in`,
              description: t`Meals, weights, readings`,
            },
          }[source];
          return (
            <OptionCard
              key={source}
              {...copy}
              selected={sources.has(source)}
              onPress={() => toggle(source)}
              testID={`onboarding-source-${source}`}
            />
          );
        })}
      </View>
      {sources.has("phone") ? (
        <Note icon={ShieldCheck}>
          {healthModules.length > 0 ? (
            <Trans>
              We'll ask {sourceName} only for:{" "}
              {healthModules.map((module) => i18n._(MODULE_LABELS[module])).join(", ")}. Read only;
              OpenValens never writes to it.
            </Trans>
          ) : (
            i18n._(OUTCOME_COPY.nothing_to_ask)
          )}
        </Note>
      ) : null}
      {outcome && outcome !== "granted" && outcome !== "nothing_to_ask" ? (
        <Note icon={CircleAlert}>{i18n._(OUTCOME_COPY[outcome])}</Note>
      ) : null}
      {sources.has("wearable") ? (
        <Button
          variant="outline"
          className="self-start"
          onPress={() => router.push("/settings/devices")}
        >
          <Icon icon={Watch} size={16} color="ink-2" />
          <Button.Label>{t`Connect a wearable`}</Button.Label>
        </Button>
      ) : null}
    </StepFrame>
  );
}

// ─── 5. A few basics ───────────────────────────────────────────

export function BasicsStep({ flow }: StepProps) {
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
    flow.goNext();
  };

  return (
    <StepFrame
      step="basics"
      title={<Trans>A few basics</Trans>}
      description={
        <Trans>
          Used for the published references the app compares against. Birth year and sex are
          optional.
        </Trans>
      }
      onContinue={() => void next()}
      continueDisabled={!parsedYear.ok}
      busy={flow.saving}
      error={flow.error}
      onSkip={flow.goNext}
      onBack={flow.goBack}
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
        <Chips field="region" draft={draft} onChange={setDraft} />
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
            <ConsentToggle
              label={CONSENT_COPY.age_band}
              checked={draft.consents.age_band}
              onPress={() => {
                const toggled = toggleConsent("age_band", draft);
                if (toggled.answers.birthYear.state === "unknown") setBirthYearText("");
                setDraft(toggled);
              }}
            />
            <TextInput
              value={birthYearText}
              editable={draft.consents.age_band && draft.answers.birthYear.state !== "declined"}
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
            <ConsentToggle
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
            <ConsentToggle
              label={CONSENT_COPY.sex}
              checked={draft.consents.sex}
              onPress={() => setDraft(toggleConsent("sex", draft))}
            />
            <Chips field="sex" draft={draft} onChange={setDraft} />
          </View>
        </Sheet>
      ) : (
        <Note>
          <Trans>Age and sex are only used by adult features, so they are not asked here.</Trans>
        </Note>
      )}
      <Note icon={ShieldCheck}>
        <Trans>
          Saving birth year or sex asks for your consent, with the same text as the profile page.
          You can withdraw it any time.
        </Trans>
      </Note>
    </StepFrame>
  );
}

// ─── 6. One goal (optional) ────────────────────────────────────

const GOAL_SUGGESTIONS = [
  msg`Sleep 7–9 hours most nights`,
  msg`Walk 8,000 steps a day`,
  msg`Reach a weight`,
  msg`Log meals most days`,
];

export function GoalStep({ flow }: StepProps) {
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
    flow.goNext();
  };

  return (
    <StepFrame
      step="goal"
      title={<Trans>One goal (optional)</Trans>}
      description={<Trans>Something to work toward, in your own words.</Trans>}
      info={
        <Prose>
          <Trans>
            Add a goal in your own words if you have one. It is saved to your Goals, where you can
            set a target and date later. Nothing is suggested or worked out for you.
          </Trans>
        </Prose>
      }
      onContinue={() => void next()}
      busy={add.isPending}
      error={add.isError ? msg`Could not save.` : null}
      onSkip={flow.goNext}
      onBack={flow.goBack}
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
        <Trans>Saved to your Goals. You can edit it under Workouts.</Trans>
      </Prose>
    </StepFrame>
  );
}

// ─── 7. Privacy choices ────────────────────────────────────────

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

export function PrivacyStep({ flow }: StepProps) {
  return (
    <StepFrame
      step="privacy"
      title={<Trans>Your privacy choices</Trans>}
      description={
        <Trans>All off unless you turn them on. Your records stay on your server either way.</Trans>
      }
      onContinue={flow.goNext}
      onSkip={flow.goNext}
      onBack={flow.goBack}
    >
      <AiSection />
      <ReminderChoices />
      <AnalyticsConsentSection />
    </StepFrame>
  );
}

// ─── 8. Your Today ─────────────────────────────────────────────

export function TodayStep({ flow }: StepProps) {
  const { t, i18n } = useLingui();
  const modules = PERSON_MODULES.filter((module) => enabledModuleSet(flow.snapshot).has(module));

  const finish = async () => {
    if (flow.snapshot.setupStatus !== "completed") {
      if (!(await flow.save({ setupStatus: "completed" }))) return;
    }
    void flow.local.markVisited("today");
    leaveOnboarding();
  };

  return (
    <StepFrame
      step="today"
      title={<Trans>You're all set</Trans>}
      description={
        <Trans>
          Here's your Today with the modules you picked. Change them any time in Settings › Modules.
        </Trans>
      }
      onContinue={() => void finish()}
      continueLabel={t`Open my dashboard`}
      busy={flow.saving}
      error={flow.error}
      onBack={flow.goBack}
    >
      {modules.length > 0 ? (
        <View className="flex-row flex-wrap gap-3" accessibilityLabel={t`Preview of your Today`}>
          {modules.map((module) => (
            <View key={module} style={{ width: "47%" }}>
              <Sheet className="gap-3 p-4">
                <View className="flex-row items-center justify-between gap-2">
                  <Text
                    className="shrink font-sans text-[15px] font-semibold leading-5 text-ink-2"
                    numberOfLines={2}
                  >
                    {i18n._(MODULE_LABELS[module])}
                  </Text>
                  <ToneIcon
                    icon={MODULE_ICON_COMPONENTS[MODULE_ICONS[module]]}
                    tone={MODULE_TONES[module]}
                    size="sm"
                  />
                </View>
                <Text className="font-sans text-sm text-ink-3">
                  {i18n._(MODULE_DESCRIPTIONS[module])}
                </Text>
              </Sheet>
            </View>
          ))}
        </View>
      ) : (
        <Note>
          <Trans>
            No modules picked. Your Today shows the timeline and scores, and you can add a module
            any time in Settings › Modules.
          </Trans>
        </Note>
      )}
      <StatusPill tone="neutral">
        <Trans>Always there: Timeline, Scores, Sharing and Settings</Trans>
      </StatusPill>
    </StepFrame>
  );
}

export const STEP_SCREENS: Record<OnboardingRoute, (props: StepProps) => ReactNode> = {
  server: ServerStep,
  welcome: WelcomeStep,
  age: AgeStep,
  modules: ModulesStep,
  data: DataStep,
  basics: BasicsStep,
  goal: GoalStep,
  privacy: PrivacyStep,
  today: TodayStep,
};
