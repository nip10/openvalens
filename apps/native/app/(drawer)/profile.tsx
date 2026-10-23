import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  buildSectionPatch,
  describeProfileSaveError,
  dirtySections,
  draftFromSnapshot,
  isAdultConfirmed,
  isSectionDirty,
  nextSetupSection,
  parseBirthYearInput,
  rebaseDraft,
  rejectionMessage,
  resetSection,
  SECTION_TITLES,
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
import { Button, Card, Spinner } from "heroui-native";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { CardStack } from "@/components/list-row";
import { Container } from "@/components/container";
import { authClient } from "@/lib/auth-client";
import { client, orpc } from "@/utils/orpc";
import {
  chipsFor,
  selectedChips,
  toggleChip,
  toggleConsent,
  type ChipField,
} from "@/utils/wellness-profile-choices";

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
      <Container className="items-center justify-center" isScrollable={false}>
        <Spinner />
      </Container>
    );
  }
  if (profile.isError || !profile.data) {
    return (
      <Container className="p-4">
        <Card variant="secondary" className="items-center gap-2 p-6">
          <Text className="text-base text-foreground" accessibilityRole="alert">
            <Trans>Could not load your profile. Nothing has changed.</Trans>
          </Text>
          <Pressable onPress={() => void profile.refetch()} accessibilityRole="button">
            <Text className="font-medium text-foreground underline">
              <Trans>Retry</Trans>
            </Text>
          </Pressable>
        </Card>
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
    <Container className="p-4">
      <View className="gap-6">
        <View className="gap-2">
          <Text className="text-2xl font-semibold text-foreground" accessibilityRole="header">
            <Trans>Your profile</Trans>
          </Text>
          <Text className="text-sm text-muted-foreground">{PROFILE_INTRO}</Text>
          <Text className="text-xs text-muted-foreground">{PROFILE_STORAGE_NOTE}</Text>
          <Text className="text-xs text-muted-foreground">{PROFILE_OFFLINE_NOTE}</Text>
        </View>

        <Card variant="secondary" className="gap-2 p-4">
          <Text className="text-sm text-foreground">
            <Trans>
              {progress.answered} of {progress.available} sections answered
            </Trans>
          </Text>
          {next ? (
            <Text className="text-sm text-muted-foreground">
              <Trans>Next unanswered: {i18n._(SECTION_TITLES[next])}</Trans>
            </Text>
          ) : null}
          {dirty.length > 0 ? (
            <Text className="text-sm text-muted-foreground">
              <Trans>Unsaved: {dirty.map((s) => i18n._(SECTION_TITLES[s])).join(", ")}</Trans>
            </Text>
          ) : null}
          {snapshot.setupStatus !== "completed" ? (
            <View className="flex-row gap-3">
              <Button variant="secondary" onPress={() => void finish("skipped")}>
                <Button.Label>
                  <Trans>Skip for now</Trans>
                </Button.Label>
              </Button>
              <Button onPress={() => void finish("completed")} isDisabled={dirty.length > 0}>
                <Button.Label>
                  <Trans>Done</Trans>
                </Button.Label>
              </Button>
            </View>
          ) : null}
          {pageError ? (
            <Text className="text-sm text-destructive" accessibilityRole="alert">
              {i18n._(pageError)}
            </Text>
          ) : null}
        </Card>

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
            <View className="gap-2">
              <Text className="text-sm font-medium text-foreground">
                {WELLNESS_FIELD_COPY.birthYear.question}
              </Text>
              <Text className="text-xs text-muted-foreground">
                {WELLNESS_FIELD_COPY.birthYear.purpose}
              </Text>
              <Text className="text-xs text-muted-foreground">
                {WELLNESS_FIELD_COPY.birthYear.limits}
              </Text>
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
                className="rounded-lg border border-border px-3 py-2 font-mono text-foreground"
              />
              {!parsedYear.ok ? (
                <Text className="text-xs text-destructive" accessibilityRole="alert">
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
            <View className="gap-2">
              <Text className="text-sm font-medium text-foreground">
                {WELLNESS_FIELD_COPY.sex.question}
              </Text>
              <Text className="text-xs text-muted-foreground">
                {WELLNESS_FIELD_COPY.sex.purpose}
              </Text>
              <Text className="text-xs text-muted-foreground">
                {WELLNESS_FIELD_COPY.sex.limits}
              </Text>
              <ConsentToggle
                label={CONSENT_COPY.sex}
                checked={draft.consents.sex}
                onPress={() => change(toggleConsent("sex", draft))}
              />
              <Chips field="sex" draft={draft} onChange={change} />
            </View>
          </Section>
        ) : (
          <CardStack title={i18n._(SECTION_TITLES.ageAndSex)}>
            <Card variant="secondary" className="p-4">
              <Text className="text-sm text-muted-foreground">
                {unavailableExplanation("adult_confirmation_required")}{" "}
                <Trans>
                  Age and sex are only used by adult features, so they are not asked here.
                </Trans>
              </Text>
            </Card>
          </CardStack>
        )}
      </View>
    </Container>
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
    <CardStack title={i18n._(SECTION_TITLES[section])}>
      <Card variant="secondary" className="gap-3 p-4">
        {section !== "ageAndSex" ? (
          <>
            <Text className="text-sm font-medium text-foreground">{copy.question}</Text>
            <Text className="text-xs text-muted-foreground">{copy.purpose}</Text>
          </>
        ) : null}
        {children}
        {section !== "ageAndSex" ? (
          <Text className="text-xs text-muted-foreground">{copy.limits}</Text>
        ) : null}
        <View className="flex-row flex-wrap items-center gap-3">
          <Button onPress={() => onSave(section)} isDisabled={!dirty || state.status === "saving"}>
            <Button.Label>{state.status === "saving" ? t`Saving…` : t`Save`}</Button.Label>
          </Button>
          {dirty ? (
            <Pressable onPress={() => onUndo(section)} accessibilityRole="button">
              <Text className="text-sm text-foreground underline">
                <Trans>Undo changes</Trans>
              </Text>
            </Pressable>
          ) : null}
          {hasAnswer ? (
            <Pressable onPress={() => onClear(fields)} accessibilityRole="button">
              <Text className="text-sm text-foreground underline">
                <Trans>Clear answer</Trans>
              </Text>
            </Pressable>
          ) : null}
          <Text className="text-sm text-muted-foreground" accessibilityLiveRegion="polite">
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
          <Text className="text-sm text-destructive" accessibilityRole="alert">
            {i18n._(state.message)}
          </Text>
        ) : null}
      </Card>
    </CardStack>
  );
}

function Chips({
  field,
  draft,
  onChange,
}: {
  field: ChipField;
  draft: WellnessProfileDraft;
  onChange: (draft: WellnessProfileDraft) => void;
}) {
  const { i18n } = useLingui();
  const selected = selectedChips(field, draft.answers);
  return (
    <View className="flex-row flex-wrap gap-2" accessibilityRole="radiogroup">
      {chipsFor(field, draft).map((chip) => {
        const isSelected = selected.includes(chip.key);
        return (
          <Pressable
            key={chip.key}
            onPress={() => onChange(toggleChip(field, chip.key, draft))}
            disabled={chip.disabled}
            accessibilityRole={field === "focus" ? "checkbox" : "radio"}
            accessibilityState={{
              selected: isSelected,
              checked: isSelected,
              disabled: chip.disabled,
            }}
            className={`rounded-full border px-3 py-1.5 active:opacity-70 ${
              isSelected ? "border-primary bg-primary/15" : "border-border bg-card"
            } ${chip.disabled ? "opacity-40" : ""}`}
          >
            <Text
              className={`text-sm ${
                isSelected ? "font-medium text-foreground" : "text-muted-foreground"
              }`}
            >
              {i18n._(chip.label)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function ConsentToggle({
  label,
  checked,
  onPress,
}: {
  label: string;
  checked: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      className="flex-row items-start gap-2 active:opacity-70"
    >
      <View
        className={`mt-0.5 h-5 w-5 items-center justify-center rounded border ${
          checked ? "border-primary bg-primary" : "border-border"
        }`}
      >
        {checked ? <Text className="text-xs text-primary-foreground">✓</Text> : null}
      </View>
      <Text className="flex-1 text-sm text-foreground">{label}</Text>
    </Pressable>
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
    <CardStack title={i18n._(SECTION_TITLES.goal)}>
      <Card variant="secondary" className="gap-3 p-4">
        <Text className="text-xs text-muted-foreground">
          <Trans>
            Add a goal in your own words if you have one. It is saved to your Goals, where you can
            set a target and date later. Nothing is suggested or worked out for you.
          </Trans>
        </Text>
        <TextInput
          value={title}
          onChangeText={setTitle}
          maxLength={200}
          accessibilityLabel={t`Goal`}
          placeholder={t`For example: walk most days`}
          className="rounded-lg border border-border px-3 py-2 text-foreground"
        />
        <Button
          variant="secondary"
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
            className={`text-sm ${message.ok ? "text-success" : "text-destructive"}`}
            accessibilityRole={message.ok ? "text" : "alert"}
          >
            {i18n._(message.text)}
          </Text>
        ) : null}
      </Card>
    </CardStack>
  );
}
