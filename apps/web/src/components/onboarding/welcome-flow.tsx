import type { MessageDescriptor } from "@lingui/core";
import { Trans, useLingui } from "@lingui/react/macro";
import { INSIGHT_DELIVERY_COPY } from "@openvalens/api/presenters/insights";
import type { PersonModule } from "@openvalens/api/presenters/modules";
import {
  buildSectionPatch,
  describeProfileSaveError,
  draftFromSnapshot,
  isAdultConfirmed,
  parseBirthYearInput,
  WELLNESS_CHOICE_LABELS,
  type WellnessProfileDraft,
} from "@openvalens/api/presenters/wellness-profile";
import {
  FOCUS_AREA_LABELS,
  unavailableExplanation,
  WELLNESS_FIELD_COPY,
  WELLNESS_REGIONS,
  type EligibilityAnswer,
  type FocusAnswer,
  type InputMethodAnswer,
  type WellnessProfileSnapshot,
  type WellnessProfileUpdateInput,
} from "@openvalens/api/wellness-profile-contract";
import { Button } from "@openvalens/ui/components/button";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { Switch } from "@openvalens/ui/components/switch";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { BellRing } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { AiConsentSection } from "@/components/ai-consent-section";
import { AnalyticsConsentSection } from "@/components/analytics-consent-section";
import { LanguageSection } from "@/components/language-section";
import {
  AgeBody,
  DataBody,
  GoalBody,
  ModulesBody,
  StepFrame,
  StepRail,
  TodayPreview,
  WelcomeBody,
} from "@/components/onboarding/onboarding-steps";
import { ServerChecklist } from "@/components/onboarding/server-checklist";
import { ErrorState, InfoTip, Page } from "@/components/page";
import { SettingsGroup, SettingsRow } from "@/components/settings-rows";
import { AgeAndSexFields, answerValue, RadioGroup } from "@/components/wellness-profile-editor";
import { adminAccessQueryOptions } from "@/utils/admin-settings";
import {
  canOpenStep,
  initialModules,
  isStepDone,
  ONBOARDING_STEPS,
  resumeStep,
  type OnboardingStep,
} from "@/utils/onboarding";
import { useOnboardingExtras } from "@/utils/onboarding-data";
import { orpc } from "@/utils/orpc";
import { useUpdateWellnessProfile, useWellnessProfile } from "@/utils/wellness-profile";

/**
 * Onboarding stage 2 — the web first-run flow at `/welcome`. Every step saves
 * through the existing APIs as the person goes (the profile with
 * `expectedRevision`, goals, consents), so leaving part-way loses nothing and
 * "Continue" on the dashboard resumes at the first step without an answer.
 */
export function WelcomeFlow() {
  const profile = useWellnessProfile();
  const { t } = useLingui();
  if (profile.isPending) {
    return (
      <Page>
        <Skeleton className="h-96 w-full rounded-3xl" />
      </Page>
    );
  }
  if (profile.isError || !profile.data) {
    return (
      <Page width="narrow">
        <ErrorState
          title={t`Could not load your profile. Nothing has changed.`}
          action={
            <Button onClick={() => void profile.refetch()}>
              <Trans>Retry</Trans>
            </Button>
          }
        />
      </Page>
    );
  }
  return (
    <WelcomeFlowLoaded
      snapshot={profile.data}
      userId={profile.userId}
      reload={() => profile.refetch()}
    />
  );
}

function WelcomeFlowLoaded({
  snapshot,
  userId,
  reload,
}: {
  snapshot: WellnessProfileSnapshot;
  userId: string;
  reload: () => Promise<unknown>;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { i18n } = useLingui();
  const titleId = useId();
  const extras = useOnboardingExtras();
  const update = useUpdateWellnessProfile(userId);
  const access = useQuery({ ...adminAccessQueryOptions(userId), enabled: !!userId });

  // Where to start, fixed on first load: the first step without an answer.
  const [initial] = useState(() => ({
    step: resumeStep(snapshot, extras),
    firstRun: snapshot.setupStatus === null,
  }));
  const [step, setStep] = useState<OnboardingStep>(initial.step);
  const [checklistDone, setChecklistDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageDescriptor | null>(null);

  // Drafts, seeded from the server.
  const [eligibility, setEligibility] = useState<EligibilityAnswer>(snapshot.eligibility);
  const [focus, setFocus] = useState<FocusAnswer>(snapshot.focus);
  const [modules, setModules] = useState<PersonModule[]>(() =>
    initialModules(snapshot, snapshot.focus.state === "recorded" ? snapshot.focus.value : []),
  );
  const modulesTouched = useRef(snapshot.enabledModules !== null);
  const [inputMethod, setInputMethod] = useState<InputMethodAnswer>(snapshot.inputMethod);
  const [basics, setBasics] = useState<WellnessProfileDraft>(() => draftFromSnapshot(snapshot));
  const [birthYearText, setBirthYearText] = useState(() =>
    snapshot.birthYear.state === "recorded" ? String(snapshot.birthYear.value) : "",
  );
  const [goalTitle, setGoalTitle] = useState("");

  // Opening the flow marks it as seen, so the first-sign-in redirect happens once.
  const marked = useRef(false);
  useEffect(() => {
    if (marked.current || snapshot.setupStatus !== null) return;
    marked.current = true;
    update.mutate({ expectedRevision: snapshot.revision, setupStatus: "in_progress" });
  }, [snapshot.revision, snapshot.setupStatus, update]);

  const addGoal = useMutation(
    orpc.plans.goals.upsertGoal.mutationOptions({
      onSuccess: () => void queryClient.invalidateQueries({ queryKey: orpc.plans.goals.key() }),
    }),
  );

  const index = ONBOARDING_STEPS.indexOf(step);
  const go = (target: OnboardingStep) => {
    if (!canOpenStep(target, { eligibility: snapshot.eligibility })) return;
    setError(null);
    setStep(target);
  };
  const next = () => go(ONBOARDING_STEPS[Math.min(index + 1, ONBOARDING_STEPS.length - 1)]!);
  const back = () => go(ONBOARDING_STEPS[Math.max(index - 1, 0)]!);

  /** Saves a partial profile update against the latest revision; true when saved. */
  const save = async (patch: Omit<WellnessProfileUpdateInput, "expectedRevision">) => {
    if (Object.keys(patch).length === 0) return true;
    try {
      await update.mutateAsync({
        ...patch,
        expectedRevision: snapshot.revision,
        ...(snapshot.setupStatus === null && patch.setupStatus === undefined
          ? { setupStatus: "in_progress" as const }
          : {}),
      });
      return true;
    } catch (e) {
      const described = describeProfileSaveError(e);
      if (described.kind === "conflict") await reload();
      setError(described.message);
      return false;
    }
  };

  const run = async (action: () => Promise<boolean>) => {
    setBusy(true);
    setError(null);
    try {
      if (await action()) next();
    } finally {
      setBusy(false);
    }
  };

  const changed = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);

  const onContinue = () => {
    switch (step) {
      case "welcome":
      case "privacy":
        next();
        return;
      case "age":
        void run(() => save(changed(eligibility, snapshot.eligibility) ? { eligibility } : {}));
        return;
      case "modules":
        void run(() =>
          save({
            ...(changed(focus, snapshot.focus) ? { focus } : {}),
            enabledModules: modules,
          }),
        );
        return;
      case "data":
        void run(() => save(changed(inputMethod, snapshot.inputMethod) ? { inputMethod } : {}));
        return;
      case "basics": {
        const draft: WellnessProfileDraft = {
          ...basics,
          answers: { ...basics.answers, eligibility: snapshot.eligibility },
        };
        const region = buildSectionPatch(snapshot, draft, "region");
        const ageAndSex = isAdultConfirmed(snapshot)
          ? buildSectionPatch(snapshot, draft, "ageAndSex")
          : null;
        const { expectedRevision: _r1, ...regionPatch } = region ?? { expectedRevision: 0 };
        const { expectedRevision: _r2, ...agePatch } = ageAndSex ?? { expectedRevision: 0 };
        void run(() => save({ ...regionPatch, ...agePatch }));
        return;
      }
      case "goal": {
        const title = goalTitle.trim();
        if (!title) {
          next();
          return;
        }
        const area = focus.state === "recorded" ? focus.value[0] : undefined;
        void run(async () => {
          try {
            await addGoal.mutateAsync({
              title,
              category: area ? FOCUS_AREA_LABELS[area] : "General",
              status: "not_started",
            });
            setGoalTitle("");
            return true;
          } catch (e) {
            setError(describeProfileSaveError(e).message);
            return false;
          }
        });
        return;
      }
      case "today":
        setBusy(true);
        setError(null);
        void save({ setupStatus: "completed" })
          .then((ok) => (ok ? navigate({ to: "/dashboard" }) : undefined))
          .finally(() => setBusy(false));
        return;
    }
  };

  const showChecklist =
    initial.firstRun &&
    !checklistDone &&
    step === "welcome" &&
    access.data?.isInstanceAdmin === true;

  const birthYearInvalid = !parseBirthYearInput(birthYearText, new Date()).ok;
  const adult = isAdultConfirmed(snapshot);
  const savedModules = snapshot.enabledModules ?? modules;

  const frame = {
    step,
    titleId,
    busy,
    onContinue,
    onSkip: step === "welcome" || step === "today" ? undefined : next,
    onBack: index > 0 ? back : undefined,
    error: error ? i18n._(error) : undefined,
  };

  let body;
  switch (step) {
    case "welcome":
      body = (
        <StepFrame
          {...frame}
          title={<Trans>Welcome to OpenValens</Trans>}
          description={<Trans>Your private health record.</Trans>}
          continueLabel={<Trans>Let's start</Trans>}
          onSkip={() => void navigate({ to: "/dashboard" })}
        >
          <WelcomeBody />
        </StepFrame>
      );
      break;
    case "age":
      body = (
        <StepFrame
          {...frame}
          title={WELLNESS_FIELD_COPY.eligibility.question}
          description={<Trans>This is the only question you can't skip.</Trans>}
          continueDisabled={eligibility.state === "unknown"}
        >
          <AgeBody value={eligibility} onChange={setEligibility} />
        </StepFrame>
      );
      break;
    case "modules":
      body = (
        <StepFrame
          {...frame}
          title={<Trans>What brings you here?</Trans>}
          description={<Trans>Pick any. We'll switch on the matching parts of the app.</Trans>}
        >
          <ModulesBody
            focus={focus}
            onFocusChange={(answer) => {
              setFocus(answer);
              if (!modulesTouched.current) {
                setModules(
                  initialModules(
                    { enabledModules: null },
                    answer.state === "recorded" ? answer.value : [],
                  ),
                );
              }
            }}
            modules={modules}
            onToggleModule={(module) => {
              modulesTouched.current = true;
              setModules((current) =>
                current.includes(module)
                  ? current.filter((m) => m !== module)
                  : [...current, module],
              );
            }}
          />
        </StepFrame>
      );
      break;
    case "data":
      body = (
        <StepFrame {...frame} title={<Trans>How will your data arrive?</Trans>}>
          <DataBody value={inputMethod} onChange={setInputMethod} />
        </StepFrame>
      );
      break;
    case "basics":
      body = (
        <StepFrame
          {...frame}
          title={<Trans>A few basics</Trans>}
          description={<Trans>Birth year and sex are optional.</Trans>}
          continueDisabled={birthYearInvalid}
        >
          <div className="grid gap-6">
            <fieldset className="grid min-w-0 gap-2">
              <legend className="mb-2 flex items-center gap-1.5 font-display font-medium text-ink">
                {WELLNESS_FIELD_COPY.region.question}
                <InfoTip>
                  <p>{WELLNESS_FIELD_COPY.region.purpose}</p>
                  <p>{WELLNESS_FIELD_COPY.region.limits}</p>
                </InfoTip>
              </legend>
              <RadioGroup
                name="onboarding-region"
                value={answerValue(basics.answers.region)}
                options={[
                  ...WELLNESS_REGIONS.map((value) => ({
                    value,
                    label: i18n._(WELLNESS_CHOICE_LABELS.region[value]),
                  })),
                  { value: "declined", label: i18n._(WELLNESS_CHOICE_LABELS.decline) },
                ]}
                onChange={(value) =>
                  setBasics({
                    ...basics,
                    answers: {
                      ...basics.answers,
                      region:
                        value === "declined"
                          ? { state: "declined" }
                          : {
                              state: "recorded",
                              value: value as (typeof WELLNESS_REGIONS)[number],
                            },
                    },
                  })
                }
              />
            </fieldset>
            {adult ? (
              <AgeAndSexFields
                draft={basics}
                onDraftChange={setBasics}
                birthYearText={birthYearText}
                onBirthYearTextChange={setBirthYearText}
                now={new Date()}
              />
            ) : (
              <p className="max-w-[65ch] text-sm text-ink-3">
                {unavailableExplanation("adult_confirmation_required")}{" "}
                <Trans>
                  Age and sex are only used by adult features, so they are not asked here.
                </Trans>
              </p>
            )}
            <LanguageSection />
          </div>
        </StepFrame>
      );
      break;
    case "goal":
      body = (
        <StepFrame
          {...frame}
          title={<Trans>One goal (optional)</Trans>}
          description={<Trans>Something to work toward, in your own words.</Trans>}
        >
          <GoalBody
            title={goalTitle}
            onTitleChange={setGoalTitle}
            existingGoals={extras.goalCount ?? 0}
          />
        </StepFrame>
      );
      break;
    case "privacy":
      body = (
        <StepFrame
          {...frame}
          title={<Trans>Your privacy choices</Trans>}
          description={
            <Trans>
              All off unless you turn them on. Your records stay on your server either way.
            </Trans>
          }
        >
          <div className="grid gap-8">
            <AiConsentSection />
            <DailyRemindersSwitch />
            <AnalyticsConsentSection />
          </div>
        </StepFrame>
      );
      break;
    case "today":
      body = (
        <StepFrame
          {...frame}
          title={<Trans>You're all set</Trans>}
          description={
            <Trans>
              Here's your Today with the modules you picked. Change them any time in Settings ›
              Modules.
            </Trans>
          }
          continueLabel={<Trans>Open my dashboard</Trans>}
        >
          <TodayPreview modules={savedModules} />
        </StepFrame>
      );
      break;
  }

  return (
    <Page className="lg:grid-cols-[14rem_minmax(0,1fr)] lg:items-start lg:gap-10">
      <aside className="hidden lg:sticky lg:top-10 lg:block">
        <StepRail
          current={step}
          done={(s) => isStepDone(s, snapshot, extras)}
          eligibility={snapshot.eligibility}
          onJump={go}
        />
      </aside>
      <div className="min-w-0">
        {showChecklist ? (
          <ServerChecklist userId={userId} onContinue={() => setChecklistDone(true)} />
        ) : (
          body
        )}
      </div>
    </Page>
  );
}

/** Daily reminders by email: the existing switch, copy and mutation from Settings. */
function DailyRemindersSwitch() {
  const queryClient = useQueryClient();
  const { t, i18n } = useLingui();
  const preferences = useQuery(orpc.insights.preferences.get.queryOptions({ input: {} }));
  const update = useMutation(
    orpc.insights.preferences.update.mutationOptions({
      onSuccess: () => void queryClient.invalidateQueries({ queryKey: orpc.insights.key() }),
    }),
  );
  if (preferences.isPending) return <Skeleton className="h-16 w-full rounded-3xl" />;
  if (preferences.isError || !preferences.data) {
    return (
      <ErrorState
        title={<Trans>Could not load your notification settings.</Trans>}
        action={
          <Button variant="outline" onClick={() => void preferences.refetch()}>
            <Trans>Retry</Trans>
          </Button>
        }
      />
    );
  }
  const data = preferences.data;
  return (
    <section className="grid gap-3">
      <h2 className="text-xl leading-tight text-ink">
        {i18n._(INSIGHT_DELIVERY_COPY.dailyRemindersTitle)}
      </h2>
      <SettingsGroup>
        <SettingsRow
          icon={BellRing}
          htmlFor="onboarding-daily-reminder-email"
          label={i18n._(INSIGHT_DELIVERY_COPY.dailyRemindersEmail)}
          info={
            <>
              <p>{i18n._(INSIGHT_DELIVERY_COPY.dailyRemindersEmailNote)}</p>
              <p>{i18n._(INSIGHT_DELIVERY_COPY.dailyRemindersTelegram)}</p>
            </>
          }
          description={
            data.emailAvailable ? undefined : i18n._(INSIGHT_DELIVERY_COPY.emailUnavailable)
          }
        >
          {data.emailAvailable ? (
            <Switch
              id="onboarding-daily-reminder-email"
              checked={data.dailyReminders.email}
              disabled={update.isPending}
              onCheckedChange={(email) => update.mutate({ dailyReminders: { email } })}
            />
          ) : null}
        </SettingsRow>
      </SettingsGroup>
      {update.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {t`Could not update notification settings.`}
        </p>
      ) : null}
    </section>
  );
}
