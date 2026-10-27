import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  buildSectionPatch,
  describeProfileSaveError,
  dirtySections,
  draftFromSnapshot,
  isAdultConfirmed,
  isSectionAnswered,
  isSectionDirty,
  nextSetupSection,
  parseBirthYearInput,
  rebaseDraft,
  rejectionMessage,
  resetSection,
  SECTION_TITLES,
  SETUP_SECTIONS,
  setupProgress,
  wellnessProfileQueryKey,
  type SetupSection,
  type WellnessProfileDraft,
} from "@openvalens/api/presenters/wellness-profile";
import {
  CONSENT_COPY,
  DECLINE_LABEL,
  FOCUS_AREA_LABELS,
  PROFILE_INTRO,
  PROFILE_OFFLINE_NOTE,
  PROFILE_STORAGE_NOTE,
  unavailableExplanation,
  WELLNESS_FIELD_COPY,
  type WellnessProfileField,
  type WellnessProfileSnapshot,
  type WellnessProfileUpdateInput,
} from "@openvalens/api/wellness-profile-contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, cn } from "heroui-native";
import { router } from "expo-router";
import {
  Compass,
  Globe,
  ListChecks,
  type LucideIcon,
  ShieldCheck,
  Smartphone,
  Target,
  UserRound,
} from "lucide-react-native";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";

import {
  ErrorState,
  Icon,
  InfoTip,
  Meter,
  Page,
  PageHeader,
  Prose,
  Sheet,
  StatusPill,
  ToneIcon,
} from "@/components/bloom";
import { Container } from "@/components/container";
import { authClient } from "@/lib/auth-client";
import { client, orpc } from "@/utils/orpc";
import { Chips, ConsentToggle, QuestionLabel } from "@/components/wellness-profile-fields";
import { toggleConsent } from "@/utils/wellness-profile-choices";

/**
 * Issue #98 — optional wellness profile (native). Same sections, meaning,
 * validation and copy as the web `/profile` page; the shared rules live in
 * `@openvalens/api/presenters/wellness-profile`. Nothing is persisted on the
 * device: saving needs a connection and "Saved" only shows after the server
 * confirms.
 */

type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved" }
  | { status: "error"; message: MessageDescriptor };

export default function ProfileScreen() {
  const { data: session } = authClient.useSession();
  const userId = session?.user?.id ?? "";
  const profile = useQuery({
    ...orpc.profile.get.queryOptions({ input: {} }),
    queryKey: [...wellnessProfileQueryKey(userId)],
    enabled: !!userId,
    retry: 1,
  });

  if (profile.isPending) {
    return (
      <Container>
        <Page>
          <PageHeader title={<Trans>Your profile</Trans>} />
          <Sheet className="h-32" />
          <Sheet className="h-48" />
        </Page>
      </Container>
    );
  }
  if (profile.isError || !profile.data) {
    return (
      <Container>
        <Page>
          <PageHeader title={<Trans>Your profile</Trans>} />
          <ErrorState
            title={<Trans>Could not load your profile. Nothing has changed.</Trans>}
            action={
              <Button variant="outline" size="sm" onPress={() => void profile.refetch()}>
                <Button.Label>
                  <Trans>Retry</Trans>
                </Button.Label>
              </Button>
            }
          />
        </Page>
      </Container>
    );
  }
  return (
    <ProfileEditor snapshot={profile.data} userId={userId} reload={() => void profile.refetch()} />
  );
}

function ProfileEditor({
  snapshot,
  userId,
  reload,
}: {
  snapshot: WellnessProfileSnapshot;
  userId: string;
  reload: () => void;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<WellnessProfileDraft>(() => draftFromSnapshot(snapshot));
  const [birthYearText, setBirthYearText] = useState(
    snapshot.birthYear.state === "recorded" ? String(snapshot.birthYear.value) : "",
  );
  const [saveState, setSaveState] = useState<Partial<Record<SetupSection, SaveState>>>({});
  const [pageError, setPageError] = useState<MessageDescriptor | null>(null);
  const baseline = useRef(snapshot);
  const { t, i18n } = useLingui();

  useEffect(() => {
    if (baseline.current === snapshot) return;
    setDraft((current) => rebaseDraft(baseline.current, snapshot, current));
    baseline.current = snapshot;
  }, [snapshot]);

  const update = useMutation({
    mutationFn: (input: WellnessProfileUpdateInput) =>
      client.profile.update(
        snapshot.setupStatus === null && input.setupStatus === undefined
          ? { ...input, setupStatus: "in_progress" }
          : input,
      ),
    onSuccess: (next) => queryClient.setQueryData(wellnessProfileQueryKey(userId), next),
  });

  const save = async (section: SetupSection) => {
    const patch = buildSectionPatch(snapshot, draft, section);
    if (!patch) return;
    setSaveState((s) => ({ ...s, [section]: { status: "saving" } }));
    try {
      await update.mutateAsync(patch);
      setSaveState((s) => ({ ...s, [section]: { status: "saved" } }));
    } catch (error) {
      const described = describeProfileSaveError(error);
      if (described.kind === "conflict") reload();
      setSaveState((s) => ({ ...s, [section]: { status: "error", message: described.message } }));
    }
  };

  const finish = async (setupStatus: "completed" | "skipped") => {
    setPageError(null);
    try {
      if (snapshot.setupStatus !== setupStatus) {
        await update.mutateAsync({ expectedRevision: snapshot.revision, setupStatus });
      }
      router.replace("/");
    } catch (error) {
      setPageError(describeProfileSaveError(error).message);
    }
  };

  const change = (next: WellnessProfileDraft) => {
    setDraft(next);
    setSaveState({});
  };

  const progress = setupProgress(snapshot);
  const next = nextSetupSection(snapshot);
  const dirty = dirtySections(snapshot, draft);
  const adult = isAdultConfirmed(draft.answers);
  const parsedYear = parseBirthYearInput(birthYearText, new Date());

  const sectionProps = {
    snapshot,
    draft,
    saveState,
    onSave: (section: SetupSection) => void save(section),
    onUndo: (section: SetupSection) => {
      setDraft((current) => resetSection(snapshot, current, section));
      if (section === "ageAndSex") {
        setBirthYearText(
          snapshot.birthYear.state === "recorded" ? String(snapshot.birthYear.value) : "",
        );
      }
    },
    onClear: (fields: WellnessProfileField[]) => {
      let cleared = draft;
      for (const field of fields) {
        cleared = { ...cleared, answers: { ...cleared.answers, [field]: { state: "unknown" } } };
      }
      if (fields.includes("birthYear")) setBirthYearText("");
      change(cleared);
    },
  };

  return (
    <Container>
      <Page>
        <PageHeader
          title={<Trans>Your profile</Trans>}
          description={<Trans>All optional. Answer what helps you.</Trans>}
          info={
            <>
              <Prose>{PROFILE_INTRO}</Prose>
              <Prose>{PROFILE_STORAGE_NOTE}</Prose>
              <Prose>{PROFILE_OFFLINE_NOTE}</Prose>
            </>
          }
          actions={
            snapshot.setupStatus !== "completed" ? (
              <>
                <Button variant="outline" onPress={() => void finish("skipped")}>
                  <Button.Label>
                    <Trans>Skip for now</Trans>
                  </Button.Label>
                </Button>
                <Button onPress={() => void finish("completed")} isDisabled={dirty.length > 0}>
                  <Button.Label>
                    <Trans>Done</Trans>
                  </Button.Label>
                </Button>
              </>
            ) : undefined
          }
        />

        <Sheet className="gap-3">
          <View className="flex-row items-center gap-3">
            <ToneIcon icon={ListChecks} tone="signal" />
            <Text className="shrink font-display text-lg font-medium text-ink">
              <Trans>
                {progress.answered} of {progress.available} sections answered
              </Trans>
            </Text>
          </View>
          <Meter
            value={progress.available > 0 ? progress.answered / progress.available : 0}
            tone="signal"
          />
          {next ? (
            <Text className="font-sans text-sm text-ink-2">
              <Trans>Next unanswered: {i18n._(SECTION_TITLES[next])}</Trans>
            </Text>
          ) : null}
          {dirty.length > 0 ? (
            <Text className="font-sans text-sm text-ink-3">
              <Trans>Unsaved: {dirty.map((s) => i18n._(SECTION_TITLES[s])).join(", ")}</Trans>
            </Text>
          ) : null}
          {pageError ? (
            <Text className="font-sans text-sm text-destructive" accessibilityRole="alert">
              {i18n._(pageError)}
            </Text>
          ) : null}
        </Sheet>

        <View className="gap-4">
          <Section {...sectionProps} section="eligibility" fields={["eligibility"]}>
            <Chips field="eligibility" draft={draft} onChange={change} />
          </Section>

          <Section {...sectionProps} section="focus" fields={["focus"]}>
            <Chips field="focus" draft={draft} onChange={change} />
          </Section>

          <Section {...sectionProps} section="inputMethod" fields={["inputMethod"]}>
            <Chips field="inputMethod" draft={draft} onChange={change} />
          </Section>

          <GoalSection draft={draft} />

          <Section {...sectionProps} section="region" fields={["region"]}>
            <Chips field="region" draft={draft} onChange={change} />
          </Section>

          {adult ? (
            <Section {...sectionProps} section="ageAndSex" fields={["birthYear", "sex"]}>
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
                    change(toggled);
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
                      change({
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
                    change({
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
                  onPress={() => change(toggleConsent("sex", draft))}
                />
                <Chips field="sex" draft={draft} onChange={change} />
              </View>
            </Section>
          ) : (
            <Sheet className="gap-4">
              <StepHead section="ageAndSex" />
              <Text className="font-sans text-sm leading-relaxed text-ink-3">
                {unavailableExplanation("adult_confirmation_required")}{" "}
                <Trans>
                  Age and sex are only used by adult features, so they are not asked here.
                </Trans>
              </Text>
            </Sheet>
          )}
        </View>
      </Page>
    </Container>
  );
}

const SECTION_ICONS: Record<SetupSection, LucideIcon> = {
  eligibility: ShieldCheck,
  focus: Compass,
  inputMethod: Smartphone,
  goal: Target,
  region: Globe,
  ageAndSex: UserRound,
};

/**
 * The head of one profile step (as on web): its number in a soft circle, its
 * icon and title, an optional ⓘ with the why, and a pill once it has an answer.
 */
function StepHead({
  section,
  answered = false,
  info,
}: {
  section: SetupSection;
  answered?: boolean;
  info?: ReactNode;
}) {
  const { i18n } = useLingui();
  return (
    <View className="flex-row flex-wrap items-center gap-3">
      <View
        className="h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sidebar-accent"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Text className="font-display text-base font-medium text-signal">
          {SETUP_SECTIONS.indexOf(section) + 1}
        </Text>
      </View>
      <View className="min-w-0 flex-1 flex-row items-center gap-2">
        <Icon icon={SECTION_ICONS[section]} size={18} />
        <Text
          className="shrink font-display text-xl font-semibold text-ink"
          accessibilityRole="header"
        >
          {i18n._(SECTION_TITLES[section])}
        </Text>
        {info ? <InfoTip>{info}</InfoTip> : null}
      </View>
      {answered ? (
        <StatusPill tone="good">
          <Trans>Answered</Trans>
        </StatusPill>
      ) : null}
    </View>
  );
}

function Section({
  section,
  fields,
  snapshot,
  draft,
  saveState,
  onSave,
  onUndo,
  onClear,
  children,
}: {
  section: SetupSection;
  fields: WellnessProfileField[];
  snapshot: WellnessProfileSnapshot;
  draft: WellnessProfileDraft;
  saveState: Partial<Record<SetupSection, SaveState>>;
  onSave: (section: SetupSection) => void;
  onUndo: (section: SetupSection) => void;
  onClear: (fields: WellnessProfileField[]) => void;
  children: React.ReactNode;
}) {
  const dirty = isSectionDirty(snapshot, draft, section);
  const state = saveState[section] ?? { status: "idle" };
  const copy = WELLNESS_FIELD_COPY[fields[0]!];
  const hasAnswer = fields.some((field) => draft.answers[field].state !== "unknown");
  const { t, i18n } = useLingui();

  return (
    <Sheet className="gap-4">
      <StepHead
        section={section}
        answered={isSectionAnswered(section, snapshot)}
        info={
          section !== "ageAndSex" ? (
            <>
              <Prose>{copy.purpose}</Prose>
              <Prose>{copy.limits}</Prose>
            </>
          ) : undefined
        }
      />
      {section !== "ageAndSex" ? <QuestionLabel>{copy.question}</QuestionLabel> : null}
      {children}
      <View className="flex-row flex-wrap items-center gap-2">
        <Button
          variant={dirty ? "primary" : "outline"}
          onPress={() => onSave(section)}
          isDisabled={!dirty || state.status === "saving"}
        >
          <Button.Label>{state.status === "saving" ? t`Saving…` : t`Save`}</Button.Label>
        </Button>
        {dirty ? (
          <Button variant="ghost" onPress={() => onUndo(section)}>
            <Button.Label>
              <Trans>Undo changes</Trans>
            </Button.Label>
          </Button>
        ) : null}
        {hasAnswer ? (
          <Button variant="outline" onPress={() => onClear(fields)}>
            <Button.Label>
              <Trans>Clear answer</Trans>
            </Button.Label>
          </Button>
        ) : null}
        <Text
          className={cn(
            "font-sans text-sm",
            state.status === "saved" && !dirty ? "text-success" : "text-ink-3",
          )}
          accessibilityLiveRegion="polite"
        >
          {state.status === "error"
            ? ""
            : dirty
              ? t`Unsaved changes`
              : state.status === "saved"
                ? t`Saved`
                : ""}
        </Text>
      </View>
      {state.status === "error" ? (
        <Text className="font-sans text-sm text-destructive" accessibilityRole="alert">
          {i18n._(state.message)}
        </Text>
      ) : null}
    </Sheet>
  );
}

/** Optional goal shortcut into the existing Goals feature (same as web). */
function GoalSection({ draft }: { draft: WellnessProfileDraft }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: MessageDescriptor } | null>(null);
  const { t, i18n } = useLingui();
  const add = useMutation(
    orpc.plans.goals.upsertGoal.mutationOptions({
      onSuccess: () => {
        setTitle("");
        setMessage({ ok: true, text: msg`Goal added. You can edit it under Workouts.` });
        void queryClient.invalidateQueries({ queryKey: orpc.plans.goals.key() });
      },
      onError: (error) => setMessage({ ok: false, text: describeProfileSaveError(error).message }),
    }),
  );
  const focus = draft.answers.focus.state === "recorded" ? draft.answers.focus.value[0] : undefined;

  return (
    <Sheet className="gap-4">
      <StepHead
        section="goal"
        info={
          <Prose>
            <Trans>
              Add a goal in your own words if you have one. It is saved to your Goals, where you can
              set a target and date later. Nothing is suggested or worked out for you.
            </Trans>
          </Prose>
        }
      />
      <TextInput
        value={title}
        onChangeText={setTitle}
        maxLength={200}
        accessibilityLabel={t`Goal`}
        placeholder={t`For example: walk most days`}
        className="rounded-xl border border-rule bg-paper px-3 py-2.5 font-sans text-base text-ink"
      />
      <Button
        variant="outline"
        className="self-start"
        isDisabled={title.trim().length === 0 || add.isPending}
        onPress={() =>
          add.mutate({
            title: title.trim(),
            category: focus ? FOCUS_AREA_LABELS[focus] : "General",
            status: "not_started",
          })
        }
      >
        <Button.Label>{add.isPending ? t`Adding…` : t`Add goal`}</Button.Label>
      </Button>
      {message ? (
        <Text
          className={cn("font-sans text-sm", message.ok ? "text-success" : "text-destructive")}
          accessibilityRole={message.ok ? "text" : "alert"}
        >
          {i18n._(message.text)}
        </Text>
      ) : null}
    </Sheet>
  );
}
