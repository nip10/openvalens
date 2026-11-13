import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { INSIGHT_DELIVERY_COPY } from "@openvalens/api/presenters/insights";
import { logKindPermissionCheck, type LogKind } from "@openvalens/api/presenters/log-kinds";
import { defaultModulesForFocus, type PersonModule } from "@openvalens/api/presenters/modules";
import { newClientMutationId, deviceTimeZone } from "@openvalens/api/presenters/nutrition-diary";
import {
  firstLogKinds,
  phoneAppLink,
  turnsOnWater,
  type FirstLogKindId,
} from "@openvalens/api/presenters/onboarding";
import { buildQuickLogWrite, quickFormDefaults } from "@openvalens/api/presenters/quick-log";
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
  type FocusAnswer,
  type WellnessProfileSnapshot,
  type WellnessProfileUpdateInput,
} from "@openvalens/api/wellness-profile-contract";
import { Button } from "@openvalens/ui/components/button";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { Switch } from "@openvalens/ui/components/switch";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { AiConsentSection } from "@/components/ai-consent-section";
import { AnalyticsConsentSection } from "@/components/analytics-consent-section";
import { LanguageSection } from "@/components/language-section";
import {
  ConnectBody,
  FirstLogCards,
  GoalBody,
  ModulesBody,
  StepFrame,
} from "@/components/onboarding/onboarding-steps";
import { ErrorState, InfoTip } from "@/components/page";
import { performQuickLogWrite } from "@/components/quick-log/perform-write";
import { QuickForm } from "@/components/quick-log/quick-form";
import { SettingsGroup, SettingsRow } from "@/components/settings-rows";
import { AgeAndSexFields, answerValue, RadioGroup } from "@/components/wellness-profile-editor";
import { ENV } from "@/env";
import { client, orpc } from "@/utils/orpc";
import { useProductSettings } from "@/utils/product-settings";
import { enqueueMetricSample } from "@/utils/sync-engine";
import { useUpdateWellnessProfile } from "@/utils/wellness-profile";

/**
 * Onboarding (#444) — the screens behind the first run and the "Finish
 * setting up" items, each wired to the existing APIs and usable on its own:
 * the first run strings three together, and each card item opens one.
 */

/** Where a screen sits and what its buttons do. */
export type SetupStepProps = {
  /** "Step N of 3" in the first run; left out on a card item's screen. */
  progress?: { index: number; total: number; label: string };
  /** Called once the screen is answered or skipped. */
  onDone: () => void;
  onBack?: () => void;
  /** The main button's label (the first run says "Continue", a card item "Save"). */
  doneLabel?: MessageDescriptor;
};

const COPY = {
  save: msg`Save`,
  saved: msg`Saved: {what}`,
  savedOffline: msg`Saved on this device: {what}. It syncs when you are back online.`,
  waterOn: msg`Water logging is on.`,
  waterFailed: msg`Could not turn on water logging. Try again.`,
  connectFailed: msg`Could not start connecting. Try again.`,
};

/** Saves a partial profile update against the snapshot's revision; true when saved. */
function useProfileSave(snapshot: WellnessProfileSnapshot, userId: string, reload: () => unknown) {
  const update = useUpdateWellnessProfile(userId);
  const [error, setError] = useState<MessageDescriptor | null>(null);
  const save = async (patch: Omit<WellnessProfileUpdateInput, "expectedRevision">) => {
    setError(null);
    if (Object.keys(patch).length === 0) return true;
    try {
      await update.mutateAsync({ ...patch, expectedRevision: snapshot.revision });
      return true;
    } catch (e) {
      const described = describeProfileSaveError(e);
      if (described.kind === "conflict") await reload();
      setError(described.message);
      return false;
    }
  };
  return { save, error, setError, pending: update.isPending };
}

const changed = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);

// ─── First log ─────────────────────────────────────────────────

/**
 * Weight, Water or Last night's sleep, through the quick-log forms and save
 * path (#440). Choosing Water first turns plain water on.
 */
export function FirstLogStep({
  snapshot,
  progress,
  onDone,
  onBack,
}: SetupStepProps & { snapshot: Pick<WellnessProfileSnapshot, "enabledModules"> }) {
  const { i18n } = useLingui();
  const titleId = useId();
  const queryClient = useQueryClient();
  const timeZone = useMemo(() => deviceTimeZone(), []);
  const me = useQuery(orpc.sharing.me.queryOptions({ input: {} }));
  const water = useQuery(orpc.plainWater.getPreferences.queryOptions({ input: {} }));
  const products = useProductSettings();
  const weightUnit = products.data?.units === "imperial" ? "lb" : "kg";
  const kinds = firstLogKinds({
    enabledModules: snapshot.enabledModules,
    can: logKindPermissionCheck(me.data?.role),
  });

  const [kind, setKind] = useState<LogKind<FirstLogKindId> | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [showErrors, setShowErrors] = useState(false);
  const [mutationId, setMutationId] = useState(newClientMutationId);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<MessageDescriptor | null>(null);

  const turnOnWater = useMutation(
    orpc.plainWater.updatePreferences.mutationOptions({
      onSuccess: () => void queryClient.invalidateQueries({ queryKey: orpc.plainWater.key() }),
    }),
  );

  const open = async (next: LogKind<FirstLogKindId>) => {
    setError(null);
    if (turnsOnWater(next.id, water.data?.enabled)) {
      try {
        await turnOnWater.mutateAsync({ enabled: true });
        toast.success(i18n._(COPY.waterOn));
      } catch {
        setError(COPY.waterFailed);
        return;
      }
    }
    setValues(quickFormDefaults(next, new Date(), { weightUnit }));
    setShowErrors(false);
    setFailed(false);
    setMutationId(newClientMutationId());
    setKind(next);
  };

  const parsed = kind
    ? buildQuickLogWrite(kind, values, {
        timeZone,
        locale: i18n.locale,
        // One id per open form, so a retried save cannot log twice.
        newId: () => mutationId,
      })
    : null;

  const submit = async () => {
    if (!kind || !parsed) return;
    if (!parsed.ok) {
      setShowErrors(true);
      return;
    }
    setSaving(true);
    setFailed(false);
    try {
      const result = await performQuickLogWrite(parsed.write, client, enqueueMetricSample);
      for (const key of [
        orpc.quickLog.key(),
        orpc.healthRecord.key(),
        orpc.body.key(),
        orpc.sleep.key(),
        orpc.plainWater.key(),
      ])
        void queryClient.invalidateQueries({ queryKey: key });
      const what = i18n._(kind.label);
      toast.success(
        i18n._({ ...(result.queued ? COPY.savedOffline : COPY.saved), values: { what } }),
      );
      onDone();
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <StepFrame
      titleId={titleId}
      progress={progress}
      title={<Trans>Log your first entry</Trans>}
      description={
        <Trans>Pick one to try it. It takes a few seconds, and you can change it later.</Trans>
      }
      // A card item's screen has Back; Skip belongs to the first run.
      onSkip={progress && !saving ? onDone : undefined}
      onBack={kind ? undefined : onBack}
      error={error ? i18n._(error) : undefined}
    >
      {kind && parsed ? (
        <div className="rounded-3xl border border-rule bg-card">
          <QuickForm
            kind={kind}
            values={values}
            errors={parsed.ok ? [] : parsed.errors}
            showErrors={showErrors}
            supplements={null}
            pending={saving}
            failed={failed}
            onChange={(id, value) => setValues((current) => ({ ...current, [id]: value }))}
            onSubmit={() => void submit()}
            onBack={() => setKind(null)}
          />
        </div>
      ) : me.isPending ? (
        <Skeleton className="h-36 w-full rounded-3xl" />
      ) : (
        <FirstLogCards
          kinds={kinds}
          plainWaterEnabled={water.data?.enabled ?? null}
          disabled={turnOnWater.isPending}
          onPick={(next) => void open(next)}
        />
      )}
    </StepFrame>
  );
}

// ─── Connect ───────────────────────────────────────────────────

/** This server's address as the phone app should store it. */
export function serverAddress(configured: string, origin: string): string {
  try {
    return new URL(configured, origin).toString().replace(/\/+$/, "");
  } catch {
    return configured.replace(/\/+$/, "");
  }
}

/** The web's "Connect": get the phone app (QR) and the operator's wearable accounts. */
export function ConnectStep({ progress, onDone, onBack, doneLabel }: SetupStepProps) {
  const { i18n } = useLingui();
  const titleId = useId();
  const [error, setError] = useState<MessageDescriptor | null>(null);
  const wearables = useQuery(orpc.wearables.list.queryOptions({ input: {} }));
  const connect = useMutation(
    orpc.wearables.connect.mutationOptions({
      onMutate: () => setError(null),
      // Full-page navigation: the vendor returns to Settings › Devices.
      onSuccess: ({ authorizationUrl }) => window.location.assign(authorizationUrl),
      onError: () => setError(COPY.connectFailed),
    }),
  );
  const server = serverAddress(ENV.VITE_SERVER_URL, window.location.origin);
  return (
    <StepFrame
      titleId={titleId}
      progress={progress}
      title={<Trans>Connect your data</Trans>}
      description={
        <Trans>Bring in what your phone and devices already record. You can do this later.</Trans>
      }
      continueLabel={doneLabel ? i18n._(doneLabel) : undefined}
      onContinue={onDone}
      onBack={onBack}
      error={error ? i18n._(error) : undefined}
    >
      <ConnectBody
        phoneLink={phoneAppLink(server)}
        serverUrl={server}
        providers={wearables.data?.providers ?? (wearables.isError ? [] : null)}
        busyProvider={connect.isPending ? (connect.variables?.provider ?? null) : null}
        onConnect={(provider) => connect.mutate({ provider })}
      />
    </StepFrame>
  );
}

// ─── Card items: modules, basics, goal, privacy ────────────────

type ProfileStepProps = SetupStepProps & {
  snapshot: WellnessProfileSnapshot;
  userId: string;
  reload: () => unknown;
};

/** Focus areas and the module cards; the cards follow the focus until touched. */
export function ModulesStep({
  snapshot,
  userId,
  reload,
  onDone,
  onBack,
  doneLabel,
}: ProfileStepProps) {
  const { i18n } = useLingui();
  const titleId = useId();
  const { save, error, pending } = useProfileSave(snapshot, userId, reload);
  const [focus, setFocus] = useState<FocusAnswer>(snapshot.focus);
  const [modules, setModules] = useState<PersonModule[]>(() =>
    snapshot.enabledModules !== null
      ? [...snapshot.enabledModules]
      : defaultModulesForFocus(snapshot.focus),
  );
  const touched = useRef(snapshot.enabledModules !== null);
  return (
    <StepFrame
      titleId={titleId}
      title={<Trans>What brings you here?</Trans>}
      description={<Trans>Pick any. We'll switch on the matching parts of the app.</Trans>}
      continueLabel={i18n._(doneLabel ?? COPY.save)}
      busy={pending}
      onContinue={() =>
        void save({
          ...(changed(focus, snapshot.focus) ? { focus } : {}),
          enabledModules: modules,
        }).then((ok) => ok && onDone())
      }
      onBack={onBack}
      error={error ? i18n._(error) : undefined}
    >
      <ModulesBody
        focus={focus}
        onFocusChange={(answer) => {
          setFocus(answer);
          if (!touched.current) setModules(defaultModulesForFocus(answer));
        }}
        modules={modules}
        onToggleModule={(module) => {
          touched.current = true;
          setModules((current) =>
            current.includes(module) ? current.filter((m) => m !== module) : [...current, module],
          );
        }}
      />
    </StepFrame>
  );
}

/** Region, and birth year and sex for adults; plus the language. */
export function BasicsStep({
  snapshot,
  userId,
  reload,
  onDone,
  onBack,
  doneLabel,
}: ProfileStepProps) {
  const { i18n } = useLingui();
  const titleId = useId();
  const { save, error, pending } = useProfileSave(snapshot, userId, reload);
  const [basics, setBasics] = useState<WellnessProfileDraft>(() => draftFromSnapshot(snapshot));
  const [birthYearText, setBirthYearText] = useState(() =>
    snapshot.birthYear.state === "recorded" ? String(snapshot.birthYear.value) : "",
  );
  const adult = isAdultConfirmed(snapshot);
  const birthYearInvalid = !parseBirthYearInput(birthYearText, new Date()).ok;

  const onSave = () => {
    const draft: WellnessProfileDraft = {
      ...basics,
      answers: { ...basics.answers, eligibility: snapshot.eligibility },
    };
    const region = buildSectionPatch(snapshot, draft, "region");
    const ageAndSex = adult ? buildSectionPatch(snapshot, draft, "ageAndSex") : null;
    const { expectedRevision: _r1, ...regionPatch } = region ?? { expectedRevision: 0 };
    const { expectedRevision: _r2, ...agePatch } = ageAndSex ?? { expectedRevision: 0 };
    void save({ ...regionPatch, ...agePatch }).then((ok) => ok && onDone());
  };

  return (
    <StepFrame
      titleId={titleId}
      title={<Trans>A few basics</Trans>}
      description={<Trans>Birth year and sex are optional.</Trans>}
      continueLabel={i18n._(doneLabel ?? COPY.save)}
      continueDisabled={birthYearInvalid}
      busy={pending}
      onContinue={onSave}
      onBack={onBack}
      error={error ? i18n._(error) : undefined}
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
                      : { state: "recorded", value: value as (typeof WELLNESS_REGIONS)[number] },
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
            <Trans>Age and sex are only used by adult features, so they are not asked here.</Trans>
          </p>
        )}
        <LanguageSection />
      </div>
    </StepFrame>
  );
}

/** One goal in the person's own words, saved to Goals. */
export function GoalStep({
  snapshot,
  onDone,
  onBack,
  doneLabel,
  goalCount,
}: SetupStepProps & { snapshot: Pick<WellnessProfileSnapshot, "focus">; goalCount: number }) {
  const { i18n } = useLingui();
  const titleId = useId();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [error, setError] = useState<MessageDescriptor | null>(null);
  const addGoal = useMutation(
    orpc.plans.goals.upsertGoal.mutationOptions({
      onSuccess: () => void queryClient.invalidateQueries({ queryKey: orpc.plans.goals.key() }),
    }),
  );
  const onSave = () => {
    const trimmed = title.trim();
    if (!trimmed) return onDone();
    const area = snapshot.focus.state === "recorded" ? snapshot.focus.value[0] : undefined;
    setError(null);
    addGoal.mutate(
      {
        title: trimmed,
        category: area ? FOCUS_AREA_LABELS[area] : "General",
        status: "not_started",
      },
      {
        onSuccess: onDone,
        onError: (e) => setError(describeProfileSaveError(e).message),
      },
    );
  };
  return (
    <StepFrame
      titleId={titleId}
      title={<Trans>One goal (optional)</Trans>}
      description={<Trans>Something to work toward, in your own words.</Trans>}
      continueLabel={i18n._(doneLabel ?? COPY.save)}
      busy={addGoal.isPending}
      onContinue={onSave}
      onBack={onBack}
      error={error ? i18n._(error) : undefined}
    >
      <GoalBody title={title} onTitleChange={setTitle} existingGoals={goalCount} />
    </StepFrame>
  );
}

/** AI, daily reminders and usage analytics: the existing switches, all off by default. */
export function PrivacyStep({ onDone, onBack, doneLabel }: SetupStepProps) {
  const { i18n } = useLingui();
  const titleId = useId();
  return (
    <StepFrame
      titleId={titleId}
      title={<Trans>Your privacy choices</Trans>}
      description={
        <Trans>All off unless you turn them on. Your records stay on your server either way.</Trans>
      }
      continueLabel={doneLabel ? i18n._(doneLabel) : <Trans>Done</Trans>}
      onContinue={onDone}
      onBack={onBack}
    >
      <div className="grid gap-8">
        <AiConsentSection />
        <DailyRemindersSwitch />
        <AnalyticsConsentSection />
      </div>
    </StepFrame>
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
